import assert from "node:assert/strict";
import test from "node:test";
import { buildPromptInputEnvelope } from "$lib/server/agent/prompts/promptInput.js";
import type { MemoryPromptSnapshot, MemoryRecord } from "$lib/server/memory/types.js";

function memoryRecord(id: string, content: string, layer: MemoryRecord["layer"] = "long_term"): MemoryRecord {
  return {
    id,
    channel: "web",
    externalUserId: "user-1",
    content,
    tags: [],
    layer,
    confidence: 0.9,
    reason: "user_explicit",
    sources: [],
    pinned: false,
    hasConflict: false,
    createdAt: "2026-04-25T00:00:00.000Z",
    updatedAt: "2026-04-26T00:00:00.000Z"
  };
}

function memorySnapshot(records: MemoryRecord[]): MemoryPromptSnapshot {
  const longTerm = records.filter((record) => record.layer === "long_term");
  const daily = records.filter((record) => record.layer === "daily");
  return {
    createdAt: "2026-04-26T00:00:00.000Z",
    scope: { channel: "web", externalUserId: "user-1" },
    query: "memory",
    fingerprint: records.map((record) => record.id).join("|"),
    promptText: "legacy text is not the source of truth",
    longTerm,
    daily,
    selected: records
  };
}

test("buildPromptInputEnvelope wraps the live prompt with env metadata without polluting persisted text", () => {
  const result = buildPromptInputEnvelope({
    messageText: "Hi",
    attachmentPaths: ["/tmp/demo.txt"],
    messageTimestamp: "2026-04-26T02:59:24Z",
    timezone: "Asia/Shanghai"
  });

  assert.equal(
    result.modelMessage,
    [
      "<env>",
      "message_received_at: 2026-04-26T10:59:24+08:00",
      "timezone: Asia/Shanghai",
      "today: 2026-04-26",
      "scratch_artifact_dir: 2026/04/26",
      "</env>",
      "",
      "<user_message>",
      "Hi",
      "</user_message>",
      "",
      "<channel_attachments>",
      "/tmp/demo.txt",
      "</channel_attachments>"
    ].join("\n")
  );
  assert.equal(
    result.persistedMessage,
    ["Hi", "", "<channel_attachments>", "/tmp/demo.txt", "</channel_attachments>"].join("\n")
  );
});

test("buildPromptInputEnvelope injects the memory snapshot into the model message only", () => {
  const record = memoryRecord("memory-1", "User prefers concise replies.");
  const result = buildPromptInputEnvelope({
    messageText: "Hi",
    messageTimestamp: "2026-04-26T02:59:24Z",
    timezone: "Asia/Shanghai",
    memorySnapshot: memorySnapshot([record])
  });

  assert.ok(result.modelMessage.includes("<current-memory>"));
  assert.ok(result.modelMessage.includes("User prefers concise replies."));
  assert.ok(result.modelMessage.indexOf("<current-memory>") < result.modelMessage.indexOf("<user_message>"));
  assert.ok(!result.persistedMessage.includes("<current-memory>"));
  assert.deepEqual(result.memoryInjection.items.map((item) => item.memoryId), ["memory-1"]);
  assert.equal(result.memoryInjection.items[0]?.snapshot.content, "User prefers concise replies.");
});

test("buildPromptInputEnvelope omits the memory block when the snapshot is empty", () => {
  const result = buildPromptInputEnvelope({
    messageText: "Hi",
    messageTimestamp: "2026-04-26T02:59:24Z",
    timezone: "Asia/Shanghai",
    memorySnapshot: memorySnapshot([])
  });

  assert.ok(!result.modelMessage.includes("<current-memory>"));
  assert.deepEqual(result.memoryInjection.items, []);
});

test("buildPromptInputEnvelope reports only the final five serialized memories", () => {
  const records = Array.from({ length: 7 }, (_, index) =>
    memoryRecord(`memory-${index + 1}`, `Preference ${index + 1}`)
  );
  const result = buildPromptInputEnvelope({
    messageText: "Hi",
    messageTimestamp: "2026-04-26T02:59:24Z",
    timezone: "Asia/Shanghai",
    memorySnapshot: memorySnapshot(records)
  });

  assert.deepEqual(
    result.memoryInjection.items.map((item) => item.memoryId),
    ["memory-1", "memory-2", "memory-3", "memory-4", "memory-5"]
  );
  assert.ok(result.modelMessage.includes("5. Preference 5"));
  assert.ok(!result.modelMessage.includes("Preference 6"));
});

test("memory injection snapshot preserves the exact truncated text sent to the model", () => {
  const record = memoryRecord("memory-long", "x".repeat(260));
  const result = buildPromptInputEnvelope({
    messageText: "Hi",
    messageTimestamp: "2026-04-26T02:59:24Z",
    timezone: "Asia/Shanghai",
    memorySnapshot: memorySnapshot([record])
  });

  const item = result.memoryInjection.items[0];
  assert.ok(item);
  assert.equal(item.promptText.length, 220);
  assert.ok(item.promptText.endsWith("…"));
  assert.ok(result.modelMessage.includes(item.promptText));
});
