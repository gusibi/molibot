import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ChannelInboundMessage, DurableAttemptHooks } from "$lib/server/agent/core/types.js";
import { DurableExecutionCoordinator } from "./coordinator.js";
import { DurableExecutionRuntime } from "./runtime.js";
import { buildKanbanBriefing, decideKanbanRoundOutcome, KANBAN_USAGE_GAP_REASON } from "./kanbanRuntime.js";
import { DurableExecutionStore } from "./store.js";
import type { DurableWakeup, KanbanReceipt, KanbanTaskConfig } from "./types.js";
import type { AcceptanceCriterion, KanbanChecklistItem, KanbanUserInput } from "./types.js";

function taskFixture(overrides: Partial<KanbanTaskConfig> = {}): KanbanTaskConfig {
  return {
    executionId: "exec-1",
    form: "single",
    title: "整理周报",
    goal: "产出本周数据周报",
    members: [],
    completionSource: "user",
    handoffLimit: 8,
    approvalPolicy: "suspend",
    humanAcceptance: false,
    autoStart: true,
    handoffCount: 0,
    roundCount: 0,
    retryCount: 0,
    usageGapCount: 0,
    createdAt: "2026-11-07T00:00:00.000Z",
    updatedAt: "2026-11-07T00:00:00.000Z",
    ...overrides
  };
}

function receiptFixture(overrides: Partial<KanbanReceipt> = {}): KanbanReceipt {
  return {
    receiptId: "rcpt-1",
    executionId: "exec-1",
    round: 1,
    actorAgentId: "agent-a",
    actions: {},
    dedupKey: "r1-t1",
    expectedVersion: 3,
    createdAt: "2026-11-07T00:01:00.000Z",
    ...overrides
  };
}

const emptyCriteria: AcceptanceCriterion[] = [];
const emptyChecklist: KanbanChecklistItem[] = [];

test("briefing states the goal, round receipt requirement and no-conditions guidance", () => {
  const briefing = buildKanbanBriefing({
    task: taskFixture(),
    round: 1,
    criteria: emptyCriteria,
    checklist: emptyChecklist,
    lastReceipt: null,
    pendingInputs: []
  });
  assert.match(briefing, /\[看板任务 整理周报\] 第 1 轮/);
  assert.match(briefing, /## 目标/);
  assert.match(briefing, /产出本周数据周报/);
  assert.match(briefing, /尚未确定完成条件/);
  assert.match(briefing, /kanban_receipt/);
  assert.match(briefing, /用回执工具维护一份勾选清单/);
});

test("briefing marks criterion results and lists pending user inputs", () => {
  const briefing = buildKanbanBriefing({
    task: taskFixture(),
    round: 3,
    criteria: [
      { description: "周报包含三张图", required: true, checkerType: "subjective", result: "passed", userEdited: false, createdAt: "" } as AcceptanceCriterion,
      { description: "数字与源数据一致", required: true, checkerType: "subjective", result: "failed", userEdited: false, createdAt: "" } as AcceptanceCriterion,
      { description: "附带复核记录", required: false, checkerType: "subjective", result: "unproven", userEdited: false, createdAt: "" } as AcceptanceCriterion
    ],
    checklist: [{ itemId: "item-1", text: "收集数据", done: true, sortIndex: 0, updatedRound: 2 }],
    lastReceipt: receiptFixture({ round: 2, actions: { conclusion: "已完成数据收集" } }),
    pendingInputs: [{ inputId: "input-1", executionId: "exec-1", text: "改用万元单位", createdAt: "", consumedRound: null }]
  });
  assert.match(briefing, /- \[已通过\] 周报包含三张图/);
  assert.match(briefing, /- \[未通过\] 数字与源数据一致/);
  assert.match(briefing, /- \[未判定\] 附带复核记录/);
  assert.match(briefing, /- \[x\] 收集数据/);
  assert.match(briefing, /## 上一轮回执摘要（第 2 轮）/);
  assert.match(briefing, /已完成数据收集/);
  assert.match(briefing, /## 用户补充/);
  assert.match(briefing, /改用万元单位/);
});

test("settlement: question wins over everything; completion requests verification", () => {
  const task = taskFixture();
  const decision = decideKanbanRoundOutcome({
    receipt: receiptFixture({ actions: { question: { text: "预算够吗？" }, requestCompletion: true } }),
    task
  });
  assert.equal(decision.kind, "question");
  assert.equal(decision.kind === "question" ? decision.question.text : "", "预算够吗？");

  const verify = decideKanbanRoundOutcome({ receipt: receiptFixture({ actions: { requestCompletion: true, continueWork: true } }), task });
  assert.equal(verify.kind, "verify");
});

test("settlement: verifyAt schedules a review; continue continues; empty receipt parks on user", () => {
  const task = taskFixture();
  const review = decideKanbanRoundOutcome({ receipt: receiptFixture({ actions: { verifyAt: "2026-11-08T09:00:00.000Z" } }), task });
  assert.equal(review.kind, "schedule_review");
  assert.equal(review.kind === "schedule_review" ? review.runAt.toISOString() : "", "2026-11-08T09:00:00.000Z");

  const reviewInvalid = decideKanbanRoundOutcome({ receipt: receiptFixture({ actions: { verifyAt: "not-a-date" } }), task });
  assert.equal(reviewInvalid.kind, "wait_user");

  const cont = decideKanbanRoundOutcome({ receipt: receiptFixture({ actions: { conclusion: "仍在写", continueWork: true } }), task });
  assert.equal(cont.kind, "continue");

  const none = decideKanbanRoundOutcome({ receipt: null, task });
  assert.equal(none.kind, "wait_user");

  const empty = decideKanbanRoundOutcome({ receipt: receiptFixture({ actions: {} }), task });
  assert.equal(empty.kind, "wait_user");

  const ambiguous = decideKanbanRoundOutcome({ receipt: receiptFixture({ actions: { conclusion: "做完了大概" } }), task });
  assert.equal(ambiguous.kind, "wait_user");
});

test("settlement: handoff on a single-agent task parks on user; missing intent parks on user", () => {
  const single = taskFixture({ form: "single" });
  const handoff = decideKanbanRoundOutcome({ receipt: receiptFixture({ actions: { handoffTo: { agentId: "agent-b", brief: "继续" } } }), task: single });
  assert.equal(handoff.kind, "wait_user");
  assert.match(handoff.kind === "wait_user" ? handoff.reason : "", /单 Agent/);
});

test("usage gap reason is a distinct message the executor can show", () => {
  assert.match(KANBAN_USAGE_GAP_REASON, /用量统计缺口/);
});

// ---- Runtime integration ----------------------------------------------------

const USAGE = { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 150 };

function runtimeFixture() {
  const root = mkdtempSync(join(tmpdir(), "molibot-kanban-runtime-"));
  const store = new DurableExecutionStore(join(root, "durable-execution.sqlite"));
  const cleanup = () => { try { store.close(); } catch { /* already closed by a restart check */ } rmSync(root, { recursive: true, force: true }); };
  return { root, store, cleanup };
}

function createSingleTask(store: DurableExecutionStore, overrides: Record<string, unknown> = {}) {
  return store.kanban.createTask({
    ownerId: "owner-1",
    botId: "bot-1",
    form: "single",
    title: "整理周报",
    goal: "产出本周数据周报",
    agentId: "agent-a",
    completionConditions: [{ description: "周报定稿并附数据来源", checkerType: "subjective" }],
    autoStart: false,
    ...overrides
  });
}

test("a kanban task runs receipt-driven rounds: continue, then completion, then verify", async () => {
  const { store, cleanup } = runtimeFixture();
  try {
    const task = createSingleTask(store);
    const executionId = task.executionId;
    store.kanban.startTask({ executionId, ownerId: "owner-1", expectedVersion: 1, actionId: "start-1" });

    const briefings: string[] = [];
    const inbounds: ChannelInboundMessage[] = [];
    let round = 0;
    const runtime = new DurableExecutionRuntime({
      store, processOwnerId: "process-a", dataDir: join("__unused__"),
      channelManagers: new Map([["web", new Map([["bot-1", {
        runDurableAttempt: async (message: ChannelInboundMessage, hooks: DurableAttemptHooks) => {
          round += 1;
          inbounds.push(message);
          briefings.push(message.text);
          if (round === 1) {
            await hooks.submitKanbanReceipt!({ conclusion: "开始收集数据", continueWork: true, checklist: [{ text: "收集数据", done: true }] });
          } else {
            await hooks.submitKanbanReceipt!({ conclusion: "周报已完成", evidence: ["weekly.md"], requestCompletion: true });
          }
          return { result: { stopReason: "stop" as const, usage: USAGE }, contextSessionId: `kanban-ctx-${round}` };
        }
      }]])]]) as any
    });

    // Round 1: continueWork requeues for another round.
    await runWakeupDirect(runtime, store, executionId, 2);
    assert.equal(store.getById(executionId)!.status, "queued");
    const afterRound1 = store.kanban.getTask(executionId)!;
    assert.equal(afterRound1.roundCount, 1);
    assert.deepEqual(store.kanban.getChecklist(executionId).map(item => [item.text, item.done]), [["收集数据", true]]);

    // Round 2: requestCompletion moves the task to verifying.
    await runWakeupDirect(runtime, store, executionId, store.getById(executionId)!.version);
    assert.equal(store.getById(executionId)!.status, "verifying");

    // Without human acceptance the executor's requestCompletion completes the
    // task (story 51/52: subjective conditions are executor-certified; story 53
    // evidence is filed as durable evidence for the acceptance record).
    await runWakeupDirect(runtime, store, executionId, store.getById(executionId)!.version);
    assert.equal(store.getById(executionId)!.status, "completed");
    const evidence = store.getDetail(executionId)!.evidenceRefs;
    assert.ok(evidence.some(ref => ref.referenceType === "kanban-receipt" && ref.summary === "weekly.md"), "receipt evidence lands in durable evidence");

    // The task context: synthetic chat, fresh task-archive session, bound agent.
    assert.equal(inbounds[0].chatId, `kanban:${executionId}`);
    assert.equal(inbounds[0].isEvent, true);
    assert.equal(inbounds[0].sessionMode, "fresh");
    assert.equal(inbounds[0].agentId, "agent-a");
    assert.equal(inbounds[0].projectId, undefined);
    assert.match(briefings[0], /\[看板任务 整理周报\] 第 1 轮/);
    assert.match(briefings[0], /周报定稿并附数据来源/);
    assert.match(briefings[1], /## 进度清单/);
    assert.match(briefings[1], /开始收集数据/);
    const attempts = store.getDetail(executionId)!.attempts;
    // Two rounds plus the verification lease.
    assert.equal(attempts.length, 3);
    assert.equal(attempts.some(attempt => attempt.contextSessionId === "kanban-ctx-1"), true);
    assert.equal(attempts.some(attempt => attempt.status === "running"), false);
  } finally {
    cleanup();
  }
});

test("a question receipt parks on the user; the recorded answer joins the next briefing and is consumed once", async () => {
  const { store, cleanup } = runtimeFixture();
  const { PlanService } = await import("../plans/service.js");
  try {
    const service = new PlanService(store, new DurableExecutionCoordinator(store, "process-a"));
    const task = createSingleTask(store);
    const executionId = task.executionId;
    store.kanban.startTask({ executionId, ownerId: "owner-1", expectedVersion: 1, actionId: "start-1" });

    let round = 0;
    const runtime = new DurableExecutionRuntime({
      store, processOwnerId: "process-a", dataDir: join("__unused__"),
      channelManagers: new Map([["web", new Map([["bot-1", {
        runDurableAttempt: async (_message: ChannelInboundMessage, hooks: DurableAttemptHooks) => {
          round += 1;
          if (round === 1) {
            await hooks.submitKanbanReceipt!({ conclusion: "需要确认格式", question: { text: "用哪种格式？", options: ["Markdown", "PDF"] } });
          } else {
            await hooks.submitKanbanReceipt!({ conclusion: "已按 Markdown 完成", continueWork: true });
          }
          return { result: { stopReason: "stop" as const, usage: USAGE }, contextSessionId: `ctx-${round}` };
        }
      }]])]]) as any
    });

    await runWakeupDirect(runtime, store, executionId, 2);
    const parked = store.getById(executionId)!;
    assert.equal(parked.status, "waiting_for_user");
    assert.equal(parked.waitingKind, "user");
    assert.match(parked.waitingReason ?? "", /用哪种格式？/);

    service.answerKanbanTask({ ownerId: "owner-1", executionId, text: "用 Markdown。" });
    assert.equal(store.getById(executionId)!.status, "queued");

    await runWakeupDirect(runtime, store, executionId, store.getById(executionId)!.version);
    assert.equal(store.kanban.getTask(executionId)!.roundCount, 2);
    // The consumed input rides into the next briefing exactly once.
    const consumed = store.kanban.listInputs(executionId, false);
    assert.deepEqual(consumed.map(input => [input.text, input.consumedRound]), [["用 Markdown。", 2]]);
    assert.equal(store.kanban.listInputs(executionId, true).length, 0);
    assert.equal(store.getById(executionId)!.status, "queued");
  } finally {
    cleanup();
  }
});

test("tasks in the same Project serialize on the advance slot and the released slot wakes the queued task", async () => {
  const { store, cleanup } = runtimeFixture();
  try {
    const taskA = createSingleTask(store, { title: "任务A", projectId: "proj-1" });
    const taskB = createSingleTask(store, { title: "任务B", agentId: "agent-b", projectId: "proj-1" });
    store.kanban.startTask({ executionId: taskA.executionId, ownerId: "owner-1", expectedVersion: 1, actionId: "start-a" });
    store.kanban.startTask({ executionId: taskB.executionId, ownerId: "owner-1", expectedVersion: 1, actionId: "start-b" });

    let releaseA!: () => void;
    const gate = new Promise<void>(resolve => { releaseA = resolve; });
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const calls: string[] = [];
    const runtime = new DurableExecutionRuntime({
      store, processOwnerId: "process-a", dataDir: join("__unused__"),
      channelManagers: new Map([["web", new Map([["bot-1", {
        runDurableAttempt: async (message: ChannelInboundMessage, hooks: DurableAttemptHooks) => {
          calls.push(message.chatId);
          if (message.chatId === `kanban:${taskA.executionId}`) {
            entered();
            await gate;
            await hooks.submitKanbanReceipt!({ conclusion: "A 完成", continueWork: true });
          } else {
            await hooks.submitKanbanReceipt!({ conclusion: "B 完成", continueWork: true });
          }
          return { result: { stopReason: "stop" as const, usage: USAGE }, contextSessionId: `ctx-${calls.length}` };
        }
      }]])]]) as any
    });

    const runningA = runWakeupDirect(runtime, store, taskA.executionId, 2);
    await started;
    const slotWhileHeld = store.kanban.getProjectSlot("project:proj-1");
    assert.equal(slotWhileHeld?.executionId, taskA.executionId);

    // B's trigger while A holds the slot parks the task back into the queue.
    await runWakeupDirect(runtime, store, taskB.executionId, 2);
    assert.equal(store.getById(taskB.executionId)!.status, "queued");
    assert.deepEqual(calls, [`kanban:${taskA.executionId}`]);

    releaseA();
    await runningA;
    assert.equal(store.kanban.getTask(taskA.executionId)!.roundCount, 1);
    // The slot stays held while A only queued its next round: rounds of the
    // same Project interleave never, only Done/cancelled releases (spec L169).
    assert.equal(store.kanban.getProjectSlot("project:proj-1")?.executionId, taskA.executionId);

    // B cannot start between A's rounds either.
    await runWakeupDirect(runtime, store, taskB.executionId, store.getById(taskB.executionId)!.version);
    assert.deepEqual(calls, [`kanban:${taskA.executionId}`]);
    assert.equal(store.kanban.getTask(taskB.executionId)!.roundCount, 0);

    // Cancelling A is terminal and releases the slot to B.
    store.transitionStatus(taskA.executionId, store.getById(taskA.executionId)!.version, "cancelled");
    await runWakeupDirect(runtime, store, taskB.executionId, store.getById(taskB.executionId)!.version);
    assert.deepEqual(calls, [`kanban:${taskA.executionId}`, `kanban:${taskB.executionId}`]);
    assert.equal(store.kanban.getTask(taskB.executionId)!.roundCount, 1);
    assert.equal(store.kanban.getProjectSlot("project:proj-1")?.executionId, taskB.executionId);
  } finally {
    cleanup();
  }
});

test("a kanban task without completion conditions parks on the user instead of completing", async () => {
  const { store, cleanup } = runtimeFixture();
  const { DurableExecutionCoordinator } = await import("./coordinator.js");
  try {
    const task = createSingleTask(store, { completionConditions: [] });
    const executionId = task.executionId;
    store.kanban.startTask({ executionId, ownerId: "owner-1", expectedVersion: 1, actionId: "start-1" });
    const runtime = new DurableExecutionRuntime({
      store, processOwnerId: "process-a", dataDir: join("__unused__"),
      channelManagers: new Map([["web", new Map([["bot-1", {
        runDurableAttempt: async (_message: ChannelInboundMessage, hooks: DurableAttemptHooks) => {
          await hooks.submitKanbanReceipt!({ conclusion: "看起来做完了", evidence: ["out.md"], requestCompletion: true });
          return { result: { stopReason: "stop" as const, usage: USAGE }, contextSessionId: "kanban-ctx-1" };
        }
      }]])]]) as any
    });

    // Round 1 moves to verifying; verification finds no criteria and must not
    // auto-complete (spec: 无有效条件时等待用户补充).
    await runWakeupDirect(runtime, store, executionId, 2);
    assert.equal(store.getById(executionId)!.status, "verifying");
    await runWakeupDirect(runtime, store, executionId, store.getById(executionId)!.version);
    const waiting = store.getDetail(executionId)!;
    assert.equal(waiting.execution.status, "waiting_for_user");
    assert.equal(waiting.decisions.length, 1);

    // The user confirms completion explicitly; the task then completes.
    new DurableExecutionCoordinator(store, "process-a").answerDecision({
      ownerId: "owner-1", executionId, decisionId: waiting.decisions[0]!.id,
      answer: "confirm_completion", expectedVersion: waiting.execution.version, actionId: "confirm-zero-1"
    });
    assert.equal(store.getById(executionId)!.status, "completed");
  } finally {
    cleanup();
  }
});

test("human acceptance keeps verification waiting for the owner before Done", async () => {
  const { store, cleanup } = runtimeFixture();
  const { DurableExecutionCoordinator } = await import("./coordinator.js");
  try {
    const task = createSingleTask(store, { humanAcceptance: true });
    const executionId = task.executionId;
    store.kanban.startTask({ executionId, ownerId: "owner-1", expectedVersion: 1, actionId: "start-1" });
    const runtime = new DurableExecutionRuntime({
      store, processOwnerId: "process-a", dataDir: join("__unused__"),
      channelManagers: new Map([["web", new Map([["bot-1", {
        runDurableAttempt: async (_message: ChannelInboundMessage, hooks: DurableAttemptHooks) => {
          await hooks.submitKanbanReceipt!({ conclusion: "已按来源核对", evidence: ["weekly.md"], requestCompletion: true });
          return { result: { stopReason: "stop" as const, usage: USAGE }, contextSessionId: "kanban-ctx-1" };
        }
      }]])]]) as any
    });

    await runWakeupDirect(runtime, store, executionId, 2);
    await runWakeupDirect(runtime, store, executionId, store.getById(executionId)!.version);
    const waiting = store.getDetail(executionId)!;
    assert.equal(waiting.execution.status, "waiting_for_user");
    assert.equal(waiting.decisions.length, 1);

    new DurableExecutionCoordinator(store, "process-a").answerDecision({
      ownerId: "owner-1", executionId, decisionId: waiting.decisions[0]!.id,
      answer: "confirm_completion", expectedVersion: waiting.execution.version, actionId: "confirm-human-1"
    });
    assert.equal(store.getById(executionId)!.status, "completed");
  } finally {
    cleanup();
  }
});

test("a pause during a running round settles the attempt and the control request", async () => {
  const { store, cleanup } = runtimeFixture();
  try {
    const task = createSingleTask(store);
    const executionId = task.executionId;
    store.kanban.startTask({ executionId, ownerId: "owner-1", expectedVersion: 1, actionId: "start-1" });
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const runtime = new DurableExecutionRuntime({
      store, processOwnerId: "process-a", dataDir: join("__unused__"),
      channelManagers: new Map([["web", new Map([["bot-1", {
        runDurableAttempt: async () => {
          entered();
          await gate;
          return { result: { stopReason: "aborted" as const }, contextSessionId: "ctx-abort" };
        }
      }]])]]) as any
    });

    const running = runWakeupDirect(runtime, store, executionId, store.getById(executionId)!.version);
    await started;
    store.requestControl(executionId, store.getById(executionId)!.version, "pause");
    release();
    await running;
    // The execution never stays "running" after a pause request (story 69).
    assert.equal(store.getById(executionId)!.status, "paused");
    assert.ok(!store.getControlRequest(executionId), "the control request is settled");
  } finally {
    cleanup();
  }
});

test("a task interrupted by a restart resumes its round loop after recovery review", async () => {
  const { store, cleanup } = runtimeFixture();
  try {
    const task = createSingleTask(store);
    const executionId = task.executionId;
    store.kanban.startTask({ executionId, ownerId: "owner-1", expectedVersion: 1, actionId: "start-1" });
    // Another process claims the round and dies: expired lease, attempt left running.
    store.claimAttempt({
      executionId, expectedVersion: store.getById(executionId)!.version, processOwnerId: "process-dead",
      runId: "dead-run", contextSessionId: "dead-ctx", leaseDurationMs: -1_000
    });
    store.reconcileOrphanedAttempts("process-a", new Date(Date.now() + 3_600_000));
    assert.equal(store.getById(executionId)!.status, "recovery_required");

    let round = 0;
    const runtime = new DurableExecutionRuntime({
      store, processOwnerId: "process-a", dataDir: join("__unused__"),
      channelManagers: new Map([["web", new Map([["bot-1", {
        runDurableAttempt: async (_message: ChannelInboundMessage, hooks: DurableAttemptHooks) => {
          round += 1;
          await hooks.submitKanbanReceipt!({ conclusion: "恢复后继续", continueWork: round === 1 });
          return { result: { stopReason: "stop" as const, usage: USAGE }, contextSessionId: `ctx-recover-${round}` };
        }
      }]])]]) as any
    });
    await runWakeupDirect(runtime, store, executionId, store.getById(executionId)!.version);
    assert.equal(store.kanban.getTask(executionId)!.roundCount, 1, "the interrupted task runs its round again");
  } finally {
    cleanup();
  }
});

test("recovery parks on the user when the interrupted round recorded an unknown external effect", async () => {
  const { store, cleanup } = runtimeFixture();
  try {
    const task = createSingleTask(store);
    const executionId = task.executionId;
    store.kanban.startTask({ executionId, ownerId: "owner-1", expectedVersion: 1, actionId: "start-1" });
    const dead = store.claimAttempt({
      executionId, expectedVersion: store.getById(executionId)!.version, processOwnerId: "process-dead",
      runId: "dead-run", contextSessionId: "dead-ctx", leaseDurationMs: -1_000
    });
    store.kanban.recordRoundSideEffect({
      executionId, round: 1, attemptId: dead.attempt.id, phase: "intent",
      sideEffectClass: "non_idempotent", idempotencyKey: "key-1",
      targetSummary: "web_search", contentSummary: "publish"
    });
    store.reconcileOrphanedAttempts("process-a", new Date(Date.now() + 3_600_000));
    const runtime = new DurableExecutionRuntime({
      store, processOwnerId: "process-a", dataDir: join("__unused__"),
      channelManagers: new Map([["web", new Map([["bot-1", {
        runDurableAttempt: async () => { throw new Error("must not run while recovery review is open"); }
      }]])]]) as any
    });
    await runWakeupDirect(runtime, store, executionId, store.getById(executionId)!.version);
    const waiting = store.getDetail(executionId)!;
    assert.equal(waiting.execution.status, "waiting_for_user");
    assert.equal(waiting.decisions.length, 1);
    assert.deepEqual(waiting.decisions[0]!.options, ["retry_after_recovery_review"]);
  } finally {
    cleanup();
  }
});

test("inputs submitted while a round runs stay pending for the next briefing", async () => {
  const { store, cleanup } = runtimeFixture();
  try {
    const task = createSingleTask(store);
    const executionId = task.executionId;
    store.kanban.startTask({ executionId, ownerId: "owner-1", expectedVersion: 1, actionId: "start-1" });
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const runtime = new DurableExecutionRuntime({
      store, processOwnerId: "process-a", dataDir: join("__unused__"),
      channelManagers: new Map([["web", new Map([["bot-1", {
        runDurableAttempt: async (_message: ChannelInboundMessage, hooks: DurableAttemptHooks) => {
          entered();
          await gate;
          await hooks.submitKanbanReceipt!({ conclusion: "本轮完成", continueWork: true });
          return { result: { stopReason: "stop" as const, usage: USAGE }, contextSessionId: "ctx-inputs" };
        }
      }]])]]) as any
    });

    const running = runWakeupDirect(runtime, store, executionId, store.getById(executionId)!.version);
    await started;
    // Arrives after the briefing was built, before the round settles (story 24).
    store.kanban.recordInput({ executionId, text: "轮次运行中提交的补充" });
    release();
    await running;
    assert.deepEqual(store.kanban.listInputs(executionId, true).map(input => input.text), ["轮次运行中提交的补充"]);
  } finally {
    cleanup();
  }
});

test("an executor proposal creates visible conditions and the owner revision replaces them", async () => {
  const { store, cleanup } = runtimeFixture();
  const { PlanService } = await import("../plans/service.js");
  try {
    const task = createSingleTask(store, { completionConditions: [] });
    const executionId = task.executionId;
    store.kanban.startTask({ executionId, ownerId: "owner-1", expectedVersion: 1, actionId: "start-1" });
    const runtime = new DurableExecutionRuntime({
      store, processOwnerId: "process-a", dataDir: join("__unused__"),
      channelManagers: new Map([["web", new Map([["bot-1", {
        runDurableAttempt: async (_message: ChannelInboundMessage, hooks: DurableAttemptHooks) => {
          await hooks.submitKanbanReceipt!({ conclusion: "先提出完成条件", proposeConditions: ["周报包含数据来源", "附升级注意事项"] });
          return { result: { stopReason: "stop" as const, usage: USAGE }, contextSessionId: "ctx-propose" };
        }
      }]])]]) as any
    });

    await runWakeupDirect(runtime, store, executionId, store.getById(executionId)!.version);
    // Without continueWork the proposal parks on the user (story 53).
    assert.equal(store.getById(executionId)!.status, "waiting_for_user");
    const proposed = store.kanban.getTask(executionId)!;
    assert.equal(proposed.completionSource, "generated");
    const criteria = store.getDetail(executionId)!.acceptanceCriteria.filter(criterion => criterion.planVersion === 1);
    assert.deepEqual(criteria.map(criterion => criterion.description).sort(), ["周报包含数据来源", "附升级注意事项"]);

    const plans = new PlanService(store);
    const revised = plans.setKanbanCompletionConditions({
      ownerId: "owner-1", executionId,
      expectedVersion: store.getById(executionId)!.version,
      descriptions: ["周报包含数据来源与单位换算"]
    });
    assert.equal(revised.execution.status, "waiting_for_user");
    assert.equal(store.kanban.getTask(executionId)!.completionSource, "user");
    const after = store.getDetail(executionId)!.acceptanceCriteria.filter(criterion => criterion.planVersion === 1);
    assert.deepEqual(after.map(criterion => [criterion.description, criterion.userEdited]), [["周报包含数据来源与单位换算", true]]);
  } finally {
    cleanup();
  }
});

test("a rejected approval requeues the kanban task with feedback instead of failing it", async () => {
  const { store, cleanup } = runtimeFixture();
  try {
    const task = createSingleTask(store);
    const executionId = task.executionId;
    store.kanban.startTask({ executionId, ownerId: "owner-1", expectedVersion: 1, actionId: "start-1" });
    const runtime = new DurableExecutionRuntime({
      store, processOwnerId: "process-a", dataDir: join("__unused__"),
      channelManagers: new Map([["web", new Map([["bot-1", {
        runDurableAttempt: async (_message: ChannelInboundMessage, hooks: DurableAttemptHooks) => {
          await hooks.onApprovalRequest!({
            backend: "approval_broker",
            requestId: "req-1",
            prompt: {
              request: { toolId: "host_shell", command: "rm draft", approvalMode: "once" },
              title: "删除草稿文件",
              body: "需要删除临时草稿。",
              options: [{ id: "once" }, { id: "deny" }]
            }
          } as any);
          return { result: { stopReason: "waiting_for_approval" as const }, contextSessionId: "ctx-approval" };
        }
      }]])]]) as any
    });

    await runWakeupDirect(runtime, store, executionId, store.getById(executionId)!.version);
    assert.equal(store.getById(executionId)!.status, "waiting_for_approval");
    const approval = store.getDetail(executionId)!.approvals.find(item => item.status === "pending")!;

    store.runControlAction({
      action: "resolve_approval", executionId, expectedVersion: store.getById(executionId)!.version,
      actionId: "reject-1", approvalId: approval.id, status: "rejected", selectedScope: "once"
    } as any);
    // Story 65: rejection blocks this operation, not the task - the executor
    // gets the feedback as a pending input and looks for an alternative.
    assert.equal(store.getById(executionId)!.status, "queued");
    assert.ok(store.kanban.listInputs(executionId, true).some(input => input.text.includes("审批被拒绝")));
  } finally {
    cleanup();
  }
});

test("deny policy fails the approval call without a card and the round still settles from the receipt", async () => {
  const { store, cleanup } = runtimeFixture();
  try {
    const task = createSingleTask(store, { approvalPolicy: "deny" });
    const executionId = task.executionId;
    store.kanban.startTask({ executionId, ownerId: "owner-1", expectedVersion: 1, actionId: "start-1" });
    let denyResult: string | undefined;
    const runtime = new DurableExecutionRuntime({
      store, processOwnerId: "process-a", dataDir: join("__unused__"),
      channelManagers: new Map([["web", new Map([["bot-1", {
        runDurableAttempt: async (_message: ChannelInboundMessage, hooks: DurableAttemptHooks) => {
          denyResult = (await hooks.onApprovalRequest!({
            requestId: "req-1", backend: "approval_broker",
            prompt: {
              title: "Approve write", body: "Write file",
              request: { toolId: "write", command: "out.md", approvalMode: "once" },
              options: [{ id: "approve_once", label: "Allow once" }]
            }
          } as unknown as Parameters<NonNullable<DurableAttemptHooks["onApprovalRequest"]>>[0])) as string;
          await hooks.submitKanbanReceipt!({ conclusion: "改用已授权路径完成", continueWork: true });
          return { result: { stopReason: "stop" as const, usage: USAGE }, contextSessionId: "ctx-deny" };
        }
      }]])]]) as any
    });

    await runWakeupDirect(runtime, store, executionId, 2);
    assert.equal(denyResult, "deny");
    const detail = store.getDetail(executionId)!;
    assert.equal(detail.approvals.length, 0);
    assert.equal(detail.execution.status, "queued");
    assert.equal(store.kanban.getTask(executionId)!.roundCount, 1);
  } finally {
    cleanup();
  }
});

test("a round without usage stats parks the task instead of auto-advancing", async () => {
  const { store, cleanup } = runtimeFixture();
  try {
    const task = createSingleTask(store);
    const executionId = task.executionId;
    store.kanban.startTask({ executionId, ownerId: "owner-1", expectedVersion: 1, actionId: "start-1" });
    const runtime = new DurableExecutionRuntime({
      store, processOwnerId: "process-a", dataDir: join("__unused__"),
      channelManagers: new Map([["web", new Map([["bot-1", {
        runDurableAttempt: async (_message: ChannelInboundMessage, hooks: DurableAttemptHooks) => {
          await hooks.submitKanbanReceipt!({ conclusion: "继续", continueWork: true });
          return { result: { stopReason: "stop" as const }, contextSessionId: "ctx-gap" };
        }
      }]])]]) as any
    });

    await runWakeupDirect(runtime, store, executionId, 2);
    const parked = store.getById(executionId)!;
    assert.equal(parked.status, "waiting_for_user");
    assert.equal(parked.waitingReason, KANBAN_USAGE_GAP_REASON);
    assert.equal(store.kanban.getTask(executionId)!.usageGapCount, 1);
  } finally {
    cleanup();
  }
});

/** Direct dispatch for tests: the wakeup row only feeds executionId + expectedVersion. */
async function runWakeupDirect(runtime: DurableExecutionRuntime, _store: DurableExecutionStore, executionId: string, expectedVersion: number): Promise<void> {
  const outcome = await runtime.runWakeup({ executionId, expectedVersion } as DurableWakeup);
  assert.equal(outcome.kind, "done", `wakeup outcome: ${JSON.stringify(outcome)}`);
}

// ---- Budget & retry guards --------------------------------------------------


test("a failed round retries with 60s×4 backoff, keeps pending inputs, and resets after success", async () => {
  const { store, cleanup } = runtimeFixture();
  try {
    const task = createSingleTask(store);
    const executionId = task.executionId;
    store.kanban.startTask({ executionId, ownerId: "owner-1", expectedVersion: 1, actionId: "start-1" });
    store.kanban.recordInput({ executionId, text: "失败前留下的补充" });
    let round = 0;
    const runtime = new DurableExecutionRuntime({
      store, processOwnerId: "process-a", dataDir: join("__unused__"),
      channelManagers: new Map([["web", new Map([["bot-1", {
        runDurableAttempt: async (_message: ChannelInboundMessage, hooks: DurableAttemptHooks) => {
          round += 1;
          if (round <= 2) throw new Error("model provider timed out");
          await hooks.submitKanbanReceipt!({ conclusion: "重试后完成", continueWork: true });
          return { result: { stopReason: "stop" as const, usage: USAGE }, contextSessionId: `ctx-retry-${round}` };
        }
      }]])]]) as any
    });

    await runWakeupDirect(runtime, store, executionId, store.getById(executionId)!.version);
    let after = store.getById(executionId)!;
    assert.equal(after.status, "queued");
    const stored = store.kanban.getTask(executionId)!;
    assert.equal(stored.retryCount, 1);
    assert.ok(stored.nextRetryAt);
    // The retry notice lands on the failed attempt's end_reason.
    const failedAttempt = store.getDetail(executionId)!.attempts.find(attempt => attempt.endReason?.includes("自动重试"));
    assert.ok(failedAttempt);
    assert.match(failedAttempt.endReason ?? "", /自动重试（1\/3）/);
    // The retry wakeup is due at the persisted backoff time.
    const [retryWakeup] = store.pendingWakeups(executionId);
    assert.ok(retryWakeup);
    assert.ok(retryWakeup.runAt, "retry wakeup carries the backoff runAt");
    // Failed rounds keep pending user inputs for the retried round.
    assert.equal(store.kanban.listInputs(executionId, true).length, 1);

    await runWakeupDirect(runtime, store, executionId, store.getById(executionId)!.version);
    after = store.getById(executionId)!;
    assert.equal(after.status, "queued");
    assert.equal(store.kanban.getTask(executionId)!.retryCount, 2);
    // Backoff grows ×4: second retry waits 240s.
    const delay = Date.parse(store.kanban.getTask(executionId)!.nextRetryAt!) - Date.parse(after.updatedAt);
    assert.ok(delay > 200_000 && delay <= 240_000, `second backoff ~240s, got ${delay}ms`);

    await runWakeupDirect(runtime, store, executionId, store.getById(executionId)!.version);
    assert.equal(store.getById(executionId)!.status, "queued");
    const settled = store.kanban.getTask(executionId)!;
    assert.equal(settled.retryCount, 0, "a successful round clears the retry ledger");
    assert.equal(settled.nextRetryAt ?? null, null);
    assert.equal(settled.roundCount, 3);
    // The input is consumed by the round that finally ran.
    assert.equal(store.kanban.listInputs(executionId, true).length, 0);
    assert.equal(store.kanban.listInputs(executionId, false)[0].consumedRound, 3);
  } finally {
    cleanup();
  }
});

test("a round with an uncertain side effect never auto-retries and parks on the user", async () => {
  const { store, cleanup } = runtimeFixture();
  try {
    const task = createSingleTask(store);
    const executionId = task.executionId;
    store.kanban.startTask({ executionId, ownerId: "owner-1", expectedVersion: 1, actionId: "start-1" });
    const runtime = new DurableExecutionRuntime({
      store, processOwnerId: "process-a", dataDir: join("__unused__"),
      channelManagers: new Map([["web", new Map([["bot-1", {
        runDurableAttempt: async (_message: ChannelInboundMessage, hooks: DurableAttemptHooks) => {
          await hooks.onToolSideEffectPreflight!({
            toolId: "write", toolCallId: "tool-1",
            sideEffectClass: "non_idempotent", idempotencyKey: "publish-report",
            targetSummary: "report service", contentSummary: "publish"
          });
          throw new Error("runner crashed after the side effect");
        }
      }]])]]) as any
    });

    await runWakeupDirect(runtime, store, executionId, 2);
    const parked = store.getById(executionId)!;
    assert.equal(parked.status, "waiting_for_user");
    assert.match(parked.waitingReason ?? "", /不确定的外部副作用/);
    assert.equal(store.kanban.getTask(executionId)!.retryCount, 0);
  } finally {
    cleanup();
  }
});

test("after 3 retries a failing task parks on the user with an exhausted notice", async () => {
  const { root, store, cleanup } = runtimeFixture();
  try {
    const task = createSingleTask(store);
    const executionId = task.executionId;
    store.kanban.startTask({ executionId, ownerId: "owner-1", expectedVersion: 1, actionId: "start-1" });
    const runtime = new DurableExecutionRuntime({
      store, processOwnerId: "process-a", dataDir: join("__unused__"),
      channelManagers: new Map([["web", new Map([["bot-1", {
        runDurableAttempt: async () => { throw new Error("persistent failure"); }
      }]])]]) as any
    });

    let expectedVersion = 2;
    for (let round = 1; round <= 4; round += 1) {
      await runWakeupDirect(runtime, store, executionId, expectedVersion);
      const current = store.getById(executionId)!;
      if (round < 4) {
        assert.equal(current.status, "queued", `round ${round} should retry`);
        assert.equal(store.kanban.getTask(executionId)!.retryCount, round);
        expectedVersion = current.version;
      } else {
        assert.equal(current.status, "waiting_for_user", "the 4th failure must stop for the user");
        assert.match(current.waitingReason ?? "", /自动重试已达上限/);
        assert.equal(store.kanban.getTask(executionId)!.retryCount, 3);
      }
    }

    // The retry ledger survives a restart.
    store.close();
    const reopened = new DurableExecutionStore(join(root, "durable-execution.sqlite"));
    assert.equal(reopened.kanban.getTask(executionId)!.retryCount, 3);
    reopened.close();
  } finally {
    cleanup();
  }
});

test("budget exhaustion parks the task as partial; a top-up plus start resumes it", async () => {
  const { store, cleanup } = runtimeFixture();
  const { PlanService } = await import("../plans/service.js");
  try {
    const service = new PlanService(store);
    const created = service.createKanbanTask({
      ownerId: "owner-1", botId: "bot-1", form: "single",
      title: "小预算任务", goal: "用很少的预算跑完",
      agentId: "agent-a", budgetTokenLimit: 100, autoStart: true
    });
    const executionId = created.execution.id;
    let round = 0;
    const runtime = new DurableExecutionRuntime({
      store, processOwnerId: "process-a", dataDir: join("__unused__"),
      channelManagers: new Map([["web", new Map([["bot-1", {
        runDurableAttempt: async (_message: ChannelInboundMessage, hooks: DurableAttemptHooks) => {
          round += 1;
          await hooks.submitKanbanReceipt!({ conclusion: `第 ${round} 轮`, continueWork: true });
          return { result: { stopReason: "stop" as const, usage: { inputTokens: 60, outputTokens: 90, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 150 } }, contextSessionId: `ctx-budget-${round}` };
        }
      }]])]]) as any
    });

    await runWakeupDirect(runtime, store, executionId, 2);
    assert.equal(store.getById(executionId)!.status, "queued");
    assert.equal(round, 1);

    // tokens_used (150) now exceeds the 100-token budget: the claim aborts.
    await runWakeupDirect(runtime, store, executionId, store.getById(executionId)!.version);
    const partial = store.getById(executionId)!;
    assert.equal(partial.status, "partial");
    assert.match(partial.lastError ?? "", /token limit/);
    assert.equal(round, 1);

    // Top-up alone does not resume; start does (追加后从当前状态继续).
    service.addKanbanBudget({ ownerId: "owner-1", executionId, expectedVersion: partial.version, addTokens: 1000 });
    assert.equal(store.getById(executionId)!.status, "partial");
    const resumed = service.startKanbanTask({
      ownerId: "owner-1", executionId,
      expectedVersion: store.getById(executionId)!.version, actionId: "resume-after-topup"
    });
    assert.equal(resumed.execution.status, "queued");

    await runWakeupDirect(runtime, store, executionId, resumed.execution.version);
    assert.equal(round, 2);
    assert.equal(store.kanban.getTask(executionId)!.roundCount, 2);
  } finally {
    cleanup();
  }
});

// ---- Team execution ---------------------------------------------------------

test("a team task dispatches members serially: brief rides along, current member rotates, handoffs are recorded", async () => {
  const { store, cleanup } = runtimeFixture();
  try {
    const task = store.kanban.createTask({
      ownerId: "owner-1",
      botId: "bot-1",
      form: "team",
      title: "发布周报",
      goal: "写周报并复核",
      coordinatorAgentId: "agent-lead",
      members: [
        { agentId: "agent-lead", name: "Lead" },
        { agentId: "agent-reviewer", name: "Reviewer" }
      ],
      completionConditions: [{ description: "周报发布", checkerType: "subjective" }],
      autoStart: false
    });
    const executionId = task.executionId;
    store.kanban.startTask({ executionId, ownerId: "owner-1", expectedVersion: 1, actionId: "start-1" });

    const inbounds: ChannelInboundMessage[] = [];
    const briefings: string[] = [];
    let round = 0;
    const runtime = new DurableExecutionRuntime({
      store, processOwnerId: "process-a", dataDir: join("__unused__"),
      channelManagers: new Map([["web", new Map([["bot-1", {
        runDurableAttempt: async (message: ChannelInboundMessage, hooks: DurableAttemptHooks) => {
          round += 1;
          inbounds.push(message);
          briefings.push(message.text);
          if (round === 1) {
            await hooks.submitKanbanReceipt!({ conclusion: "初稿完成", continueWork: true, handoffTo: { agentId: "agent-reviewer", brief: "请复核第二节的数字" } });
          } else {
            await hooks.submitKanbanReceipt!({ conclusion: "复核完成", continueWork: true });
          }
          return { result: { stopReason: "stop" as const, usage: USAGE }, contextSessionId: `team-ctx-${round}` };
        }
      }]])]]) as any
    });

    await runWakeupDirect(runtime, store, executionId, 2);
    const afterDispatch = store.kanban.getTask(executionId)!;
    assert.equal(afterDispatch.currentAgentId, "agent-reviewer");
    // Coordinator pure scheduling re-points the task without consuming the
    // member handoff budget (spec 155: 负责人串行派活).
    assert.equal(afterDispatch.handoffCount, 0);
    assert.equal(afterDispatch.roundCount, 1);
    assert.equal(store.getById(executionId)!.status, "queued");
    const handoffs = store.kanban.listHandoffs(executionId);
    assert.deepEqual(handoffs.map(record => [record.kind, record.fromAgentId, record.toAgentId]), [
      ["assign", null, "agent-lead"],
      ["dispatch", "agent-lead", "agent-reviewer"]
    ]);

    await runWakeupDirect(runtime, store, executionId, store.getById(executionId)!.version);
    assert.equal(store.kanban.getTask(executionId)!.roundCount, 2);
    // The reviewer runs in their own context and sees the dispatch brief once.
    assert.equal(inbounds[1].agentId, "agent-reviewer");
    assert.match(briefings[1], /本轮执行成员：Reviewer（agent-reviewer）/);
    assert.match(briefings[1], /请复核第二节的数字/);
    // The brief is tied to the dispatch round, not repeated forever.
    assert.match(briefings[0], /本轮执行成员：Lead（agent-lead）/);
    assert.equal(briefings[0].includes("请复核第二节的数字"), false);
    assert.equal(store.getById(executionId)!.status, "queued");
  } finally {
    cleanup();
  }
});

test("team creation without a coordinator or members defaults to the Primary Agent", () => {
  const { store, cleanup } = runtimeFixture();
  try {
    const task = store.kanban.createTask({
      ownerId: "owner-1",
      botId: "bot-1",
      form: "team",
      title: "默认负责人",
      goal: " coordination defaults apply",
      autoStart: false
    });
    assert.equal(task.coordinatorAgentId, "default");
    assert.deepEqual(task.members, [{ agentId: "default", name: "default" }]);
    assert.equal(task.currentAgentId, "default");
    assert.deepEqual(store.kanban.listHandoffs(task.executionId).map(record => record.kind), ["assign"]);
  } finally {
    cleanup();
  }
});

test("dispatching to a non-member parks the task with a protocol violation instead of rotating", async () => {
  const { store, cleanup } = runtimeFixture();
  try {
    const task = store.kanban.createTask({
      ownerId: "owner-1",
      botId: "bot-1",
      form: "team",
      title: "越权交接",
      goal: "guards hold",
      coordinatorAgentId: "agent-lead",
      members: [{ agentId: "agent-lead", name: "Lead" }],
      autoStart: false
    });
    const executionId = task.executionId;
    store.kanban.startTask({ executionId, ownerId: "owner-1", expectedVersion: 1, actionId: "start-1" });
    const runtime = new DurableExecutionRuntime({
      store, processOwnerId: "process-a", dataDir: join("__unused__"),
      channelManagers: new Map([["web", new Map([["bot-1", {
        runDurableAttempt: async (_message: ChannelInboundMessage, hooks: DurableAttemptHooks) => {
          await hooks.submitKanbanReceipt!({ conclusion: "交给陌生人", handoffTo: { agentId: "agent-outsider", brief: "" } });
          return { result: { stopReason: "stop" as const, usage: USAGE }, contextSessionId: "ctx-outsider" };
        }
      }]])]]) as any
    });

    await runWakeupDirect(runtime, store, executionId, 2);
    const parked = store.getById(executionId)!;
    assert.equal(parked.status, "waiting_for_user");
    assert.match(parked.waitingReason ?? "", /不在任务成员列表中/);
    const after = store.kanban.getTask(executionId)!;
    assert.equal(after.currentAgentId, "agent-lead");
    assert.equal(after.handoffCount, 0);
  } finally {
    cleanup();
  }
});

test("the handoff limit counts member handoffs, not coordinator re-dispatches", async () => {
  const { store, cleanup } = runtimeFixture();
  try {
    const task = store.kanban.createTask({
      ownerId: "owner-1",
      botId: "bot-1",
      form: "team",
      title: "交接上限",
      goal: "guards hold",
      coordinatorAgentId: "agent-lead",
      members: [
        { agentId: "agent-lead", name: "Lead" },
        { agentId: "agent-b", name: "B" }
      ],
      handoffLimit: 1,
      autoStart: false
    });
    const executionId = task.executionId;
    store.kanban.startTask({ executionId, ownerId: "owner-1", expectedVersion: 1, actionId: "start-1" });
    let round = 0;
    const runtime = new DurableExecutionRuntime({
      store, processOwnerId: "process-a", dataDir: join("__unused__"),
      channelManagers: new Map([["web", new Map([["bot-1", {
        runDurableAttempt: async (_message: ChannelInboundMessage, hooks: DurableAttemptHooks) => {
          round += 1;
          if (round === 1) {
            await hooks.submitKanbanReceipt!({ conclusion: "交给 B", handoffTo: { agentId: "agent-b", brief: "" } });
          } else {
            await hooks.submitKanbanReceipt!({ conclusion: "再交给 Lead", handoffTo: { agentId: "agent-lead", brief: "" } });
          }
          return { result: { stopReason: "stop" as const, usage: USAGE }, contextSessionId: `ctx-limit-${round}` };
        }
      }]])]]) as any
    });

    await runWakeupDirect(runtime, store, executionId, 2);
    // Coordinator pure scheduling consumes no budget.
    assert.equal(store.kanban.getTask(executionId)!.handoffCount, 0);
    assert.equal(store.getById(executionId)!.status, "queued");

    // B → Lead is a member handoff and consumes the budget of 1.
    await runWakeupDirect(runtime, store, executionId, store.getById(executionId)!.version);
    assert.equal(store.kanban.getTask(executionId)!.handoffCount, 1);
    assert.equal(store.kanban.getTask(executionId)!.currentAgentId, "agent-lead");
    assert.equal(store.getById(executionId)!.status, "queued");
  } finally {
    cleanup();
  }
});

test("the round's tool activity and final reply persist as the attempt's conversation projection", async () => {
  const { store, cleanup } = runtimeFixture();
  try {
    const task = createSingleTask(store);
    const executionId = task.executionId;
    store.kanban.startTask({ executionId, ownerId: "owner-1", expectedVersion: 1, actionId: "start-1" });

    const runtime = new DurableExecutionRuntime({
      store, processOwnerId: "process-a", dataDir: join("__unused__"),
      channelManagers: new Map([["web", new Map([["bot-1", {
        runDurableAttempt: async (_message: ChannelInboundMessage, hooks: DurableAttemptHooks) => {
          await hooks.submitKanbanReceipt!({ conclusion: "跑完了验证", continueWork: true });
          hooks.onRunnerEvent?.({
            type: "tool_execution_start", toolCallId: "call-1", toolName: "bash", label: "运行测试"
          } as any);
          return {
            result: { stopReason: "stop" as const, usage: USAGE },
            contextSessionId: "ctx-projection",
            text: "已运行测试并通过。"
          };
        }
      }]])]]) as any
    });

    await runWakeupDirect(runtime, store, executionId, 2);
    const projections = store.listAttemptActivities(executionId);
    assert.equal(projections.length, 1);
    assert.equal(projections[0].round, 1);
    assert.equal(projections[0].text, "已运行测试并通过。");
    assert.equal(projections[0].activities.length, 1);
    assert.equal(projections[0].activities[0].key, "call-1");
    assert.equal(projections[0].activities[0].tool, "bash");
    assert.equal(projections[0].activities[0].label, "运行测试");
  } finally {
    cleanup();
  }
});

test("member-to-member handoffs consume the limit while coordinator re-dispatches do not", async () => {
  const { store, cleanup } = runtimeFixture();
  try {
    const task = store.kanban.createTask({
      ownerId: "owner-1",
      botId: "bot-1",
      form: "team",
      title: "交付活动页",
      goal: "设计、实现并复核活动页",
      coordinatorAgentId: "agent-lead",
      members: [
        { agentId: "agent-lead", name: "Lead" },
        { agentId: "agent-a", name: "A" },
        { agentId: "agent-b", name: "B" }
      ],
      completionConditions: [{ description: "活动页上线", checkerType: "subjective" }],
      handoffLimit: 1,
      autoStart: false
    });
    const executionId = task.executionId;
    store.kanban.startTask({ executionId, ownerId: "owner-1", expectedVersion: 1, actionId: "start-1" });

    let round = 0;
    const runtime = new DurableExecutionRuntime({
      store, processOwnerId: "process-a", dataDir: join("__unused__"),
      channelManagers: new Map([["web", new Map([["bot-1", {
        runDurableAttempt: async (_message: ChannelInboundMessage, hooks: DurableAttemptHooks) => {
          round += 1;
          if (round === 1) {
            // Coordinator scheduling: exempt from the budget.
            await hooks.submitKanbanReceipt!({ conclusion: "拆解完成", continueWork: true, handoffTo: { agentId: "agent-a", brief: "请实现" } });
          } else if (round === 2) {
            // Member-to-member: consumes the budget of 1.
            await hooks.submitKanbanReceipt!({ conclusion: "实现完成", continueWork: true, handoffTo: { agentId: "agent-b", brief: "请复核" } });
          } else {
            // Budget exhausted: the member handoff receipt parks the task on
            // the user instead of dispatching another member round.
            await hooks.submitKanbanReceipt!({ conclusion: "想再交给 A", handoffTo: { agentId: "agent-a", brief: "" } });
          }
          return { result: { stopReason: "stop" as const, usage: USAGE }, contextSessionId: `lim-ctx-${round}` };
        }
      }]])]]) as any
    });

    await runWakeupDirect(runtime, store, executionId, 2);
    assert.equal(store.kanban.getTask(executionId)!.handoffCount, 0);
    assert.equal(store.kanban.getTask(executionId)!.currentAgentId, "agent-a");

    await runWakeupDirect(runtime, store, executionId, store.getById(executionId)!.version);
    const afterBounce = store.kanban.getTask(executionId)!;
    assert.equal(afterBounce.handoffCount, 1);
    assert.equal(afterBounce.currentAgentId, "agent-b");

    // agent-b → anyone is a member handoff over the limit: the pre-check parks
    // the task on the user instead of dispatching a round.
    await runWakeupDirect(runtime, store, executionId, store.getById(executionId)!.version);
    const parked = store.getById(executionId)!;
    assert.equal(parked.status, "waiting_for_user");
    assert.match(parked.waitingReason ?? "", /成员交接上限/);
    // The round itself ran and its receipt was recorded; only the dispatch was
    // refused, so the round counter reflects it.
    assert.equal(store.kanban.getTask(executionId)!.roundCount, 3);
  } finally {
    cleanup();
  }
});
