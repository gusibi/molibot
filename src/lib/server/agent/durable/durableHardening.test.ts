import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { ChannelInboundMessage, DurableAttemptHooks } from "$lib/server/agent/core/types.js";
import { DurableExecutionCoordinator } from "./coordinator.js";
import { DurableExecutionConflictError, DurableExecutionStore } from "./store.js";
import { DurableExecutionRuntime } from "./runtime.js";
import { runNextWakeup, runUntilIdle } from "./testSupport.js";

function deletePendingWakeups(dbFile: string, executionId: string): void {
  const db = new DatabaseSync(dbFile);
  db.prepare("DELETE FROM durable_wakeups WHERE execution_id = ?").run(executionId);
  db.close();
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "molibot-durable-hardening-"));
  const store = new DurableExecutionStore(join(root, "durable-execution.sqlite"));
  return { root, store };
}

function createExecution(store: DurableExecutionStore, steps: Array<Record<string, unknown>> = [{ title: "Collect", sideEffectClass: "pure" }]) {
  const created = store.create({
    ownerId: "owner-1",
    botId: "bot-1",
    sourceChannel: "web",
    sourceChatId: "web:owner-1:bot-1",
    sourceUiSessionId: "session-source",
    goal: "Prepare the weekly report",
    steps: steps as never,
    acceptanceCriteria: [{ description: "All steps are complete", checkerType: "deterministic", checkerKey: "steps_completed" }],
    activationPath: "deterministic"
  });
  return store.transitionStatus(created.id, created.version, "queued");
}

function managerFactory(runDurableAttempt: (message: ChannelInboundMessage, hooks: DurableAttemptHooks) => Promise<unknown>) {
  return new Map([["web", new Map([["bot-1", { runDurableAttempt }]])]]) as never;
}

test("a refused startup retries after the previous instance lease expires", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"], now: Date.now() });
  const { root, store } = fixture();
  store.claimRuntimeInstance("dead-process", 60_000);
  const queued = createExecution(store);
  let runs = 0;
  const runtime = new DurableExecutionRuntime({ store, processOwnerId: "new-process", dataDir: root,
    channelManagers: managerFactory(async () => { runs++; return { result: { stopReason: "stop" } }; }) });
  try {
    assert.equal(runtime.start().started, false);
    t.mock.timers.tick(60_001);
    t.mock.timers.tick(1000);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(runs, 1);
    assert.equal(store.getById(queued.id)?.status, "completed");
  } finally { await runtime.stop(); store.close(); rmSync(root, { recursive: true, force: true }); }
});

test("leases expiring after startup recover without another restart", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"], now: Date.now() });
  const { root, store } = fixture();
  const queued = createExecution(store);
  store.claimDueWakeups("dead-process", 1);
  const claimed = store.claimAttempt({ executionId: queued.id, expectedVersion: queued.version, processOwnerId: "dead-process", runId: "dead-run", contextSessionId: "dead-context", leaseDurationMs: 1000 });
  store.markStepRunning(queued.id, store.getCurrentSteps(queued.id)[0].id, claimed.execution.version, "dead-process");
  let runs = 0;
  const runtime = new DurableExecutionRuntime({ store, processOwnerId: "new-process", dataDir: root, instanceGuard: false, leaseDurationMs: 1000,
    channelManagers: managerFactory(async () => { runs++; return { result: { stopReason: "stop" } }; }) });
  try {
    assert.equal(runtime.start().reconciled, 0);
    t.mock.timers.tick(2000);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(runs, 1);
    assert.equal(store.getById(queued.id)?.status, "completed");
    assert.equal(store.pendingWakeups(queued.id).length, 0);
  } finally { await runtime.stop(); store.close(); rmSync(root, { recursive: true, force: true }); }
});

test("instance heartbeat continues during long attempts without reclaiming their wakeups", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"], now: Date.now() });
  const { root, store } = fixture();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let runs = 0;
  const runtime = new DurableExecutionRuntime({ store, processOwnerId: "process-a", dataDir: root, leaseDurationMs: 1000,
    channelManagers: managerFactory(async () => { runs++; await gate; return { result: { stopReason: "stop" } }; }) });
  try {
    runtime.start();
    t.mock.timers.tick(1000);
    const queued = createExecution(store);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(runs, 1);
    t.mock.timers.tick(61_000);
    assert.equal(store.claimRuntimeInstance("process-b", 60_000).ok, false);
    assert.equal(store.pendingWakeups(queued.id).filter(row => row.status === "claimed").length, 1);
    assert.equal(store.getDetail(queued.id)?.attempts.filter(row => row.status === "running").length, 1);
  } finally { release(); await runtime.stop(); store.close(); rmSync(root, { recursive: true, force: true }); }
});

test("a crash mid-attempt recovers on restart and continues without manual repair", async () => {
  const { root, store } = fixture();
  try {
    const queued = createExecution(store);
    // Simulate a process that died mid-step: a running attempt with an expired
    // lease and an uncertain step, plus its committed wakeup.
    const claimed = store.claimAttempt({
      executionId: queued.id,
      expectedVersion: queued.version,
      processOwnerId: "dead-process",
      runId: "dead-run",
      contextSessionId: "dead-context",
      leaseDurationMs: 1000
    });
    store.markStepRunning(queued.id, store.getCurrentSteps(queued.id)[0].id, claimed.execution.version, "dead-process");
    assert.equal(store.reconcileOrphanedAttempts("new-process", new Date(Date.now() + 60_000)), 1);

    const runtime = new DurableExecutionRuntime({
      store,
      processOwnerId: "new-process",
      dataDir: root,
      channelManagers: managerFactory(async (message) => ({ result: { stopReason: "stop", runId: message.runId }, contextSessionId: "recovered-context" }))
    });
    await runUntilIdle(runtime, store, "new-process");
    // Step completed, then acceptance verification completed the plan.
    const detail = store.getDetail(queued.id)!;
    assert.equal(detail.steps[0].status, "completed");
    assert.equal(detail.execution.status, "completed");
    assert.equal(detail.attempts.filter((attempt) => attempt.status === "running").length, 0);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("startup repair schedules a plan whose trigger was lost, and the worker finishes it", async () => {
  const { root, store } = fixture();
  try {
    const queued = createExecution(store);
    // A pre-upgrade/partial state: runnable execution with no trigger row.
    deletePendingWakeups(join(root, "durable-execution.sqlite"), queued.id);
    assert.deepEqual(store.pendingWakeups(queued.id), []);

    const runtime = new DurableExecutionRuntime({
      store,
      processOwnerId: "process-a",
      dataDir: root,
      instanceGuard: false,
      channelManagers: managerFactory(async (message) => ({ result: { stopReason: "stop", runId: message.runId } }))
    });
    const startup = runtime.start();
    assert.equal(startup.enqueued, 1);
    await runUntilIdle(runtime, store, "process-a");
    assert.equal(store.getById(queued.id)?.status, "completed");
    await runtime.stop();
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

for (const completedTool of ["publish", "unrelated-read"]) {
test(`a completed ${completedTool} tool does not authorize whole-step replay of a non-idempotent effect`, async () => {
  const { root, store } = fixture();
  try {
    const queued = createExecution(store, [{ title: "Publish", sideEffectClass: "non_idempotent" }]);
    const claimed = store.claimAttempt({
      executionId: queued.id,
      expectedVersion: queued.version,
      processOwnerId: "dead-process",
      runId: "dead-run",
      contextSessionId: "dead-context",
      leaseDurationMs: 1000
    });
    const step = store.getCurrentSteps(queued.id)[0];
    store.markStepRunning(queued.id, step.id, claimed.execution.version, "dead-process");
    store.recordSideEffectIntent({
      executionId: queued.id,
      stepId: step.id,
      attemptId: claimed.attempt.id,
      processOwnerId: "dead-process",
      expectedVersion: store.getById(queued.id)!.version,
      sideEffectClass: "non_idempotent",
      idempotencyKey: "publish-report",
      targetSummary: "report service",
      contentSummary: "publish report"
    });
    // Whole-step replay may repeat even a completed external operation.
    store.recordAttemptProgress({ attemptId: claimed.attempt.id, toolCallId: "call-1", toolId: completedTool, status: "completed" });
    store.reconcileOrphanedAttempts("new-process", new Date(Date.now() + 60_000));

    let attempts = 0;
    const runtime = new DurableExecutionRuntime({
      store,
      processOwnerId: "new-process",
      dataDir: root,
      channelManagers: managerFactory(async (message) => {
        attempts += 1;
        return { result: { stopReason: "stop", runId: message.runId } };
      })
    });
    await runUntilIdle(runtime, store, "new-process");
    assert.equal(attempts, 0, "a tool checkpoint does not make whole-step replay safe");
    assert.equal(store.getDetail(queued.id)!.decisions.length, 1);
    assert.equal(store.getById(queued.id)?.status, "waiting_for_user");
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

}

test("an unconfirmed non-idempotent call still asks the owner before retrying", async () => {
  const { root, store } = fixture();
  try {
    const queued = createExecution(store, [{ title: "Publish", sideEffectClass: "non_idempotent" }]);
    const claimed = store.claimAttempt({
      executionId: queued.id,
      expectedVersion: queued.version,
      processOwnerId: "dead-process",
      runId: "dead-run",
      contextSessionId: "dead-context",
      leaseDurationMs: 1000
    });
    const step = store.getCurrentSteps(queued.id)[0];
    store.markStepRunning(queued.id, step.id, claimed.execution.version, "dead-process");
    store.recordSideEffectIntent({
      executionId: queued.id,
      stepId: step.id,
      attemptId: claimed.attempt.id,
      processOwnerId: "dead-process",
      expectedVersion: store.getById(queued.id)!.version,
      sideEffectClass: "non_idempotent",
      idempotencyKey: "publish-report",
      targetSummary: "report service",
      contentSummary: "publish report"
    });
    store.reconcileOrphanedAttempts("new-process", new Date(Date.now() + 60_000));

    const runtime = new DurableExecutionRuntime({
      store,
      processOwnerId: "new-process",
      dataDir: root,
      channelManagers: managerFactory(async () => {
        throw new Error("uncertain non-idempotent work must not be retried");
      })
    });
    await runUntilIdle(runtime, store, "new-process");
    const detail = store.getDetail(queued.id)!;
    assert.equal(detail.execution.status, "waiting_for_user");
    assert.equal(detail.decisions.length, 1);
    assert.equal(detail.decisions[0].options[0], "retry_after_recovery_review");
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("a finishing attempt re-reads the version instead of leaving itself running", async () => {
  const { root, store } = fixture();
  try {
    const queued = createExecution(store);
    const originalFinish = store.finishAttempt.bind(store);
    let conflicts = 0;
    store.finishAttempt = (input) => {
      if (conflicts === 0) {
        conflicts += 1;
        throw new DurableExecutionConflictError(input.executionId, input.expectedVersion, input.expectedVersion + 1);
      }
      return originalFinish(input);
    };
    const runtime = new DurableExecutionRuntime({
      store,
      processOwnerId: "process-a",
      dataDir: root,
      channelManagers: managerFactory(async (message) => ({ result: { stopReason: "stop", runId: message.runId } }))
    });
    await runNextWakeup(runtime, store, "process-a");
    assert.equal(conflicts, 1);
    const detail = store.getDetail(queued.id)!;
    assert.equal(detail.execution.status, "verifying");
    assert.equal(detail.attempts.filter((attempt) => attempt.status === "running").length, 0);
    assert.equal(store.fatalError, null);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("a permanently conflicting finalize fail-stops instead of silently leaving the attempt running", async () => {
  const { root, store } = fixture();
  try {
    const queued = createExecution(store);
    store.finishAttempt = () => { throw new DurableExecutionConflictError(queued.id, 1, 2); };
    const runtime = new DurableExecutionRuntime({
      store,
      processOwnerId: "process-a",
      dataDir: root,
      channelManagers: managerFactory(async (message) => ({ result: { stopReason: "stop", runId: message.runId } }))
    });
    const outcome = await runtime.runWakeup(store.claimDueWakeups("process-a", 1)[0]);
    assert.equal(outcome.kind, "fatal");
    assert.match(store.fatalError?.message ?? "", /conflict/i);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("a storage-level failure latches the store and never writes a business recovery state", async () => {
  const { root, store } = fixture();
  try {
    const queued = createExecution(store);
    const ioError = Object.assign(new Error("disk I/O error"), { code: "ERR_SQLITE_ERROR", errcode: 10, errstr: "disk I/O error" });
    const originalFinish = store.finishAttempt.bind(store);
    store.finishAttempt = (input) => { throw ioError; };
    const runtime = new DurableExecutionRuntime({
      store,
      processOwnerId: "process-a",
      dataDir: root,
      channelManagers: managerFactory(async (message) => ({ result: { stopReason: "stop", runId: message.runId } }))
    });
    const outcome = await runtime.runWakeup(store.claimDueWakeups("process-a", 1)[0]);
    assert.equal(outcome.kind, "fatal");
    assert.equal(store.fatalError?.message, "disk I/O error");
    // The attempt is left for restart-time recovery rather than being written
    // onto a store the executor no longer trusts.
    assert.equal(store.getById(queued.id)?.status, "running");
    store.finishAttempt = originalFinish;
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("a lost lease stops the attempt without overwriting the new owner's state", async () => {
  const { root, store } = fixture();
  try {
    const queued = createExecution(store);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const runtime = new DurableExecutionRuntime({
      store,
      processOwnerId: "process-a",
      leaseDurationMs: 1000,
      dataDir: root,
      channelManagers: managerFactory(async () => {
        entered();
        await gate;
        return { result: { stopReason: "stop" } };
      })
    });
    const running = runNextWakeup(runtime, store, "process-a");
    await started;
    // Another owner takes the lease while the attempt is still running.
    const handover = new DatabaseSync(join(root, "durable-execution.sqlite"));
    handover.prepare("UPDATE durable_executions SET lease_owner_id = 'process-b', lease_expires_at = ? WHERE id = ?")
      .run(new Date(Date.now() + 600_000).toISOString(), queued.id);
    handover.close();
    await new Promise((resolve) => setTimeout(resolve, 1100));
    release();
    await running;
    // The attempt did not write a business terminal state over the new owner.
    const detail = store.getDetail(queued.id)!;
    assert.notEqual(detail.execution.status, "completed");
    assert.equal(detail.execution.leaseOwnerId, "process-b");
    assert.equal(detail.attempts.filter((attempt) => attempt.status === "running").length, 1);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("cancel aborts the plan's derived Sessions, not just its own attempt", async () => {
  const { root, store } = fixture();
  try {
    const createInput = store.create({
      ownerId: "owner-1",
      botId: "bot-1",
      sourceChannel: "web",
      sourceChatId: "web:owner-1:bot-1",
      sourceUiSessionId: "session-source",
      goal: "Long plan",
      steps: [{ title: "Step", sideEffectClass: "pure" }],
      acceptanceCriteria: [{ description: "Done", checkerType: "deterministic" }],
      activationPath: "deterministic"
    });
    const queued = store.transitionStatus(createInput.id, createInput.version, "queued");
    const aborted: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let started!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const runtime = new DurableExecutionRuntime({
      store,
      processOwnerId: "process-a",
      leaseDurationMs: 60_000,
      dataDir: root,
      channelManagers: new Map([["web", new Map([["bot-1", {
        runDurableAttempt: async () => {
          started();
          await gate;
          return { result: { stopReason: "stop" } };
        },
        abortRun: (_chatId: string, sessionId: string) => { aborted.push(sessionId); return { aborted: true }; }
      }]])]]) as never
    });
    const running = runNextWakeup(runtime, store, "process-a");
    await entered;
    store.requestControl(queued.id, store.getById(queued.id)!.version, "cancel");
    await new Promise((resolve) => setTimeout(resolve, 250));
    release();
    await running;
    assert.equal(aborted.includes("session-source"), true);
    assert.equal(store.getById(queued.id)?.status, "cancelled");
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("a second live executor refuses to start and leaves the first one's work alone", async () => {
  const { root, store } = fixture();
  try {
    const queued = createExecution(store);
    const first = new DurableExecutionRuntime({ store, processOwnerId: "process-a", dataDir: root, instanceGuard: true, channelManagers: new Map() as never });
    const second = new DurableExecutionRuntime({ store, processOwnerId: "process-b", dataDir: root, instanceGuard: true, channelManagers: new Map() as never });
    const firstStart = first.start();
    const secondStart = second.start();
    assert.equal(firstStart.started, true);
    assert.equal(secondStart.started, false);
    assert.match(secondStart.reason ?? "", /another Durable Execution executor/);
    assert.equal(store.getById(queued.id)?.status, "queued");
    await second.stop();
    await first.stop();
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("diagnostics expose lease, wakeups, blocked reason and the last confirmed tool", async () => {
  const { root, store } = fixture();
  try {
    const queued = createExecution(store);
    const coordinator = new DurableExecutionCoordinator(store, "process-a");
    const diagnostics = coordinator.diagnostics("owner-1", queued.id);
    assert.equal(diagnostics.execution.id, queued.id);
    assert.deepEqual(diagnostics.wakeups.map((wakeup) => wakeup.reason), ["resume"]);
    assert.equal(diagnostics.queuePosition, 1);
    assert.equal(diagnostics.blockedReason, undefined);

    // Waiting on a decision produces a human-readable blocked reason.
    const claimed = store.claimAttempt({
      executionId: queued.id,
      expectedVersion: queued.version,
      processOwnerId: "process-a",
      runId: "run-a",
      contextSessionId: "session-a",
      leaseDurationMs: 60_000
    });
    store.openDecision({
      executionId: queued.id,
      expectedVersion: claimed.execution.version,
      processOwnerId: "process-a",
      question: "Continue?",
      options: ["yes", "no"]
    });
    const waiting = coordinator.diagnostics("owner-1", queued.id);
    assert.equal(waiting.blockedReason, "Continue?");
    assert.equal(waiting.uncertainSteps.length, 0);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
