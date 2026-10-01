import assert from "node:assert/strict";
import test from "node:test";
import { createToolProgressBatcher, formatWeixinToolProgressText } from "$lib/server/channels/weixin/toolProgress.js";

test("formatWeixinToolProgressText renders batched tool progress as a multi-line list", () => {
  assert.equal(
    formatWeixinToolProgressText("_→ Sandbox_\n_→ read config_\n_→ search docs_"),
    ["工具调用：", "- Sandbox", "- read config", "- search docs"].join("\n")
  );
});

test("createToolProgressBatcher flushes batched Weixin tool progress with line breaks", async () => {
  const sent: string[] = [];
  const batcher = createToolProgressBatcher(async (text) => {
    sent.push(text);
  }, 5);

  await batcher.handle("_→ Sandbox_");
  await batcher.handle("_→ read config_");
  await batcher.handle("_→ search docs_");
  await batcher.handle("_→ edit file_");
  await batcher.handle("_→ run test_");
  await batcher.handle("_→ send reply_");

  assert.deepEqual(sent, [
    "_→ Sandbox_",
    ["工具调用：", "- read config", "- search docs", "- edit file", "- run test", "- send reply"].join("\n")
  ]);
});

test("queued Weixin admission restores the normalized shape and persists its logical identity", async () => {
  const { WeixinManager } = await import("./runtime.js");
  const runtime = Object.create(WeixinManager.prototype);
  let admittedEvent: any;
  runtime.snapshotInboundThinkingPolicy = (scopeId: string, event: any, retry: boolean) => {
    assert.equal(scopeId, "chat-1");
    assert.equal(retry, true);
    admittedEvent = event;
    event.runId = "new-retry-turn";
    event.sessionId = "admitted-session";
  };
  const payload = { event: { chatId: "chat-1", chatType: "private", messageId: 1, userId: "user", text: "hello",
    ts: "2026-10-01T00:00:00Z", attachments: [], runId: "old-turn" }, sourceMessage: {} };
  runtime.prepareQueuedAdmission("chat-1", payload, true);
  assert.deepEqual(admittedEvent.imageContents, []);
  assert.equal(payload.event.runId, "new-retry-turn");
  assert.equal((payload.event as { sessionId?: string }).sessionId, "admitted-session");
  assert.ok(!("imageContents" in payload.event), "queue serialization keeps image bytes absent");
});
