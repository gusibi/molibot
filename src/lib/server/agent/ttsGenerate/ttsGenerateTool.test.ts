import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createTtsGenerateTool } from "./ttsGenerateTool.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";

function settings(overrides: Partial<RuntimeSettings["ttsGenerate"]> = {}): RuntimeSettings {
  const ttsGenerate = {
    ...defaultRuntimeSettings.ttsGenerate,
    defaultProvider: "xiaomi" as const,
    providers: {
      macos: { ...defaultRuntimeSettings.ttsGenerate.providers.macos, enabled: true, voice: "Tingting", format: "aiff" as const },
      xiaomi: {
        ...defaultRuntimeSettings.ttsGenerate.providers.xiaomi,
        enabled: true,
        apiKey: "secret-key",
        baseUrl: "https://api.xiaomimimo.com/v1",
        model: "mimo-v2-tts",
        voice: "mimo_default",
        format: "wav" as const
      }
    },
    ...overrides
  };
  return { ...defaultRuntimeSettings, ttsGenerate };
}

test("ttsGenerate writes Xiaomi audio and uploads by default", async () => {
  const root = mkdtempSync(join(tmpdir(), "molibot-tts-tool-"));
  const uploaded: string[] = [];
  try {
    const tool = createTtsGenerateTool({
      getSettings: () => settings(),
      cwd: root,
      workspaceDir: root,
      artifactDir: "artifacts",
      uploadFile: async (filePath) => { uploaded.push(filePath); },
      fetch: async () => new Response(JSON.stringify({
        choices: [{ message: { audio: { data: Buffer.from("speech").toString("base64") } } }]
      }), { status: 200 }),
      platform: "darwin",
      spawn: (() => { throw new Error("spawn not expected"); }) as any,
      now: () => 1_717_280_000_000
    });

    const result = await tool.execute("call-1", {
      text: "hello",
      provider: "xiaomi",
      fileName: "hello.wav"
    });

    assert.equal(uploaded.length, 1);
    assert.equal(readFileSync(uploaded[0], "utf8"), "speech");
    assert.equal((result as any).details.provider, "xiaomi");
    assert.equal((result as any).details.uploaded, true);
    assert.match((result as any).details.path, /artifacts\/hello\.wav$/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ttsGenerate returns partial success when upload fails", async () => {
  const root = mkdtempSync(join(tmpdir(), "molibot-tts-tool-"));
  try {
    const tool = createTtsGenerateTool({
      getSettings: () => settings(),
      cwd: root,
      workspaceDir: root,
      artifactDir: "artifacts",
      uploadFile: async () => { throw new Error("upload unavailable"); },
      fetch: async () => new Response(JSON.stringify({
        choices: [{ message: { audio: { data: Buffer.from("speech").toString("base64") } } }]
      }), { status: 200 }),
      platform: "darwin",
      spawn: (() => { throw new Error("spawn not expected"); }) as any,
      now: () => 1_717_280_000_000
    });

    const result = await tool.execute("call-1", { text: "hello", provider: "xiaomi" });

    assert.equal((result as any).details.uploaded, false);
    assert.equal((result as any).details.uploadError, "upload unavailable");
    assert.match((result as any).content[0].text, /Generated successfully, but automatic chat upload failed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ttsGenerate rejects disabled global settings", async () => {
  const root = mkdtempSync(join(tmpdir(), "molibot-tts-tool-"));
  try {
    const tool = createTtsGenerateTool({
      getSettings: () => settings({ enabled: false }),
      cwd: root,
      workspaceDir: root,
      artifactDir: "artifacts"
    });

    await assert.rejects(
      () => tool.execute("call-1", { text: "hello" }),
      /TTS generation tool is disabled in settings/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ttsGenerate rejects unsafe file names", async () => {
  const root = mkdtempSync(join(tmpdir(), "molibot-tts-tool-"));
  try {
    const tool = createTtsGenerateTool({
      getSettings: () => settings(),
      cwd: root,
      workspaceDir: root,
      artifactDir: "artifacts"
    });

    await assert.rejects(
      () => tool.execute("call-1", { text: "hello", fileName: "../escape.wav" }),
      /fileName must be a safe file name/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
