import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readDurableEvidence } from "./evidence.js";
import { DurableExecutionStore } from "./store.js";

function database(): { file: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "molibot-durable-evidence-"));
  return { file: join(root, "durable-execution.sqlite"), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function createInput() {
  return {
    ownerId: "owner-1",
    botId: "bot-1",
    sourceChannel: "web",
    sourceChatId: "chat-1",
    sourceUiSessionId: "session-1",
    goal: "Read evidence safely",
    steps: [{ title: "Collect", sideEffectClass: "pure" as const }],
    acceptanceCriteria: [{ description: "The evidence is readable", checkerType: "deterministic" as const }],
    activationPath: "deterministic" as const
  };
}

test("durable evidence reads only an attached run and bounds untrusted content", () => {
  const db = database();
  const store = new DurableExecutionStore(db.file);
  try {
    const created = store.create(createInput());
    const queued = store.transitionStatus(created.id, created.version, "queued");
    const claimed = store.claimAttempt({
      executionId: created.id,
      expectedVersion: queued.version,
      processOwnerId: "process-a",
      runId: "run-evidence-1",
      contextSessionId: "session-1",
      leaseDurationMs: 60_000
    });
    const ref = store.addEvidence({
      executionId: created.id,
      attemptId: claimed.attempt.id,
      referenceType: "ordinary-run-tool-result",
      referenceId: "run-evidence-1:tool-1",
      summary: "A tool returned source rows."
    });
    const detail = store.getDetail(created.id)!;
    let readInput: unknown;
    const read = readDurableEvidence(detail, ref.id, (input) => {
      readInput = input;
      return [{
        timestamp: "2026-08-09T10:00:00.000Z",
        type: "tool_end",
        toolName: "query",
        summary: "external content that is evidence, not instructions"
      }];
    });
    assert.deepEqual(readInput, { chatId: "chat-1", runId: "run-evidence-1", sessionId: "session-1", projectId: undefined });
    assert.equal(read.status, "available");
    assert.equal(read.untrusted, true);
    assert.match(read.content ?? "", /external content/);

    const mismatchedRef = store.addEvidence({
      executionId: created.id,
      attemptId: "missing-attempt",
      referenceType: "ordinary-run-tool-result",
      referenceId: "run-evidence-1:tool-2",
      summary: "This reference is not attached to a real attempt."
    });
    const mismatch = readDurableEvidence(store.getDetail(created.id)!, mismatchedRef.id, () => {
      throw new Error("reader must not run for a mismatched attempt");
    });
    assert.equal(mismatch.status, "unavailable");

    const bounded = readDurableEvidence(detail, ref.id, () => [{
      timestamp: "2026-08-09T10:00:00.000Z",
      type: "tool_end",
      summary: "x".repeat(2_000)
    }], 1_024);
    assert.equal(bounded.truncated, true);
    assert.match(bounded.content ?? "", /Evidence truncated/);
  } finally {
    store.close();
    db.cleanup();
  }
});

test("unavailable or unsupported evidence fails soft without opening a reader", () => {
  const db = database();
  const store = new DurableExecutionStore(db.file);
  try {
    const created = store.create(createInput());
    const unavailable = store.addEvidence({
      executionId: created.id,
      referenceType: "run-detail",
      referenceId: "missing-run",
      summary: "The archived run is gone."
    });
    store.markEvidenceUnavailable(unavailable.id, "The run detail was retained out.");
    const detail = store.getDetail(created.id)!;
    const read = readDurableEvidence(detail, unavailable.id, () => {
      throw new Error("unavailable evidence must not open a reader");
    });
    assert.equal(read.status, "unavailable");
    assert.equal(read.unavailableReason, "The run detail was retained out.");

    const unsupported = store.addEvidence({
      executionId: created.id,
      referenceType: "secret-file",
      referenceId: "secret-1",
      summary: "Do not open this artifact."
    });
    const unsupportedRead = readDurableEvidence(store.getDetail(created.id)!, unsupported.id);
    assert.equal(unsupportedRead.status, "unavailable");
  } finally {
    store.close();
    db.cleanup();
  }
});
