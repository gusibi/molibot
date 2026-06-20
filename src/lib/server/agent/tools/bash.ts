import { existsSync, mkdirSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { config } from "$lib/server/app/env.js";
import type { ToolSandboxSettings } from "$lib/server/settings/index.js";
import type {
  ApprovedHostBashEntry,
  HostBashCommandClassification,
  HostBashApprovalPrompt,
  HostBashStore
} from "$lib/server/hostBash/index.js";
import {
  buildHostBashApprovalPrompt,
  classifyHostBashCommand,
  getHostBashStore,
  sanitizeHostBashId
} from "$lib/server/hostBash/index.js";
import { executeApprovedHostBash, executeHostBashApproval } from "$lib/server/agent/hostBashExec.js";
import { momWarn } from "$lib/server/agent/common/log.js";
import type { MomRuntimeStore } from "$lib/server/agent/session/store.js";
import { pollUntilResolved, type PollOutcome } from "$lib/server/approval/approvalWaiter.js";
import { execCommand, normalizeCommandOutput, shellEscape, stripAnsi, wrapCommandWithVenv, toolDefToAgentTool } from "$lib/server/agent/tools/helpers.js";
import { prepareToolSandboxExecution } from "$lib/server/agent/tools/sandbox.js";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateMiddle, type TruncationResult } from "$lib/server/agent/tools/truncate.js";
import type { ToolDefinition, ToolExecutionContext, ToolResult } from "$lib/server/agent/tools/toolTypes.js";

const bashSchema = Type.Object({
  label: Type.String(),
  command: Type.String({
    description: "Shell command to execute in the scratch workspace."
  }),
  timeout: Type.Optional(Type.Number()),
  hostApproval: Type.Optional(Type.Object({
    reason: Type.String({
      description: "Why this command needs controlled host access instead of sandboxed execution. Use only for host-only capabilities such as native app control, browser process access, IPC, OAuth callbacks, or external tool integration."
    }),
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
  hostBash?: boolean;
  truncation?: TruncationResult;
  fullOutputPath?: string;
  sandboxApplied?: boolean;
  sandboxWarning?: string;
  hostBashApproval?: HostBashApprovalPrompt;
}

interface ParsedHostBashCommand {
  toolId: string;
  command: string;
  args: string[];
  originalCommand: string;
  classification: HostBashCommandClassification;
}

export interface BashToolSandboxOptions {
  settings: ToolSandboxSettings;
  workspaceDir: string;
}

export interface BashToolHostApprovalOptions {
  channel: string;
  chatId: string;
  scopeId: string;
  sessionId: string;
  store: MomRuntimeStore;
  hostBashStore?: HostBashStore;
  requestedByDepth?: number;
  approvalWaitTimeoutMs?: number;
}

interface PreparedBashOutput {
  rendered: string;
  details?: BashToolDetails;
}

function buildBashOutput(
  cwd: string,
  output: string,
  details: BashToolDetails | undefined,
  movedArtifacts: string[]
): PreparedBashOutput {
  const truncation = truncateMiddle(output);
  let rendered = truncation.content || "(no output)";
  let nextDetails = details;
  if (movedArtifacts.length > 0) {
    rendered += `\n\n[Moved generated artifact(s) into dated scratch folder: ${movedArtifacts.join(", ")}]`;
  }

  if (truncation.truncated) {
    const fullOutputPath = buildTempOutputPath(cwd);
    writeFileSync(fullOutputPath, output, "utf8");
    rendered += `\n\n[Output compressed from ${truncation.totalLines} lines / ${formatSize(truncation.totalBytes)}. Full output: ${fullOutputPath}]`;
    nextDetails = { ...nextDetails, truncation, fullOutputPath };
  }

  return { rendered, details: nextDetails };
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

function snapshotRootFiles(cwd: string): Map<string, number> {
  try {
    const snapshot = new Map<string, number>();
    for (const entry of readdirSync(cwd, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      try {
        snapshot.set(entry.name, statSync(resolve(cwd, entry.name)).mtimeMs);
      } catch {
        snapshot.set(entry.name, 0);
      }
    }
    return snapshot;
  } catch {
    return new Map();
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

function moveNewRootArtifacts(cwd: string, artifactDir: string | undefined, before: Map<string, number>): string[] {
  if (!artifactDir) return [];
  const targetDir = resolve(cwd, artifactDir);
  mkdirSync(targetDir, { recursive: true });
  const moved: string[] = [];

  for (const [name, mtimeMs] of snapshotRootFiles(cwd)) {
    if (!shouldMoveRootArtifact(name)) continue;
    const previousMtimeMs = before.get(name);
    if (previousMtimeMs !== undefined && previousMtimeMs === mtimeMs) continue;
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

function classifyApprovalRequest(
  store: HostBashStore,
  classification: HostBashCommandClassification
): {
  approvalMode: "persistent" | "ephemeral";
  toolId: string;
  command: string;
  args: string[];
  originalCommand: string;
  classification: HostBashCommandClassification;
} {
  if (classification.kind === "one-time-script") {
    const firstToken = classification.originalCommand.split(/\s+/)[0] ?? "";
    const sanitizedFirst = sanitizeHostBashId(firstToken);
    return {
      approvalMode: "ephemeral",
      toolId: sanitizeHostBashId(sanitizedFirst ? `one-time-${sanitizedFirst}` : "one-time-host-script"),
      command: classification.originalCommand.slice(0, 240),
      args: [],
      originalCommand: classification.originalCommand,
      classification
    };
  }

  const distinctCapabilities = [...new Map(
    (classification.kind === "persistent-capability"
      ? [classification.capability]
      : classification.capabilities
    ).map((item) => [item.toolId, item])
  ).values()];

  if (distinctCapabilities.length === 1) {
    const primary = distinctCapabilities[0];
    return {
      approvalMode: "persistent",
      toolId: primary.toolId,
      command: primary.executable,
      args: primary.argv,
      originalCommand: classification.originalCommand,
      classification
    };
  }

  const unapproved = distinctCapabilities.filter((item) => !store.getApprovedEntry(item.toolId)?.enabled);
  if (unapproved.length === 1) {
    const primary = unapproved[0];
    return {
      approvalMode: "persistent",
      toolId: primary.toolId,
      command: primary.executable,
      args: primary.argv,
      originalCommand: classification.originalCommand,
      classification
    };
  }

  const firstToken = classification.originalCommand.split(/\s+/)[0] ?? "";
  const sanitizedFirst = sanitizeHostBashId(firstToken);
  return {
    approvalMode: "ephemeral",
    toolId: sanitizeHostBashId(sanitizedFirst ? `one-time-${sanitizedFirst}` : "one-time-host-script"),
    command: classification.originalCommand.slice(0, 240),
    args: [],
    originalCommand: classification.originalCommand,
    classification: {
      kind: "one-time-script",
      originalCommand: classification.originalCommand,
      reason: "Command spans multiple host capabilities and cannot be reduced to one reusable approval.",
      detectedTokens: distinctCapabilities.map((item) => item.toolId)
    }
  };
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
): { text: string; prompt?: HostBashApprovalPrompt } {
  const store = options.hostBashStore ?? getHostBashStore();
  const classification = classifyHostBashCommand(command);
  const parsed = classifyApprovalRequest(store, classification);
  const requested = store.requestApproval({
    toolId: parsed.toolId,
    command: parsed.command,
    approvalMode: parsed.approvalMode,
    classification: parsed.classification,
    displayName: approval.displayName,
    reason: approval.reason,
    permissions: approval.permissions,
    pendingAction: parsed.approvalMode === "persistent"
      ? {
          kind: "run_approved_host_bash",
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
    scopeId: options.scopeId,
    sessionId: options.sessionId,
    requestedByDepth: options.requestedByDepth
  });

  if (requested.kind === "existing-approved" && requested.approved) {
    return {
      text: `${requested.approved.displayName} is already approved as Host Bash ${requested.approved.toolId}.`
    };
  }

  if (requested.kind === "existing-pending" && requested.approval) {
    return {
      text: [
        `Host Bash approval is already pending: ${requested.approval.id}`,
        `Tool: ${requested.approval.displayName}`,
        `Command: ${requested.approval.command}`,
        requested.approval.approvalMode === "ephemeral" ? "Mode: one-time" : "Mode: persistent",
        "",
        "Operator can approve or reject it from a structured action."
      ].join("\n"),
      prompt: buildHostBashApprovalPrompt(requested.approval)
    };
  }

  const saved = requested.approval;
  if (!saved) throw new Error("Failed to persist Host Bash approval request.");
  return {
    text: [
      "Host Bash approval requested.",
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
    prompt: buildHostBashApprovalPrompt(saved)
  };
}

const HOST_APPROVAL_WAIT_TIMEOUT_MS = 10 * 60 * 1000;
const HOST_APPROVAL_POLL_INTERVAL_MS = 500;

// Approval is a mandatory gate, so the bash tool call blocks inside the run:
// the channel shows the approval card, the run keeps streaming "waiting", and
// once the user approves, the host command executes inline and its real output
// becomes the tool result. Only if the wait times out do we fall back to the
// asynchronous approve -> execute -> resume flow.
async function waitForHostBashApprovalAndExecute(input: {
  store: HostBashStore;
  prompt: HostBashApprovalPrompt;
  requestText: string;
  ctx: ToolExecutionContext;
  fallbackDetails?: BashToolDetails;
  waitTimeoutMs?: number;
}): Promise<ToolResult> {
  const { store, prompt, ctx } = input;
  const buildFallbackResult = (): ToolResult => ({
    ok: false,
    error: input.requestText || "Tool execution is waiting for approval.",
    metadata: {
      status: "waiting_for_approval"
    },
    details: { ...input.fallbackDetails, hostBashApproval: prompt }
  });
  // Partial store doubles (tests) cannot be polled; keep the async approve flow.
  if (typeof store.getApprovalRecord !== "function") {
    return buildFallbackResult();
  }
  ctx.emit({
    timestamp: new Date().toISOString(),
    workspaceId: ctx.workspaceId,
    type: "tool_end",
    toolName: "bash",
    displayName: "bash",
    summary: `Waiting for user approval: ${prompt.request.reason || prompt.request.displayName || prompt.request.command}`,
    hostBashApproval: prompt
  } as any);

  return pollUntilResolved<ToolResult>({
    timeoutMs: input.waitTimeoutMs ?? HOST_APPROVAL_WAIT_TIMEOUT_MS,
    pollMs: HOST_APPROVAL_POLL_INTERVAL_MS,
    signal: ctx.signal,
    onAbort: () => ({ ok: false, error: "Tool execution aborted while waiting for user approval." }),
    onTimeout: () => buildFallbackResult(),
    poll: async (): Promise<PollOutcome<ToolResult>> => {
      const record = store.getApprovalRecord!(prompt.requestId);
      // Record vanished — fall back to the async approve -> execute -> resume flow.
      if (!record) return { done: true, value: buildFallbackResult() };
      if (record.status === "rejected") {
        return { done: true, value: { ok: false, error: "Tool execution is rejected by user approval." } };
      }
      if (record.status === "expired") {
        return { done: true, value: { ok: false, error: "Tool execution is rejected: the approval request expired." } };
      }
      if (record.status === "executed" || record.status === "failed") {
        // The approval handler raced us and already executed the command out-of-band.
        return {
          done: true,
          value: record.status === "executed"
            ? { ok: true, content: [{ type: "text", text: "Command was approved and executed by the approval handler. Output was delivered to the chat." }] }
            : { ok: false, error: record.errorText || "Approved command failed during execution." }
        };
      }
      if (record.status === "approved") {
        // Claim execution so the channel approval handler cannot also run the
        // command; if the claim is lost, keep polling until the winner records
        // the outcome (executed/failed).
        const claimed = typeof store.claimExecution === "function" ? store.claimExecution(record.id) : true;
        if (!claimed) {
          return { done: false };
        }
        const approvedTool = findApprovedHostBash(
          store,
          tryParseHostBashCommand(record.pendingAction?.originalCommand ?? "")
        );
        try {
          const executed = await executeHostBashApproval({
            record,
            approvedTool: approvedTool ?? undefined,
            cwd: ctx.cwd,
            signal: ctx.signal
          });
          store.markExecution(record.id, "executed");
          return {
            done: true,
            value: { ok: true, content: [{ type: "text", text: executed.rendered }], details: executed.details }
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          store.markExecution(record.id, "failed", message);
          return { done: true, value: { ok: false, error: message } };
        }
      }
      return { done: false };
    }
  });
}

export function tryParseHostBashCommand(command: string): ParsedHostBashCommand | null {
  const classification = classifyHostBashCommand(command);
  if (classification.kind === "one-time-script") return null;

  const primary = classification.kind === "persistent-capability"
    ? classification.capability
    : classification.capabilities[0];
  if (!primary) return null;

  return {
    toolId: primary.toolId,
    command: primary.executable,
    args: primary.argv,
    originalCommand: classification.originalCommand,
    classification
  }
}

export function findApprovedHostBash(
  store: HostBashStore,
  parsed: ParsedHostBashCommand | null
) : ApprovedHostBashEntry | undefined {
  if (!parsed) return undefined;
  const toolIds = parsed.classification.kind === "persistent-capability"
    ? [parsed.classification.capability.toolId]
    : [...new Set(parsed.classification.capabilities.map((item) => item.toolId))];
  if (toolIds.length === 0) return undefined;
  const approvedEntries = toolIds
    .map((toolId) => store.getApprovedEntry(sanitizeHostBashId(toolId)))
    .filter((item): item is ApprovedHostBashEntry => Boolean(item?.enabled));
  if (approvedEntries.length !== toolIds.length) return undefined;

  if (approvedEntries.length === 1) return approvedEntries[0];
  return {
    ...approvedEntries[0],
    toolId: toolIds.join("+"),
    displayName: toolIds.join(", "),
    permissions: {
      envAllowlist: [...new Set(approvedEntries.flatMap((item) => item.permissions.envAllowlist))],
      filesystem: approvedEntries.some((item) => item.permissions.filesystem === "workspace-write")
        ? "workspace-write"
        : approvedEntries.some((item) => item.permissions.filesystem === "workspace-read")
          ? "workspace-read"
          : approvedEntries.some((item) => item.permissions.filesystem === "scratch-only")
            ? "scratch-only"
            : "none",
      network: approvedEntries.some((item) => item.permissions.network === "internet")
        ? "internet"
        : approvedEntries.some((item) => item.permissions.network === "loopback")
          ? "loopback"
          : "none"
    }
  };
}

function isSandboxPermissionFailure(output: string): boolean {
  // Only match signatures the OS sandbox itself produces. Generic words such as
  // "sandbox", "socket", or "access denied" appear in ordinary command output
  // and used to trigger spurious host-approval requests.
  const text = output.toLowerCase();
  return [
    "operation not permitted",
    "permission denied",
    "sandbox-exec",
    "seatbelt"
  ].some((pattern) => text.includes(pattern)) || /\b(?:eperm|eacces)\b/i.test(output);
}

function buildAutomaticHostApprovalReason(parsed: ParsedHostBashCommand): string {
  const capabilitySummary = parsed.classification.kind === "persistent-capability"
    ? parsed.classification.capability.toolId
    : [...new Set(parsed.classification.capabilities.map((item) => item.toolId))].join(", ");
  return `Sandbox denied host-level access for \`${parsed.originalCommand}\`. Approve ${capabilitySummary || "this capability"} as controlled Host Bash access if you want future runs to bypass sandbox for similarly classified commands.`;
}

export function getBashToolDefinition(
  options: {
    cwd: string;
    artifactDir?: string;
    sandbox?: BashToolSandboxOptions;
    hostApproval?: BashToolHostApprovalOptions;
  }
): ToolDefinition {
  const artifactDir = options.artifactDir?.trim();
  return {
    id: "bash",
    name: "bash",
    description:
      `Execute shell commands in the scratch workspace under a runtime-managed sandbox. Use for shell-native work such as scripts, builds, tests, package installs, and data processing. IMPORTANT: Do NOT use bash for reading, writing, or editing files — the dedicated read, write, and edit tools MUST be used instead. Avoid commands like \`cat\`, \`head\`, \`tail\`, \`less\` for reading files (use the read tool), \`cat > file\`, \`echo > file\`, heredocs, or \`tee\` for creating files (use the write tool), and \`sed -i\`, \`awk\`, or \`perl -i\` for modifying files (use the edit tool). Only fall back to shell file manipulation when those tools genuinely cannot express the operation (e.g. bulk renames, chmod, binary processing). Use hostApproval only for host-only capabilities; do not attempt to bypass sandbox limits with command workarounds. Long output is compressed to preserve both the beginning and the end within ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}.`,
    inputSchema: bashSchema,
    risk: "high",
    source: "host",
    handler: async (params: any, ctx) => {
      const hostBashStore = options.hostApproval?.hostBashStore ?? getHostBashStore();
      const hostBashClassification = options.hostApproval
        ? classifyHostBashCommand(params.command)
        : null;
      const parsedHostBashCommand = options.hostApproval
        ? tryParseHostBashCommand(params.command)
        : null;
      const approvedHostBash = options.hostApproval
        ? findApprovedHostBash(hostBashStore, parsedHostBashCommand)
        : undefined;

      if (approvedHostBash && parsedHostBashCommand) {
        const executed = await executeApprovedHostBash({
          tool: approvedHostBash,
          cwd: ctx.cwd,
          originalCommand: parsedHostBashCommand.originalCommand,
          args: parsedHostBashCommand.args,
          timeoutSeconds: params.timeout,
        });
        return {
          ok: true,
          content: [{ type: "text", text: executed.rendered }],
          details: executed.details
        };
      }

      const hostFullAccess = options.sandbox?.settings.enabled === false;
      if (params.hostApproval && !hostFullAccess) {
        if (!options.hostApproval) {
          return { ok: false, error: "Host Bash approval is not configured for this bash tool instance." };
        }
        const requested = requestApprovalFromBash(
          options.hostApproval,
          params.command,
          params.timeout,
          params.hostApproval
        );
        if (!requested.prompt) {
          return { ok: false, error: requested.text || "Tool execution is waiting for approval." };
        }
        return waitForHostBashApprovalAndExecute({
          store: hostBashStore,
          prompt: requested.prompt,
          requestText: requested.text,
          ctx,
          waitTimeoutMs: options.hostApproval.approvalWaitTimeoutMs
        });
      }

      if (artifactDir) {
        mkdirSync(resolve(ctx.cwd, artifactDir), { recursive: true });
      }
      const rootFilesBefore = snapshotRootFiles(ctx.cwd);

      const result = await ctx.shell.run(params.command, {
        cwd: ctx.cwd,
        timeoutMs: params.timeout ? params.timeout * 1000 : undefined
      });

      const movedArtifacts = moveNewRootArtifacts(ctx.cwd, artifactDir, rootFilesBefore);

      try {
        captureSayTranscript(params.command, ctx.cwd);
      } catch {
        // Ignore
      }

      let output = "";
      if (result.stdout) output += result.stdout;
      if (result.stderr) output += `${output ? "\n" : ""}${result.stderr}`;
      output = normalizeCommandOutput(stripAnsi(output));

      let details: BashToolDetails | undefined = result.sandboxApplied || result.warning
        ? { sandboxApplied: result.sandboxApplied, sandboxWarning: result.warning }
        : undefined;
      const built = buildBashOutput(ctx.cwd, output, details, movedArtifacts);
      let rendered = built.rendered;
      details = built.details;

      if (result.exitCode !== 0) {
        let errorBody = `${rendered}\n\nCommand exited with code ${result.exitCode}`.trim();
        if (result.sandboxApplied && options.hostApproval && isSandboxPermissionFailure(rendered)) {
          if (options.hostApproval.store.getSessionHostApprovalMode(options.hostApproval.scopeId, options.hostApproval.sessionId) === "session") {
            const wrappedCommand = wrapCommandWithVenv(params.command);
            const fallbackResult = await execCommand(wrappedCommand, {
              cwd: ctx.cwd,
              timeoutSeconds: params.timeout,
              inheritProcessEnv: true
            });
            const fallbackMovedArtifacts = moveNewRootArtifacts(ctx.cwd, artifactDir, rootFilesBefore);
            let fallbackOutput = "";
            if (fallbackResult.stdout) fallbackOutput += fallbackResult.stdout;
            if (fallbackResult.stderr) fallbackOutput += `${fallbackOutput ? "\n" : ""}${fallbackResult.stderr}`;
            fallbackOutput = normalizeCommandOutput(stripAnsi(fallbackOutput));
            const fallbackBuilt = buildBashOutput(
              ctx.cwd,
              fallbackOutput,
              {
                ...details,
                hostBash: true,
                sandboxApplied: false,
                sandboxWarning: "Sandbox blocked this command. Re-ran with session-approved host bash fallback."
              },
              fallbackMovedArtifacts
            );
            if (fallbackResult.code !== 0) {
              return { ok: false, error: `${fallbackBuilt.rendered}\n\nCommand exited with code ${fallbackResult.code}`.trim() };
            }
            return {
              ok: true,
              content: [{ type: "text", text: `${fallbackBuilt.rendered}\n\n[SESSION] Sandbox was bypassed for this session after a permission denial.`.trim() }],
              details: fallbackBuilt.details
            };
          }
          if (parsedHostBashCommand) {
            const requested = requestApprovalFromBash(
              options.hostApproval,
              params.command,
              params.timeout,
              {
                reason: buildAutomaticHostApprovalReason(parsedHostBashCommand)
              }
            );
            if (!requested.prompt) {
              return { ok: false, error: requested.text || "Sandbox blocked this command and host approval was requested automatically." };
            }
            return waitForHostBashApprovalAndExecute({
              store: hostBashStore,
              prompt: requested.prompt,
              requestText: "Sandbox blocked this command and host approval was requested automatically.",
              ctx,
              fallbackDetails: details,
              waitTimeoutMs: options.hostApproval.approvalWaitTimeoutMs
            });
          }
          const reason = hostBashClassification?.kind === "one-time-script"
            ? hostBashClassification.reason
            : "Automatic approval could not reduce this command to a reusable Host Bash capability.";
          errorBody += `\n\n[SANDBOX] This command appears to need host-level access, but automatic approval kept it as one-time only: ${reason}`;
        } else if (result.sandboxApplied) {
          errorBody += "\n\n[SANDBOX] This command ran inside the OS sandbox. If it failed due to filesystem or network restrictions (e.g. \"Operation not permitted\", \"Permission denied\", socket/IPC errors), request host access through `bash` with `hostApproval.reason`. Once approved, runtime will execute the stored host action automatically. Do not retry the same command through plain bash.";
        }
        return { ok: false, error: errorBody, details };
      }

      return {
        ok: true,
        content: [{ type: "text", text: rendered }],
        details
      };
    }
  };
}

export function createBashTool(cwd: string, options?: {
  artifactDir?: string;
  sandbox?: BashToolSandboxOptions;
  hostApproval?: BashToolHostApprovalOptions;
}): AgentTool<typeof bashSchema> {
  const def = getBashToolDefinition({ cwd, ...options });
  const env = options?.artifactDir ? { MOLIBOT_SCRATCH_ARTIFACT_DIR: options.artifactDir } : undefined;
  return toolDefToAgentTool(def, cwd, env);
}
