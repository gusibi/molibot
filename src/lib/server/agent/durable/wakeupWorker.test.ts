import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DurableExecutionStore } from "./store.js";
import { DurableWakeupWorker } from "./wakeupWorker.js";
import type { DurableWakeup } from "./types.js";

function tempDatabase(): { file: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "molibot-durable-worker-"));
  return { file: join(root, "durable-execution.sqlite"), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function createExecution(store: DurableExecutionStore, goal = "work") {
  const created = store.create({
    ownerId: "owner-1",
    botId: "bot-1",
    sourceChannel: "web",
    sourceChatId: "web:owner-1:bot-1",
    goal,
    steps: [{ title: "Collect", sideEffectClass: "pure" as const }],
    acceptanceCriteria: [{ description: "Done", checkerType: "deterministic" as const }],
    activationPath: "deterministic" as const
  });
  return store.transitionStatus(created.id, created.version, "queued");
}

test("a tick claims due wakeups, runs them, and settles them as done", async () => {
  const database = tempDatabase();
  const store = new DurableExecutionStore(database.file);
  try {
    const created = createExecution(store);
    const seen: string[] = [];
    const worker = new DurableWakeupWorker({
      store,
      ownerId: "process-a",
      intervalMs: 60_000,
      execute: async (wakeup: DurableWakeup) => { seen.push(wakeup.executionId); return { kind: "done" }; }
    });
    await worker.tick();
    assert.deepEqual(seen, [created.id]);
    assert.equal(store.wakeups(created.id)[0].status, "done");
    await worker.stop();
  } finally {
    store.close();
    database.cleanup();
  }
});

test("a commit in this process wakes the worker without waiting for the interval", async () => {
  const database = tempDatabase();
  const store = new DurableExecutionStore(database.file);
  try {
    const seen: string[] = [];
    const worker = new DurableWakeupWorker({
      store,
      ownerId: "process-a",
      intervalMs: 3_600_000,
      execute: async () => { seen.push("run"); return { kind: "done" }; }
    });
    worker.start();
    assert.deepEqual(seen, []);
    const created = createExecution(store);
    const deadline = Date.now() + 2000;
    while (seen.length === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(seen, ["run"]);
    await worker.stop();
    assert.equal(store.wakeups(created.id)[0].status, "done");
  } finally {
    store.close();
    database.cleanup();
  }
});

test("claims are processed in scheduled order within one batch", async () => {
  const database = tempDatabase();
  const store = new DurableExecutionStore(database.file);
  try {
    const first = createExecution(store, "first");
    const second = createExecution(store, "second");
    store.deferQueued(first.id, first.version, 60_000);
    const order: string[] = [];
    const worker = new DurableWakeupWorker({
      store,
      ownerId: "process-a",
      intervalMs: 60_000,
      batch: 4,
      execute: async (wakeup) => { order.push(wakeup.executionId); return { kind: "done" }; }
    });
    await worker.tick();
    assert.deepEqual(order, [second.id]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    order.length = 0;
    const later = new Date(Date.now() + 120_000);
    // Force the deferred row to be due by moving its clock forward through a
    // fresh worker that treats now as later.
    const laterWorker = new DurableWakeupWorker({
      store,
      ownerId: "process-a",
      intervalMs: 60_000,
      now: () => later,
      execute: async (wakeup) => { order.push(wakeup.executionId); return { kind: "done" }; }
    });
    await laterWorker.tick();
    assert.deepEqual(order, [first.id]);
    await worker.stop();
    await laterWorker.stop();
  } finally {
    store.close();
    database.cleanup();
  }
});

test("a process-level failure returns the wakeup to pending with backoff", async () => {
  const database = tempDatabase();
  const store = new DurableExecutionStore(database.file);
  try {
    const created = createExecution(store);
    let now = new Date();
    const worker = new DurableWakeupWorker({
      store,
      ownerId: "process-a",
      intervalMs: 60_000,
      now: () => now,
      random: () => 0.5,
      execute: async () => ({ kind: "retry", error: "database is busy" })
    });
    await worker.tick();
    const retried = store.wakeups(created.id)[0];
    assert.equal(retried.status, "pending");
    assert.equal(retried.attempts, 1);
    assert.equal(Date.parse(retried.runAt) > now.getTime(), true);
    // Still pending, not yet due: a second immediate tick does nothing.
    assert.equal(store.claimDueWakeups("process-a", 10, now).length, 0);
    now = new Date(Date.parse(retried.runAt) + 1);
    assert.equal(store.claimDueWakeups("process-a", 10, now).length, 1);
    await worker.stop();
  } finally {
    store.close();
    database.cleanup();
  }
});

test("retrying stops at the attempt limit and marks the wakeup failed", async () => {
  const database = tempDatabase();
  const store = new DurableExecutionStore(database.file);
  try {
    const created = createExecution(store);
    let now = new Date();
    const worker = new DurableWakeupWorker({
      store,
      ownerId: "process-a",
      intervalMs: 60_000,
      now: () => now,
      random: () => 0.5,
      execute: async () => ({ kind: "retry", error: "still busy" })
    });
    for (let index = 0; index < 5; index += 1) {
      await worker.tick();
      const row = store.wakeups(created.id)[0];
      if (row.status === "failed") break;
      now = new Date(Date.parse(row.runAt) + 1);
    }
    assert.equal(store.wakeups(created.id)[0].status, "failed");
    await worker.stop();
  } finally {
    store.close();
    database.cleanup();
  }
});

test("stop waits for an in-flight wakeup and a fatal store stops claiming", async () => {
  const database = tempDatabase();
  const store = new DurableExecutionStore(database.file);
  try {
    const created = createExecution(store);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let finished = false;
    const worker = new DurableWakeupWorker({
      store,
      ownerId: "process-a",
      intervalMs: 60_000,
      execute: async () => { await gate; finished = true; return { kind: "done" }; }
    });
    const tick = worker.tick();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const stopping = worker.stop();
    assert.equal(finished, false);
    release();
    await Promise.all([tick, stopping]);
    assert.equal(finished, true);
    assert.equal(store.wakeups(created.id)[0].status, "done");

    // A storage failure latches the store; the worker refuses new claims.
    const second = createExecution(store, "second");
    store.markFatal(new Error("SQLITE_IOERR"));
    const claims: string[] = [];
    const fatalWorker = new DurableWakeupWorker({
      store,
      ownerId: "process-a",
      intervalMs: 60_000,
      execute: async (wakeup) => { claims.push(wakeup.executionId); return { kind: "done" }; }
    });
    await fatalWorker.tick();
    assert.deepEqual(claims, []);
    assert.equal(store.pendingWakeups(second.id).length, 1);
    await fatalWorker.stop();
  } finally {
    store.close();
    database.cleanup();
  }
});

test("a fatal execution outcome latches the store through the worker", async () => {
  const database = tempDatabase();
  const store = new DurableExecutionStore(database.file);
  try {
    createExecution(store);
    const worker = new DurableWakeupWorker({
      store,
      ownerId: "process-a",
      intervalMs: 60_000,
      execute: async () => ({ kind: "fatal", error: "disk is full" })
    });
    await worker.tick();
    assert.equal(store.fatalError?.message, "disk is full");
    let closed = false;
    void store.closed.then(() => { closed = true; });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(closed, true);
    await worker.stop();
  } finally {
    store.close();
    database.cleanup();
  }
});

test("new work uses a free slot while an earlier wakeup is blocked", async () => {
  const database = tempDatabase();
  const store = new DurableExecutionStore(database.file);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const seen: string[] = [];
  const first = createExecution(store, "slow");
  const worker = new DurableWakeupWorker({ store, ownerId: "process-a", batch: 4,
    execute: async wakeup => { seen.push(wakeup.executionId); if (wakeup.executionId === first.id) await gate; return { kind: "done" }; } });
  const firstTick = worker.tick();
  const second = createExecution(store, "independent");
  const secondTick = worker.tick();
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(seen.includes(second.id), "a free slot must not wait for the slow task");
    assert.equal(store.wakeups(second.id)[0].status, "done");
    assert.equal(store.wakeups(first.id)[0].status, "claimed");
  } finally {
    release(); await Promise.all([firstTick, secondTick]); await worker.stop();
    store.close(); database.cleanup();
  }
});

for (const [errcode, fatal] of [[5, false], [10, true]] as const) {
  test(`claim error ${errcode} is contained and ${fatal ? "stops" : "preserves"} the worker`, async () => {
    const database = tempDatabase();
    const store = new DurableExecutionStore(database.file);
    const execution = createExecution(store);
    const claim = store.claimDueWakeups.bind(store);
    store.claimDueWakeups = () => { throw Object.assign(new Error("claim failed"), { errcode }); };
    let runs = 0;
    const worker = new DurableWakeupWorker({ store, ownerId: "process-a", execute: async () => { runs++; return { kind: "done" }; } });
    try {
      await assert.doesNotReject(worker.tick());
      assert.equal(Boolean(store.fatalError), fatal);
      assert.equal(store.wakeups(execution.id)[0].status, "pending");
      store.claimDueWakeups = claim;
      await worker.tick();
      assert.equal(runs, fatal ? 0 : 1);
    } finally { await worker.stop(); store.close(); database.cleanup(); }
  });
}
