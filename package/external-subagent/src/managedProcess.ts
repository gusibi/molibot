import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { setTimeout as sleepMs } from "node:timers/promises";

export const DEFAULT_DISPOSE_GRACE_MS = 3_000;

export interface ManagedProcessSpawnSpec {
  argv: readonly string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  stdio?: {
    stdin?: "pipe" | "ignore";
    stdout?: "pipe" | "inherit" | "ignore";
    stderr?: "pipe" | "inherit" | "ignore";
  };
  graceMs?: number;
  signal?: AbortSignal;
}

export interface ProcessOutcome {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

export interface ManagedProcessHandle {
  readonly pid: number;
  readonly stdin: Writable | undefined;
  readonly stdout: Readable | undefined;
  readonly stderr: Readable | undefined;
  readonly done: Promise<ProcessOutcome>;
  terminate(): void;
  waitForExit(signal?: AbortSignal): Promise<boolean>;
}

export function killProcessGroup(pid: number, signal: NodeJS.Signals): void {
  if (pid <= 0) return;
  try {
    process.kill(-pid, signal);
  } catch {
    // ESRCH or process already exited
  }
}

export function taskkillWindowsProcessTree(pid: number): void {
  if (pid <= 0) return;
  try {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
  } catch {
    // Best effort on Windows
  }
}

function signalProcessTree(
  platform: NodeJS.Platform,
  pid: number,
  signal: NodeJS.Signals,
  child: ChildProcess
): void {
  if (platform === "win32") {
    taskkillWindowsProcessTree(pid);
    return;
  }
  if (pid <= 0) return;
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // Child already dead
    }
  }
}

export function spawnManagedProcess(spec: ManagedProcessSpawnSpec): ManagedProcessHandle {
  const graceMs = spec.graceMs ?? DEFAULT_DISPOSE_GRACE_MS;
  const platform = process.platform;

  if (spec.signal?.aborted) {
    throw new Error(`ManagedProcess: aborted before spawn (${String(spec.signal.reason ?? "aborted")})`);
  }

  const [program, ...args] = spec.argv;
  if (!program) {
    throw new Error("ManagedProcess: invalid argv - missing executable at argv[0]");
  }

  const stdinMode = spec.stdio?.stdin ?? "pipe";
  const stdoutMode = spec.stdio?.stdout ?? "pipe";
  const stderrMode = spec.stdio?.stderr ?? "pipe";

  const child = spawn(program, args, {
    cwd: spec.cwd,
    env: spec.env,
    stdio: [
      stdinMode === "ignore" ? "ignore" : "pipe",
      stdoutMode === "inherit" ? "inherit" : stdoutMode === "ignore" ? "ignore" : "pipe",
      stderrMode === "inherit" ? "inherit" : stderrMode === "ignore" ? "ignore" : "pipe"
    ],
    detached: platform !== "win32"
  });

  const pid = child.pid ?? -1;
  let graceTimer: NodeJS.Timeout | undefined;
  let treeExitObserved = false;
  let treeExitObservation: Promise<void> | undefined;
  let settled = false;

  const isTreeAlive = (): boolean => {
    if (treeExitObserved || pid <= 0) return false;
    if (platform === "win32") {
      return child.exitCode === null && child.signalCode === null;
    }
    try {
      process.kill(-pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  const observeTreeExit = (): Promise<void> => {
    treeExitObservation ??= (async () => {
      while (isTreeAlive()) {
        await sleepMs(15);
      }
      treeExitObserved = true;
      if (graceTimer !== undefined) {
        clearTimeout(graceTimer);
        graceTimer = undefined;
      }
    })();
    return treeExitObservation;
  };

  const kill = (sig: NodeJS.Signals): void => {
    if (!isTreeAlive()) return;
    signalProcessTree(platform, pid, sig, child);
  };

  const terminate = (): void => {
    if (treeExitObserved || graceTimer !== undefined) return;
    void observeTreeExit();
    if (treeExitObserved) return;

    kill("SIGTERM");
    graceTimer = setTimeout(() => {
      kill("SIGKILL");
    }, graceMs);
    // Unref graceTimer so it doesn't hold open the Node event loop if parent is shutting down
    if (typeof graceTimer.unref === "function") {
      graceTimer.unref();
    }
  };

  const onAbort = (): void => {
    terminate();
  };
  spec.signal?.addEventListener("abort", onAbort, { once: true });

  const done = new Promise<ProcessOutcome>((resolve, reject) => {
    let pipeDrainTimer: NodeJS.Timeout | undefined;

    const settle = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ exitCode, signal });
    };

    child.on("error", (error) => {
      settled = true;
      cleanup();
      reject(error);
    });

    child.on("exit", (exitCode, signal) => {
      pipeDrainTimer = setTimeout(() => {
        settle(exitCode, signal);
      }, graceMs);
      if (typeof pipeDrainTimer.unref === "function") {
        pipeDrainTimer.unref();
      }
    });

    child.on("close", (exitCode, signal) => {
      settle(exitCode, signal);
    });

    function cleanup(): void {
      if (pipeDrainTimer !== undefined) {
        clearTimeout(pipeDrainTimer);
      }
      spec.signal?.removeEventListener("abort", onAbort);
    }
  });

  const waitForExit = async (signal?: AbortSignal): Promise<boolean> => {
    const observed = observeTreeExit();
    if (treeExitObserved) return true;
    if (signal?.aborted) return false;
    if (!signal) {
      await observed;
      return true;
    }

    const abortedPromise = new Promise<boolean>((res) => {
      signal.addEventListener("abort", () => res(false), { once: true });
    });

    return Promise.race([observed.then(() => true), abortedPromise]);
  };

  return {
    pid,
    stdin: stdinMode === "pipe" ? child.stdin ?? undefined : undefined,
    stdout: stdoutMode === "pipe" ? child.stdout ?? undefined : undefined,
    stderr: stderrMode === "pipe" ? child.stderr ?? undefined : undefined,
    done,
    terminate,
    waitForExit
  };
}
