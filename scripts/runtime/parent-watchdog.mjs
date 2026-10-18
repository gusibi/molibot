/**
 * A desktop-managed sidecar must not outlive the supervisor that spawned it.
 *
 * The supervisor signals the child on a normal quit, but a force-killed
 * desktop app (or a crashed supervisor) leaves the sidecar orphaned: it keeps
 * the service lease and its port, so the next app launch cannot start or
 * adopt cleanly — once for over an hour against a healthy-but-abandoned
 * service. macOS has no PR_SET_PDEATHSIG, so the standard sidecar defence
 * applies: poll the parent process id, and once the child has been reparented
 * to launchd (ppid 1) the parent is gone — deliver SIGTERM to self so the
 * normal shutdown handlers release the lease.
 *
 * Only desktop-managed launches install this. A standalone `pnpm start` or
 * CLI run has no parent to outlive.
 */
export function installParentWatchdog({
  managed = process.env.MOLIBOT_DESKTOP_MANAGED === "1",
  intervalMs = 5000,
  processRef = process
} = {}) {
  if (!managed) return null;
  let timer = null;
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
  const check = () => {
    if (processRef.ppid !== 1) return;
    // One signal is enough: shutdown() force-exits 500 ms after releasing the
    // lease, so keep polling off a process that is already on its way down.
    stop();
    processRef.kill(processRef.pid, "SIGTERM");
  };
  timer = setInterval(check, intervalMs);
  timer.unref?.();
  check();
  return { stop };
}
