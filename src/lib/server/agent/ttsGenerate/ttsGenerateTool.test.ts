import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { EventEmitter } from "node:events";
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

/**
 * Mock spawn that responds to ffmpeg -version (availability check)
 * and ffmpeg conversion commands. For all other commands, throws.
 */
function mockFfmpegSpawn(conversionBehavior: "success" | "fail" = "success"): typeof import("node:child_process").spawn {
  return ((command: string, args: string[]) => {
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => true;

    if (command === "ffmpeg" && args[0] === "-version") {
      // ffmpeg availability check → available
      queueMicrotask(() => child.emit("close", 0));
      return child;
    }

    if (command === "ffmpeg" && args.includes("-c:a") && args.includes("libopus")) {
      // OGG conversion
      if (conversionBehavior === "fail") {
        queueMicrotask(() => {
          child.stderr.emit("data", "Conversion failed");
          child.emit("close", 1);
        });
      } else {
        // Simulate successful conversion: create the output file
        const outputIdx = args.indexOf("-y");
        const outputPath = outputIdx >= 0 && args[outputIdx + 1] ? args[outputIdx + 1] : "";
        if (outputPath) {
          try {
            mkdirSync(dirname(outputPath), { recursive: true });
            writeFileSync(outputPath, "ogg-audio-data");
          } catch {}
        }
        queueMicrotask(() => child.emit("close", 0));
      }
      return child;
    }

    // Unknown command
    queueMicrotask(() => child.emit("error", new Error(`spawn not expected: ${command} ${args.join(" ")}`)));
    return child;
  }) as any;
}

/**
 * Mock spawn that simulates ffmpeg NOT being available.
 */
function mockNoFfmpegSpawn(): typeof import("node:child_process").spawn {
  return ((command: string, args: string[]) => {
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => true;

    if (command === "ffmpeg") {
      queueMicrotask(() => child.emit("error", new Error("ffmpeg not found")));
      return child;
    }

    queueMicrotask(() => child.emit("error", new Error(`spawn not expected: ${command}`)));
    return child;
  }) as any;
}

test("ttsGenerate converts Xiaomi audio to OGG and uploads", async () => {
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
      spawn: mockFfmpegSpawn("success"),
      now: () => 1_717_280_000_000
    });

    const result = await tool.execute("call-1", {
      text: "hello",
      provider: "xiaomi",
      fileName: "hello.wav"
    });

    assert.equal(uploaded.length, 1);
    assert.equal((result as any).details.provider, "xiaomi");
    assert.equal((result as any).details.uploaded, true);
    assert.equal((result as any).details.format, "ogg");
    assert.equal((result as any).details.mimeType, "audio/ogg");
    assert.match((result as any).details.path, /artifacts\/hello\.ogg$/);
    // Intermediate .wav should be cleaned up
    assert.equal(existsSync(join(root, "artifacts", "hello.wav")), false);
    // OGG file should exist
    assert.equal(existsSync(uploaded[0]), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ttsGenerate falls back to native format when ffmpeg is unavailable", async () => {
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
      spawn: mockNoFfmpegSpawn(),
      now: () => 1_717_280_000_000
    });

    const result = await tool.execute("call-1", {
      text: "hello",
      provider: "xiaomi",
      fileName: "hello.wav"
    });

    assert.equal((result as any).details.format, "wav");
    assert.equal((result as any).details.mimeType, "audio/wav");
    assert.match((result as any).details.path, /artifacts\/hello\.wav$/);
    assert.match((result as any).content[0].text, /ffmpeg not available/);
    // Original provider file should still exist
    assert.equal(existsSync(uploaded[0]), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ttsGenerate falls back to native format when OGG conversion fails", async () => {
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
      spawn: mockFfmpegSpawn("fail"),
      now: () => 1_717_280_000_000
    });

    const result = await tool.execute("call-1", {
      text: "hello",
      provider: "xiaomi",
      fileName: "hello.wav"
    });

    assert.equal((result as any).details.format, "wav");
    assert.match((result as any).details.path, /artifacts\/hello\.wav$/);
    assert.match((result as any).content[0].text, /OGG conversion failed/);
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
      spawn: mockFfmpegSpawn("success"),
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
