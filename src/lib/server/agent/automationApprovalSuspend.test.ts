import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventExecutionLeaseStore } from "$lib/server/agent/eventsLeaseStore.js";

/**
 * Automation suspends and waits for a person; it must not pin its lease.
 *
 * Product decision 2026-08-10 chose the suspend + async-resume path over
 * "automation is fixed Auto and fails". That is the friendlier semantic, but it
 * only holds if the lease is settled at the moment of suspension. CLAUDE.md
 * pitfall 23 is exactly this failure: a lease left in `running` is read as an
 * owner that is still alive, so `hasActiveForTask` suppresses every later run
 * of that task as `task_already_running` — the task goes quiet forever and the
 * UI shows a spinner nobody can clear.
 *
 * The PRD therefore requires two assertions together, not one:
 *   (a) the suspended attempt's lease is not `running`, and
 *   (b) the task's next dispatch is not suppressed.
 * Asserting only (a) misses the pitfall 23(b) family, where a *different*
 * non-terminal status (`retry_wait`) still counts as occupancy.
 */

function withStore(fn: (store: EventExecutionLeaseStore) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "molibot-automation-suspend-"));
  try {
    fn(new EventExecutionLeaseStore(join(dir, "leases.sqlite")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const SCOPE = "personal";
const TASK = "t-daily-report";

function acquire(store: EventExecutionLeaseStore, runId: string, triggerSlot = "2026-08-10T09:00") {
  const lease = store.acquire({
    leaseScope: SCOPE,
    eventFile: "daily.json",
    eventType: "periodic",
    chatId: "web:personal:auto",
    triggerSlot,
    runId,
    taskId: TASK,
    maxAttempts: 3,
    timeoutMs: 600_000,
    eventPayloadJson: "{}"
  });
  assert.ok(lease, "the fixture must actually acquire a lease");
  return lease;
}

test("a settled lease does not occupy the task, so the next run still dispatches", () => {
  withStore((store) => {
    const lease = acquire(store, "run-1");
    assert.equal(lease.status, "running");
    assert.equal(
      store.hasActiveForTask(TASK, SCOPE),
      true,
      "while it really is running, the task is occupied"
    );

    // Suspension settles the attempt. Whatever terminal status is used, the
    // requirement is that the task stops being occupied.
    store.markCompleted(lease.id, lease.runId, { stopReason: "waiting_for_approval" });

    assert.notEqual(store.getById(lease.id)?.status, "running", "(a) the lease must not stay running");
    assert.equal(
      store.hasActiveForTask(TASK, SCOPE),
      false,
      "(b) the next dispatch must not be suppressed as task_already_running"
    );
  });
});

test("the next run of a suspended task acquires its own lease", () => {
  // The end-to-end shape of the contract: suspend, then the following slot runs
  // normally rather than being skipped.
  withStore((store) => {
    const first = acquire(store, "run-1");
    store.markCompleted(first.id, first.runId, { stopReason: "waiting_for_approval" });

    const second = acquire(store, "run-2", "2026-08-10T10:00");
    assert.equal(second.status, "running");
    assert.notEqual(second.id, first.id);
  });
});

test("retry_wait still counts as occupancy, which is why (a) alone is not enough", () => {
  // The pitfall 23(b) family: a lease that left `running` can still block the
  // task. A future change that settled a suspension as `retry_wait` would pass
  // assertion (a) and still deadlock the task, so the guard needs both.
  withStore((store) => {
    const lease = acquire(store, "run-1");
    const timedOut = store.markTimedOut(lease.id, lease.runId, 60_000);
    assert.equal(timedOut?.status, "retry_wait");
    assert.notEqual(timedOut?.status, "running", "(a) passes...");
    assert.equal(store.hasActiveForTask(TASK, SCOPE), true, "...but the task is still occupied");
  });
});

test("an interrupted lease frees the task too", () => {
  // Startup reconcile takes over an attempt whose process died; the task must
  // be dispatchable afterwards rather than pinned by the dead run.
  withStore((store) => {
    const lease = acquire(store, "run-1");
    store.markInterrupted(lease.id);
    assert.equal(store.getById(lease.id)?.status, "interrupted");
    assert.equal(store.hasActiveForTask(TASK, SCOPE), false);
  });
});
