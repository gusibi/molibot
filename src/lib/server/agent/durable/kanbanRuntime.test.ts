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
  const cleanup = () => { store.close(); rmSync(root, { recursive: true, force: true }); };
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
    const coordinator = new DurableExecutionCoordinator(store, "process-a");
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

    // Verification of the subjective criterion parks on the user decision.
    await runWakeupDirect(runtime, store, executionId, store.getById(executionId)!.version);
    const waiting = store.getDetail(executionId)!;
    assert.equal(waiting.execution.status, "waiting_for_user");
    assert.equal(waiting.decisions.length, 1);

    coordinator.answerDecision({
      ownerId: "owner-1", executionId, decisionId: waiting.decisions[0]!.id,
      answer: "confirm_completion", expectedVersion: waiting.execution.version, actionId: "confirm-1"
    });
    assert.equal(store.getById(executionId)!.status, "completed");

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
    assert.equal(store.kanban.getProjectSlot("project:proj-1"), null);

    // The released slot lets B run its first round.
    await runWakeupDirect(runtime, store, taskB.executionId, store.getById(taskB.executionId)!.version);
    assert.deepEqual(calls, [`kanban:${taskA.executionId}`, `kanban:${taskB.executionId}`]);
    assert.equal(store.kanban.getTask(taskB.executionId)!.roundCount, 1);
    assert.equal(store.kanban.getProjectSlot("project:proj-1"), null);
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
    assert.equal(afterDispatch.handoffCount, 1);
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

test("the handoff limit stops automatic dispatch and parks the task on the user", async () => {
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
    assert.equal(store.kanban.getTask(executionId)!.handoffCount, 1);
    assert.equal(store.getById(executionId)!.status, "queued");

    await runWakeupDirect(runtime, store, executionId, store.getById(executionId)!.version);
    const parked = store.getById(executionId)!;
    assert.equal(parked.status, "waiting_for_user");
    assert.match(parked.waitingReason ?? "", /交接上限/);
    // The blocked dispatch consumed no budget and rotated nobody.
    const after = store.kanban.getTask(executionId)!;
    assert.equal(after.handoffCount, 1);
    assert.equal(after.currentAgentId, "agent-b");
    assert.equal(after.roundCount, 2);
  } finally {
    cleanup();
  }
});
