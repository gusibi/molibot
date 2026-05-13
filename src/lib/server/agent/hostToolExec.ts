import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ApprovedHostTool } from "../settings/index.js";
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

function buildHostEnv(tool: ApprovedHostTool): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of tool.permissions.envAllowlist) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

async function runHostCommand(input: {
  tool: ApprovedHostTool;
  cwd: string;
  args: string[];
  stdin?: string;
  timeoutSeconds?: number;
  signal?: AbortSignal;
}): Promise<HostRunResult> {
  return new Promise((resolve, reject) => {
    const timeoutSeconds = input.timeoutSeconds && input.timeoutSeconds > 0
      ? Math.min(Math.round(input.timeoutSeconds), 600)
      : 60;
    const child = spawn(input.tool.command, input.args, {
      cwd: input.cwd,
      env: buildHostEnv(input.tool),
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
  args: string[];
  stdin?: string;
  timeoutSeconds?: number;
  signal?: AbortSignal;
}): Promise<ApprovedHostToolRunOutput> {
  const result = await runHostCommand(input);

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
