import {
  chmodSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { randomUUID } from "node:crypto";
import { RUNTIME_DIR_MODE, resolveDataDir, runtimePaths } from "./runtime-paths.mjs";

export { resolveDataDir };

export class ServiceLeaseConflictError extends Error {
  constructor(message, owner = null) {
    super(message);
    this.name = "ServiceLeaseConflictError";
    this.code = "MOLIBOT_SERVICE_LEASE_CONFLICT";
    this.owner = owner;
  }
}

function readJson(pathname) {
  try {
    return JSON.parse(readFileSync(pathname, "utf8"));
  } catch {
    return null;
  }
}

export function isProcessRunning(pid, signalProcess = process.kill) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    signalProcess(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function removeIfOwned(pathname, ownerId) {
  const current = readJson(pathname);
  if (!current || current.ownerId !== ownerId) return false;
  try {
    unlinkSync(pathname);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export function acquireServiceLease({
  dataDir,
  pid = process.pid,
  ownerId = randomUUID(),
  startedAt = new Date().toISOString(),
  processRunning = isProcessRunning
}) {
  const { runtimeDir, lockPath, statePath } = runtimePaths(dataDir);
  mkdirSync(runtimeDir, { recursive: true, mode: RUNTIME_DIR_MODE });
  chmodSync(runtimeDir, RUNTIME_DIR_MODE);

  const owner = { ownerId, pid, startedAt };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(lockPath, "wx", 0o600);
      try {
        writeFileSync(fd, `${JSON.stringify(owner)}\n`, "utf8");
      } finally {
        closeSync(fd);
      }
      chmodSync(lockPath, 0o600);

      let released = false;
      return {
        ...owner,
        lockPath,
        statePath,
        release() {
          if (released) return false;
          released = true;
          removeIfOwned(statePath, ownerId);
          return removeIfOwned(lockPath, ownerId);
        }
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const existing = readJson(lockPath);
      if (existing && processRunning(existing.pid)) {
        throw new ServiceLeaseConflictError(
          `Molibot data directory is already owned by process ${existing.pid}.`,
          existing
        );
      }
      try {
        unlinkSync(lockPath);
      } catch (unlinkError) {
        if (unlinkError?.code !== "ENOENT") throw unlinkError;
      }
    }
  }

  throw new ServiceLeaseConflictError("Molibot service lease could not be acquired.");
}

export function writeServiceState(lease, state) {
  const payload = {
    ownerId: lease.ownerId,
    pid: lease.pid,
    updatedAt: new Date().toISOString(),
    ...state
  };
  const temporaryPath = `${lease.statePath}.${lease.ownerId}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(temporaryPath, 0o600);
  renameSync(temporaryPath, lease.statePath);
  chmodSync(lease.statePath, 0o600);
  return payload;
}

export function readServiceState(dataDir) {
  return readJson(runtimePaths(dataDir).statePath);
}

/**
 * The current lock holder, or `null` when the data directory is unowned.
 *
 * Ownership is a runtime concern, not a launcher concern: a process that
 * bypasses `start-server.mjs` acquires no lease at all, and five such processes
 * once ran one WeChat bot identity in parallel for twelve days. The runtime
 * reads this to decide whether it may start live channels, and re-reads it to
 * notice a lease it no longer holds (prd.md §3.41).
 */
export function readServiceLease(dataDir) {
  return readJson(runtimePaths(dataDir).lockPath);
}
