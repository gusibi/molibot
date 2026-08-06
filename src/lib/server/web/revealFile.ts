import { spawn } from "node:child_process";

/**
 * Hands an already-validated absolute path to Finder.
 *
 * Callers resolve the absolute path inside their own root check and never let it
 * travel back to the WebView (pitfall #6). This helper only owns the spawn, so
 * the Project route and the Session route cannot drift on how the command is
 * built - notably `shell: false` with an argument array, so a path containing
 * spaces or quotes can never become extra arguments.
 */
export type RevealMode = "reveal" | "open";

export function revealSupported(): boolean {
  return process.platform === "darwin";
}

export function revealAbsolutePath(absolutePath: string, mode: RevealMode): void {
  const child = spawn("open", mode === "reveal" ? ["-R", absolutePath] : [absolutePath], {
    stdio: "ignore",
    shell: false,
    detached: true
  });
  child.on("error", () => { /* Finder failing to launch must not crash the service. */ });
  child.unref();
}
