import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

test("attach resolves a missing root artifact path to the dated artifact folder", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "molibot-attach-"));
  try {
    mkdirSync(join(cwd, "2026/05/10"), { recursive: true });
    const datedPath = join(cwd, "2026/05/10/flying_pig_cartoon.png");
    writeFileSync(datedPath, "image");
    let captured: { filePath?: string; title?: string } = {};

    const tool = createAttachTool({
      cwd,
      workspaceDir: cwd,
      artifactDir: "2026/05/10",
      uploadFile: async (filePath, title) => {
        captured = { filePath, title };
      }
    });

    await tool.execute("tool-1", {
      label: "发送图片",
      path: join(cwd, "flying_pig_cartoon.png")
    });

    assert.equal(captured.filePath, datedPath);
    assert.equal(captured.title, "flying_pig_cartoon.png");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
