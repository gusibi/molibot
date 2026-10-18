import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createToolProgressBatcher, formatWeixinToolProgressText } from "$lib/server/channels/weixin/toolProgress.js";

const dataRoot = mkdtempSync(join(tmpdir(), "molibot-weixin-runtime-"));
process.env.DATA_DIR = dataRoot;
process.env.MOLIBOT_DISABLE_LIVE_CHANNELS = "1";
after(() => rmSync(dataRoot, { recursive: true, force: true }));

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

interface RuntimeTurnOptions {
  response: { sendText: (text: string) => Promise<unknown> };
  replaceWithoutEdit: (text: string, state: { hasResponded: boolean; accumulatedText: string }) => Promise<void>;
}

async function deliverWeixinTurn(drive: (options: RuntimeTurnOptions) => Promise<void>): Promise<string[]> {
  const { WeixinManager } = await import("./runtime.js");
  const sent: string[] = [];
  const runtime = Object.assign(Object.create(WeixinManager.prototype), {
    instanceId: "weixin-error-test",
    getSettings: () => ({ channels: { weixin: { instances: [] } }, display: {} }),
    commandService: { shouldSendRunArchiveNotice: () => false },
    sendText: async (_chatId: string, _source: unknown, text: string) => { sent.push(text); },
    runSharedTextTask: async (_chatId: unknown, _event: unknown, options: RuntimeTurnOptions) => {
      await drive(options);
    }
  }) as { processEvent: (event: { chatId: string }, preferReplyInitial?: boolean) => Promise<void> };
  await runtime.processEvent({ chatId: "weixin-error-chat" });
  return sent;
}

test("a failed tool call leaves no error trace after a normal Weixin answer", async () => {
  const sent = await deliverWeixinTurn(async (options) => {
    await options.response.sendText("_→ toolSearch_");
    await options.response.sendText("_Error: a-share-paper-trading\nagent-browser\nquery-i_");
    await options.replaceWithoutEdit("语音发你了。想换音色或再长一点，说一声。", { hasResponded: false, accumulatedText: "" });
  });
  const delivered = sent.join("\n");
  assert.ok(delivered.includes("语音发你了。"), "main answer must still be delivered");
  assert.ok(!delivered.includes("Error:"), `buffered tool error leaked into the outbound message:\n${delivered}`);
});

test("the buffered error still fires on Weixin when the run produced no normal reply", async () => {
  const sent = await deliverWeixinTurn(async (options) => {
    await options.response.sendText("_Error: boom_");
  });
  assert.ok(sent.join("\n").includes("Error: boom"), "error fallback is the only notice a silent run gets");
});
