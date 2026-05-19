import { existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { config } from "../../app/env.js";
import type {
  ApprovedHostTool,
  RuntimeSettings,
  ToolSandboxSettings
} from "../../settings/index.js";
import {
  buildHostToolApprovalPrompt,
  parseHostToolApprovalCommand,
  parseHostToolShellCommand,
  requestHostToolApproval,
  sanitizeHostToolId,
  type HostToolApprovalPrompt
} from "../../settings/hostTools.js";
import { executeApprovedHostTool } from "../hostToolExec.js";
import { momWarn } from "../log.js";
import { execCommand, normalizeCommandOutput, shellEscape, stripAnsi } from "./helpers.js";
import { prepareToolSandboxExecution } from "./sandbox.js";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateMiddle, type TruncationResult } from "./truncate.js";

const SANDBOX_VENV_DIR = join(config.dataDir, "tooling", "sandbox-venv");

function wrapCommandWithVenv(command: string): string {
  const venvBin = process.platform === "win32" ? join(SANDBOX_VENV_DIR, "Scripts") : join(SANDBOX_VENV_DIR, "bin");
  const venvPython = process.platform === "win32" ? join(venvBin, "python.exe") : join(venvBin, "python");
  return [
    `if [ ! -f ${shellEscape(venvPython)} ]; then python3 -m venv ${shellEscape(SANDBOX_VENV_DIR)} 2>/dev/null || true; fi`,
    `export PATH=${shellEscape(venvBin)}:$PATH`,
    `export VIRTUAL_ENV=${shellEscape(SANDBOX_VENV_DIR)}`,
    command
  ].join("\n");
}

const bashSchema = Type.Object({
  label: Type.String(),
  command: Type.String(),
  timeout: Type.Optional(Type.Number()),
  hostApproval: Type.Optional(Type.Object({
    reason: Type.String(),
    displayName: Type.Optional(Type.String()),
    permissions: Type.Optional(Type.Object({
      envAllowlist: Type.Optional(Type.Array(Type.String())),
      filesystem: Type.Optional(Type.Union([
        Type.Literal("none"),
        Type.Literal("scratch-only"),
        Type.Literal("workspace-read"),
        Type.Literal("workspace-write")
      ])),
      network: Type.Optional(Type.Union([
        Type.Literal("none"),
        Type.Literal("loopback"),
        Type.Literal("internet")
      ]))
    }, { additionalProperties: false }))
  }, { additionalProperties: false }))
});

interface BashToolDetails {
  truncation?: TruncationResult;
  fullOutputPath?: string;
  sandboxApplied?: boolean;
  sandboxWarning?: string;
  hostToolApproval?: HostToolApprovalPrompt;
}

interface ParsedHostToolCommand {
  command: string;
  args: string[];
  originalCommand: string;
}

export interface BashToolSandboxOptions {
  settings: ToolSandboxSettings;
  workspaceDir: string;
}

export interface BashToolHostApprovalOptions {
  channel: string;
  chatId: string;
  scopeId: string;
  getSettings: () => RuntimeSettings;
  updateSettings: (patch: Partial<RuntimeSettings>) => RuntimeSettings;
}

const ROOT_ARTIFACT_EXTENSIONS = new Set([
  ".aac", ".aif", ".aiff", ".amr", ".avif", ".csv", ".doc", ".docx", ".gif", ".html",
  ".jpeg", ".jpg", ".json", ".m4a", ".md", ".mp3", ".mp4", ".oga", ".ogg", ".opus",
  ".pdf", ".png", ".svg", ".txt", ".wav", ".webm", ".webp", ".xls", ".xlsx", ".zip"
]);
const ROOT_ARTIFACT_EXCLUDED_NAMES = new Set([
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock"
]);

function buildTempOutputPath(cwd: string): string {
  const dir = join(cwd, ".mom-tool-output");
  mkdirSync(dir, { recursive: true });
  return join(dir, `bash-${Date.now()}-${randomBytes(4).toString("hex")}.log`);
}

function listRootFileNames(cwd: string): Set<string> {
  try {
    return new Set(
      readdirSync(cwd, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
    );
  } catch {
    return new Set();
  }
}

function shouldMoveRootArtifact(name: string): boolean {
  if (!name || name.startsWith(".")) return false;
  if (ROOT_ARTIFACT_EXCLUDED_NAMES.has(name.toLowerCase())) return false;
  return ROOT_ARTIFACT_EXTENSIONS.has(extname(name).toLowerCase());
}

function uniqueArtifactPath(dir: string, name: string): string {
  const ext = extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  let candidate = join(dir, name);
  let index = 1;
  while (existsSync(candidate)) {
    candidate = join(dir, `${stem}-${index}${ext}`);
    index += 1;
  }
  return candidate;
}

function moveNewRootArtifacts(cwd: string, artifactDir: string | undefined, before: Set<string>): string[] {
  if (!artifactDir) return [];
  const targetDir = resolve(cwd, artifactDir);
  mkdirSync(targetDir, { recursive: true });
  const moved: string[] = [];

  for (const name of listRootFileNames(cwd)) {
    if (before.has(name) || !shouldMoveRootArtifact(name)) continue;
    const from = resolve(cwd, name);
    const to = uniqueArtifactPath(targetDir, name);
    try {
      renameSync(from, to);
      moved.push(relative(cwd, to).replace(/\\/g, "/"));
    } catch {
      // Keep the original file if relocation fails; command output remains authoritative.
    }
  }

  return moved;
}

function stripShellQuotes(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function decodeDoubleQuotedShellText(value: string): string {
  const unquoted = stripShellQuotes(value);
  return unquoted
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, "\"")
    .replace(/\\\\/g, "\\");
}

function inferCommandWorkingDir(command: string, fallbackCwd: string): string {
  const match = command.match(/(?:^|\s)cd\s+("[^"]+"|'[^']+'|[^\s&;|]+)\s*(?:&&|;|\|\|)/);
  if (!match) return fallbackCwd;
  const rawDir = stripShellQuotes(match[1] ?? "");
  return isAbsolute(rawDir) ? rawDir : resolve(fallbackCwd, rawDir);
}

function captureSayTranscript(command: string, fallbackCwd: string): void {
  const sayMatch = command.match(/\bsay\b[\s\S]*?\s-o\s+("[^"]+"|'[^']+'|[^\s]+)\s+("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/);
  if (!sayMatch) return;

  const baseDir = inferCommandWorkingDir(command, fallbackCwd);
  const rawOutputPath = stripShellQuotes(sayMatch[1] ?? "");
  const transcript = decodeDoubleQuotedShellText(sayMatch[2] ?? "");
  if (!rawOutputPath || !transcript.trim()) return;

  const outputPath = isAbsolute(rawOutputPath) ? rawOutputPath : resolve(baseDir, rawOutputPath);
  writeFileSync(`${outputPath}.transcript.txt`, `${transcript.trim()}\n`, "utf8");
}

function requestApprovalFromBash(
  options: BashToolHostApprovalOptions,
  command: string,
  timeoutSeconds: number | undefined,
  approval: {
    reason: string;
    displayName?: string;
    permissions?: {
      envAllowlist?: string[];
      filesystem?: "none" | "scratch-only" | "workspace-read" | "workspace-write";
      network?: "none" | "loopback" | "internet";
    };
  }
): { text: string; prompt?: HostToolApprovalPrompt } {
  const parsed = parseHostToolApprovalCommand(command);
  const requested = requestHostToolApproval(options.getSettings().hostTools, {
    toolId: parsed.toolId,
    command: parsed.command,
    approvalMode: parsed.approvalMode,
    displayName: approval.displayName,
    reason: approval.reason,
    permissions: approval.permissions,
    pendingAction: parsed.approvalMode === "persistent"
      ? {
          kind: "run_approved_host_tool",
          originalCommand: parsed.originalCommand,
          args: parsed.args,
          timeout: timeoutSeconds
        }
      : {
          kind: "run_one_time_host_script",
          originalCommand: parsed.originalCommand,
          timeout: timeoutSeconds
        },
    channel: options.channel,
    chatId: options.chatId,
    scopeId: options.scopeId
  });

  if (requested.kind === "existing-approved" && requested.approved) {
    return {
      text: `${requested.approved.displayName} is already approved as host tool ${requested.approved.toolId}.`
    };
  }

  if (requested.kind === "existing-pending" && requested.approval) {
    return {
      text: [
        `Host tool approval is already pending: ${requested.approval.id}`,
        `Tool: ${requested.approval.displayName}`,
        `Command: ${requested.approval.command}`,
        requested.approval.approvalMode === "ephemeral" ? "Mode: one-time" : "Mode: persistent",
        "",
        "Operator can approve or reject it from a structured action."
      ].join("\n"),
      prompt: buildHostToolApprovalPrompt(requested.approval)
    };
  }

  const nextSettings = options.updateSettings({ hostTools: requested.settings });
  const saved = nextSettings.hostTools.pendingApprovals[0];
  if (!saved) throw new Error("Failed to persist host tool approval request.");
  return {
    text: [
      "Host tool approval requested.",
      `Approval ID: ${saved.id}`,
      `Tool: ${saved.displayName} (${saved.toolId})`,
      `Command: ${saved.command}`,
      `Mode: ${saved.approvalMode === "ephemeral" ? "one-time" : "persistent"}`,
      saved.pendingAction?.args?.length ? `Args: ${saved.pendingAction.args.join(" ")}` : "",
      `Reason: ${saved.reason}`,
      `Permissions: filesystem=${saved.permissions.filesystem}, network=${saved.permissions.network}, env=${saved.permissions.envAllowlist.join(", ") || "(none)"}`,
      "",
      "Approve or reject it from the structured action UI."
    ].filter(Boolean).join("\n"),
    prompt: buildHostToolApprovalPrompt(saved)
  };
}

function tryParseHostToolCommand(command: string): ParsedHostToolCommand | null {
  try {
    return parseHostToolShellCommand(command);
  } catch {
    return null;
  }
}

function findApprovedHostTool(
  settings: RuntimeSettings,
  parsed: ParsedHostToolCommand | null
): ApprovedHostTool | undefined {
  if (!parsed) return undefined;
  const toolId = sanitizeHostToolId(parsed.command);
  return settings.hostTools.approvedTools.find((item) => item.enabled && item.toolId === toolId);
}

function isSandboxPermissionFailure(output: string): boolean {
  const text = output.toLowerCase();
  return [
    "operation not permitted",
    "permission denied",
    "not permitted",
    "sandbox",
    "access denied",
    "socket",
    "ipc"
  ].some((pattern) => text.includes(pattern));
}

function buildAutomaticHostApprovalReason(parsed: ParsedHostToolCommand): string {
  return `Sandbox denied host-level access for \`${parsed.originalCommand}\`. Approve this executable as a controlled host capability if you want future runs to bypass sandbox for this command.`;
}

export function createBashTool(cwd: string, options?: {
  artifactDir?: string;
  sandbox?: BashToolSandboxOptions;
  hostApproval?: BashToolHostApprovalOptions;
}): AgentTool<typeof bashSchema> {
  const artifactDir = options?.artifactDir?.trim();
  return {
    name: "bash",
    label: "bash",
    description:
      `Execute a bash command in scratch workspace. When creating ordinary generated files, prefer $MOLIBOT_SCRATCH_ARTIFACT_DIR. Long output is compressed to preserve both the beginning and the end within ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}.`,
    parameters: bashSchema,
    execute: async (_toolCallId, params, signal) => {
      const parsedHostToolCommand = options?.hostApproval
        ? tryParseHostToolCommand(params.command)
        : null;
      const approvedHostTool = options?.hostApproval
        ? findApprovedHostTool(options.hostApproval.getSettings(), parsedHostToolCommand)
        : undefined;

      if (approvedHostTool && parsedHostToolCommand) {
        const executed = await executeApprovedHostTool({
          tool: approvedHostTool,
          cwd,
          originalCommand: parsedHostToolCommand.originalCommand,
          args: parsedHostToolCommand.args,
          timeoutSeconds: params.timeout,
          signal
        });
        return {
          content: [{ type: "text", text: executed.rendered }],
          details: executed.details
        };
      }

      if (params.hostApproval) {
        if (!options?.hostApproval) {
          throw new Error("Host tool approval is not configured for this bash tool instance.");
        }
        const requested = requestApprovalFromBash(
          options.hostApproval,
          params.command,
          params.timeout,
          params.hostApproval
        );
        return {
          content: [{
            type: "text",
            text: requested.text
          }],
          details: requested.prompt ? { hostToolApproval: requested.prompt } : undefined
        };
      }

      if (artifactDir) {
        mkdirSync(resolve(cwd, artifactDir), { recursive: true });
      }
      const rootFilesBefore = listRootFileNames(cwd);

      const sandboxEnv = artifactDir ? { MOLIBOT_SCRATCH_ARTIFACT_DIR: artifactDir } : {};
      const wrappedCommand = wrapCommandWithVenv(params.command);
      const sandboxed = options?.sandbox?.settings.enabled
        ? await prepareToolSandboxExecution({
            settings: options.sandbox.settings,
            workspaceDir: options.sandbox.workspaceDir,
            cwd,
            command: wrappedCommand,
            env: sandboxEnv,
            signal
          })
        : {
            command: wrappedCommand,
            env: sandboxEnv,
            inheritProcessEnv: true,
            sandboxApplied: false,
            warning: undefined
          };

      if (sandboxed.warning) {
        momWarn("runner", "tool_sandbox_disabled", {
          cwd,
          reason: sandboxed.warning
        });
      }

      const result = await execCommand(sandboxed.command, {
        cwd,
        timeoutSeconds: params.timeout,
        signal,
        env: sandboxed.env,
        inheritProcessEnv: sandboxed.inheritProcessEnv
      });
      const movedArtifacts = moveNewRootArtifacts(cwd, artifactDir, rootFilesBefore);

      try {
        captureSayTranscript(params.command, cwd);
      } catch {
        // Ignore transcript sidecar capture failures; command output remains authoritative.
      }

      let output = "";
      if (result.stdout) output += result.stdout;
      if (result.stderr) output += `${output ? "\n" : ""}${result.stderr}`;
      output = normalizeCommandOutput(stripAnsi(output));

      const truncation = truncateMiddle(output);
      let rendered = truncation.content || "(no output)";
      let details: BashToolDetails | undefined = sandboxed.sandboxApplied || sandboxed.warning
        ? { sandboxApplied: sandboxed.sandboxApplied, sandboxWarning: sandboxed.warning }
        : undefined;
      if (movedArtifacts.length > 0) {
        rendered += `\n\n[Moved generated artifact(s) into dated scratch folder: ${movedArtifacts.join(", ")}]`;
      }

      if (truncation.truncated) {
        const fullOutputPath = buildTempOutputPath(cwd);
        writeFileSync(fullOutputPath, output, "utf8");
        rendered += `\n\n[Output compressed from ${truncation.totalLines} lines / ${formatSize(truncation.totalBytes)}. Full output: ${fullOutputPath}]`;
        details = { ...details, truncation, fullOutputPath };
      }

      if (result.code !== 0) {
        let errorBody = `${rendered}\n\nCommand exited with code ${result.code}`.trim();
        if (sandboxed.sandboxApplied && options?.hostApproval && isSandboxPermissionFailure(rendered)) {
          if (parsedHostToolCommand) {
            const requested = requestApprovalFromBash(
              options.hostApproval,
              params.command,
              params.timeout,
              {
                reason: buildAutomaticHostApprovalReason(parsedHostToolCommand)
              }
            );
            return {
              content: [{
                type: "text",
                text: [
                  "Sandbox blocked this command and host approval was requested automatically.",
                  "",
                  requested.text,
                  "",
                  "Original sandbox error:",
                  rendered
                ].join("\n")
              }],
              details: {
                ...details,
                hostToolApproval: requested.prompt
              }
            };
          }
          errorBody += "\n\n[SANDBOX] This command appears to need host-level access, but automatic approval only supports a single executable command with structured argv. Split it into one command and retry.";
        } else if (sandboxed.sandboxApplied) {
          errorBody += "\n\n[SANDBOX] This command ran inside the OS sandbox. If it failed due to filesystem or network restrictions (e.g. \"Operation not permitted\", \"Permission denied\", socket/IPC errors), request host access through `bash` with `hostApproval.reason`. Once approved, runtime will execute the stored host action automatically. Do not retry the same command through plain bash.";
        }
        throw new Error(errorBody);
      }

      return {
        content: [{ type: "text", text: rendered }],
        details
      };
    }
  };
}
