import assert from "node:assert/strict";
import test from "node:test";
import { memoryWriteReceiptsFromToolCall } from "$lib/server/memory/writeReceipt.js";

const memory = {
  id: "memory-1",
  channel: "web",
  externalUserId: "user-1",
  content: "Uses Svelte",
  tags: ["stack"],
  layer: "long_term",
  confidence: 0.9,
  reason: "user_explicit",
  sources: [],
  pinned: false,
  hasConflict: false,
  createdAt: "2026-07-15T08:00:00.000Z",
  updatedAt: "2026-07-15T08:00:00.000Z"
};

test("captures added and updated memory receipts from structured memory tool results", () => {
  assert.equal(memoryWriteReceiptsFromToolCall({ action: "add" }, { details: { item: memory } })[0]?.operation, "added");
  assert.equal(memoryWriteReceiptsFromToolCall({ action: "update" }, { details: { item: memory } })[0]?.operation, "updated");
  assert.deepEqual(memoryWriteReceiptsFromToolCall({ action: "search" }, { details: { rows: [memory] } }), []);
});

test("captures save_memory receipts and treats a revision as updated", () => {
  assert.equal(memoryWriteReceiptsFromToolCall({ fact: "Uses Svelte" }, { details: { item: memory } }, "save_memory")[0]?.operation, "added");
  assert.equal(
    memoryWriteReceiptsFromToolCall(
      { fact: "Uses Svelte 5" },
      { details: { item: { ...memory, supersedes: "memory-0" } } },
      "save_memory"
    )[0]?.operation,
    "updated"
  );
  assert.deepEqual(memoryWriteReceiptsFromToolCall({ id: "memory-1" }, { details: { deleted: true } }, "forget_memory"), []);
});

test("captures each memory persisted by flush", () => {
  const receipts = memoryWriteReceiptsFromToolCall(
    { action: "flush" },
    { details: { result: { memories: [memory, { ...memory, id: "memory-2" }] } } }
  );
  assert.deepEqual(receipts.map((receipt) => receipt.memoryId), ["memory-1", "memory-2"]);
});
