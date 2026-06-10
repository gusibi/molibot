import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createMacosTtsProvider, createXiaomiTtsProvider, parseMacosSayVoices } from "./providers.js";
import type { TtsGenerateProviderContext } from "./types.js";

function context(overrides: Partial<TtsGenerateProviderContext> = {}): TtsGenerateProviderContext {
  return {
    settings: {
      enabled: true,
      defaultProvider: "xiaomi",
      providers: {
        macos: { enabled: true, voice: "Tingting", format: "aiff" },
        xiaomi: {
          enabled: true,
          apiKey: "secret-key",
          baseUrl: "https://api.xiaomimimo.com/v1",
          model: "mimo-v2-tts",
          voice: "mimo_default",
          format: "wav"
        }
      }
    },
    fetch: async () => new Response(JSON.stringify({
      choices: [{ message: { audio: { data: Buffer.from("audio-bytes").toString("base64") } } }]
    }), { status: 200 }),
    platform: "darwin",
    spawn: (() => { throw new Error("spawn not configured"); }) as any,
    ...overrides
  };
}

test("xiaomi provider posts assistant text and decodes audio data", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const provider = createXiaomiTtsProvider();

  const result = await provider.generate({
    text: "hello",
    provider: "xiaomi",
    voice: "default_zh",
    model: "mimo-v2-tts",
    style: "cheerful",
    format: "wav"
  }, context({
    fetch: async (url, init) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(JSON.stringify({
        choices: [{ message: { audio: { data: Buffer.from("audio-bytes").toString("base64") } } }]
      }), { status: 200 });
    }
  }));

  assert.equal(capturedUrl, "https://api.xiaomimimo.com/v1/chat/completions");
  assert.equal((capturedInit?.headers as Record<string, string>)["api-key"], "secret-key");
  const body = JSON.parse(String(capturedInit?.body));
  assert.equal(body.model, "mimo-v2-tts");
  assert.equal(body.messages[0].role, "assistant");
  assert.equal(body.messages[0].content, "<style>cheerful</style>hello");
  assert.deepEqual(body.audio, { format: "wav", voice: "default_zh" });
  assert.equal(body.stream, false);
  assert.equal(result.audioBuffer?.toString(), "audio-bytes");
  assert.equal(result.mimeType, "audio/wav");
  assert.equal(result.extension, "wav");
});

test("xiaomi provider rejects missing api key", async () => {
  const provider = createXiaomiTtsProvider();
  await assert.rejects(
    () => provider.generate({ text: "hello", provider: "xiaomi" }, context({
      settings: {
        ...context().settings,
        providers: {
          ...context().settings.providers,
          xiaomi: { ...context().settings.providers.xiaomi, apiKey: "" }
        }
      }
    })),
    /Xiaomi TTS API key is not configured/
  );
});

test("xiaomi provider rejects malformed audio response", async () => {
  const provider = createXiaomiTtsProvider();
  await assert.rejects(
    () => provider.generate({ text: "hello", provider: "xiaomi" }, context({
      fetch: async () => new Response(JSON.stringify({ choices: [{ message: {} }] }), { status: 200 })
    })),
    /Xiaomi TTS response did not include audio data/
  );
});

test("parseMacosSayVoices extracts voice ids and samples", () => {
  const voices = parseMacosSayVoices("Tingting             zh_CN    # 你好\nSamantha            en_US    # Hello\n");
  assert.deepEqual(voices, [
    { id: "Tingting", locale: "zh_CN", sample: "你好" },
    { id: "Samantha", locale: "en_US", sample: "Hello" }
  ]);
});

test("macos provider rejects non-darwin platforms", async () => {
  const provider = createMacosTtsProvider();
  await assert.rejects(
    () => provider.generate({ text: "hello", provider: "macos" }, context({ platform: "linux" })),
    /macOS system TTS is only available on macOS/
  );
});

test("macos provider uses safe spawn argument array", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const provider = createMacosTtsProvider();

  await provider.generate({
    text: "hello; rm -rf /",
    provider: "macos",
    voice: "Tingting",
    format: "aiff",
    outputPath: "/tmp/speech.aiff"
  }, context({
    spawn: ((command: string, args: string[]) => {
      calls.push({ command, args });
      const child = new EventEmitter() as any;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => true;
      queueMicrotask(() => child.emit("close", 0));
      return child;
    }) as any
  }));

  assert.equal(calls[0].command, "say");
  assert.deepEqual(calls[0].args, ["-v", "Tingting", "-o", "/tmp/speech.aiff", "--", "hello; rm -rf /"]);
});

test("macos provider falls back from wav to aiff format", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const provider = createMacosTtsProvider();

  const result = await provider.generate({
    text: "hello",
    provider: "macos",
    voice: "Tingting",
    format: "wav",
    outputPath: "/tmp/speech.wav"
  }, context({
    spawn: ((command: string, args: string[]) => {
      calls.push({ command, args });
      const child = new EventEmitter() as any;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => true;
      queueMicrotask(() => child.emit("close", 0));
      return child;
    }) as any
  }));

  // macOS say does not support wav; should output as aiff instead
  assert.deepEqual(calls[0].args, ["-v", "Tingting", "-o", "/tmp/speech.aiff", "--", "hello"]);
  assert.equal(result.format, "aiff");
  assert.equal(result.extension, "aiff");
  assert.equal(result.mimeType, "audio/aiff");
  assert.equal(result.outputPath, "/tmp/speech.aiff");
});

test("xiaomi provider falls back from aiff to wav format", async () => {
  let capturedBody: any;
  const provider = createXiaomiTtsProvider();

  const result = await provider.generate({
    text: "hello",
    provider: "xiaomi",
    voice: "mimo_default",
    format: "aiff"
  }, context({
    fetch: async (_url, init) => {
      capturedBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        choices: [{ message: { audio: { data: Buffer.from("audio").toString("base64") } } }]
      }), { status: 200 });
    }
  }));

  // aiff is not supported by Xiaomi; should fall back to wav
  assert.equal(capturedBody.audio.format, "wav");
  assert.equal(result.format, "wav");
  assert.equal(result.extension, "wav");
  assert.equal(result.mimeType, "audio/wav");
});

test("xiaomi provider accepts mp3 format", async () => {
  let capturedBody: any;
  const provider = createXiaomiTtsProvider();

  const result = await provider.generate({
    text: "hello",
    provider: "xiaomi",
    voice: "mimo_default",
    format: "mp3"
  }, context({
    fetch: async (_url, init) => {
      capturedBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        choices: [{ message: { audio: { data: Buffer.from("audio").toString("base64") } } }]
      }), { status: 200 });
    }
  }));

  assert.equal(capturedBody.audio.format, "mp3");
  assert.equal(result.format, "mp3");
  assert.equal(result.mimeType, "audio/mpeg");
});

test("macos provider falls back from mp3 to aiff format", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const provider = createMacosTtsProvider();

  const result = await provider.generate({
    text: "hello",
    provider: "macos",
    voice: "Tingting",
    format: "mp3",
    outputPath: "/tmp/speech.mp3"
  }, context({
    spawn: ((command: string, args: string[]) => {
      calls.push({ command, args });
      const child = new EventEmitter() as any;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => true;
      queueMicrotask(() => child.emit("close", 0));
      return child;
    }) as any
  }));

  assert.deepEqual(calls[0].args, ["-v", "Tingting", "-o", "/tmp/speech.aiff", "--", "hello"]);
  assert.equal(result.format, "aiff");
  assert.equal(result.outputPath, "/tmp/speech.aiff");
});
