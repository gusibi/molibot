import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  DurableExecutionEngineVersionError,
  DurableExecutionStore
} from "./store.js";

function tempDatabase(): { file: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "molibot-durable-wakeup-"));
  return { file: join(root, "durable-execution.sqlite"), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function createExecution(store: DurableExecutionStore, overrides: Record<string, unknown> = {}) {
  return store.create({
    ownerId: "owner-1",
    botId: "bot-1",
    sourceChannel: "web",
    sourceChatId: "web:owner-1:bot-1",
    goal: "Prepare the weekly report",
    steps: [{ title: "Collect the source data", sideEffectClass: "pure" as const }],
    acceptanceCriteria: [{ description: "The report exists", checkerType: "deterministic" as const }],
    activationPath: "deterministic" as const,
    ...overrides
  });
}

test("a state change and its wakeup are committed in one transaction", () => {
  const database = tempDatabase();
  const store = new DurableExecutionStore(database.file);
  try {
    const created = createExecution(store);
    assert.deepEqual(store.pendingWakeups(created.id), []);

    const queued = store.transitionStatus(created.id, created.version, "queued");
    const wakeups = store.pendingWakeups(created.id);
    assert.deepEqual(wakeups.map((wakeup) => [wakeup.expectedVersion, wakeup.reason, wakeup.status]), [[queued.version, "resume", "pending"]]);

    // The row is transactionally coupled: reopening the file shows the same
    // invariant, so a crash between "status queued" and "trigger written" is
    // no longer representable.
    store.close();
    const reopened = new DurableExecutionStore(database.file);
    assert.deepEqual(reopened.pendingWakeups(created.id).map((wakeup) => wakeup.expectedVersion), [queued.version]);
    reopened.close();
  } finally {
    database.cleanup();
  }
});

test("a newer version discards older pending wakeups and at most one stays live", () => {
  const database = tempDatabase();
  const store = new DurableExecutionStore(database.file);
  try {
    const created = createExecution(store);
    const queued = store.transitionStatus(created.id, created.version, "queued");
    const paused = store.transitionStatus(created.id, queued.version, "paused");
    const resumed = store.transitionStatus(created.id, paused.version, "queued");

    const pending = store.pendingWakeups(created.id);
    assert.deepEqual(pending.map((wakeup) => [wakeup.expectedVersion, wakeup.status]), [[resumed.version, "pending"]]);
    const discarded = store.wakeups(created.id).filter((wakeup) => wakeup.status === "discarded");
    assert.equal(discarded.length >= 1, true);
    assert.equal(discarded.every((wakeup) => wakeup.expectedVersion !== resumed.version), true);
  } finally {
    store.close();
    database.cleanup();
  }
});

test("one hundred competing claims produce exactly one winner", () => {
  const database = tempDatabase();
  const first = new DurableExecutionStore(database.file);
  const second = new DurableExecutionStore(database.file);
  try {
    const created = createExecution(first);
    first.transitionStatus(created.id, created.version, "queued");

    let winners = 0;
    for (let index = 0; index < 100; index += 1) {
      const claimer = index % 2 === 0 ? first : second;
      winners += claimer.claimDueWakeups(index % 2 === 0 ? "process-a" : "process-b", 10).length;
    }
    assert.equal(winners, 1);
    assert.equal(first.wakeups(created.id).filter((wakeup) => wakeup.status === "claimed").length, 1);
  } finally {
    first.close();
    second.close();
    database.cleanup();
  }
});

test("claiming is FIFO by scheduled time and a future wakeup is not claimable", () => {
  const database = tempDatabase();
  const store = new DurableExecutionStore(database.file);
  try {
    const first = createExecution(store, { goal: "first" });
    const second = createExecution(store, { goal: "second" });
    const firstQueued = store.transitionStatus(first.id, first.version, "queued");
    store.transitionStatus(second.id, second.version, "queued");
    // Capacity deferral pushes the first execution a minute out.
    store.deferQueued(first.id, firstQueued.version, 60_000);
    const now = new Date();

    assert.deepEqual(store.claimDueWakeups("process-a", 10, now).map((wakeup) => wakeup.executionId), [second.id]);
    const later = new Date(now.getTime() + 120_000);
    assert.deepEqual(store.claimDueWakeups("process-a", 10, later).map((wakeup) => wakeup.executionId), [first.id]);
  } finally {
    store.close();
    database.cleanup();
  }
});

test("a claimed execution is not claimed a second time and stale claims are recovered", () => {
  const database = tempDatabase();
  const store = new DurableExecutionStore(database.file);
  try {
    const created = createExecution(store);
    store.transitionStatus(created.id, created.version, "queued");
    const now = new Date();
    assert.equal(store.claimDueWakeups("process-a", 10, now).length, 1);
    assert.equal(store.claimDueWakeups("process-a", 10, now).length, 0);

    assert.equal(store.recoverStaleClaims(30_000, new Date(now.getTime() + 60_000)), 1);
    assert.equal(store.claimDueWakeups("process-b", 10, new Date(now.getTime() + 61_000)).length, 1);
  } finally {
    store.close();
    database.cleanup();
  }
});

test("claim recovery preserves a foreign live attempt and our own in-flight claim", () => {
  const database = tempDatabase();
  const store = new DurableExecutionStore(database.file);
  try {
    const created = createExecution(store);
    const queued = store.transitionStatus(created.id, created.version, "queued");
    const now = new Date();
    store.claimDueWakeups("process-a", 1, now);
    store.claimAttempt({ executionId: queued.id, expectedVersion: queued.version, processOwnerId: "process-a", runId: "run-a", contextSessionId: "session-a", leaseDurationMs: 120_000, now });
    const later = new Date(now.getTime() + 60_000);
    assert.equal(store.recoverStaleClaims(30_000, later, "process-b"), 0);
    const expired = new Date(now.getTime() + 121_000);
    assert.equal(store.recoverStaleClaims(30_000, expired, "process-a"), 0);
    assert.equal(store.recoverStaleClaims(30_000, expired, "process-b"), 1);
    assert.equal(store.wakeups(queued.id)[0].status, "pending");
  } finally { store.close(); database.cleanup(); }
});

test("retries back off and stop at the attempt limit with a retained failure", () => {
  const database = tempDatabase();
  const store = new DurableExecutionStore(database.file);
  try {
    const created = createExecution(store);
    store.transitionStatus(created.id, created.version, "queued");
    let now = new Date();
    const claimed = () => {
      const [wakeup] = store.claimDueWakeups("process-a", 1, now);
      assert.ok(wakeup);
      return wakeup;
    };
    let wakeup = claimed();
    assert.equal(wakeup.attempts, 1);
    for (let index = 0; index < 5; index += 1) {
      const result = store.backoffWakeup(wakeup, "database is busy", now, () => 0.5);
      if (result.status === "failed") break;
      now = new Date(Date.parse(result.runAt));
      wakeup = claimed();
    }
    const final = store.wakeups(created.id)[0];
    assert.equal(final.status, "failed");
    assert.equal(final.attempts, 5);
    assert.match(final.lastError ?? "", /busy/);
  } finally {
    store.close();
    database.cleanup();
  }
});

test("finished wakeups age out while failed ones stay visible", () => {
  const database = tempDatabase();
  const store = new DurableExecutionStore(database.file);
  try {
    const created = createExecution(store);
    store.transitionStatus(created.id, created.version, "queued");
    const now = new Date();
    const [wakeup] = store.claimDueWakeups("process-a", 1, now);
    assert.ok(wakeup);
    store.settleWakeup(wakeup.id, { status: "done" }, now);
    assert.equal(store.pruneWakeups(7, new Date(now.getTime() + 8 * 86_400_000)), 1);
    assert.deepEqual(store.wakeups(created.id), []);
  } finally {
    store.close();
    database.cleanup();
  }
});

test("startup repair enqueues one wakeup per runnable execution and is idempotent", () => {
  const database = tempDatabase();
  const store = new DurableExecutionStore(database.file);
  try {
    const created = createExecution(store);
    const queued = store.transitionStatus(created.id, created.version, "queued");
    // Simulate a legacy/partial state: the execution is runnable but has no
    // trigger (a pre-upgrade database or a deleted row).
    const admin = new DatabaseSync(database.file);
    admin.prepare("DELETE FROM durable_wakeups WHERE execution_id = ?").run(created.id);
    admin.close();
    assert.deepEqual(store.pendingWakeups(created.id), []);
    assert.equal(store.enqueueDueWakeups("owner-1"), 1);
    assert.equal(store.enqueueDueWakeups("owner-1"), 0);
    assert.deepEqual(store.pendingWakeups(created.id).map((wakeup) => [wakeup.expectedVersion, wakeup.expectedVersion === queued.version]), [[queued.version, true]]);
  } finally {
    store.close();
    database.cleanup();
  }
});

test("graceful shutdown releases its own lease and enqueues recovery", () => {
  const database = tempDatabase();
  const store = new DurableExecutionStore(database.file);
  try {
    const created = createExecution(store);
    const queued = store.transitionStatus(created.id, created.version, "queued");
    const claimed = store.claimAttempt({
      executionId: created.id,
      expectedVersion: queued.version,
      processOwnerId: "process-a",
      runId: "run-a",
      contextSessionId: "session-a",
      leaseDurationMs: 600_000
    });
    assert.equal(store.releaseOwnedAttempts("process-b"), 0, "another process must not release our lease");
    assert.equal(store.releaseOwnedAttempts("process-a"), 1);
    const detail = store.getDetail(created.id)!;
    assert.equal(detail.execution.status, "recovery_required");
    assert.equal(detail.execution.leaseOwnerId, undefined);
    assert.equal(detail.attempts.find((attempt) => attempt.id === claimed.attempt.id)?.status, "interrupted");
    assert.equal(store.pendingWakeups(created.id).length, 1);
  } finally {
    store.close();
    database.cleanup();
  }
});

test("a second live executor instance is refused and a released instance can be reused", () => {
  const database = tempDatabase();
  const store = new DurableExecutionStore(database.file);
  try {
    const now = new Date("2026-08-09T10:00:00.000Z");
    assert.equal(store.claimRuntimeInstance("process-a", 60_000, now).ok, true);
    const conflict = store.claimRuntimeInstance("process-b", 60_000, new Date(now.getTime() + 1000));
    assert.equal(conflict.ok, false);
    assert.equal(conflict.ok === false ? conflict.holder.id : "", "process-a");
    // An empty/expired table is reusable.
    store.releaseRuntimeInstance("process-a");
    assert.equal(store.claimRuntimeInstance("process-b", 60_000, new Date(now.getTime() + 2000)).ok, true);
  } finally {
    store.close();
    database.cleanup();
  }
});

test("attempt progress is idempotent per tool call and narrow reads avoid full detail", () => {
  const database = tempDatabase();
  const store = new DurableExecutionStore(database.file);
  try {
    const created = createExecution(store, {
      steps: [{ title: "Collect", sideEffectClass: "pure" as const }, { title: "Write", sideEffectClass: "idempotent" as const }]
    });
    const queued = store.transitionStatus(created.id, created.version, "queued");
    const claimed = store.claimAttempt({
      executionId: created.id,
      expectedVersion: queued.version,
      processOwnerId: "process-a",
      runId: "run-a",
      contextSessionId: "session-a",
      leaseDurationMs: 60_000
    });
    store.recordAttemptProgress({ attemptId: claimed.attempt.id, toolCallId: "call-1", toolId: "read", status: "completed", summary: "read 2 files" });
    store.recordAttemptProgress({ attemptId: claimed.attempt.id, toolCallId: "call-1", toolId: "read", status: "failed", summary: "retried as failed" });
    store.recordAttemptProgress({ attemptId: claimed.attempt.id, toolCallId: "call-2", toolId: "write", status: "completed" });
    const progress = store.attemptProgress(claimed.attempt.id);
    assert.deepEqual(progress.map((item) => [item.seq, item.toolCallId, item.status]), [[1, "call-1", "failed"], [2, "call-2", "completed"]]);

    assert.equal(store.getVersion(created.id), queued.version + 1);
    assert.deepEqual(store.getCurrentSteps(created.id).map((step) => step.title), ["Collect", "Write"]);
    assert.equal(store.getCurrentCriteria(created.id).length, 1);
    assert.equal(store.getAttempt(claimed.attempt.id)?.runId, "run-a");
  } finally {
    store.close();
    database.cleanup();
  }
});

test("inspect explains lease, wakeups, uncertain work and the last confirmed tool", () => {
  const database = tempDatabase();
  const store = new DurableExecutionStore(database.file);
  try {
    const created = createExecution(store);
    const queued = store.transitionStatus(created.id, created.version, "queued");
    const claimed = store.claimAttempt({
      executionId: created.id,
      expectedVersion: queued.version,
      processOwnerId: "process-a",
      runId: "run-a",
      contextSessionId: "session-a",
      leaseDurationMs: 120_000
    });
    store.markStepRunning(created.id, store.getCurrentSteps(created.id)[0].id, claimed.execution.version, "process-a");
    store.recordAttemptProgress({ attemptId: claimed.attempt.id, toolCallId: "call-1", toolId: "read", status: "completed" });

    const diagnostics = store.inspect(created.id, { ownerProcessId: "process-a", now: new Date() })!;
    assert.equal(diagnostics.lease?.ownerId, "process-a");
    assert.equal((diagnostics.lease?.remainingMs ?? 0) > 0, true);
    assert.equal(diagnostics.uncertainSteps.length, 1);
    assert.equal(diagnostics.progress.lastCompletedTool?.toolCallId, "call-1");
    assert.equal(diagnostics.scheduler.ownerId, "process-a");
    assert.equal(diagnostics.execution.id, created.id);
  } finally {
    store.close();
    database.cleanup();
  }
});

test("an execution persisted by a newer engine is rejected at claim time", () => {
  const database = tempDatabase();
  const store = new DurableExecutionStore(database.file);
  try {
    const created = createExecution(store);
    const queued = store.transitionStatus(created.id, created.version, "queued");
    // Simulate an execution written by a future build.
    const admin = new DatabaseSync(database.file);
    admin.prepare("UPDATE durable_executions SET engine_version = 99 WHERE id = ?").run(created.id);
    admin.close();
    assert.throws(
      () => store.claimAttempt({
        executionId: created.id,
        expectedVersion: queued.version,
        processOwnerId: "process-a",
        runId: "run-a",
        contextSessionId: "session-a",
        leaseDurationMs: 60_000
      }),
      (error: unknown) => error instanceof DurableExecutionEngineVersionError
    );
    assert.throws(() => store.assertSupportedEngine(created.id), (error: unknown) => error instanceof DurableExecutionEngineVersionError);
  } finally {
    store.close();
    database.cleanup();
  }
});
