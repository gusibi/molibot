import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DurableExecutionCoordinator } from "./coordinator.js";
import { DurableExecutionNotFoundError } from "./store.js";
import { DurableExecutionStore } from "./store.js";

function createDatabase(): { root: string; file: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "molibot-durable-coordinator-"));
  return {
    root,
    file: join(root, "durable-execution.sqlite"),
    cleanup: () => rmSync(root, { recursive: true, force: true })
  };
}

function createInput() {
  return {
    ownerId: "owner-1",
    botId: "bot-1",
    sourceChannel: "web",
    sourceChatId: "web:owner-1:bot-1",
    sourceUiSessionId: "ui-session-1",
    goal: "Prepare the weekly report",
    steps: [{ title: "Collect source data", sideEffectClass: "pure" as const }],
    acceptanceCriteria: [{ description: "The report is complete", checkerType: "deterministic" as const }],
    activationPath: "deterministic" as const
  };
}

test("coordinator projects list and inspect without crossing owner boundaries", () => {
  const database = createDatabase();
  const store = new DurableExecutionStore(database.file);
  try {
    const coordinator = new DurableExecutionCoordinator(store, "process-a");
    const created = coordinator.create(createInput());
    assert.equal(created.projection.progress.total, 1);
    assert.equal(created.projection.nextStep?.title, "Collect source data");
    assert.deepEqual(coordinator.list({ ownerId: "owner-1" }).map((item) => item.execution.id), [created.execution.id]);
    assert.deepEqual(coordinator.list({ ownerId: "other-owner" }), []);
    assert.throws(
      () => coordinator.inspect("other-owner", created.execution.id),
      (error: unknown) => error instanceof DurableExecutionNotFoundError
    );
  } finally {
    store.close();
    database.cleanup();
  }
});

test("coordinator control actions use the stored version and replay one action id", () => {
  const database = createDatabase();
  const store = new DurableExecutionStore(database.file);
  try {
    const coordinator = new DurableExecutionCoordinator(store, "process-a");
    const created = coordinator.create(createInput());
    const paused = coordinator.pause({
      ownerId: "owner-1",
      executionId: created.execution.id,
      expectedVersion: created.execution.version,
      actionId: "pause-1",
      reason: "Owner is reviewing the source data."
    });
    const replayed = coordinator.pause({
      ownerId: "owner-1",
      executionId: created.execution.id,
      expectedVersion: created.execution.version,
      actionId: "pause-1",
      reason: "This replay must not overwrite the first reason."
    });
    assert.equal(paused.execution.status, "paused");
    assert.equal(replayed.execution.version, paused.execution.version);
    assert.equal(replayed.execution.waitingReason, "Owner is reviewing the source data.");

    const resumed = coordinator.resume({
      ownerId: "owner-1",
      executionId: created.execution.id,
      expectedVersion: paused.execution.version,
      actionId: "resume-1"
    });
    assert.equal(resumed.execution.status, "queued");
  } finally {
    store.close();
    database.cleanup();
  }
});

test("queued projection exposes creation-order position", () => {
  const database = createDatabase();
  const store = new DurableExecutionStore(database.file);
  try {
    const coordinator = new DurableExecutionCoordinator(store, "process-a", database.root);
    const first = coordinator.create(createInput());
    const second = coordinator.create({ ...createInput(), goal: "Prepare the monthly report" });
    const firstQueued = coordinator.activate({ ownerId: "owner-1", executionId: first.execution.id, expectedVersion: first.execution.version });
    const secondQueued = coordinator.activate({ ownerId: "owner-1", executionId: second.execution.id, expectedVersion: second.execution.version });
    assert.equal(firstQueued.projection.queuePosition, 1);
    assert.equal(secondQueued.projection.queuePosition, 2);
    assert.equal(existsSync(join(database.root, "system", "bots", "owner", "events", `durable-execution-${second.execution.id}-v${secondQueued.execution.version}.json`)), false);
  } finally {
    store.close();
    database.cleanup();
  }
});

test("activation writes one versioned watched event and is idempotent", () => {
  const database = createDatabase();
  const store = new DurableExecutionStore(database.file);
  try {
    const coordinator = new DurableExecutionCoordinator(store, "process-a", database.root);
    const created = coordinator.create(createInput());
    const activated = coordinator.activate({
      ownerId: "owner-1",
      executionId: created.execution.id,
      expectedVersion: created.execution.version
    });
    assert.equal(activated.execution.status, "queued");
    const eventFile = join(database.root, "system", "bots", "owner", "events", `durable-execution-${created.execution.id}-v${activated.execution.version}.json`);
    assert.equal(existsSync(eventFile), true);
    const first = readFileSync(eventFile, "utf8");
    coordinator.ensureQueuedEvents("owner-1");
    assert.equal(readFileSync(eventFile, "utf8"), first);
    const event = JSON.parse(first) as { execution: string; internal?: { kind?: string; durable?: { executionId?: string; expectedVersion?: number } } };
    assert.equal(event.execution, "internal");
    assert.equal(event.internal?.kind, "durable-execution");
    assert.deepEqual(event.internal?.durable, { executionId: created.execution.id, expectedVersion: activated.execution.version });
  } finally {
    store.close();
    database.cleanup();
  }
});

test("lazy promotion absorbs the ordinary-run prefix and queues only the next step", () => {
  const database = createDatabase();
  const store = new DurableExecutionStore(database.file);
  try {
    const coordinator = new DurableExecutionCoordinator(store, "process-a", database.root);
    const promoted = coordinator.promote({
      ownerId: "owner-1",
      botId: "bot-1",
      sourceChannel: "web",
      sourceChatId: "web:owner-1:bot-1",
      sourceUiSessionId: "ui-session-1",
      goal: "Prepare and deliver the report",
      acceptanceCriteria: [{ description: "The report is delivered", checkerType: "subjective" }],
      prefix: [{
        runId: "ordinary-run-1",
        toolId: "write",
        toolCallId: "call-write-1",
        inputSummary: "{path:report.md}",
        effect: {
          toolId: "write",
          toolCallId: "call-write-1",
          sideEffectClass: "idempotent",
          idempotencyKey: "write-report",
          targetSummary: "report.md",
          contentSummary: "report contents"
        },
        result: { ok: true, content: "wrote report.md" },
        isError: false,
        occurredAt: new Date().toISOString()
      }],
      currentEffect: {
        toolId: "bash",
        sideEffectClass: "non_idempotent",
        idempotencyKey: "send-report",
        targetSummary: "report delivery",
        contentSummary: "send the report"
      },
      reason: "model_requires_multiple_steps"
    });

    const detail = store.getDetail(promoted.execution.id)!;
    assert.equal(detail.execution.status, "queued");
    assert.equal(detail.execution.activationPath, "lazy_promotion");
    assert.deepEqual(detail.steps.map((step) => step.status), ["completed", "pending"]);
    assert.deepEqual(detail.sideEffects.map((effect) => effect.phase), ["intent", "receipt"]);
    assert.equal(detail.evidenceRefs.length, 1);
    assert.equal(promoted.projection.progress.completed, 1);
    assert.equal(promoted.projection.nextStep?.title, "Continue with: bash");
    assert.equal(existsSync(join(database.root, "system", "bots", "owner", "events", `durable-execution-${promoted.execution.id}-v${promoted.execution.version}.json`)), true);
  } finally {
    store.close();
    database.cleanup();
  }
});
