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
