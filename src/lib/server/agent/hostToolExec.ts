import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ApprovedHostTool, HostToolApprovalRequest, HostToolPermissions } from "../settings/index.js";
import { normalizeCommandOutput, stripAnsi } from "./tools/helpers.js";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateMiddle,
  type TruncationResult
} from "./tools/truncate.js";

interface HostToolExecutionDetails {
  hostTool: true;
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

export interface ApprovedHostToolRunOutput {
  rendered: string;
  details: HostToolExecutionDetails;
}

function buildTempOutputPath(cwd: string): string {
  const dir = join(cwd, ".mom-tool-output");
  mkdirSync(dir, { recursive: true });
  return join(dir, `host-tool-${Date.now()}-${randomBytes(4).toString("hex")}.log`);
}

function buildHostEnv(permissions: HostToolPermissions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of permissions.envAllowlist) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

async function runHostCommand(input: {
  command: string;
  permissions: HostToolPermissions;
  cwd: string;
  timeoutSeconds?: number;
  stdin?: string;
  signal?: AbortSignal;
}): Promise<HostRunResult> {
  const shell = process.env.SHELL || (process.platform === "win32" ? "cmd.exe" : "zsh");
  const shellArgs = process.platform === "win32"
    ? ["/d", "/s", "/c", input.command]
    : ["-lc", input.command];
  return new Promise((resolve, reject) => {
    const timeoutSeconds = input.timeoutSeconds && input.timeoutSeconds > 0
      ? Math.min(Math.round(input.timeoutSeconds), 600)
      : 60;
    const child = spawn(shell, shellArgs, {
      cwd: input.cwd,
      env: buildHostEnv(input.permissions),
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
        reject(new Error("Host tool command aborted"));
        return;
      }
      if (timedOut) {
        reject(new Error(`Host tool command timed out after ${timeoutSeconds} seconds`));
        return;
      }
      resolve({ stdout, stderr, code: code ?? 0 });
    });

    if (input.stdin) {
      child.stdin?.end(input.stdin);
    } else {
      child.stdin?.end();
    }
  });
}

export async function executeApprovedHostTool(input: {
  tool: ApprovedHostTool;
  cwd: string;
  originalCommand: string;
  args: string[];
  stdin?: string;
  timeoutSeconds?: number;
  signal?: AbortSignal;
}): Promise<ApprovedHostToolRunOutput> {
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
  const details: HostToolExecutionDetails = {
    hostTool: true,
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
    throw new Error(`${rendered}\n\nHost tool exited with code ${result.code}`.trim());
  }

  return { rendered, details };
}

async function runOneTimeHostScript(input: {
  request: HostToolApprovalRequest;
  cwd: string;
  signal?: AbortSignal;
}): Promise<ApprovedHostToolRunOutput> {
  const pendingAction = input.request.pendingAction;
  if (!pendingAction || pendingAction.kind !== "run_one_time_host_script") {
    throw new Error("Missing one-time host script payload.");
  }
  const result = await runHostCommand({
    command: pendingAction.originalCommand,
    permissions: input.request.permissions,
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
  const details: HostToolExecutionDetails = {
    hostTool: true,
    toolId: input.request.toolId,
    command: input.request.command,
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
    throw new Error(`${rendered}\n\nHost tool exited with code ${result.code}`.trim());
  }

  return { rendered, details };
}

export async function executeHostToolApproval(input: {
  request: HostToolApprovalRequest;
  approvedTool?: ApprovedHostTool;
  cwd: string;
  signal?: AbortSignal;
}): Promise<ApprovedHostToolRunOutput> {
  if (!input.request.pendingAction) {
    throw new Error("Missing pending host action payload.");
  }
  if (input.request.pendingAction.kind === "run_one_time_host_script") {
    return runOneTimeHostScript({
      request: input.request,
      cwd: input.cwd,
      signal: input.signal
    });
  }
  if (!input.approvedTool) {
    throw new Error("Missing approved host tool definition.");
  }
  return executeApprovedHostTool({
    tool: input.approvedTool,
    cwd: input.cwd,
    originalCommand: input.request.pendingAction.originalCommand,
    args: input.request.pendingAction.args ?? [],
    stdin: input.request.pendingAction.stdin,
    timeoutSeconds: input.request.pendingAction.timeout,
    signal: input.signal
  });
}
