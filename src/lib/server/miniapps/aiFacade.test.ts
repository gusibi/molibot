import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createMiniAppAiFacade, MINIAPP_AI_MAX_OUTPUT_TOKENS } from "$lib/server/miniapps/aiFacade.js";
import { MiniAppAiError } from "$lib/server/miniapps/types.js";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";

test("text facade enforces declaration, clamps tokens, and reads routing settings per call", async () => {
  let modelKey = "custom|one|first";
  const seen: Array<{ maxTokens: number; provider: string }> = [];
  const facade = createMiniAppAiFacade({
    appId: "writer",
    dataDir: ".",
    capabilities: ["text"],
    getSettings: () => ({
      ...defaultRuntimeSettings,
      plugins: {
        ...defaultRuntimeSettings.plugins,
        miniApps: { ...defaultRuntimeSettings.plugins.miniApps, ai: { textModelKey: modelKey, transcriptionModelKey: "" } }
      }
    }),
    executeText: async ({ settings, maxTokens }) => {
      seen.push({ maxTokens, provider: settings.defaultCustomProviderId });
      return {
        text: "done",
        usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
        provider: "fake",
        model: "fake",
        api: "fake"
      };
    }
  });

  await facade.generateText({ prompt: "first", maxTokens: 999_999 });
  modelKey = "custom|two|second";
  await facade.generateText({ prompt: "second" });
  assert.deepEqual(seen, [
    { maxTokens: MINIAPP_AI_MAX_OUTPUT_TOKENS, provider: "one" },
    { maxTokens: 1024, provider: "two" }
  ]);

  const undeclared = createMiniAppAiFacade({
    appId: "plain",
    dataDir: ".",
    capabilities: [],
    getSettings: () => defaultRuntimeSettings
  });
  await assert.rejects(
    () => undeclared.generateText({ prompt: "no" }),
    (cause: unknown) => cause instanceof MiniAppAiError && cause.code === "capability_not_declared"
  );
});

test("text facade rejects a third concurrent request before provider execution", async () => {
  const resolvers: Array<() => void> = [];
  let calls = 0;
  const facade = createMiniAppAiFacade({
    appId: "writer",
    dataDir: ".",
    capabilities: ["text"],
    getSettings: () => defaultRuntimeSettings,
    executeText: async () => {
      calls += 1;
      await new Promise<void>((resolve) => resolvers.push(resolve));
      return {
        text: "done",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        provider: "fake",
        model: "fake",
        api: "fake"
      };
    }
  });
  const first = facade.generateText({ prompt: "one" });
  const second = facade.generateText({ prompt: "two" });
  await assert.rejects(
    () => facade.generateText({ prompt: "three" }),
    (cause: unknown) => cause instanceof MiniAppAiError && cause.code === "rate_limited"
  );
  assert.equal(calls, 2);
  resolvers.splice(0).forEach((resolve) => resolve());
  await Promise.all([first, second]);
});

function wavSecond(): Buffer {
  const dataBytes = 8_000 * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0); buffer.writeUInt32LE(36 + dataBytes, 4); buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8_000, 24); buffer.writeUInt32LE(16_000, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36); buffer.writeUInt32LE(dataBytes, 40);
  return buffer;
}

test("transcription validates declaration, containment, language, abort, and audio metadata before provider work", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "molibot-ai-audio-"));
  writeFileSync(join(dataDir, "segment.wav"), wavSecond());
  const facade = createMiniAppAiFacade({
    appId: "meeting",
    dataDir,
    capabilities: ["transcription"],
    getSettings: () => defaultRuntimeSettings
  });
  await assert.rejects(() => facade.transcribe({ path: "../outside.wav" }), (cause: unknown) => cause instanceof MiniAppAiError && cause.code === "invalid_request");
  await assert.rejects(() => facade.transcribe({ path: "segment.wav", language: "not_a_language" }), (cause: unknown) => cause instanceof MiniAppAiError && cause.code === "invalid_request");
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => facade.transcribe({ path: "segment.wav", signal: controller.signal }), (cause: unknown) => cause instanceof MiniAppAiError && cause.code === "aborted");
  await assert.rejects(() => facade.transcribe({ path: "segment.wav", language: "zh-CN" }), (cause: unknown) => cause instanceof MiniAppAiError && cause.code === "capability_unavailable");

  const undeclared = createMiniAppAiFacade({ appId: "plain", dataDir, capabilities: [], getSettings: () => defaultRuntimeSettings });
  await assert.rejects(() => undeclared.transcribe({ path: "segment.wav" }), (cause: unknown) => cause instanceof MiniAppAiError && cause.code === "capability_not_declared");
});
