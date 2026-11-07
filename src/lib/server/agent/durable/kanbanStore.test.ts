import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DurableExecutionStore,
  DurableExecutionTransitionError
} from "./store.js";
import { KanbanProjectSlotHeldError } from "./types.js";
import { kanbanProjectKey } from "./kanbanStore.js";
import type { CreateKanbanTaskInput } from "./types.js";

function tempDatabase(): { file: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "molibot-kanban-"));
  return {
    file: join(root, "durable-execution.sqlite"),
    cleanup: () => rmSync(root, { recursive: true, force: true })
  };
}

function createTaskInput(overrides: Partial<CreateKanbanTaskInput> = {}): CreateKanbanTaskInput {
  return {
    ownerId: "owner-1",
    botId: "bot-1",
    form: "single",
    title: "Fix the flaky login test",
    goal: "Investigate and fix the flaky login test, then verify it passes ten runs in a row.",
    agentId: "agent-coder",
    projectId: "proj-molibot",
    completionConditions: [
      { description: "The failing scenario passes ten consecutive runs", checkerType: "subjective" }
    ],
    autoStart: true,
    now: new Date("2026-11-07T08:00:00.000Z"),
    ...overrides
  };
}

test("kanban task creation persists the aggregate and config in one transaction", () => {
  const database = tempDatabase();
  try {
    const store = new DurableExecutionStore(database.file);
    const task = store.kanban.createTask(createTaskInput());
    assert.equal(task.form, "single");
    assert.equal(task.autoStart, true);
    assert.equal(task.handoffLimit, 8);
    assert.equal(task.approvalPolicy, "suspend");
    assert.equal(task.completionSource, "user");
    const execution = store.getById(task.executionId);
    assert.ok(execution);
    assert.equal(execution.status, "planned");
    // The synthetic source chat isolates every attempt of this task.
    assert.equal(execution.sourceChatId, `kanban:${task.executionId}`);
    assert.equal(execution.sourceChannel, "web");
    assert.equal(execution.sourceUiSessionId, undefined, "no visible session unless the creator binds one");
    const bound = store.kanban.createTask(createTaskInput({ sourceUiSessionId: "conv-visible" }));
    assert.equal(store.getById(bound.executionId)!.sourceUiSessionId, "conv-visible");
    // Member child sessions persist inside the creation transaction.
    const team = store.kanban.createTask(createTaskInput({
      form: "team",
      agentId: undefined,
      coordinatorAgentId: "agent-lead",
      members: [{ agentId: "agent-lead", name: "Lead" }, { agentId: "agent-cr", name: "CR" }],
      memberSessions: [{ agentId: "agent-lead", sessionId: "conv-lead" }, { agentId: "agent-cr", sessionId: "conv-cr" }]
    }));
    assert.equal(store.kanban.getMemberSession(team.executionId, "agent-lead"), "conv-lead");
    assert.deepEqual(store.kanban.listMemberSessions(team.executionId), [
      { agentId: "agent-cr", sessionId: "conv-cr" },
      { agentId: "agent-lead", sessionId: "conv-lead" }
    ]);
    assert.equal(store.kanban.getMemberSession(team.executionId, "agent-ghost"), undefined);
    const detail = store.getDetail(task.executionId);
    assert.ok(detail);
    assert.equal(detail.acceptanceCriteria.length, 1);
    assert.equal(detail.acceptanceCriteria[0].author, "user");
    assert.equal(store.getPlanAgent(task.executionId), "agent-coder");
    // Idempotent by kanbanTaskId.
    const again = store.kanban.createTask({ ...createTaskInput(), kanbanTaskId: task.executionId });
    assert.equal(again.executionId, task.executionId);
    store.close();
  } finally {
    database.cleanup();
  }
});

test("team task creation requires members and a coordinator among them", () => {
  const database = tempDatabase();
  try {
    const store = new DurableExecutionStore(database.file);
    // Missing coordinator.
    assert.throws(() => store.kanban.createTask(createTaskInput({
      form: "team",
      agentId: undefined,
      members: [{ agentId: "agent-lead", name: "Lead" }, { agentId: "agent-cr", name: "CR" }]
    })));
    // Coordinator outside the member snapshot.
    assert.throws(() => store.kanban.createTask(createTaskInput({
      form: "team",
      agentId: undefined,
      coordinatorAgentId: "agent-outsider",
      members: [{ agentId: "agent-lead", name: "Lead" }]
    })));
    const task = store.kanban.createTask(createTaskInput({
      form: "team",
      agentId: undefined,
      coordinatorAgentId: "agent-lead",
      members: [{ agentId: "agent-lead", name: "Lead" }, { agentId: "agent-cr", name: "CR" }]
    }));
    assert.equal(task.currentAgentId, "agent-lead");
    const handoffs = store.kanban.listHandoffs(task.executionId);
    assert.equal(handoffs.length, 1);
    assert.equal(handoffs[0].kind, "assign");
    store.close();
  } finally {
    database.cleanup();
  }
});

test("startTask is idempotent by actionId and enqueues exactly one resume wakeup", () => {
  const database = tempDatabase();
  try {
    const store = new DurableExecutionStore(database.file);
    const task = store.kanban.createTask(createTaskInput());
    const execution = store.getById(task.executionId)!;
    const first = store.kanban.startTask({ executionId: task.executionId, ownerId: "owner-1", expectedVersion: execution.version, actionId: "start-1" });
    assert.equal(first.started, true);
    const afterStart = store.getById(task.executionId)!;
    assert.equal(afterStart.status, "queued");
    // Repeating the same operation must not run twice.
    const repeat = store.kanban.startTask({ executionId: task.executionId, ownerId: "owner-1", expectedVersion: afterStart.version, actionId: "start-1" });
    assert.equal(repeat.started, false);
    assert.equal(store.getById(task.executionId)!.version, afterStart.version);
    const reader = new DatabaseSync(database.file, { readOnly: true });
    const wakeups = reader.prepare("SELECT COUNT(*) AS count FROM durable_wakeups WHERE execution_id = ? AND status = 'pending'").get(task.executionId) as { count: number };
    assert.equal(wakeups.count, 1);
    reader.close();
    store.close();
  } finally {
    database.cleanup();
  }
});

test("same-project tasks serialize through the Project slot; different projects run in parallel", () => {
  const database = tempDatabase();
  try {
    const store = new DurableExecutionStore(database.file);
    const taskA = store.kanban.createTask(createTaskInput({ projectId: "proj-1", title: "A" }));
    store.kanban.startTask({ executionId: taskA.executionId, ownerId: "owner-1", expectedVersion: 1, actionId: "start-a" });
    const claimedA = store.claimAttempt({
      executionId: taskA.executionId,
      expectedVersion: 2,
      processOwnerId: "process-1",
      runId: "run-a",
      contextSessionId: "ctx-a",
      leaseDurationMs: 60_000,
      projectKey: kanbanProjectKey({ projectId: "proj-1" })!
    });
    assert.equal(claimedA.execution.status, "running");
    assert.equal(store.kanban.getProjectSlot("project:proj-1")?.executionId, taskA.executionId);

    const taskB = store.kanban.createTask(createTaskInput({ projectId: "proj-1", title: "B", now: new Date("2026-11-07T08:01:00.000Z") }));
    store.kanban.startTask({ executionId: taskB.executionId, ownerId: "owner-1", expectedVersion: 1, actionId: "start-b" });
    const versionB = store.getById(taskB.executionId)!.version;
    assert.throws(() => store.claimAttempt({
      executionId: taskB.executionId,
      expectedVersion: versionB,
      processOwnerId: "process-1",
      runId: "run-b",
      contextSessionId: "ctx-b",
      leaseDurationMs: 60_000,
      projectKey: kanbanProjectKey({ projectId: "proj-1" })!
    }), KanbanProjectSlotHeldError);

    const taskC = store.kanban.createTask(createTaskInput({ projectId: "proj-2", title: "C", now: new Date("2026-11-07T08:02:00.000Z") }));
    store.kanban.startTask({ executionId: taskC.executionId, ownerId: "owner-1", expectedVersion: 1, actionId: "start-c" });
    const claimedC = store.claimAttempt({
      executionId: taskC.executionId,
      expectedVersion: store.getById(taskC.executionId)!.version,
      processOwnerId: "process-1",
      runId: "run-c",
      contextSessionId: "ctx-c",
      leaseDurationMs: 60_000,
      projectKey: kanbanProjectKey({ projectId: "proj-2" })!
    });
    assert.equal(claimedC.execution.status, "running");

    // A terminates (cancelled here) → slot released and B, the older queued
    // task on the same project, receives a capacity wakeup in the same
    // transaction.
    store.finishAttempt({
      executionId: taskA.executionId,
      attemptId: claimedA.attempt.id,
      expectedVersion: claimedA.execution.version,
      processOwnerId: "process-1",
      status: "completed",
      nextExecutionStatus: "cancelled",
      reason: "cancelled by user"
    });
    assert.equal(store.kanban.getProjectSlot("project:proj-1"), null);
    // The release keeps B runnable: its pending wakeup survives (the capacity
    // insert no-ops on the unique (execution_id, expected_version) key).
    const reader = new DatabaseSync(database.file, { readOnly: true });
    const pending = reader.prepare("SELECT COUNT(*) AS count FROM durable_wakeups WHERE execution_id = ? AND status = 'pending'").get(taskB.executionId) as { count: number };
    assert.equal(pending.count, 1);
    reader.close();
    const claimedB = store.claimAttempt({
      executionId: taskB.executionId,
      expectedVersion: store.getById(taskB.executionId)!.version,
      processOwnerId: "process-1",
      runId: "run-b2",
      contextSessionId: "ctx-b2",
      leaseDurationMs: 60_000,
      projectKey: kanbanProjectKey({ projectId: "proj-1" })!
    });
    assert.equal(claimedB.execution.status, "running");
    store.close();
  } finally {
    database.cleanup();
  }
});

test("a free Project slot still defers to an older queued sibling (creation-order arbitration)", () => {
  const database = tempDatabase();
  try {
    const store = new DurableExecutionStore(database.file);
    // Both tasks are queued; the newer one reaches the worker batch first.
    const taskA = store.kanban.createTask(createTaskInput({ projectId: "proj-1", title: "A" }));
    store.kanban.startTask({ executionId: taskA.executionId, ownerId: "owner-1", expectedVersion: 1, actionId: "start-a" });
    const taskB = store.kanban.createTask(createTaskInput({ projectId: "proj-1", title: "B", now: new Date("2026-11-07T08:01:00.000Z") }));
    store.kanban.startTask({ executionId: taskB.executionId, ownerId: "owner-1", expectedVersion: 1, actionId: "start-b" });

    const versionB = store.getById(taskB.executionId)!.version;
    assert.throws(() => store.claimAttempt({
      executionId: taskB.executionId,
      expectedVersion: versionB,
      processOwnerId: "process-1",
      runId: "run-b",
      contextSessionId: "ctx-b",
      leaseDurationMs: 60_000,
      projectKey: kanbanProjectKey({ projectId: "proj-1" })!
    }), KanbanProjectSlotHeldError);
    assert.equal(store.kanban.getProjectSlot("project:proj-1"), null);

    // The older sibling outranks nothing and takes the free slot.
    const claimedA = store.claimAttempt({
      executionId: taskA.executionId,
      expectedVersion: store.getById(taskA.executionId)!.version,
      processOwnerId: "process-1",
      runId: "run-a",
      contextSessionId: "ctx-a",
      leaseDurationMs: 60_000,
      projectKey: kanbanProjectKey({ projectId: "proj-1" })!
    });
    assert.equal(claimedA.execution.status, "running");
    assert.equal(store.kanban.getProjectSlot("project:proj-1")?.executionId, taskA.executionId);
    store.close();
  } finally {
    database.cleanup();
  }
});

test("receipts deduplicate by identity and reject conflicting bodies", () => {
  const database = tempDatabase();
  try {
    const store = new DurableExecutionStore(database.file);
    const task = store.kanban.createTask(createTaskInput());
    const base = {
      executionId: task.executionId,
      round: 1,
      actorAgentId: "agent-coder",
      dedupKey: "turn-final",
      expectedVersion: 1,
      processOwnerId: "process-1"
    };
    const recorded = store.kanban.transact(() => store.kanban.recordReceiptInTransaction({
      ...base,
      actions: { conclusion: "Found the root cause: race in token refresh." }
    }));
    assert.equal(recorded.recorded, true);
    const duplicate = store.kanban.transact(() => store.kanban.recordReceiptInTransaction({ ...base, actions: { conclusion: "Found the root cause: race in token refresh." } }));
    assert.equal(duplicate.recorded, false);
    assert.throws(() => store.kanban.transact(() => store.kanban.recordReceiptInTransaction({ ...base, actions: { conclusion: "Different conclusion." } })));
    assert.equal(store.kanban.listReceipts(task.executionId).length, 1);
    store.close();
  } finally {
    database.cleanup();
  }
});

test("user inputs persist and the checklist round-trips with versions", () => {
  const database = tempDatabase();
  try {
    const store = new DurableExecutionStore(database.file);
    const task = store.kanban.createTask(createTaskInput());
    store.kanban.recordInput({ executionId: task.executionId, text: "Use the staging database, not production." });
    assert.equal(store.kanban.listInputs(task.executionId, true).length, 1);
    store.kanban.transact(() => {
      store.kanban.applyChecklistInTransaction(task.executionId, 1, [
        { text: "Reproduce the flake", done: true },
        { text: "Fix the race", done: false }
      ]);
      store.kanban.consumeInputsInTransaction(task.executionId, 1);
    });
    const checklist = store.kanban.getChecklist(task.executionId);
    assert.equal(checklist.length, 2);
    assert.equal(checklist[0].done, true);
    assert.equal(store.kanban.listInputs(task.executionId, true).length, 0);
    assert.equal(store.kanban.listInputs(task.executionId).length, 1);
    store.kanban.transact(() => {
      store.kanban.applyChecklistInTransaction(task.executionId, 2, [{ itemId: checklist[1].itemId, done: true }]);
    });
    assert.equal(store.kanban.getChecklist(task.executionId).filter(item => item.done).length, 2);
    store.close();
  } finally {
    database.cleanup();
  }
});

test("budget top-up extends the limit without resetting accumulated usage", () => {
  const database = tempDatabase();
  try {
    const store = new DurableExecutionStore(database.file);
    const task = store.kanban.createTask(createTaskInput({ budgetTokenLimit: 1000 }));
    const claimed = store.claimAttempt({
      executionId: task.executionId,
      expectedVersion: 1,
      processOwnerId: "process-1",
      runId: "run-1",
      contextSessionId: "ctx-1",
      leaseDurationMs: 60_000
    });
    store.finishAttempt({
      executionId: task.executionId,
      attemptId: claimed.attempt.id,
      expectedVersion: claimed.execution.version,
      processOwnerId: "process-1",
      status: "completed",
      nextExecutionStatus: "waiting_for_user",
      reason: "waiting for the user",
      tokensUsed: 800
    });
    const afterRound = store.getById(task.executionId)!;
    assert.equal(afterRound.tokensUsed, 800);
    store.kanban.extendKanbanBudget({ executionId: task.executionId, expectedVersion: afterRound.version, topup: 500 });
    const afterTopup = store.getById(task.executionId)!;
    assert.equal(afterTopup.budgetTokenLimit, 1500);
    assert.equal(afterTopup.tokensUsed, 800);
    store.close();
  } finally {
    database.cleanup();
  }
});

test("the board projects kanban tasks and legacy plans by execution status", () => {
  const database = tempDatabase();
  try {
    const store = new DurableExecutionStore(database.file);
    // Legacy plan: completed must surface as Done, never filtered by the old
    // completed → archived planStatus bucket. Reaching completed follows the
    // legal transition path (approve → run → verify → completed).
    const legacy = store.createPlan({
      ownerId: "owner-1",
      botId: "bot-1",
      title: "Translate the docs",
      tasks: [{ title: "Translate", steps: [{ title: "Read", sideEffectClass: "pure" as const }] }],
      acceptanceCriteria: [{ description: "Translation complete", checkerType: "subjective" }],
      now: new Date("2026-11-06T08:00:00.000Z")
    });
    store.bindPlan({ ownerId: "owner-1", planId: legacy.id, expectedVersion: legacy.version, sessionId: "session-1", agentId: "agent-coder", mode: "accept_edits" });
    const bound = store.getById(legacy.id)!;
    store.transitionStatus(legacy.id, bound.version, "running");
    const running = store.getById(legacy.id)!;
    store.transitionStatus(legacy.id, running.version, "verifying");
    const verifying = store.getById(legacy.id)!;
    store.transitionStatus(legacy.id, verifying.version, "completed");
    // Legacy plan cancelled stays in 已取消.
    const legacyCancelled = store.createPlan({
      ownerId: "owner-1",
      botId: "bot-1",
      title: "Old cancelled plan",
      tasks: [{ title: "Work", steps: [{ title: "Step", sideEffectClass: "pure" as const }] }],
      now: new Date("2026-11-06T09:00:00.000Z")
    });
    store.transitionStatus(legacyCancelled.id, legacyCancelled.version, "cancelled");

    const task = store.kanban.createTask(createTaskInput({ title: "Kanban fix" }));
    const boardAll = store.kanban.listExecutionSummaries({ ownerId: "owner-1" });
    assert.equal(boardAll.length, 3);
    const stages = new Map(boardAll.map(item => [item.executionId, item.status]));
    assert.equal(stages.get(legacy.id), "completed");
    assert.equal(stages.get(legacyCancelled.id), "cancelled");
    assert.equal(stages.get(task.executionId), "planned");
    assert.equal(boardAll.find(item => item.executionId === legacy.id)?.isKanban, false);
    assert.equal(boardAll.find(item => item.executionId === task.executionId)?.isKanban, true);
    store.close();
  } finally {
    database.cleanup();
  }
});

test("kanban state survives a store restart", () => {
  const database = tempDatabase();
  try {
    const first = new DurableExecutionStore(database.file);
    const task = first.kanban.createTask(createTaskInput());
    first.kanban.startTask({ executionId: task.executionId, ownerId: "owner-1", expectedVersion: 1, actionId: "start-1" });
    first.kanban.recordInput({ executionId: task.executionId, text: "Constraint: keep the API stable." });
    first.kanban.transact(() => {
      first.kanban.applyChecklistInTransaction(task.executionId, 1, [{ text: "Write the repro", done: true }]);
    });
    first.close();

    const second = new DurableExecutionStore(database.file);
    const restored = second.kanban.getTask(task.executionId);
    assert.ok(restored);
    assert.equal(restored.autoStart, true);
    assert.equal(second.getById(task.executionId)?.status, "queued");
    assert.equal(second.kanban.listInputs(task.executionId).length, 1);
    assert.equal(second.kanban.getChecklist(task.executionId).length, 1);
    second.close();
  } finally {
    database.cleanup();
  }
});

test("starting a task that is already running is rejected with a transition error", () => {
  const database = tempDatabase();
  try {
    const store = new DurableExecutionStore(database.file);
    const task = store.kanban.createTask(createTaskInput());
    store.kanban.startTask({ executionId: task.executionId, ownerId: "owner-1", expectedVersion: 1, actionId: "start-1" });
    assert.throws(() => store.kanban.startTask({ executionId: task.executionId, ownerId: "owner-1", expectedVersion: store.getById(task.executionId)!.version, actionId: "start-2" }), DurableExecutionTransitionError);
    store.close();
  } finally {
    database.cleanup();
  }
});
