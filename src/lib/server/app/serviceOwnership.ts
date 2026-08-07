import { config } from "$lib/server/app/env.js";
// The lease implementation is shared with `scripts/start-server.mjs`; importing
// it keeps one atomic lock protocol rather than a second, forked copy.
import {
  acquireServiceLease,
  readServiceLease
} from "../../../../scripts/runtime/service-lease.mjs";

/**
 * Which process owns this data directory, and therefore may run live channels.
 *
 * A lease acquired only by the launcher is not a single-instance guarantee: a
 * process started as `node build/index.js` skips `start-server.mjs` entirely —
 * no lease, no signal handlers, no forced exit — and its long-poll loops keep
 * the event loop alive forever. Five such orphans polled the owner's WeChat bot
 * for twelve days, answering one message five times from five unrelated session
 * namespaces (prd.md §3.41).
 *
 * So ownership is asserted by the runtime itself: adopt the launcher's lease
 * when there is one, otherwise take it, and refuse live channels when another
 * live process holds it. Same class as CLAUDE.md pitfall 23 — liveness is
 * ownership, and no other signal stands in for it.
 */
export type ServiceOwnership =
  | { owned: true; ownerId: string; source: "launcher" | "runtime" }
  | { owned: false; reason: "conflict" | "unavailable"; detail: string };

const LEASE_CONFLICT_CODE = "MOLIBOT_SERVICE_LEASE_CONFLICT";

let cached: ServiceOwnership | null = null;
let releaseOwnedLease: (() => void) | null = null;

function describeHolder(holder: unknown): string {
  const owner = holder as { pid?: number; ownerId?: string; startedAt?: string } | null;
  if (!owner) return "another process";
  return `pid ${owner.pid ?? "?"} (owner ${owner.ownerId ?? "?"}, started ${owner.startedAt ?? "?"})`;
}

export function ensureServiceOwnership(): ServiceOwnership {
  if (cached) return cached;

  const dataDir = config.dataDir;
  const launcherOwnerId = String(process.env.MOLIBOT_SERVICE_OWNER_ID ?? "").trim();

  try {
    // `start-server.mjs` and the Vite dev plugin both acquire the lease before
    // the runtime loads and publish the id here. Adopt it rather than fighting
    // our own launcher for the same lock.
    if (launcherOwnerId) {
      const held = readServiceLease(dataDir) as { ownerId?: string } | null;
      if (held?.ownerId === launcherOwnerId) {
        cached = { owned: true, ownerId: launcherOwnerId, source: "launcher" };
        return cached;
      }
    }

    const lease = acquireServiceLease({ dataDir });
    releaseOwnedLease = () => lease.release();
    process.env.MOLIBOT_SERVICE_OWNER_ID = lease.ownerId;
    // A lock left behind makes the next start fail with a conflict, so release
    // it on the way out even though we did not open the process. Only the
    // runtime-acquired lease is cleaned up here: when the launcher owns it,
    // `start-server.mjs` owns the shutdown path too.
    //
    // `exit` alone is not enough. This branch only runs in a process that
    // bypassed the launcher, so there are no signal handlers at all and a
    // SIGTERM terminates without running exit hooks — precisely how the
    // orphaned smoke instances behaved (prd.md §3.41). A stale lock is still
    // reclaimed on the next start because its pid is dead, but releasing
    // promptly keeps a supervisor restart from tripping over it.
    const release = () => {
      try {
        releaseOwnedLease?.();
      } catch {
        // best-effort during shutdown
      }
    };
    process.once("exit", release);
    for (const signal of ["SIGTERM", "SIGINT"] as const) {
      process.once(signal, () => {
        release();
        // A signal listener suppresses Node's default termination, so exiting
        // is now this handler's responsibility.
        process.exit(0);
      });
    }
    cached = { owned: true, ownerId: lease.ownerId, source: "runtime" };
    return cached;
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code === LEASE_CONFLICT_CODE) {
      cached = {
        owned: false,
        reason: "conflict",
        detail: `${dataDir} is already owned by ${describeHolder((error as { owner?: unknown }).owner)}`
      };
      return cached;
    }
    // Fail closed: an unreadable or unwritable lock is not evidence that we own
    // anything, and starting a bot on that assumption is the failure this guard
    // exists to prevent. The message names the exact path so it is actionable.
    cached = {
      owned: false,
      reason: "unavailable",
      detail: `service lease for ${dataDir} could not be evaluated: ${
        error instanceof Error ? error.message : String(error)
      }`
    };
    return cached;
  }
}

/**
 * Re-read the lock and confirm we still hold it. Ownership can be lost after
 * startup — a `/tmp` data dir swept by the OS, an operator deleting the lock,
 * another instance taking over — and a channel that keeps polling after that is
 * exactly the invisible orphan this module exists to stop.
 */
export function verifyServiceOwnership(): boolean {
  const current = cached;
  if (!current?.owned) return false;
  try {
    const held = readServiceLease(config.dataDir) as { ownerId?: string } | null;
    return held?.ownerId === current.ownerId;
  } catch {
    return false;
  }
}

export function describeServiceOwnership(ownership: ServiceOwnership): string {
  return ownership.owned
    ? `owned (${ownership.source}, ${ownership.ownerId})`
    : `not owned (${ownership.reason}: ${ownership.detail})`;
}

/** Test seam: drops the cached decision without touching a real lease. */
export function resetServiceOwnershipCache(): void {
  cached = null;
  releaseOwnedLease = null;
}

/** Test seam: install a decision without acquiring a lease. */
export function setServiceOwnershipForTests(ownership: ServiceOwnership | null): void {
  cached = ownership;
}
