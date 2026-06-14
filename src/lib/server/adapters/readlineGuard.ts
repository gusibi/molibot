import type readline from "node:readline";

export function isIgnorableReadlineError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const row = error as { code?: unknown; syscall?: unknown; message?: unknown };
  return row.code === "EIO" && row.syscall === "read";
}

export function isReadlineClosed(rl: readline.Interface): boolean {
  return Boolean((rl as readline.Interface & { closed?: boolean }).closed);
}

export function closeReadlineQuietly(rl: readline.Interface): void {
  if (!isReadlineClosed(rl)) {
    rl.close();
  }
  if (process.stdin.isTTY) {
    process.stdin.pause();
  }
}

export function attachReadlineShutdownGuard(rl: readline.Interface): void {
  rl.on("SIGINT", () => {
    closeReadlineQuietly(rl);
  });
  rl.on("error", (error) => {
    if (isIgnorableReadlineError(error)) {
      closeReadlineQuietly(rl);
      return;
    }
    throw error;
  });
}
