import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { MomEvent } from "$lib/server/agent/events.js";
import type { ChannelInboundMessage, DurableAttemptHooks } from "$lib/server/agent/core/types.js";
import { DurableExecutionCoordinator } from "./coordinator.js";
import { DurableExecutionRuntime } from "./runtime.js";
import { DurableExecutionStore } from "./store.js";
import { runNextWakeup } from "./testSupport.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "molibot-durable-runtime-"));
  const store = new DurableExecutionStore(join(root, "durable-execution.sqlite"));
  const input = {
    ownerId: "owner-1",
    botId: "bot-1",
    sourceChannel: "web",
    sourceChatId: "web:owner-1:bot-1",
    goal: "Prepare the weekly report",
    constraints: ["Keep the evidence factual."],
    steps: [{ title: "Collect source data", sideEffectClass: "pure" as const }],
    acceptanceCriteria: [{ description: "All steps are complete", checkerType: "deterministic" as const, checkerKey: "steps_completed" }],
    activationPath: "deterministic" as const
  };
  return { root, store, input };
}

for (const scope of ["once", "session", "persistent"] as const) {
  test(`approved ${scope} execution resumes the suspended step and completes the plan`, async () => {
    const { root, store, input } = fixture();
    try {
      const coordinator = new DurableExecutionCoordinator(store, "process-a");
      const created = coordinator.create(input);
      const executionId = created.execution.id;
      coordinator.activate({ ownerId: input.ownerId, executionId, expectedVersion: created.execution.version });
      let calls = 0;
      let firstBudgetId: string | undefined;
      const runtime = new DurableExecutionRuntime({
        store, processOwnerId: "process-a", dataDir: root,
        channelManagers: new Map([["web", new Map([["bot-1", {
          runDurableAttempt: async (message: ChannelInboundMessage, hooks: DurableAttemptHooks) => {
            calls += 1;
            assert.ok(message.budgetId);
            if (calls === 1) {
              firstBudgetId = message.budgetId;
              await hooks.onApprovalRequest!({
                requestId: "write-request", backend: "approval_broker",
                prompt: {
                  title: "Approve write", body: "Write report.txt",
                  request: { toolId: "write", command: "report.txt", approvalMode: "persistent" },
                  options: [{ id: "approve_once", label: "Allow once" }]
                }
              } as Parameters<NonNullable<DurableAttemptHooks["onApprovalRequest"]>>[0]);
              return { result: { stopReason: "waiting_for_approval" }, contextSessionId: "suspended-context" };
            }
            assert.equal(message.budgetId, firstBudgetId, "approval resume retains the admitted step budget");
            assert.equal(await hooks.consumeDurableApproval!({
              backend: "approval_broker", actionKey: "write:report.txt:persistent", toolId: "write", command: "report.txt"
            }), scope);
            return { result: { stopReason: "stop", runId: message.runId }, contextSessionId: "resumed-context" };
          }
        }]])]]) as any
      });
      const runNext = async () => { await runNextWakeup(runtime, store, "process-a"); };
      await runNext();
      const waiting = store.getDetail(executionId)!;
      assert.equal(waiting.execution.status, "waiting_for_approval");
      coordinator.resolveApproval({
        ownerId: input.ownerId, executionId, expectedVersion: waiting.execution.version,
        approvalId: waiting.approvals[0].id, status: "approved", selectedScope: scope, actionId: "approve-write"
      });
      await runNext();
      const resumed = store.getDetail(executionId)!;
      assert.equal(calls, 2);
      assert.equal(resumed.steps[0].status, "completed");
      assert.equal(resumed.execution.status, "verifying");
      assert.equal(resumed.approvals.length, 1);
      assert.equal(resumed.attempts.every((attempt) => attempt.status !== "running"), true);
      await runNext();
      assert.equal(store.getById(executionId)!.status, "completed");
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("step startup failure settles the claimed attempt instead of leaving it running", async () => {
  const { root, store, input } = fixture();
  try {
    const coordinator = new DurableExecutionCoordinator(store, "process-a");
    const created = coordinator.create(input);
    const executionId = created.execution.id;
    const activated = coordinator.activate({ ownerId: input.ownerId, executionId, expectedVersion: created.execution.version });
    let calls = 0;
    const runtime = new DurableExecutionRuntime({
      store, processOwnerId: "process-a", dataDir: root,
      channelManagers: new Map([["web", new Map([["bot-1", {
        runDurableAttempt: async () => { calls += 1; return { result: { stopReason: "stop" } }; }
      }]])]]) as any
    });
    store.markStepRunning = () => { throw new Error("Step startup failed"); };
    await runNextWakeup(runtime, store, "process-a");
    const detail = store.getDetail(executionId)!;
    assert.equal(calls, 0);
    assert.equal(detail.execution.status, "recovery_required");
    assert.equal(detail.execution.leaseOwnerId, undefined);
    assert.equal(detail.execution.lastError, "Step startup failed");
    assert.equal(detail.attempts[0].status, "failed");
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("watched durable event claims one fresh attempt and leaves verification explicit", async () => {
  const { root, store, input } = fixture();
  try {
    const coordinator = new DurableExecutionCoordinator(store, "process-a");
    const created = coordinator.create(input);
    const activated = coordinator.activate({ ownerId: input.ownerId, executionId: created.execution.id, expectedVersion: created.execution.version });
    const runtime = new DurableExecutionRuntime({
      store,
      processOwnerId: "process-a",
      dataDir: root,
      channelManagers: new Map([
        ["web", new Map([["bot-1", {
          runDurableAttempt: async (message: ChannelInboundMessage) => ({
            result: { stopReason: "stop", runId: message.runId },
            contextSessionId: "t-archive-durable-attempt"
          })
        }]])]
      ]) as any
    });

    await runNextWakeup(runtime, store, "process-a");
    const detail = store.getDetail(created.execution.id)!;
    assert.equal(detail.execution.status, "verifying");
    assert.equal(detail.steps[0].status, "completed");
    assert.equal(detail.attempts[0].status, "completed");
    assert.equal(detail.attempts[0].contextSessionId, "t-archive-durable-attempt");
    assert.equal(detail.acceptanceCriteria[0].result, "unproven");

    await runNextWakeup(runtime, store, "process-a");
    const completed = store.getDetail(created.execution.id)!;
    assert.equal(completed.execution.status, "completed");
    assert.equal(completed.acceptanceCriteria[0].result, "passed");
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("a linear plan executes one durable step per attempt before task verification", async () => {
  const { root, store, input } = fixture();
  try {
    const coordinator = new DurableExecutionCoordinator(store, "process-a");
    const created = coordinator.create({
      ...input,
      steps: [
        { title: "Collect source data", sideEffectClass: "pure" },
        { title: "Write the report", sideEffectClass: "idempotent", idempotencyKey: "weekly-report" }
      ]
    });
    const activated = coordinator.activate({ ownerId: input.ownerId, executionId: created.execution.id, expectedVersion: created.execution.version });
    let attempts = 0;
    const runtime = new DurableExecutionRuntime({
      store,
      processOwnerId: "process-a",
      dataDir: root,
      channelManagers: new Map([
        ["web", new Map([["bot-1", {
          runDurableAttempt: async (message: ChannelInboundMessage) => {
            attempts += 1;
            return {
              result: { stopReason: "stop" as const, runId: message.runId },
              contextSessionId: `t-linear-${attempts}`
            };
          }
        }]])]
      ]) as any
    });

    await runNextWakeup(runtime, store, "process-a");
    const afterFirst = store.getDetail(created.execution.id)!;
    assert.equal(afterFirst.execution.status, "queued");
    assert.deepEqual(afterFirst.steps.map((step) => step.status), ["completed", "pending"]);
    assert.equal(afterFirst.evidenceRefs[0]?.referenceType, "run-detail");

    await runNextWakeup(runtime, store, "process-a");
    const afterSecond = store.getDetail(created.execution.id)!;
    assert.equal(afterSecond.execution.status, "verifying");
    assert.deepEqual(afterSecond.steps.map((step) => step.status), ["completed", "completed"]);
    assert.equal(attempts, 2);

    await runNextWakeup(runtime, store, "process-a");
    assert.equal(store.getById(created.execution.id)?.status, "completed");
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("durable attempts expose only attached evidence through the read-only hook", async () => {
  const { root, store, input } = fixture();
  try {
    const coordinator = new DurableExecutionCoordinator(store, "process-a");
    const created = coordinator.create(input);
    const activated = coordinator.activate({ ownerId: input.ownerId, executionId: created.execution.id, expectedVersion: created.execution.version });
    const evidence = store.addEvidence({
      executionId: created.execution.id,
      referenceType: "durable-verifier",
      referenceId: "verifier:summary",
      summary: "The stored verifier summary is available to this attempt."
    });
    const runtime = new DurableExecutionRuntime({
      store,
      processOwnerId: "process-a",
      dataDir: root,
      channelManagers: new Map([
        ["web", new Map([["bot-1", {
          runDurableAttempt: async (_message: ChannelInboundMessage, hooks: any) => {
            const read = await hooks.readDurableEvidence(evidence.id);
            assert.equal(read.untrusted, true);
            assert.match(read.content, /stored verifier summary/);
            return { result: { stopReason: "stop" as const }, contextSessionId: "t-archive-evidence-attempt" };
          }
        }]])]
      ]) as any
    });

    await runNextWakeup(runtime, store, "process-a");
    assert.equal(store.getDetail(created.execution.id)?.attempts[0]?.contextSessionId, "t-archive-evidence-attempt");
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("subjective verification creates a user decision and only explicit confirmation completes", async () => {
  const { root, store, input } = fixture();
  try {
    const coordinator = new DurableExecutionCoordinator(store, "process-a");
    const created = coordinator.create({
      ...input,
      acceptanceCriteria: [{
        description: "The report is accurate and useful.",
        checkerType: "subjective"
      }]
    });
    const activated = coordinator.activate({ ownerId: input.ownerId, executionId: created.execution.id, expectedVersion: created.execution.version });
    const runtime = new DurableExecutionRuntime({
      store,
      processOwnerId: "process-a",
      dataDir: root,
      channelManagers: new Map([
        ["web", new Map([["bot-1", {
          runDurableAttempt: async (message: ChannelInboundMessage) => ({
            result: { stopReason: "stop", runId: message.runId },
            contextSessionId: "t-archive-subjective-attempt"
          })
        }]])]
      ]) as any
    });

    await runNextWakeup(runtime, store, "process-a");
    await runNextWakeup(runtime, store, "process-a");
    const waiting = store.getDetail(created.execution.id)!;
    assert.equal(waiting.execution.status, "waiting_for_user");
    assert.equal(waiting.decisions.length, 1);
    assert.equal(waiting.decisions[0]?.status, "open");
    assert.equal(waiting.attempts.some((attempt) => attempt.status === "waiting"), true);

    const answered = coordinator.answerDecision({
      ownerId: input.ownerId,
      executionId: created.execution.id,
      decisionId: waiting.decisions[0]!.id,
      answer: "confirm_completion",
      expectedVersion: waiting.execution.version,
      actionId: "confirm-subjective-1"
    });
    assert.equal(answered.execution.status, "completed");
    assert.deepEqual(store.pendingWakeups(created.execution.id), []);
    const completed = store.getDetail(created.execution.id)!;
    assert.equal(completed.execution.status, "completed");
    assert.equal(completed.acceptanceCriteria[0]?.result, "passed");
    assert.equal(completed.acceptanceCriteria[0]?.userEdited, true);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("durable attempts persist one intent and one receipt around a non-pure tool", async () => {
  const { root, store, input } = fixture();
  try {
    const coordinator = new DurableExecutionCoordinator(store, "process-a");
    const created = coordinator.create({
      ...input,
      steps: [{ title: "Publish report", sideEffectClass: "non_idempotent" }]
    });
    const activated = coordinator.activate({ ownerId: input.ownerId, executionId: created.execution.id, expectedVersion: created.execution.version });
    const runtime = new DurableExecutionRuntime({
      store,
      processOwnerId: "process-a",
      dataDir: root,
      channelManagers: new Map([
        ["web", new Map([["bot-1", {
          runDurableAttempt: async (_message: ChannelInboundMessage, hooks: any) => {
            const effect = {
              toolId: "write",
              toolCallId: "tool-1",
              sideEffectClass: "idempotent" as const,
              idempotencyKey: "stable-report-write",
              targetSummary: "write:weekly-report.md",
              contentSummary: "report contents"
            };
            await hooks.onToolSideEffectPreflight(effect);
            await hooks.onToolSideEffectReceipt(effect, { ok: true, content: "published" });
            return {
              result: { stopReason: "stop" as const },
              contextSessionId: "t-archive-side-effect"
            };
          }
        }]])]
      ]) as any
    });

    await runNextWakeup(runtime, store, "process-a");
    const detail = store.getDetail(created.execution.id)!;
    assert.deepEqual(detail.sideEffects.map((effect) => effect.phase), ["intent", "receipt"]);
    assert.equal(detail.sideEffects[0]?.idempotencyKey, "stable-report-write");
    assert.equal(detail.sideEffects[1]?.idempotencyKey, "stable-report-write");
    assert.equal(detail.execution.status, "verifying");
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("recovery_required does not retry an uncertain non-idempotent step without a user decision", async () => {
  const { root, store, input } = fixture();
  try {
    const coordinator = new DurableExecutionCoordinator(store, "process-a");
    const created = coordinator.create({
      ...input,
      steps: [{ title: "Publish report", sideEffectClass: "non_idempotent" }]
    });
    const activated = coordinator.activate({ ownerId: input.ownerId, executionId: created.execution.id, expectedVersion: created.execution.version });
    const claimed = store.claimAttempt({
      executionId: created.execution.id,
      expectedVersion: activated.execution.version,
      processOwnerId: "process-a",
      runId: "run-recovery-a",
      contextSessionId: "session-recovery-a",
      leaseDurationMs: 60_000
    });
    const step = store.getDetail(created.execution.id)!.steps[0]!;
    store.markStepRunning(created.execution.id, step.id, claimed.execution.version, "process-a");
    store.recordSideEffectIntent({
      executionId: created.execution.id,
      stepId: step.id,
      attemptId: claimed.attempt.id,
      processOwnerId: "process-a",
      expectedVersion: store.getById(created.execution.id)!.version,
      sideEffectClass: "non_idempotent",
      idempotencyKey: "publish-report",
      targetSummary: "report service",
      contentSummary: "publish report"
    });
    store.reconcileOrphanedAttempts("process-b", new Date(Date.now() + 3_600_000));
    const recovered = store.getById(created.execution.id)!;
    const runtime = new DurableExecutionRuntime({
      store,
      processOwnerId: "process-a",
      dataDir: root,
      channelManagers: new Map([
        ["web", new Map([["bot-1", {
          runDurableAttempt: async () => {
            throw new Error("uncertain non-idempotent work must not be retried");
          }
        }]])]
      ]) as any
    });

    await runtime.run({
      internal: { kind: "durable-execution", durable: { executionId: created.execution.id, expectedVersion: recovered.version } }
    } as MomEvent, join(root, "recovery.json"));
    const detail = store.getDetail(created.execution.id)!;
    assert.equal(detail.execution.status, "waiting_for_user");
    assert.equal(detail.execution.waitingKind, "recovery");
    assert.deepEqual(detail.decisions[0]?.options, ["retry_after_recovery_review"]);
    assert.equal(detail.attempts.filter((attempt) => attempt.status === "running").length, 0);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

for (const firstEffect of ["non_idempotent", "queryable"] as const) {
  test(`recovery reviews an earlier ${firstEffect} operation even when the last intent is safe`, async () => {
    const { root, store, input } = fixture();
    try {
      const coordinator = new DurableExecutionCoordinator(store, "process-a");
      const created = coordinator.create(input);
      const activated = coordinator.activate({ ownerId: input.ownerId, executionId: created.execution.id, expectedVersion: created.execution.version });
      const claimed = store.claimAttempt({
        executionId: created.execution.id, expectedVersion: activated.execution.version,
        processOwnerId: "process-a", runId: "mixed-effects", contextSessionId: "mixed-effects-context", leaseDurationMs: 60_000
      });
      const step = store.getDetail(created.execution.id)!.steps[0]!;
      store.markStepRunning(created.execution.id, step.id, claimed.execution.version, "process-a");
      for (const sideEffectClass of [firstEffect, "idempotent"] as const) {
        store.recordSideEffectIntent({
          executionId: created.execution.id, stepId: step.id, attemptId: claimed.attempt.id,
          processOwnerId: "process-a", expectedVersion: store.getById(created.execution.id)!.version,
          sideEffectClass, idempotencyKey: sideEffectClass,
          targetSummary: sideEffectClass === "idempotent" ? "local report" : "report service",
          contentSummary: sideEffectClass === "idempotent" ? "write report" : "publish report"
        });
      }
      store.reconcileOrphanedAttempts("process-b", new Date(Date.now() + 3_600_000));
      let attempts = 0;
      const runtime = new DurableExecutionRuntime({
        store, processOwnerId: "process-b", dataDir: root,
        queryableProbes: { queryable: async () => { throw new Error("one probe cannot verify a multi-operation step"); } },
        channelManagers: new Map([["web", new Map([["bot-1", {
          runDurableAttempt: async () => { attempts += 1; return { result: { stopReason: "stop" } }; }
        }]])]]) as any
      });
      await runtime.run({
        internal: { kind: "durable-execution", durable: { executionId: created.execution.id, expectedVersion: store.getById(created.execution.id)!.version } }
      } as MomEvent, join(root, "mixed-effects.json"));
      assert.equal(attempts, 0, "the earlier send must not be repeated as part of a whole-step retry");
      const detail = store.getDetail(created.execution.id)!;
      assert.equal(detail.execution.status, "waiting_for_user");
      assert.equal(detail.decisions.length, 1);
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("queryable recovery reconciles completed external state before verification", async () => {
  const { root, store, input } = fixture();
  try {
    const coordinator = new DurableExecutionCoordinator(store, "process-a");
    const created = coordinator.create({
      ...input,
      steps: [{ title: "Publish report", sideEffectClass: "queryable", idempotencyKey: "report:weekly" }]
    });
    const activated = coordinator.activate({ ownerId: input.ownerId, executionId: created.execution.id, expectedVersion: created.execution.version });
    const claimed = store.claimAttempt({
      executionId: created.execution.id,
      expectedVersion: activated.execution.version,
      processOwnerId: "process-a",
      runId: "run-queryable-a",
      contextSessionId: "session-queryable-a",
      leaseDurationMs: 60_000
    });
    const step = store.getDetail(created.execution.id)!.steps[0]!;
    store.markStepRunning(created.execution.id, step.id, claimed.execution.version, "process-a");
    store.recordSideEffectIntent({
      executionId: created.execution.id,
      stepId: step.id,
      attemptId: claimed.attempt.id,
      processOwnerId: "process-a",
      expectedVersion: store.getById(created.execution.id)!.version,
      sideEffectClass: "queryable",
      idempotencyKey: "report:weekly",
      targetSummary: "report service",
      contentSummary: "publish report"
    });
    store.recordSideEffectIntent({
      executionId: created.execution.id,
      stepId: step.id,
      attemptId: claimed.attempt.id,
      processOwnerId: "process-a",
      expectedVersion: store.getById(created.execution.id)!.version,
      sideEffectClass: "queryable",
      idempotencyKey: "report:weekly",
      targetSummary: "report service",
      contentSummary: "publish report"
    });
    store.reconcileOrphanedAttempts("process-b", new Date(Date.now() + 3_600_000));
    const recovered = store.getById(created.execution.id)!;
    let probed = false;
    const runtime = new DurableExecutionRuntime({
      store,
      processOwnerId: "process-a",
      dataDir: root,
      queryableProbes: {
        "report:weekly": async ({ step: probedStep }) => {
          probed = true;
          assert.equal(probedStep.id, step.id);
          return { status: "completed", summary: "External report service confirms the report exists.", externalId: "report-42" };
        }
      },
      channelManagers: new Map() as any
    });

    await runtime.run({
      internal: { kind: "durable-execution", durable: { executionId: created.execution.id, expectedVersion: recovered.version } }
    } as MomEvent, join(root, "queryable-recovery.json"));
    const detail = store.getDetail(created.execution.id)!;
    assert.equal(probed, true);
    assert.equal(detail.execution.status, "verifying");
    assert.equal(detail.steps[0]?.status, "completed");
    assert.equal(detail.sideEffects.some((effect) => effect.phase === "receipt" && effect.externalId === "report-42"), true);
    assert.equal(detail.evidenceRefs.some((evidence) => evidence.referenceType === "durable-queryable-probe"), true);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("queryable recovery without a probe waits for an explicit review instead of retrying", async () => {
  const { root, store, input } = fixture();
  try {
    const coordinator = new DurableExecutionCoordinator(store, "process-a");
    const created = coordinator.create({
      ...input,
      steps: [{ title: "Publish report", sideEffectClass: "queryable", idempotencyKey: "report:weekly" }]
    });
    const activated = coordinator.activate({ ownerId: input.ownerId, executionId: created.execution.id, expectedVersion: created.execution.version });
    const claimed = store.claimAttempt({
      executionId: created.execution.id,
      expectedVersion: activated.execution.version,
      processOwnerId: "process-a",
      runId: "run-queryable-no-probe",
      contextSessionId: "session-queryable-no-probe",
      leaseDurationMs: 60_000
    });
    const step = store.getDetail(created.execution.id)!.steps[0]!;
    store.markStepRunning(created.execution.id, step.id, claimed.execution.version, "process-a");
    store.recordSideEffectIntent({
      executionId: created.execution.id,
      stepId: step.id,
      attemptId: claimed.attempt.id,
      processOwnerId: "process-a",
      expectedVersion: store.getById(created.execution.id)!.version,
      sideEffectClass: "queryable",
      idempotencyKey: "report:weekly",
      targetSummary: "report service",
      contentSummary: "publish report"
    });
    store.reconcileOrphanedAttempts("process-b", new Date(Date.now() + 3_600_000));
    const recovered = store.getById(created.execution.id)!;
    let attempted = false;
    const runtime = new DurableExecutionRuntime({
      store,
      processOwnerId: "process-a",
      dataDir: root,
      channelManagers: new Map([
        ["web", new Map([["bot-1", {
          runDurableAttempt: async () => {
            attempted = true;
            throw new Error("a queryable step without a probe must not be retried");
          }
        }]])]
      ]) as any
    });

    await runtime.run({
      internal: { kind: "durable-execution", durable: { executionId: created.execution.id, expectedVersion: recovered.version } }
    } as MomEvent, join(root, "queryable-no-probe.json"));
    const detail = store.getDetail(created.execution.id)!;
    assert.equal(attempted, false);
    assert.equal(detail.execution.status, "waiting_for_user");
    assert.equal(detail.execution.waitingKind, "recovery");
    assert.match(detail.decisions[0]?.question ?? "", /no external-state probe/);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("a bound plan uses isolated attempts while its receiving Session is busy and pauses only after quiescence", async () => {
  const { root, store } = fixture();
  const { PlanService } = await import("../plans/service.js");
  try {
    const coordinator = new DurableExecutionCoordinator(store, "process-a");
    const plans = new PlanService(store, coordinator);
    const plan = plans.create({ ownerId: "owner-1", botId: "bot-1", sourceChannel: "web", sourceChatId: "original-chat", sourceUiSessionId: "session-a", title: "Bound plan", tasks: [{ title: "Task", steps: [{ title: "One" }, { title: "Two" }] }] });
    const approved = plans.approve({ ownerId: "owner-1", planId: plan.execution.id, expectedVersion: plan.execution.version, sessionId: "busy-session-b", agentId: "agent-a", mode: "manual" });
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const runtime = new DurableExecutionRuntime({ store, processOwnerId: "process-a", dataDir: root,
      channelManagers: new Map([["web", new Map([["bot-1", { runDurableAttempt: async (message: ChannelInboundMessage) => {
        assert.equal(message.sessionMode, "fresh");
        assert.equal(message.agentId, "agent-a");
        assert.equal(message.chatId, "original-chat");
        assert.notEqual(message.sessionId, "busy-session-b");
        entered(); await gate;
        return { result: { stopReason: "stop", runId: message.runId }, contextSessionId: "isolated-attempt" };
      } }]])]]) as any });
    const running = (async () => {
      const [wakeup] = store.claimDueWakeups("process-a", 1);
      assert.ok(wakeup);
      await runtime.runWakeup(wakeup);
    })();
    await Promise.race([started, running.then(() => { throw new Error(store.getById(plan.execution.id)?.lastError || "Attempt did not start"); })]);
    const before = plans.read("owner-1", plan.execution.id);
    const pausing = plans.pause({ ownerId: "owner-1", planId: plan.execution.id, expectedVersion: before.execution.version, actionId: "pause" });
    assert.equal(pausing.execution.status, "running");
    assert.equal(pausing.controlRequest, "pause");
    assert.throws(() => plans.edit({ ownerId: "owner-1", executionId: plan.execution.id, expectedVersion: pausing.execution.version, author: "user", tasks: [{ title: "Changed", steps: [{ title: "X" }] }] }), /transition/);
    release(); await running;
    const paused = plans.read("owner-1", plan.execution.id);
    assert.equal(paused.execution.status, "paused");
    assert.equal(paused.controlRequest, undefined);
    assert.equal(paused.binding?.sessionId, "busy-session-b");
    assert.equal(paused.tasks[0].steps[0].status, "completed");
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test("bound plans retain original input files and summary after source deletion, and retry feedback after restart", async () => {
  const { root, store } = fixture();
  const { writeFileSync, mkdirSync } = await import("node:fs");
  const { capturePlanInput } = await import("../plans/input.js");
  const { PlanService } = await import("../plans/service.js");
  try {
    mkdirSync(join(root, "source")); writeFileSync(join(root, "source", "input.txt"), "original data");
    const snapshot = capturePlanInput("context-plan", { text: "Use the original figures", workspaceDir: root, attachments: [{ original: "input.txt", local: "source/input.txt", mediaType: "file", isImage: false, isAudio: false }] });
    const plans = new PlanService(store, new DurableExecutionCoordinator(store, "process-a"));
    const plan = plans.create({ planId: "context-plan", inputSnapshot: snapshot, ownerId: "owner-1", botId: "bot-1", sourceChannel: "web", sourceChatId: "original", sourceUiSessionId: "deleted-source", title: "Context", summary: "Preserve currencies", tasks: [{ title: "Task", description: "Use decimal units", steps: [{ title: "Read" }] }] });
    rmSync(join(root, "source"), { recursive: true });
    const approved = plans.approve({ ownerId: "owner-1", planId: plan.execution.id, expectedVersion: plan.execution.version, sessionId: "receiver", agentId: "default", mode: "manual" });
    let delivered = 0;
    const options = { store, processOwnerId: "process-a", dataDir: root, channelManagers: new Map([["web", new Map([["bot-1", { runDurableAttempt: async (message: ChannelInboundMessage) => {
      assert.match(message.text, /Use the original figures/); assert.match(message.text, /Preserve currencies/); assert.match(message.text, /Use decimal units/);
      assert.equal(readFileSync(join(root, message.attachments![0].local), "utf8"), "original data");
      return { result: { stopReason: "stop", runId: message.runId }, text: "Actual result" };
    } }]])]]) as any };
    const runtime = new DurableExecutionRuntime({ ...options, onPlanAttempt: () => { throw new Error("offline feedback"); } });
    await runNextWakeup(runtime, store, "process-a");
    assert.equal(store.pendingPlanDeliveries().length, 1);
    const restarted = new DurableExecutionRuntime({ ...options, onPlanAttempt: input => { assert.equal(input.text, "Actual result"); assert.equal(input.binding.sessionId, "receiver"); delivered++; } });
    await restarted.reconcilePlanDeliveries(); await restarted.reconcilePlanDeliveries();
    assert.equal(delivered, 1); assert.equal(store.pendingPlanDeliveries().length, 0);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

for (const action of ["pause", "cancel"] as const) test(`restart settles a persisted ${action} request without stopping a later attempt`, () => {
  const { root, store, input } = fixture();
  try {
    const execution = store.create(input);
    const queued = store.transitionStatus(execution.id, execution.version, "queued");
    store.claimAttempt({ executionId: execution.id, expectedVersion: queued.version, processOwnerId: "dead-process", runId: "dead-run", contextSessionId: "dead-context", leaseDurationMs: 10000 });
    store.requestControl(execution.id, store.getById(execution.id)!.version, action);
    // A crashed owner's lease is reclaimed only after it expires.
    assert.equal(store.reconcileOrphanedAttempts("new-process"), 0);
    assert.equal(store.reconcileOrphanedAttempts("new-process", new Date(Date.now() + 60_000)), 1);
    assert.equal(store.getById(execution.id)!.status, action === "pause" ? "paused" : "cancelled");
    assert.equal(store.getControlRequest(execution.id), undefined);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});
