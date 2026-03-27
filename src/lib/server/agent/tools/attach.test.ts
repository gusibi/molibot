import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { createAttachTool } from "./attach.js";

test("attach uses transcript sidecar for audio files when text is omitted", async () => {
  const cwd = process.cwd();
  const audioPath = join(cwd, "src/lib/server/channels/weixin/test-fixtures/reply.mp3");
  let captured: { filePath?: string; title?: string; text?: string } = {};

  const tool = createAttachTool({
    cwd,
    workspaceDir: cwd,
    uploadFile: async (filePath, title, text) => {
      captured = { filePath, title, text };
    }
  });

  await tool.execute("tool-1", {
    label: "发送音频",
    path: audioPath,
    title: "土豆笑话语音"
  });

  assert.equal(captured.filePath, audioPath);
  assert.equal(captured.title, "土豆笑话语音");
  assert.equal(captured.text, "这是完整的土豆笑话原文。");
});
