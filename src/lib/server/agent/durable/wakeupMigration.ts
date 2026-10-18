import { existsSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { MomEvent } from "$lib/server/agent/events.js";
import type { DurableExecutionStore } from "./store.js";
import type { WakeupMigrationSummary } from "./types.js";

const DURABLE_EVENT_FILE = /^durable-execution-.+-v\d+\.json$/;
const RUNNABLE_STATUSES = new Set(["planned", "queued", "verifying", "recovery_required"]);

/**
 * Moves legacy `durable-execution-<id>-v<version>.json` triggers into the
 * wakeup table and deletes the file. Idempotent: running it again finds nothing
 * to do, and a file is only accepted when it still names the execution's
 * current version and a runnable status.
 *
 * A malformed or orphaned file is deleted (it can never be consumed), while a
 * file that cannot be removed is counted as `failed` and retried next start.
 */
export function migrateDurableEventFiles(input: {
  eventsDir: string;
  store: DurableExecutionStore;
  log?: (event: string, payload: unknown) => void;
  now?: Date;
}): WakeupMigrationSummary {
  const summary: WakeupMigrationSummary = { scanned: 0, enqueued: 0, stale: 0, discarded: 0, failed: 0 };
  if (!existsSync(input.eventsDir)) return summary;

  for (const name of readdirSync(input.eventsDir)) {
    if (!DURABLE_EVENT_FILE.test(name)) continue;
    const filePath = join(input.eventsDir, name);
    summary.scanned += 1;
    let executionId: string | undefined;
    let expectedVersion: number | undefined;
    try {
      const event = JSON.parse(readFileSync(filePath, "utf8")) as MomEvent;
      const durable = event.internal?.kind === "durable-execution" ? event.internal.durable : undefined;
      if (typeof durable?.executionId === "string") executionId = durable.executionId;
      if (Number.isFinite(durable?.expectedVersion)) expectedVersion = Number(durable?.expectedVersion);
    } catch {
      executionId = undefined;
    }

    if (!executionId || expectedVersion === undefined) {
      summary.discarded += 1;
      if (!remove(filePath)) summary.failed += 1;
      continue;
    }

    const execution = input.store.getById(executionId);
    if (!execution) {
      summary.discarded += 1;
      if (!remove(filePath)) summary.failed += 1;
      continue;
    }
    if (execution.version !== expectedVersion) {
      summary.stale += 1;
      if (!remove(filePath)) summary.failed += 1;
      continue;
    }
    if (!RUNNABLE_STATUSES.has(execution.status)) {
      summary.discarded += 1;
      if (!remove(filePath)) summary.failed += 1;
      continue;
    }

    try {
      const reason = execution.status === "verifying"
        ? "verify"
        : execution.status === "recovery_required" ? "resume" : "advance";
      if (input.store.enqueueWakeup({
        executionId,
        expectedVersion,
        reason,
        runAt: execution.nextRunAt ? new Date(execution.nextRunAt) : undefined
      }, input.now)) {
        summary.enqueued += 1;
      } else {
        summary.discarded += 1;
      }
      if (!remove(filePath)) summary.failed += 1;
    } catch {
      summary.failed += 1;
    }
  }

  input.log?.("durable_wakeup_migration", summary);
  return summary;
}

/**
 * File mode only: drop versioned durable triggers that no longer name the
 * execution's current version. The mode is a rollback path, not the default,
 * but it must not grow one file per attempt forever.
 */
export function pruneDurableEventFiles(input: {
  eventsDir: string;
  store: DurableExecutionStore;
}): number {
  if (!existsSync(input.eventsDir)) return 0;
  let removed = 0;
  for (const name of readdirSync(input.eventsDir)) {
    if (!DURABLE_EVENT_FILE.test(name)) continue;
    const filePath = join(input.eventsDir, name);
    try {
      const event = JSON.parse(readFileSync(filePath, "utf8")) as MomEvent;
      const durable = event.internal?.durable;
      if (!durable?.executionId || !Number.isFinite(durable.expectedVersion)) continue;
      const execution = input.store.getById(durable.executionId);
      if (execution && execution.version === durable.expectedVersion) continue;
      if (remove(filePath)) removed += 1;
    } catch {
      if (remove(filePath)) removed += 1;
    }
  }
  return removed;
}

function remove(filePath: string): boolean {
  try {
    unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}
