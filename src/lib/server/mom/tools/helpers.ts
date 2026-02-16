import { spawn } from "node:child_process";

export interface ExecOptions {
  cwd: string;
  timeoutSeconds?: number;
  signal?: AbortSignal;
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

export async function execCommand(command: string, opts: ExecOptions): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("sh", ["-lc", command], {
      cwd: opts.cwd,
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
