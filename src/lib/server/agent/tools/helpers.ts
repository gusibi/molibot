import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import os from "node:os";
import { config } from "$lib/server/app/env.js";

export function resolvePath(p: string): string {
  const trimmed = p.trim();
  if (trimmed.startsWith("~/") || trimmed === "~") {
    return join(os.homedir(), trimmed.slice(1));
  }
  return resolve(trimmed);
}

export function getSandboxVenvDir(): string {
  const customVenv = process.env.MOLIBOT_VENV_DIR;
  if (customVenv) {
    return resolvePath(customVenv);
  }
  return join(getPythonToolingDir(), "venv");
}

export function getPythonToolingDir(): string {
  const customPythonTooling = process.env.MOLIBOT_PYTHON_TOOLING_DIR;
  if (customPythonTooling) {
    return resolvePath(customPythonTooling);
  }
  const customTooling = process.env.MOLIBOT_TOOLING_DIR;
  if (customTooling) {
    return join(resolvePath(customTooling), "python");
  }
  return join(config.dataDir, "tooling", "python");
}

// Deprecated: use getSandboxVenvDir() instead, kept for interface compatibility
export const SANDBOX_VENV_DIR = join(config.dataDir, "tooling", "python", "venv");

export function wrapCommandWithVenv(command: string): string {
  const pythonToolingDir = getPythonToolingDir();
  const venvDir = getSandboxVenvDir();
  const venvBin = process.platform === "win32" ? join(venvDir, "Scripts") : join(venvDir, "bin");
  const venvPython = process.platform === "win32" ? join(venvBin, "python.exe") : join(venvBin, "python");
  const pipCacheDir = join(pythonToolingDir, "pip-cache");
  const uvCacheDir = join(pythonToolingDir, "uv-cache");
  const tmpDir = join(pythonToolingDir, "tmp");
  
  const customToolingDir = process.env.MOLIBOT_TOOLING_DIR;
  const goEnvLines = customToolingDir
    ? [
        `export GOPATH=${shellEscape(join(resolvePath(customToolingDir), "go"))}`,
        `export GOCACHE=${shellEscape(join(resolvePath(customToolingDir), "go-cache"))}`
      ]
    : [];

  return [
    `mkdir -p ${shellEscape(venvDir)} ${shellEscape(pipCacheDir)} ${shellEscape(uvCacheDir)} ${shellEscape(tmpDir)}`,
    `if [ ! -f ${shellEscape(venvPython)} ]; then python3 -m venv ${shellEscape(venvDir)} 2>/dev/null || true; fi`,
    `export PATH=${shellEscape(venvBin)}:$PATH`,
    `export VIRTUAL_ENV=${shellEscape(venvDir)}`,
    `export PIP_CACHE_DIR=${shellEscape(pipCacheDir)}`,
    `export UV_CACHE_DIR=${shellEscape(uvCacheDir)}`,
    `export TMPDIR=${shellEscape(tmpDir)}`,
    `export TEMP=${shellEscape(tmpDir)}`,
    `export TMP=${shellEscape(tmpDir)}`,
    "export PYTHONNOUSERSITE=1",
    ...goEnvLines,
    command
  ].join("\n");
}

export interface ExecOptions {
  cwd: string;
  timeoutSeconds?: number;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  inheritProcessEnv?: boolean;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export function shellEscape(input: string): string {
  return `'${input.replace(/'/g, "'\\''")}'`;
}

export function truncateTail(text: string, maxBytes = 50 * 1024, maxLines = 200): string {
  const lines = text.split("\n");
  let selected = lines.slice(-maxLines).join("\n");
  let bytes = Buffer.byteLength(selected, "utf8");

  if (bytes <= maxBytes) {
    return selected;
  }

  while (bytes > maxBytes && selected.length > 0) {
    selected = selected.slice(Math.floor(selected.length / 2));
    bytes = Buffer.byteLength(selected, "utf8");
  }

  return selected;
}

export function stripAnsi(text: string): string {
  // ANSI escape sequence matcher (color/control codes)
  return text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

export function normalizeCommandOutput(text: string): string {
  if (!text) return "";
  return text
    .split("\n")
    .map((line) => {
      const normalized = line.replace(/\r+/g, "\r");
      const lastCarriage = normalized.lastIndexOf("\r");
      return lastCarriage >= 0 ? normalized.slice(lastCarriage + 1) : normalized;
    })
    .join("\n");
}

export async function execCommand(command: string, opts: ExecOptions): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("sh", ["-lc", command], {
      cwd: opts.cwd,
      env: opts.inheritProcessEnv === false ? { ...opts.env } : { ...process.env, ...opts.env },
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer =
      opts.timeoutSeconds && opts.timeoutSeconds > 0
        ? setTimeout(() => {
            timedOut = true;
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
          }, opts.timeoutSeconds * 1000)
        : undefined;

    const onAbort = (): void => {
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

    if (opts.signal) {
      if (opts.signal.aborted) {
        onAbort();
      } else {
        opts.signal.addEventListener("abort", onAbort, { once: true });
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

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (opts.signal) opts.signal.removeEventListener("abort", onAbort);

      if (opts.signal?.aborted) {
        reject(new Error("Command aborted"));
        return;
      }

      if (timedOut) {
        reject(new Error(`Command timed out after ${opts.timeoutSeconds} seconds`));
        return;
      }

      resolve({ stdout, stderr, code: code ?? 0 });
    });

    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
      reject(error);
    });
  });
}

import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { ToolDefinition, ToolExecutionContext } from "$lib/server/agent/tools/toolTypes.js";
import { promises as fsPromises } from "node:fs";

export function toolDefToAgentTool(def: ToolDefinition, cwd: string, env?: Record<string, string>): AgentTool<any> {
  return {
    name: def.id,
    label: def.name,
    description: def.description,
    parameters: def.inputSchema as any,
    execute: async (toolCallId, params, signal) => {
      const ctx: ToolExecutionContext = {
        runId: toolCallId,
        sessionId: "legacy-session",
        workspaceId: "legacy-workspace",
        actorId: "legacy-actor",
        cwd,
        fs: {
          readText: async (p) => fsPromises.readFile(p, "utf8"),
          writeText: async (p, c) => fsPromises.writeFile(p, c, "utf8"),
          readBuffer: async (p) => fsPromises.readFile(p)
        },
        shell: {
          run: async (cmd, opts) => {
            const res = await execCommand(cmd, {
              cwd: opts?.cwd ?? cwd,
              timeoutSeconds: opts?.timeoutMs ? opts.timeoutMs / 1000 : undefined,
              env: env,
              signal
            });
            return { exitCode: res.code, stdout: res.stdout, stderr: res.stderr };
          }
        },
        network: {
          fetch: async (url, init) => {
            const res = await fetch(url, init as any);
            return {
              status: res.status,
              statusText: res.statusText,
              ok: res.ok,
              headers: Object.fromEntries(res.headers.entries()),
              text: async () => res.text()
            };
          }
        },
        emit: () => {}
      };

      const result = await def.handler(params, ctx);
      if (!result.ok && result.metadata?.status !== "waiting_for_approval") {
        throw new Error(result.error || "Tool execution failed");
      }
      return {
        content: Array.isArray(result.content)
          ? result.content
          : [{ type: "text", text: String(result.content ?? result.error ?? "") }],
        details: result.details
      };
    }
  };
}
