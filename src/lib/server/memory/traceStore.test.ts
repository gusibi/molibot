import assert from "node:assert/strict";
import test from "node:test";
import { SqliteMemoryTraceStore } from "$lib/server/memory/traceStore.js";

test("memory trace store preserves injected and written snapshots by Assistant source entry", () => {
  const store = new SqliteMemoryTraceStore(":memory:");
  const trace = store.save({
    runId: "run-1",
    sessionId: "session-1",
    chatId: "chat-1",
    assistantSourceEntryId: "entry-1",
    query: "How should the UI look?",
    retrievedCount: 12,
    selectedCount: 7,
    injectedItems: [{
      memoryId: "memory-1",
      order: 0,
      promptText: "1. Prefers native macOS UI",
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
    "entry-1": { traceId: trace.id, injectedCount: 1, writeCount: 1 }
  });
  assert.equal(store.getById(trace.id)?.assistantSourceEntryId, "entry-1");
  store.close();
});
