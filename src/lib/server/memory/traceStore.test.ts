import assert from "node:assert/strict";
import test from "node:test";
import { SqliteMemoryTraceStore } from "$lib/server/memory/traceStore.js";

const scope = { channel: "web", externalUserId: "chat-1", botId: "momo", conversationId: "chat-1" };

test("memory trace store preserves injected and written snapshots by Assistant source entry", () => {
  const store = new SqliteMemoryTraceStore(":memory:");
  const trace = store.save({
    runId: "run-1",
    sessionId: "session-1",
    chatId: "chat-1",
    scope,
    profileRevokedMemoryIds: [],
    assistantSourceEntryId: "entry-1",
    query: "How should the UI look?",
    retrievedCount: 12,
    selectedCount: 7,
    injectedItems: [{
      memoryId: "memory-1",
      order: 0,
      promptText: "1. Prefers native macOS UI",
      source: "retrieved",
      snapshot: {
        displayText: "Prefers native macOS UI",
        content: "Prefers native macOS UI",
        layer: "long_term",
        confidence: 0.94,
        tags: ["design"],
        updatedAt: "2026-07-14T08:00:00.000Z"
      }
    }],
    writeReceipts: [{
      memoryId: "memory-2",
      operation: "added",
      snapshot: {
        displayText: "Uses Svelte",
        content: "Uses Svelte",
        layer: "long_term",
        tags: ["stack"],
        updatedAt: "2026-07-15T08:00:00.000Z"
      }
    }],
    createdAt: "2026-07-15T08:00:00.000Z"
  });

  const stored = store.getBySourceEntryId("entry-1");
  assert.equal(stored?.id, trace.id);
  assert.equal(stored?.injectedItems[0]?.snapshot.content, "Prefers native macOS UI");
  assert.equal(stored?.writeReceipts[0]?.operation, "added");
  assert.deepEqual(store.getMetaBySourceEntryIds(["entry-1", "missing"]), {
    "entry-1": { traceId: trace.id, injectedCount: 1, referencedCount: 0, writeCount: 1 }
  });
  assert.equal(store.getById(trace.id)?.assistantSourceEntryId, "entry-1");
  store.close();
});

test("feedback is append-only, idempotent, and limited to effective injected memories", () => {
  const store = new SqliteMemoryTraceStore(":memory:");
  const trace = store.save({
    runId: "run-feedback",
    sessionId: "session-1",
    chatId: "chat-1",
    scope,
    profileRevokedMemoryIds: [],
    assistantSourceEntryId: "entry-feedback",
    query: "query",
    retrievedCount: 2,
    selectedCount: 1,
    injectedItems: [{
      memoryId: "memory-1",
      order: 0,
      promptText: "Remember this",
      source: "retrieved",
      namespace: "chat:momo:web:chat-1",
      domain: "owner",
      snapshot: { displayText: "Remember this", content: "Remember this", layer: "long_term", tags: [], updatedAt: "2026-07-17T00:00:00.000Z" }
    }],
    writeReceipts: [],
    createdAt: "2026-07-17T00:00:00.000Z"
  });

  const first = store.recordFeedback({ traceId: trace.id, memoryId: "memory-1", value: "helpful", idempotencyKey: "feedback-1" });
  const retry = store.recordFeedback({ traceId: trace.id, memoryId: "memory-1", value: "helpful", idempotencyKey: "feedback-1" });
  const changed = store.recordFeedback({ traceId: trace.id, memoryId: "memory-1", value: "irrelevant", idempotencyKey: "feedback-2" });

  assert.equal(first.duplicate, false);
  assert.equal(retry.duplicate, true);
  assert.equal(retry.event.id, first.event.id);
  assert.equal(changed.event.previousValue, "helpful");
  assert.equal(store.listFeedbackEvents(trace.id, "memory-1").length, 2);
  assert.deepEqual(store.listPendingFeedbackEffects().map((event) => event.id), [changed.event.id]);
  assert.throws(() => store.recordFeedback({ traceId: trace.id, memoryId: "forged", value: "helpful", idempotencyKey: "feedback-forged" }), /not injected/i);
  store.close();
});

test("referenced items round-trip and accept feedback even when not injected", () => {
  const store = new SqliteMemoryTraceStore(":memory:");
  const trace = store.save({
    runId: "run-referenced",
    sessionId: "session-1",
    chatId: "chat-1",
    scope,
    profileRevokedMemoryIds: [],
    assistantSourceEntryId: "entry-referenced",
    query: "上周体重多少",
    retrievedCount: 0,
    selectedCount: 0,
    injectedItems: [],
    referencedItems: [{
      memoryId: "memory-tool",
      source: "tool_retrieved",
      query: "体重",
      snapshot: { displayText: "Recorded 67.15kg on 2026-07-14", content: "Recorded 67.15kg on 2026-07-14", layer: "long_term", tags: [], updatedAt: "2026-07-14T00:00:00.000Z" }
    }],
    writeReceipts: [],
    createdAt: "2026-07-31T00:00:00.000Z"
  });

  const stored = store.getById(trace.id);
  assert.equal(stored?.referencedItems.length, 1);
  assert.equal(stored?.referencedItems[0]?.source, "tool_retrieved");
  assert.deepEqual(store.getMetaBySourceEntryIds(["entry-referenced"]), {
    "entry-referenced": { traceId: trace.id, injectedCount: 0, referencedCount: 1, writeCount: 0 }
  });
  const feedback = store.recordFeedback({ traceId: trace.id, memoryId: "memory-tool", value: "helpful", idempotencyKey: "ref-feedback-1" });
  assert.equal(feedback.duplicate, false);
  store.close();
});
