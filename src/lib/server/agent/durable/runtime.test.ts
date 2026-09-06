import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { MomEvent } from "$lib/server/agent/events.js";
import type { ChannelInboundMessage } from "$lib/server/agent/core/types.js";
import { DurableExecutionCoordinator } from "./coordinator.js";
import { DurableExecutionRuntime } from "./runtime.js";
import { DurableExecutionStore } from "./store.js";

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

test("watched durable event claims one fresh attempt and leaves verification explicit", async () => {
  const { root, store, input } = fixture();
  try {
    const coordinator = new DurableExecutionCoordinator(store, "process-a", root);
    const created = coordinator.create(input);
    const activated = coordinator.activate({ ownerId: input.ownerId, executionId: created.execution.id, expectedVersion: created.execution.version });
    const eventFile = join(root, "system", "bots", "owner", "events", `durable-execution-${created.execution.id}-v${activated.execution.version}.json`);
    const event = JSON.parse(readFileSync(eventFile, "utf8")) as MomEvent;
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

    await runtime.run(event, eventFile);
    const detail = store.getDetail(created.execution.id)!;
    assert.equal(detail.execution.status, "verifying");
    assert.equal(detail.steps[0].status, "completed");
    assert.equal(detail.attempts[0].status, "completed");
    assert.equal(detail.attempts[0].contextSessionId, "t-archive-durable-attempt");
    assert.equal(detail.acceptanceCriteria[0].result, "unproven");

    const verifyVersion = detail.execution.version;
    const verifyFile = join(root, "system", "bots", "owner", "events", `durable-execution-${created.execution.id}-v${verifyVersion}.json`);
    const verifyEvent = JSON.parse(readFileSync(verifyFile, "utf8")) as MomEvent;
    await runtime.run(verifyEvent, verifyFile);
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
    const coordinator = new DurableExecutionCoordinator(store, "process-a", root);
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

    const firstFile = join(root, "system", "bots", "owner", "events", `durable-execution-${created.execution.id}-v${activated.execution.version}.json`);
    await runtime.run(JSON.parse(readFileSync(firstFile, "utf8")) as MomEvent, firstFile);
    const afterFirst = store.getDetail(created.execution.id)!;
    assert.equal(afterFirst.execution.status, "queued");
    assert.deepEqual(afterFirst.steps.map((step) => step.status), ["completed", "pending"]);
    assert.equal(afterFirst.evidenceRefs[0]?.referenceType, "run-detail");

    const secondFile = join(root, "system", "bots", "owner", "events", `durable-execution-${created.execution.id}-v${afterFirst.execution.version}.json`);
    await runtime.run(JSON.parse(readFileSync(secondFile, "utf8")) as MomEvent, secondFile);
    const afterSecond = store.getDetail(created.execution.id)!;
    assert.equal(afterSecond.execution.status, "verifying");
    assert.deepEqual(afterSecond.steps.map((step) => step.status), ["completed", "completed"]);
    assert.equal(attempts, 2);

    const verifyFile = join(root, "system", "bots", "owner", "events", `durable-execution-${created.execution.id}-v${afterSecond.execution.version}.json`);
    await runtime.run(JSON.parse(readFileSync(verifyFile, "utf8")) as MomEvent, verifyFile);
    assert.equal(store.getById(created.execution.id)?.status, "completed");
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("durable attempts expose only attached evidence through the read-only hook", async () => {
  const { root, store, input } = fixture();
  try {
    const coordinator = new DurableExecutionCoordinator(store, "process-a", root);
    const created = coordinator.create(input);
    const activated = coordinator.activate({ ownerId: input.ownerId, executionId: created.execution.id, expectedVersion: created.execution.version });
    const evidence = store.addEvidence({
      executionId: created.execution.id,
      referenceType: "durable-verifier",
      referenceId: "verifier:summary",
      summary: "The stored verifier summary is available to this attempt."
    });
    const eventFile = join(root, "system", "bots", "owner", "events", `durable-execution-${created.execution.id}-v${activated.execution.version}.json`);
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

    await runtime.run(JSON.parse(readFileSync(eventFile, "utf8")) as MomEvent, eventFile);
    assert.equal(store.getDetail(created.execution.id)?.attempts[0]?.contextSessionId, "t-archive-evidence-attempt");
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("a missed durable continuation enters recovery_required without replaying work", () => {
  const { root, store, input } = fixture();
  try {
    const coordinator = new DurableExecutionCoordinator(store, "process-a", root);
    const created = coordinator.create(input);
    const activated = coordinator.activate({ ownerId: input.ownerId, executionId: created.execution.id, expectedVersion: created.execution.version });
    const eventFile = join(root, "system", "bots", "owner", "events", `durable-execution-${created.execution.id}-v${activated.execution.version}.json`);
    const event = JSON.parse(readFileSync(eventFile, "utf8")) as MomEvent;
    const runtime = new DurableExecutionRuntime({
      store,
      processOwnerId: "process-a",
      dataDir: root,
      channelManagers: new Map() as any
    });

    runtime.handleSkippedEvent(event, "expired_or_invalid_time");

    const detail = store.getDetail(created.execution.id)!;
    assert.equal(detail.execution.status, "recovery_required");
    assert.equal(detail.execution.waitingKind, "recovery");
    assert.match(detail.execution.lastError ?? "", /offline catch-up window/);
    assert.equal(detail.attempts.length, 0);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("subjective verification creates a user decision and only explicit confirmation completes", async () => {
  const { root, store, input } = fixture();
  try {
    const coordinator = new DurableExecutionCoordinator(store, "process-a", root);
    const created = coordinator.create({
      ...input,
      acceptanceCriteria: [{
        description: "The report is accurate and useful.",
        checkerType: "subjective"
      }]
    });
    const activated = coordinator.activate({ ownerId: input.ownerId, executionId: created.execution.id, expectedVersion: created.execution.version });
    const eventFile = join(root, "system", "bots", "owner", "events", `durable-execution-${created.execution.id}-v${activated.execution.version}.json`);
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

    await runtime.run(JSON.parse(readFileSync(eventFile, "utf8")) as MomEvent, eventFile);
    const verifyVersion = store.getById(created.execution.id)!.version;
    const verifyFile = join(root, "system", "bots", "owner", "events", `durable-execution-${created.execution.id}-v${verifyVersion}.json`);
    await runtime.run(JSON.parse(readFileSync(verifyFile, "utf8")) as MomEvent, verifyFile);
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
    const continuationFile = join(root, "system", "bots", "owner", "events", `durable-execution-${created.execution.id}-v${answered.execution.version}.json`);
    assert.equal(existsSync(continuationFile), false);
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
    const coordinator = new DurableExecutionCoordinator(store, "process-a", root);
    const created = coordinator.create({
      ...input,
      steps: [{ title: "Publish report", sideEffectClass: "non_idempotent" }]
    });
    const activated = coordinator.activate({ ownerId: input.ownerId, executionId: created.execution.id, expectedVersion: created.execution.version });
    const eventFile = join(root, "system", "bots", "owner", "events", `durable-execution-${created.execution.id}-v${activated.execution.version}.json`);
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

    await runtime.run(JSON.parse(readFileSync(eventFile, "utf8")) as MomEvent, eventFile);
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
    const coordinator = new DurableExecutionCoordinator(store, "process-a", root);
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
    store.reconcileOrphanedAttempts("process-b");
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

test("queryable recovery reconciles completed external state before verification", async () => {
  const { root, store, input } = fixture();
  try {
    const coordinator = new DurableExecutionCoordinator(store, "process-a", root);
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
    store.reconcileOrphanedAttempts("process-b");
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
    const coordinator = new DurableExecutionCoordinator(store, "process-a", root);
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
    store.reconcileOrphanedAttempts("process-b");
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
