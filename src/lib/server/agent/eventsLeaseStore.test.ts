import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { EventExecutionLeaseStore } from "$lib/server/agent/eventsLeaseStore.js";

function acquireInput(overrides: Partial<Parameters<EventExecutionLeaseStore["acquire"]>[0]> = {}) {
  return {
    eventFile: "event.json",
    eventType: "periodic",
    triggerSlot: "2026-05-31T10:00",
    chatId: "chat-1",
    sessionId: "session-1",
    channel: "telegram",
    runId: "run-1",
    maxAttempts: 3,
    timeoutMs: 600_000,
    eventPayloadJson: "{}",
    now: new Date("2026-05-31T10:00:00.000Z"),
    ...overrides
  };
}

test("event lease acquisition allows only one running attempt per event slot", () => {
  const store = new EventExecutionLeaseStore(":memory:");
  const first = store.acquire(acquireInput());
  const second = store.acquire(acquireInput({ runId: "run-2" }));

  assert.equal(first?.status, "running");
  assert.equal(first?.attempt, 1);
  assert.equal(second, null);
  store.close();
});

test("event lease acquisition is isolated by lease scope", () => {
  const store = new EventExecutionLeaseStore(":memory:");
  const first = store.acquire(acquireInput({ leaseScope: "telegram:bot-a" }));
  const second = store.acquire(acquireInput({ leaseScope: "telegram:bot-b", runId: "run-2" }));

  assert.equal(first?.status, "running");
  assert.equal(second?.status, "running");
  assert.equal(first?.leaseScope, "telegram:bot-a");
  assert.equal(second?.leaseScope, "telegram:bot-b");
  store.close();
});

test("timed out event lease moves to retry and starts the next attempt", () => {
  const store = new EventExecutionLeaseStore(":memory:");
  const first = store.acquire(acquireInput());
  assert.ok(first);

  const timedOut = store.markTimedOut(first.id, first.runId, 5000, new Date("2026-05-31T10:10:00.000Z"));
  assert.equal(timedOut?.status, "retry_wait");
  assert.equal(timedOut?.attempt, 1);

  const tooEarly = store.acquire(acquireInput({
    runId: "run-2",
    now: new Date("2026-05-31T10:10:04.000Z")
  }));
  assert.equal(tooEarly, null);

  const retry = store.acquire(acquireInput({
    runId: "run-2",
    now: new Date("2026-05-31T10:10:05.000Z")
  }));
  assert.equal(retry?.status, "running");
  assert.equal(retry?.attempt, 2);
  assert.equal(retry?.runId, "run-2");
  store.close();
});

test("event lease stops retrying after max attempts", () => {
  const store = new EventExecutionLeaseStore(":memory:");
  const first = store.acquire(acquireInput({ maxAttempts: 2 }));
  assert.ok(first);

  store.markTimedOut(first.id, first.runId, 0, new Date("2026-05-31T10:10:00.000Z"));
  const retry = store.acquire(acquireInput({
    runId: "run-2",
    maxAttempts: 2,
    now: new Date("2026-05-31T10:10:00.000Z")
  }));
  assert.ok(retry);

  const final = store.markTimedOut(retry.id, retry.runId, 0, new Date("2026-05-31T10:20:00.000Z"));
  assert.equal(final?.status, "failed");
  assert.equal(final?.attempt, 2);

  const exhausted = store.acquire(acquireInput({
    runId: "run-3",
    maxAttempts: 2,
    now: new Date("2026-05-31T10:20:00.000Z")
  }));
  assert.equal(exhausted, null);
  store.close();
});

test("manual stop aborts active event leases and suppresses retry", () => {
  const store = new EventExecutionLeaseStore(":memory:");
  const lease = store.acquire(acquireInput());
  assert.ok(lease);

  const aborted = store.markAbortedForChat("chat-1", "Stopped by user.", new Date("2026-05-31T10:01:00.000Z"));
  assert.equal(aborted, 1);
  assert.equal(store.hasActiveForChat("chat-1"), false);

  const nextSlot = store.acquire(acquireInput({
    triggerSlot: "2026-05-31T10:01",
    runId: "run-next",
    now: new Date("2026-05-31T10:01:00.000Z")
  }));
  assert.equal(nextSlot?.attempt, 1);
  store.close();
});

test("startup recovery releases stale running event leases into retry state", () => {
  const store = new EventExecutionLeaseStore(":memory:");
  const lease = store.acquire(acquireInput({
    timeoutMs: 60_000,
    now: new Date("2026-05-31T10:00:00.000Z")
  }));
  assert.ok(lease);

  const recovered = store.recoverStaleRunning(new Date("2026-05-31T10:02:00.000Z"));
  assert.equal(recovered, 1);

  const retry = store.acquire(acquireInput({
    runId: "run-recovered",
    timeoutMs: 60_000,
    now: new Date("2026-05-31T10:02:00.000Z")
  }));
  assert.equal(retry?.status, "running");
  assert.equal(retry?.attempt, 2);
  assert.equal(retry?.runId, "run-recovered");
  store.close();
});

test("startup recovery abandons overdue retry_wait leases so they stop blocking the task", () => {
  const store = new EventExecutionLeaseStore(":memory:");
  const lease = store.acquire(acquireInput({
    taskId: "explicit",
    timeoutMs: 60_000,
    now: new Date("2026-05-31T10:00:00.000Z")
  }));
  assert.ok(lease);

  // Time out into retry_wait, then never re-attempt it (process died).
  const timedOut = store.markTimedOut(lease.id, lease.runId, 5000, new Date("2026-05-31T10:05:00.000Z"));
  assert.equal(timedOut?.status, "retry_wait");
  assert.equal(store.hasActiveForTask("explicit"), true);

  // Not yet overdue by a full timeout window -> left alone.
  assert.equal(store.recoverStaleRunning(new Date("2026-05-31T10:05:30.000Z")), 0);
  assert.equal(store.hasActiveForTask("explicit"), true);

  // Overdue by more than timeoutMs past the scheduled retry -> abandoned.
  const recovered = store.recoverStaleRunning(new Date("2026-05-31T10:20:00.000Z"));
  assert.equal(recovered, 1);
  assert.equal(store.hasActiveForTask("explicit"), false);
  store.close();
});

test("acquiring a lease below the timeout floor clamps to 1000ms and warns", () => {
  const store = new EventExecutionLeaseStore(":memory:");
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((a) => String(a)).join(" "));
  };
  try {
    const lease = store.acquire(acquireInput({ timeoutMs: 5 }));
    assert.equal(lease?.timeoutMs, 1000);
    assert.ok(
      warnings.some((line) => line.includes("timeout_below_floor")),
      "expected a timeout_below_floor warning"
    );

    // A normal timeout must not warn.
    warnings.length = 0;
    const ok = store.acquire(acquireInput({ triggerSlot: "2026-05-31T10:05", runId: "run-ok", timeoutMs: 600_000 }));
    assert.equal(ok?.timeoutMs, 600_000);
    assert.equal(warnings.some((line) => line.includes("timeout_below_floor")), false);
  } finally {
    console.warn = originalWarn;
    store.close();
  }
});

test("task execution history supports newest-first offset pagination and totals", () => {
  const store = new EventExecutionLeaseStore(":memory:");
  for (let index = 0; index < 12; index += 1) {
    const lease = store.acquire(acquireInput({
      taskId: "task-paged",
      triggerSlot: `slot-${index}`,
      runId: `run-${index}`,
      now: new Date(Date.UTC(2026, 5, 1, 0, index))
    }));
    assert.ok(lease);
    store.markCompleted(lease.id, lease.runId);
  }

  assert.equal(store.countForTask("task-paged"), 12);
  assert.deepEqual(store.listForTask("task-paged", 5, 5).map((item) => item.runId), [
    "run-6", "run-5", "run-4", "run-3", "run-2"
  ]);
  store.close();
});

test("completed event lease retains its structured execution result", () => {
  const store = new EventExecutionLeaseStore(":memory:");
  const lease = store.acquire(acquireInput({ taskId: "memory-reflection-owner" }));
  assert.ok(lease);

  const result = {
    kind: "memory-reflection",
    completedTargets: 2,
    scannedMessages: 18,
    createdCandidates: 3
  };
  assert.equal(store.markCompleted(lease.id, lease.runId, result), true);
  assert.deepEqual(store.getById(lease.id)?.result, result);
  store.close();
});

// Two production runs hung as "运行中" indefinitely because their process died
// 38s and 4min into a 10min timeout: age-based recovery read "young" as "alive"
// and skipped them, and the surviving `running` row then blocked every later run
// of the same task through `hasActiveForTask`.
test("startup recovery reclaims a running lease from a dead process no matter how young it is", () => {
  const store = new EventExecutionLeaseStore(":memory:");
  const lease = store.acquire(acquireInput({ taskId: "ai-daily-report", timeoutMs: 600_000 }));
  assert.ok(lease);
  assert.equal(store.hasActiveForTask("ai-daily-report"), true);

  // 38 seconds later a *different* process starts up.
  const recovered = store.recoverStaleRunning(new Date("2026-05-31T10:00:38.000Z"), "other-process");
  assert.equal(recovered, 1);
  assert.equal(store.getById(lease.id)?.status, "interrupted");
  assert.equal(store.getById(lease.id)?.stopReason, "interrupted");
  // The task is no longer pinned as active, so its next slot can run.
  assert.equal(store.hasActiveForTask("ai-daily-report"), false);
  store.close();
});

test("startup recovery leaves this process's own in-flight lease alone", () => {
  const store = new EventExecutionLeaseStore(":memory:");
  const lease = store.acquire(acquireInput({ timeoutMs: 600_000 }));
  assert.ok(lease);

  assert.equal(store.recoverStaleRunning(new Date("2026-05-31T10:00:38.000Z")), 0);
  assert.equal(store.getById(lease.id)?.status, "running");
  store.close();
});

test("legacy leases without owner identity are reclaimed on startup", () => {
  const store = new EventExecutionLeaseStore(":memory:");
  const lease = store.acquire(acquireInput());
  assert.ok(lease);
  store.getById(lease.id); // sanity
  (store as unknown as { db: DatabaseSync }).db
    .prepare("UPDATE event_execution_leases SET owner_id = NULL WHERE id = ?").run(lease.id);

  assert.equal(store.recoverStaleRunning(new Date("2026-05-31T10:00:10.000Z")), 1);
  assert.equal(store.getById(lease.id)?.status, "interrupted");
  store.close();
});

test("a resuming lease is not treated as a competitor of itself", () => {
  const store = new EventExecutionLeaseStore(":memory:");
  const lease = store.acquire(acquireInput({ taskId: "ai-news-daily" }));
  assert.ok(lease);
  store.markTimedOut(lease.id, lease.runId, 0);

  assert.equal(store.hasActiveForTask("ai-news-daily"), true, "retry_wait is active for anyone else");
  assert.equal(store.hasActiveForTask("ai-news-daily", undefined, lease.id), false, "but not for the run taking it over");
  store.close();
});

test("an interrupted slot can be re-acquired for catch-up, a settled one cannot", () => {
  const store = new EventExecutionLeaseStore(":memory:");
  const lease = store.acquire(acquireInput());
  assert.ok(lease);
  store.markInterrupted(lease.id);

  const resumed = store.acquire(acquireInput({ runId: "run-2" }));
  assert.equal(resumed?.id, lease.id, "catch-up continues the same slot rather than opening a new one");
  assert.equal(resumed?.status, "running");
  assert.equal(resumed?.attempt, 2);

  assert.equal(store.markCompleted(resumed!.id, "run-2"), true);
  assert.equal(store.acquire(acquireInput({ runId: "run-3" })), null, "a completed slot never runs again");
  store.close();
});

test("outcome lookup ignores skipped bookkeeping rows", () => {
  const store = new EventExecutionLeaseStore(":memory:");
  const lease = store.acquire(acquireInput());
  assert.ok(lease);
  store.markInterrupted(lease.id);
  // A later dispatch declined to run and recorded a skip against the same slot.
  store.recordSkipped({ ...acquireInput({ runId: "run-2", now: new Date("2026-05-31T11:00:00.000Z") }), reason: "task_already_running" });

  assert.equal(store.getLatest("default", "event.json", "chat-1", "2026-05-31T10:00")?.status, "skipped");
  assert.equal(store.getLatestOutcome("default", "event.json", "chat-1", "2026-05-31T10:00")?.status, "interrupted");
  store.close();
});

test("interrupted attempts count as failures in task summaries", () => {
  const store = new EventExecutionLeaseStore(":memory:");
  const lease = store.acquire(acquireInput({ taskId: "summary-task" }));
  assert.ok(lease);
  store.markInterrupted(lease.id);

  assert.deepEqual(store.summarizeTasks(["summary-task"]), { total: 1, completed: 0, failed: 1 });
  store.close();
});

test("existing event lease databases migrate result storage without losing history", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "molibot-event-lease-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbFile = join(dir, "settings.sqlite");
  const legacy = new DatabaseSync(dbFile);
  legacy.exec(`
    CREATE TABLE event_execution_leases (
      id TEXT PRIMARY KEY, lease_scope TEXT NOT NULL DEFAULT 'default', event_file TEXT NOT NULL,
      event_type TEXT NOT NULL, trigger_slot TEXT NOT NULL, chat_id TEXT NOT NULL, session_id TEXT NOT NULL,
      channel TEXT NOT NULL, task_id TEXT, run_id TEXT NOT NULL, status TEXT NOT NULL, attempt INTEGER NOT NULL,
      max_attempts INTEGER NOT NULL, timeout_ms INTEGER NOT NULL, started_at TEXT NOT NULL,
      last_heartbeat_at TEXT NOT NULL, finished_at TEXT, stop_reason TEXT, last_error TEXT,
      retry_scheduled_at TEXT, event_payload_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
  `);
  legacy.close();

  const store = new EventExecutionLeaseStore(dbFile);
  const lease = store.acquire(acquireInput({ taskId: "daily-materials-owner" }));
  assert.ok(lease);
  const result = { kind: "daily-materials", completedTargets: 1, scannedMessages: 4, createdFiles: ["素材/2026-07-14.md"] };
  assert.equal(store.markCompleted(lease.id, lease.runId, result), true);
  assert.deepEqual(store.getById(lease.id)?.result, result);
  store.close();
});
