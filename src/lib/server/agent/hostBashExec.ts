import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ApprovedHostBashEntry, HostBashApprovalRecord, HostBashPermissions } from "$lib/server/hostBash/index.js";
import { normalizeCommandOutput, stripAnsi } from "$lib/server/agent/tools/helpers.js";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateMiddle,
  type TruncationResult
} from "$lib/server/agent/tools/truncate.js";

interface HostBashExecutionDetails {
  hostBash: true;
  toolId: string;
  command: string;
  args: string[];
  exitCode: number;
  truncation?: TruncationResult;
  fullOutputPath?: string;
}

interface HostRunResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface ApprovedHostBashRunOutput {
  rendered: string;
  details: HostBashExecutionDetails;
}

export function hasVisibleHostBashOutput(rendered: string): boolean {
  const normalized = rendered.trim();
  return normalized.length > 0 && normalized !== "(no output)";
}

function buildTempOutputPath(cwd: string): string {
  const dir = join(cwd, ".mom-tool-output");
  mkdirSync(dir, { recursive: true });
  return join(dir, `host-bash-${Date.now()}-${randomBytes(4).toString("hex")}.log`);
}

async function buildHostEnv(permissions: HostBashPermissions): Promise<NodeJS.ProcessEnv> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of permissions.envAllowlist) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  // Inject browser automation timeout from runtime settings (lazy import to break circular dependency)
  try {
    const { getRuntime } = await import("$lib/server/app/runtime.js");
    const settings = getRuntime().getSettings();
    env.AGENT_BROWSER_DEFAULT_TIMEOUT = String(settings.browserAutomation.defaultTimeoutMs);
  } catch {
    // Runtime may not be initialized during tests; fall through to process.env
  }
  return env;
}

async function runHostCommand(input: {
  command: string;
  permissions: HostBashPermissions;
  cwd: string;
  timeoutSeconds?: number;
  stdin?: string;
  signal?: AbortSignal;
}): Promise<HostRunResult> {
  const shell = process.env.SHELL || (process.platform === "win32" ? "cmd.exe" : "zsh");
  const shellArgs = process.platform === "win32" ? ["/d", "/s", "/c", input.command] : ["-lc", input.command];
  const env = await buildHostEnv(input.permissions);
  return new Promise((resolve, reject) => {
    const timeoutSeconds = input.timeoutSeconds && input.timeoutSeconds > 0
      ? Math.min(Math.round(input.timeoutSeconds), 600)
      : 60;
    const child = spawn(shell, shellArgs, {
      cwd: input.cwd,
      env,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
      shell: false
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const killChild = (): void => {
      try {
        if (process.platform === "win32") {
          child.kill("SIGKILL");
        } else if (child.pid) {
          process.kill(-child.pid, "SIGKILL");
        }
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killChild();
    }, timeoutSeconds * 1000);

    const onAbort = (): void => {
      killChild();
    };
    if (input.signal) {
      if (input.signal.aborted) {
        onAbort();
      } else {
        input.signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > 10 * 1024 * 1024) stdout = stdout.slice(0, 10 * 1024 * 1024);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 10 * 1024 * 1024) stderr = stderr.slice(0, 10 * 1024 * 1024);
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      if (input.signal) input.signal.removeEventListener("abort", onAbort);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (input.signal) input.signal.removeEventListener("abort", onAbort);
      if (input.signal?.aborted) {
        reject(new Error("Host Bash command aborted"));
        return;
      }
      if (timedOut) {
        reject(new Error(`Host Bash command timed out after ${timeoutSeconds} seconds`));
        return;
      }
      resolve({ stdout, stderr, code: code ?? 0 });
    });

    if (input.stdin) child.stdin?.end(input.stdin); else child.stdin?.end();
  });
}

export async function executeApprovedHostBash(input: {
  tool: ApprovedHostBashEntry;
  cwd: string;
  originalCommand: string;
  args: string[];
  stdin?: string;
  timeoutSeconds?: number;
  signal?: AbortSignal;
}): Promise<ApprovedHostBashRunOutput> {
  const result = await runHostCommand({
    command: input.originalCommand,
    permissions: input.tool.permissions,
    cwd: input.cwd,
    timeoutSeconds: input.timeoutSeconds,
    stdin: input.stdin,
    signal: input.signal
  });

  let output = "";
  if (result.stdout) output += result.stdout;
  if (result.stderr) output += `${output ? "\n" : ""}${result.stderr}`;
  output = normalizeCommandOutput(stripAnsi(output));

  const truncation = truncateMiddle(output, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
  let rendered = truncation.content || "(no output)";
  const details: HostBashExecutionDetails = {
    hostBash: true,
    toolId: input.tool.toolId,
    command: input.tool.command,
    args: input.args,
    exitCode: result.code
  };

  if (truncation.truncated) {
    const fullOutputPath = buildTempOutputPath(input.cwd);
    writeFileSync(fullOutputPath, output, "utf8");
    rendered += `\n\n[Output compressed from ${truncation.totalLines} lines / ${formatSize(truncation.totalBytes)}. Full output: ${fullOutputPath}]`;
    details.truncation = truncation;
    details.fullOutputPath = fullOutputPath;
  }

  if (result.code !== 0) {
    throw new Error(`${rendered}\n\nHost Bash exited with code ${result.code}`.trim());
  }

  return { rendered, details };
}

async function runOneTimeHostScript(input: {
  record: HostBashApprovalRecord;
  cwd: string;
  signal?: AbortSignal;
}): Promise<ApprovedHostBashRunOutput> {
  const pendingAction = input.record.pendingAction;
  if (!pendingAction || pendingAction.kind !== "run_one_time_host_script") {
    throw new Error("Missing one-time host script payload.");
  }
  const result = await runHostCommand({
    command: pendingAction.originalCommand,
    permissions: input.record.permissions,
    cwd: input.cwd,
    timeoutSeconds: pendingAction.timeout,
    stdin: pendingAction.stdin,
    signal: input.signal
  });

  let output = "";
  if (result.stdout) output += result.stdout;
  if (result.stderr) output += `${output ? "\n" : ""}${result.stderr}`;
  output = normalizeCommandOutput(stripAnsi(output));

  const truncation = truncateMiddle(output, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
  let rendered = truncation.content || "(no output)";
  const details: HostBashExecutionDetails = {
    hostBash: true,
    toolId: input.record.toolId,
    command: input.record.command,
    args: [],
    exitCode: result.code
  };

  if (truncation.truncated) {
    const fullOutputPath = buildTempOutputPath(input.cwd);
    writeFileSync(fullOutputPath, output, "utf8");
    rendered += `\n\n[Output compressed from ${truncation.totalLines} lines / ${formatSize(truncation.totalBytes)}. Full output: ${fullOutputPath}]`;
    details.truncation = truncation;
    details.fullOutputPath = fullOutputPath;
  }

  if (result.code !== 0) {
    throw new Error(`${rendered}\n\nHost Bash exited with code ${result.code}`.trim());
  }

  return { rendered, details };
}

async function runApprovedRecordHostBash(input: {
  record: HostBashApprovalRecord;
  cwd: string;
  signal?: AbortSignal;
}): Promise<ApprovedHostBashRunOutput> {
  const pendingAction = input.record.pendingAction;
  if (!pendingAction || pendingAction.kind !== "run_approved_host_bash") {
    throw new Error("Missing approved host bash payload.");
  }
  const result = await runHostCommand({
    command: pendingAction.originalCommand,
    permissions: input.record.permissions,
    cwd: input.cwd,
    timeoutSeconds: pendingAction.timeout,
    stdin: pendingAction.stdin,
    signal: input.signal
  });

  let output = "";
  if (result.stdout) output += result.stdout;
  if (result.stderr) output += `${output ? "\n" : ""}${result.stderr}`;
  output = normalizeCommandOutput(stripAnsi(output));

  const truncation = truncateMiddle(output, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
  let rendered = truncation.content || "(no output)";
  const details: HostBashExecutionDetails = {
    hostBash: true,
    toolId: input.record.toolId,
    command: input.record.command,
    args: pendingAction.args ?? [],
    exitCode: result.code
  };

  if (truncation.truncated) {
    const fullOutputPath = buildTempOutputPath(input.cwd);
    writeFileSync(fullOutputPath, output, "utf8");
    rendered += `\n\n[Output compressed from ${truncation.totalLines} lines / ${formatSize(truncation.totalBytes)}. Full output: ${fullOutputPath}]`;
    details.truncation = truncation;
    details.fullOutputPath = fullOutputPath;
  }

  if (result.code !== 0) {
    throw new Error(`${rendered}\n\nHost Bash exited with code ${result.code}`.trim());
  }

  return { rendered, details };
}

export async function executeHostBashApproval(input: {
  record: HostBashApprovalRecord;
  approvedTool?: ApprovedHostBashEntry;
  cwd: string;
  signal?: AbortSignal;
}): Promise<ApprovedHostBashRunOutput> {
  if (!input.record.pendingAction) {
    throw new Error("Missing pending host action payload.");
  }
  if (input.record.pendingAction.kind === "run_one_time_host_script") {
    return runOneTimeHostScript({
      record: input.record,
      cwd: input.cwd,
      signal: input.signal
    });
  }
  if (!input.approvedTool) {
    return runApprovedRecordHostBash({
      record: input.record,
      cwd: input.cwd,
      signal: input.signal
    });
  }
  return executeApprovedHostBash({
    tool: input.approvedTool,
    cwd: input.cwd,
    originalCommand: input.record.pendingAction.originalCommand,
    args: input.record.pendingAction.args ?? [],
    stdin: input.record.pendingAction.stdin,
    timeoutSeconds: input.record.pendingAction.timeout,
    signal: input.signal
  });
}

export function rewriteApprovalToolResultInContext(
  messages: any[],
  command: string,
  renderedOutput: string
): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      const toolCall = msg.content.find(
        (part: any) =>
          part.type === "toolCall" &&
          part.name === "bash" &&
          typeof part.arguments === "object" &&
          part.arguments !== null &&
          typeof part.arguments.command === "string" &&
          part.arguments.command.trim() === command.trim()
      ) as any;
      if (toolCall) {
        const toolCallId = toolCall.id;
        for (let j = messages.length - 1; j >= 0; j--) {
          const resultMsg = messages[j];
          if (resultMsg.role === "toolResult" && resultMsg.toolCallId === toolCallId) {
            resultMsg.content = [{ type: "text", text: renderedOutput }];
            return true;
          }
        }
      }
    }
  }
  return false;
}
