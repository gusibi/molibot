import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import test from "node:test";
import { durableExecutionEventsDir, enqueueDurableExecutionEvent, durableExecutionEventFilePath } from "./events.js";
import { DurableExecutionStore } from "./store.js";
import { migrateDurableEventFiles, pruneDurableEventFiles } from "./wakeupMigration.js";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "molibot-durable-migration-"));
}

function createExecution(store: DurableExecutionStore, goal: string) {
  return store.create({
    ownerId: "owner-1",
    botId: "bot-1",
    sourceChannel: "web",
    sourceChatId: "web:owner-1:bot-1",
    goal,
    steps: [{ title: "Collect", sideEffectClass: "pure" as const }],
    acceptanceCriteria: [{ description: "Done", checkerType: "deterministic" as const }],
    activationPath: "deterministic" as const
  });
}

test("migration enqueues current runnable files and removes stale, unknown, terminal and malformed ones", () => {
  const root = tempRoot();
  const store = new DurableExecutionStore(join(root, "durable-execution.sqlite"));
  try {
    const runnable = createExecution(store, "runnable");
    const queued = store.transitionStatus(runnable.id, runnable.version, "queued");
    const stale = createExecution(store, "stale");
    store.transitionStatus(stale.id, stale.version, "queued");
    const terminal = createExecution(store, "terminal");
    const cancelled = store.transitionStatus(terminal.id, terminal.version, "cancelled");
    const eventsDir = durableExecutionEventsDir(root);

    enqueueDurableExecutionEvent({ executionId: runnable.id, expectedVersion: queued.version }, root);
    enqueueDurableExecutionEvent({ executionId: stale.id, expectedVersion: 1 }, root);
    enqueueDurableExecutionEvent({ executionId: terminal.id, expectedVersion: cancelled.version }, root);
    enqueueDurableExecutionEvent({ executionId: "durable-missing", expectedVersion: 3 }, root);
    writeFileSync(join(eventsDir, "durable-execution-broken-v1.json"), "{not json", "utf8");
    writeFileSync(join(eventsDir, "unrelated.json"), "{}", "utf8");

    // Remove the transactionally written wakeup so the file is the only trigger.
    const admin = new DatabaseSync(join(root, "durable-execution.sqlite"));
    admin.prepare("DELETE FROM durable_wakeups WHERE execution_id = ?").run(runnable.id);
    admin.close();
    assert.deepEqual(store.pendingWakeups(runnable.id), []);

    const summary = migrateDurableEventFiles({ eventsDir, store });
    assert.deepEqual(summary, { scanned: 5, enqueued: 1, stale: 1, discarded: 3, failed: 0 });
    assert.deepEqual(store.pendingWakeups(runnable.id).map((wakeup) => [wakeup.expectedVersion, wakeup.reason]), [[queued.version, "advance"]]);
    assert.deepEqual(readdirSync(eventsDir).filter((name) => name.startsWith("durable-execution-")), []);

    // Idempotent: nothing left to scan or re-enqueue.
    const rerun = migrateDurableEventFiles({ eventsDir, store });
    assert.deepEqual(rerun, { scanned: 0, enqueued: 0, stale: 0, discarded: 0, failed: 0 });
    assert.equal(store.pendingWakeups(runnable.id).length, 1);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("file mode prunes triggers that no longer match the execution version", () => {
  const root = tempRoot();
  const store = new DurableExecutionStore(join(root, "durable-execution.sqlite"));
  try {
    const created = createExecution(store, "prune");
    const queued = store.transitionStatus(created.id, created.version, "queued");
    enqueueDurableExecutionEvent({ executionId: created.id, expectedVersion: created.version }, root);
    const current = durableExecutionEventFilePath({ executionId: created.id, expectedVersion: queued.version }, root);
    enqueueDurableExecutionEvent({ executionId: created.id, expectedVersion: queued.version }, root);
    const stale = durableExecutionEventFilePath({ executionId: created.id, expectedVersion: created.version }, root);
    assert.equal(existsSync(current), true);
    assert.equal(existsSync(stale), true);

    assert.equal(pruneDurableEventFiles({ eventsDir: durableExecutionEventsDir(root), store }), 1);
    assert.equal(existsSync(current), true);
    assert.equal(existsSync(stale), false);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
