import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DurableExecutionBudgetError,
  DurableExecutionConflictError,
  DurableExecutionLeaseError,
  DurableExecutionStore,
  DurableExecutionTransitionError
} from "./store.js";

function tempDatabase(): { file: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "molibot-durable-"));
  return {
    file: join(root, "durable-execution.sqlite"),
    cleanup: () => rmSync(root, { recursive: true, force: true })
  };
}

function createInput(overrides: Partial<Parameters<DurableExecutionStore["create"]>[0]> = {}) {
  return {
    ownerId: "owner-1",
    botId: "bot-1",
    sourceChannel: "web",
    sourceChatId: "web:owner-1:bot-1",
    sourceUiSessionId: "ui-session-1",
    goal: "Prepare the weekly report",
    constraints: ["Do not send it without approval."],
    steps: [
      { title: "Collect the source data", sideEffectClass: "pure" as const },
      { title: "Write the report", sideEffectClass: "idempotent" as const, idempotencyKey: "report:weekly" }
    ],
    acceptanceCriteria: [
      { description: "The report file exists", checkerType: "deterministic" as const, checkerKey: "file_exists" },
      { description: "The report is useful to the team", checkerType: "subjective" as const }
    ],
    activationPath: "deterministic" as const,
    activationReason: "User asked to continue this over several days.",
    now: new Date("2026-08-09T10:00:00.000Z"),
    ...overrides
  };
}

test("durable execution persists the full initial aggregate across a store restart", () => {
  const database = tempDatabase();
  try {
    const first = new DurableExecutionStore(database.file);
    const created = first.create(createInput());
    assert.equal(created.shortHandle, "#1");
    assert.equal(created.status, "planned");
    const beforeRestart = first.getDetail(created.id);
    assert.ok(beforeRestart);
    assert.equal(beforeRestart.steps.length, 2);
    assert.equal(beforeRestart.acceptanceCriteria.length, 2);
    assert.equal(beforeRestart.plans[0].version, 1);
    first.close();

    const second = new DurableExecutionStore(database.file);
    const afterRestart = second.getDetail(created.id, "owner-1");
    assert.ok(afterRestart);
    assert.equal(afterRestart.execution.goal, "Prepare the weekly report");
    assert.deepEqual(afterRestart.execution.constraints, ["Do not send it without approval."]);
    assert.equal(afterRestart.steps[1].sideEffectClass, "idempotent");
    assert.equal(afterRestart.acceptanceCriteria.find((item) => item.description === "The report is useful to the team")?.checkerType, "subjective");
    assert.equal(second.getByHandle("owner-1", "#1")?.id, created.id);
    second.close();
  } finally {
    database.cleanup();
  }
});

test("handles are stable per owner and stale versions fail closed", () => {
  const database = tempDatabase();
  const store = new DurableExecutionStore(database.file);
  try {
    const first = store.create(createInput());
    const second = store.create(createInput({ goal: "Prepare the monthly report" }));
    const otherOwner = store.create(createInput({ ownerId: "owner-2", goal: "Prepare another report" }));
    assert.deepEqual([first.shortHandle, second.shortHandle, otherOwner.shortHandle], ["#1", "#2", "#1"]);

    const paused = store.pause(first.id, first.version);
    assert.equal(paused.status, "paused");
    assert.throws(
      () => store.cancel(first.id, first.version),
      (error: unknown) => error instanceof DurableExecutionConflictError
    );
    assert.throws(
      () => store.transitionStatus(second.id, second.version, "completed"),
      (error: unknown) => error instanceof DurableExecutionTransitionError
    );
    assert.equal(store.resume(first.id, paused.version).status, "queued");
  } finally {
    store.close();
    database.cleanup();
  }
});

test("attempt and token budgets fail closed before a new attempt is created", () => {
  const database = tempDatabase();
  const store = new DurableExecutionStore(database.file);
  try {
    const created = store.create(createInput({ budget: { attemptLimit: 1 } }));
    const first = store.claimAttempt({
      executionId: created.id,
      expectedVersion: created.version,
      processOwnerId: "process-a",
      runId: "run-a",
      contextSessionId: "session-a",
      leaseDurationMs: 60_000
    });
    store.finishAttempt({
      executionId: created.id,
      attemptId: first.attempt.id,
      expectedVersion: first.execution.version,
      processOwnerId: "process-a",
      status: "completed",
      nextExecutionStatus: "verifying",
    });
    const verifying = store.getById(created.id)!;
    assert.throws(
      () => store.claimAttempt({
        executionId: created.id,
        expectedVersion: verifying.version,
        processOwnerId: "process-a",
        runId: "run-c",
        contextSessionId: "session-c",
        leaseDurationMs: 60_000
      }),
      DurableExecutionBudgetError
    );

    const tokenLimited = store.create(createInput({ budget: { tokenLimit: 10, attemptLimit: 3 } }));
    const tokenAttempt = store.claimAttempt({
      executionId: tokenLimited.id,
      expectedVersion: tokenLimited.version,
      processOwnerId: "process-a",
      runId: "run-token-a",
      contextSessionId: "session-token-a",
      leaseDurationMs: 60_000
    });
    store.finishAttempt({
      executionId: tokenLimited.id,
      attemptId: tokenAttempt.attempt.id,
      expectedVersion: tokenAttempt.execution.version,
      processOwnerId: "process-a",
      status: "completed",
      nextExecutionStatus: "verifying",
      tokensUsed: 10
    });
    const tokenVersion = store.getById(tokenLimited.id)!;
    assert.throws(
      () => store.claimAttempt({
        executionId: tokenLimited.id,
        expectedVersion: tokenVersion.version,
        processOwnerId: "process-a",
        runId: "run-token-b",
        contextSessionId: "session-token-b",
        leaseDurationMs: 60_000
      }),
      DurableExecutionBudgetError
    );
  } finally {
    store.close();
    database.cleanup();
  }
});

test("verification leases do not consume the Agent attempt budget", () => {
  const database = tempDatabase();
  const store = new DurableExecutionStore(database.file);
  try {
    const created = store.create(createInput({ budget: { attemptLimit: 1 } }));
    const agentAttempt = store.claimAttempt({
      executionId: created.id,
      expectedVersion: created.version,
      processOwnerId: "process-a",
      runId: "run-agent",
      contextSessionId: "session-agent",
      leaseDurationMs: 60_000
    });
    store.finishAttempt({
      executionId: created.id,
      attemptId: agentAttempt.attempt.id,
      expectedVersion: agentAttempt.execution.version,
      processOwnerId: "process-a",
      status: "completed",
      nextExecutionStatus: "verifying"
    });
    const verifying = store.getById(created.id)!;
    const verifier = store.claimAttempt({
      executionId: created.id,
      expectedVersion: verifying.version,
      processOwnerId: "process-a",
      runId: "run-verifier",
      contextSessionId: "session-verifier",
      leaseDurationMs: 60_000,
      countTowardsAttemptBudget: false
    });
    assert.equal(verifier.execution.attemptsUsed, 1);
  } finally {
    store.close();
    database.cleanup();
  }
});

test("continue_work creates a new plan version instead of looping the completed plan", () => {
  const database = tempDatabase();
  const store = new DurableExecutionStore(database.file);
  try {
    const created = store.create(createInput({
      acceptanceCriteria: [{ description: "The report is useful", checkerType: "subjective" as const }]
    }));
    const claimed = store.claimAttempt({
      executionId: created.id,
      expectedVersion: created.version,
      processOwnerId: "process-a",
      runId: "run-a",
      contextSessionId: "session-a",
      leaseDurationMs: 60_000
    });
    store.finishAttempt({
      executionId: created.id,
      attemptId: claimed.attempt.id,
      expectedVersion: claimed.execution.version,
      processOwnerId: "process-a",
      status: "completed",
      nextExecutionStatus: "verifying"
    });
    const verifying = store.getById(created.id)!;
    const verifier = store.claimAttempt({
      executionId: created.id,
      expectedVersion: verifying.version,
      processOwnerId: "process-a",
      runId: "run-verifier",
      contextSessionId: "session-verifier",
      leaseDurationMs: 60_000,
      countTowardsAttemptBudget: false
    });
    const decision = store.openDecision({
      executionId: created.id,
      expectedVersion: verifier.execution.version,
      processOwnerId: "process-a",
      question: "Continue?",
      options: ["confirm_completion", "continue_work"]
    });
    const continued = store.answerDecision({
      executionId: created.id,
      decisionId: decision.id,
      answer: "continue_work",
      answeredBy: "owner-1",
      expectedVersion: store.getById(created.id)!.version
    });
    const detail = store.getDetail(created.id)!;
    assert.equal(continued.status, "queued");
    assert.equal(detail.execution.currentPlanVersion, 2);
    assert.equal(detail.plans.length, 2);
    assert.equal(detail.steps.filter((step) => step.planVersion === 2).length, 1);
    assert.equal(detail.steps.find((step) => step.planVersion === 2)?.status, "pending");
    assert.equal(detail.acceptanceCriteria.find((criterion) => criterion.planVersion === 2)?.result, "unproven");
  } finally {
    store.close();
    database.cleanup();
  }
});

test("confirm_completion ends the execution without requeueing", () => {
  const database = tempDatabase();
  const store = new DurableExecutionStore(database.file);
  try {
    const created = store.create(createInput({
      acceptanceCriteria: [{ description: "The report is useful", checkerType: "subjective" as const }]
    }));
    const claimed = store.claimAttempt({
      executionId: created.id,
      expectedVersion: created.version,
      processOwnerId: "process-a",
      runId: "run-a",
      contextSessionId: "session-a",
      leaseDurationMs: 60_000
    });
    for (const step of store.getDetail(created.id)!.steps) {
      store.markStepRunning(created.id, step.id, store.getById(created.id)!.version, "process-a");
      store.completeStep({ executionId: created.id, stepId: step.id, expectedVersion: store.getById(created.id)!.version, processOwnerId: "process-a", outputSummary: "Verified output" });
    }
    store.finishAttempt({
      executionId: created.id,
      attemptId: claimed.attempt.id,
      expectedVersion: store.getById(created.id)!.version,
      processOwnerId: "process-a",
      status: "completed",
      nextExecutionStatus: "verifying"
    });
    const verifying = store.getById(created.id)!;
    const verifier = store.claimAttempt({
      executionId: created.id,
      expectedVersion: verifying.version,
      processOwnerId: "process-a",
      runId: "run-verifier",
      contextSessionId: "session-verifier",
      leaseDurationMs: 60_000,
      countTowardsAttemptBudget: false
    });
    const decision = store.openDecision({
      executionId: created.id,
      expectedVersion: verifier.execution.version,
      processOwnerId: "process-a",
      question: "Continue?",
      options: ["confirm_completion", "continue_work"]
    });
    const continued = store.answerDecision({
      executionId: created.id,
      decisionId: decision.id,
      answer: "confirm_completion",
      answeredBy: "owner-1",
      expectedVersion: store.getById(created.id)!.version
    });
    const detail = store.getDetail(created.id)!;
    assert.equal(continued.status, "completed");
    assert.equal(detail.execution.currentPlanVersion, 1);
    assert.equal(detail.acceptanceCriteria[0].result, "passed");
  } finally {
    store.close();
    database.cleanup();
  }
});

test("attempt lease, step evidence, and side-effect intent/receipt use versioned writes", () => {
  const database = tempDatabase();
  const store = new DurableExecutionStore(database.file);
  try {
    const created = store.create(createInput());
    const claimed = store.claimAttempt({
      executionId: created.id,
      expectedVersion: created.version,
      processOwnerId: "process-a",
      runId: "run-a",
      contextSessionId: "automation-session-a",
      leaseDurationMs: 60_000,
      now: new Date("2026-08-09T10:01:00.000Z")
    });
    assert.equal(claimed.execution.status, "running");
    assert.equal(claimed.attempt.status, "running");

    const step = store.getDetail(created.id)!.steps[0];
    const running = store.markStepRunning(created.id, step.id, claimed.execution.version, "process-a");
    assert.equal(running.status, "running");
    const afterStart = store.getById(created.id)!;
    const intent = store.recordSideEffectIntent({
      executionId: created.id,
      stepId: running.id,
      attemptId: claimed.attempt.id,
      processOwnerId: "process-a",
      expectedVersion: afterStart.version,
      sideEffectClass: "pure",
      idempotencyKey: "collect:weekly",
      targetSummary: "Source database",
      contentSummary: "Collect weekly source data"
    });
    assert.equal(intent.phase, "intent");

    const afterIntent = store.getById(created.id)!;
    const receipt = store.recordSideEffectReceipt({
      executionId: created.id,
      stepId: running.id,
      attemptId: claimed.attempt.id,
      processOwnerId: "process-a",
      expectedVersion: afterIntent.version,
      sideEffectClass: "pure",
      idempotencyKey: "collect:weekly",
      targetSummary: "Source database",
      contentSummary: "Collected 42 source rows",
      externalId: "query-42"
    });
    assert.equal(receipt.phase, "receipt");
    assert.equal(receipt.externalId, "query-42");

    const afterReceipt = store.getById(created.id)!;
    const completed = store.completeStep({
      executionId: created.id,
      stepId: running.id,
      expectedVersion: afterReceipt.version,
      processOwnerId: "process-a",
      outputSummary: "Collected 42 source rows",
      evidenceSummary: "query-42"
    });
    assert.equal(completed.status, "completed");
    const afterStep = store.getById(created.id)!;
    const detail = store.getDetail(created.id)!;
    assert.equal(detail.sideEffects.length, 2);
    assert.equal(detail.steps[0].status, "completed");

    const finished = store.finishAttempt({
      executionId: created.id,
      attemptId: claimed.attempt.id,
      expectedVersion: afterStep.version,
      processOwnerId: "process-a",
      status: "completed",
      nextExecutionStatus: "verifying",
      tokensUsed: 123,
      reason: "Ready for task verification"
    });
    assert.equal(finished.status, "verifying");
    assert.equal(finished.tokensUsed, 123);
    assert.equal(store.getDetail(created.id)!.attempts[0].status, "completed");
  } finally {
    store.close();
    database.cleanup();
  }
});

test("startup reconciliation turns an old active step into uncertain recovery", () => {
  const database = tempDatabase();
  const store = new DurableExecutionStore(database.file);
  try {
    const created = store.create(createInput());
    const claimed = store.claimAttempt({
      executionId: created.id,
      expectedVersion: created.version,
      processOwnerId: "old-process",
      runId: "old-run",
      contextSessionId: "old-session",
      leaseDurationMs: 600_000
    });
    const step = store.getDetail(created.id)!.steps[0];
    store.markStepRunning(created.id, step.id, claimed.execution.version, "old-process");

    assert.equal(store.reconcileOrphanedAttempts("new-process"), 1);
    const detail = store.getDetail(created.id)!;
    assert.equal(detail.execution.status, "recovery_required");
    assert.equal(detail.execution.waitingKind, "recovery");
    assert.equal(detail.steps[0].status, "uncertain");
    assert.equal(detail.attempts[0].status, "interrupted");
    assert.equal(detail.execution.leaseOwnerId, undefined);
  } finally {
    store.close();
    database.cleanup();
  }
});

test("active attempts cannot be claimed twice and expired leases are reconciled before takeover", () => {
  const database = tempDatabase();
  const store = new DurableExecutionStore(database.file);
  try {
    const created = store.create(createInput());
    const startedAt = new Date("2026-08-09T10:00:00.000Z");
    const first = store.claimAttempt({
      executionId: created.id,
      expectedVersion: created.version,
      processOwnerId: "process-a",
      runId: "run-a",
      contextSessionId: "session-a",
      leaseDurationMs: 60_000,
      now: startedAt
    });
    assert.throws(
      () => store.claimAttempt({
        executionId: created.id,
        expectedVersion: first.execution.version,
        processOwnerId: "process-a",
        runId: "run-a-duplicate",
        contextSessionId: "session-a-duplicate",
        leaseDurationMs: 60_000,
        now: new Date("2026-08-09T10:00:30.000Z")
      }),
      (error: unknown) => error instanceof DurableExecutionLeaseError
    );

    const step = store.getDetail(created.id)!.steps[0];
    store.markStepRunning(created.id, step.id, first.execution.version, "process-a", startedAt);
    const beforeTakeover = store.getById(created.id)!;
    const second = store.claimAttempt({
      executionId: created.id,
      expectedVersion: beforeTakeover.version,
      processOwnerId: "process-b",
      runId: "run-b",
      contextSessionId: "session-b",
      leaseDurationMs: 60_000,
      now: new Date("2026-08-09T10:02:00.000Z")
    });
    assert.equal(second.execution.status, "running");
    const detail = store.getDetail(created.id)!;
    assert.equal(detail.steps[0].status, "uncertain");
    assert.equal(detail.attempts.find((attempt) => attempt.id === first.attempt.id)?.status, "interrupted");
    assert.equal(detail.attempts.find((attempt) => attempt.id === second.attempt.id)?.status, "running");
  } finally {
    store.close();
    database.cleanup();
  }
});

test("control action receipt is atomic from the caller's perspective and releases execution lease", () => {
  const database = tempDatabase();
  const store = new DurableExecutionStore(database.file);
  try {
    const created = store.create(createInput());
    const claimed = store.claimAttempt({
      executionId: created.id,
      expectedVersion: created.version,
      processOwnerId: "process-a",
      runId: "run-a",
      contextSessionId: "session-a",
      leaseDurationMs: 60_000
    });
    const paused = store.runControlAction({
      actionId: "action-pause-1",
      executionId: created.id,
      action: "pause",
      expectedVersion: claimed.execution.version,
      reason: "Waiting for the owner."
    });
    const replayed = store.runControlAction({
      actionId: "action-pause-1",
      executionId: created.id,
      action: "pause",
      expectedVersion: claimed.execution.version,
      reason: "Different text must not mutate a replay."
    });
    assert.equal(paused.status, "paused");
    assert.equal(replayed.version, paused.version);
    assert.equal(replayed.waitingReason, paused.waitingReason);
    const detail = store.getDetail(created.id)!;
    assert.equal(detail.execution.leaseOwnerId, undefined);
    assert.equal(detail.attempts[0].status, "interrupted");
  } finally {
    store.close();
    database.cleanup();
  }
});

test("a one-time durable approval is consumed before a resumed attempt can run", () => {
  const database = tempDatabase();
  const store = new DurableExecutionStore(database.file);
  try {
    const created = store.create(createInput());
    const claimed = store.claimAttempt({
      executionId: created.id,
      expectedVersion: created.version,
      processOwnerId: "process-a",
      runId: "run-approval-a",
      contextSessionId: "session-a",
      leaseDurationMs: 60_000
    });
    const approval = store.recordApprovalRequest({
      executionId: created.id,
      attemptId: claimed.attempt.id,
      expectedVersion: claimed.execution.version,
      processOwnerId: "process-a",
      requestId: "approval-request-a",
      backend: "approval_broker",
      actionKey: "host-bash:git status:ephemeral",
      toolId: "host-bash",
      title: "Needs approval",
      summary: "Run git status.",
      options: ["approve_once", "reject"]
    });
    const waiting = store.finishAttempt({
      executionId: created.id,
      attemptId: claimed.attempt.id,
      expectedVersion: store.getById(created.id)!.version,
      processOwnerId: "process-a",
      status: "waiting",
      nextExecutionStatus: "waiting_for_approval"
    });
    const queued = store.runControlAction({
      actionId: "resolve-approval-a",
      executionId: created.id,
      action: "resolve_approval",
      approvalId: approval.id,
      status: "approved",
      selectedScope: "once",
      expectedVersion: waiting.version
    });
    const resumed = store.claimAttempt({
      executionId: created.id,
      expectedVersion: queued.version,
      processOwnerId: "process-a",
      runId: "run-approval-b",
      contextSessionId: "session-a",
      leaseDurationMs: 60_000
    });
    const consumed = store.consumeApprovedApproval({
      executionId: created.id,
      approvalId: approval.id,
      expectedVersion: resumed.execution.version,
      processOwnerId: "process-a"
    });
    assert.equal(consumed?.status, "expired");
    assert.equal(store.consumeApprovedApproval({
      executionId: created.id,
      approvalId: approval.id,
      expectedVersion: store.getById(created.id)!.version,
      processOwnerId: "process-a"
    }), null);
  } finally {
    store.close();
    database.cleanup();
  }
});

test("decision answers are constrained, versioned, and idempotent", () => {
  const database = tempDatabase();
  const store = new DurableExecutionStore(database.file);
  try {
    const created = store.create(createInput());
    const claimed = store.claimAttempt({
      executionId: created.id,
      expectedVersion: created.version,
      processOwnerId: "process-a",
      runId: "run-a",
      contextSessionId: "session-a",
      leaseDurationMs: 60_000
    });
    const decision = store.openDecision({
      executionId: created.id,
      expectedVersion: claimed.execution.version,
      processOwnerId: "process-a",
      question: "Should the report be sent?",
      options: ["send", "hold"]
    });
    const waiting = store.getById(created.id)!;
    assert.equal(waiting.status, "waiting_for_user");
    assert.throws(() => store.answerDecision({
      executionId: created.id,
      decisionId: decision.id,
      answer: "unknown",
      answeredBy: "owner-1",
      expectedVersion: waiting.version
    }));
    const queued = store.answerDecision({
      executionId: created.id,
      decisionId: decision.id,
      answer: "hold",
      answeredBy: "owner-1",
      expectedVersion: waiting.version
    });
    assert.equal(queued.status, "queued");
    const repeated = store.answerDecision({
      executionId: created.id,
      decisionId: decision.id,
      answer: "hold",
      answeredBy: "owner-1",
      expectedVersion: queued.version
    });
    assert.equal(repeated.version, queued.version);
    assert.equal(store.getDetail(created.id)!.decisions[0].status, "answered");
  } finally {
    store.close();
    database.cleanup();
  }
});

test("evidence references fail soft when their target is unavailable", () => {
  const database = tempDatabase();
  const store = new DurableExecutionStore(database.file);
  try {
    const created = store.create(createInput());
    const evidence = store.addEvidence({
      executionId: created.id,
      referenceType: "run-detail",
      referenceId: "run-detail-1",
      summary: "42 source rows collected"
    });
    assert.equal(evidence.status, "available");
    assert.equal(store.markEvidenceUnavailable(evidence.id, "The run detail was retained out."), true);
    const reread = store.getDetail(created.id)!.evidenceRefs[0];
    assert.equal(reread.status, "unavailable");
    assert.equal(reread.unavailableReason, "The run detail was retained out.");
  } finally {
    store.close();
    database.cleanup();
  }
});
