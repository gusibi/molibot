import assert from "node:assert/strict";
import test from "node:test";
import { detectImmediateMemoryCorrections } from "./correctionDetector.js";
import type { MemoryTurnTrace } from "./traceStore.js";

const trace: MemoryTurnTrace = {
  id: "trace-1", runId: "run-1", sessionId: "session-1", chatId: "chat-1", scope: { channel: "web", externalUserId: "chat-1", botId: "momo" },
  profileRevokedMemoryIds: [], assistantSourceEntryId: "assistant-1", query: "", retrievedCount: 1, selectedCount: 1,
  injectedItems: [{ memoryId: "memory-long", order: 0, promptText: "1. 用户偏好较长且完整的回答", source: "retrieved", snapshot: { displayText: "用户偏好较长且完整的回答", content: "用户偏好较长且完整的回答", layer: "long_term", tags: [], updatedAt: "2026-07-17T00:00:00.000Z" } }],
  writeReceipts: [], createdAt: "2026-07-17T00:00:00.000Z"
};

test("explicit relevant correction disputes only actually injected memories", () => {
  assert.deepEqual(detectImmediateMemoryCorrections("不对，我不喜欢长回答", trace), ["memory-long"]);
  assert.deepEqual(detectImmediateMemoryCorrections("我今天不去公司", trace), []);
  assert.deepEqual(detectImmediateMemoryCorrections("不对，我更喜欢蓝色", trace), []);
  assert.deepEqual(detectImmediateMemoryCorrections("不对，我不喜欢长回答", null), []);
});
