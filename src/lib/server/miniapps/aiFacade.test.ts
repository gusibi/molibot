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

test("chat facade forwards only validated alternating messages and an explicit system prompt", async () => {
  const seen: unknown[] = [];
  const facade = createMiniAppAiFacade({
    appId: "mini-chat",
    dataDir: ".",
    capabilities: ["text"],
    getSettings: () => defaultRuntimeSettings,
    executeText: async (input) => {
      seen.push({ messages: input.messages, system: input.system, reasoning: input.reasoning });
      return {
        text: "four",
        usage: { inputTokens: 3, outputTokens: 1, totalTokens: 4 },
        provider: "fake",
        model: "fake",
        api: "fake"
      };
    }
  });

  await facade.chat({
    messages: [
      { role: "user", content: "one" },
      { role: "assistant", content: "two" },
      { role: "user", content: "three" }
    ]
  });

  assert.deepEqual(seen, [{
    messages: [
      { role: "user", content: "one" },
      { role: "assistant", content: "two" },
      { role: "user", content: "three" }
    ],
    system: undefined,
    reasoning: "low"
  }]);
  assert.throws(
    () => facade.chat({ messages: [{ role: "assistant", content: "invalid" }] }),
    (cause: unknown) => cause instanceof MiniAppAiError && cause.code === "invalid_request"
  );
  assert.throws(
    () => facade.chat({ messages: [{ role: "user", content: "one" }, { role: "user", content: "two" }] }),
    (cause: unknown) => cause instanceof MiniAppAiError && cause.code === "invalid_request"
  );
});

test("provider failures keep an actionable, credential-redacted description", async () => {
  const settings = structuredClone(defaultRuntimeSettings);
  settings.providerMode = "custom";
  settings.defaultCustomProviderId = "test-provider";
  settings.customProviders = [{
    id: "test-provider",
    name: "Test provider",
    enabled: true,
    baseUrl: "https://example.invalid",
    apiKey: "secret-value",
    defaultModel: "test-model",
    path: "/v1/chat/completions",
    models: [{ id: "test-model", tags: ["text"] }]
  } as (typeof settings.customProviders)[number]];
  const facade = createMiniAppAiFacade({
    appId: "mini-chat",
    dataDir: ".",
    capabilities: ["text"],
    getSettings: () => settings,
    completeText: async (_model, _context, options) => {
      assert.equal(options?.reasoning, "low");
      return {
        role: "assistant",
        content: [],
        api: "openai-completions",
        provider: "test-provider",
        model: "test-model",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
        },
        stopReason: "error",
        errorMessage: '400: {"message":"reasoning low is unsupported; api_key=my-secret"}',
        timestamp: Date.now()
      };
    }
  });

  await assert.rejects(
    () => facade.chat({ messages: [{ role: "user", content: "hello" }] }),
    (cause: unknown) => cause instanceof MiniAppAiError
      && cause.code === "provider_failed"
      && cause.message === "Model request failed (400): reasoning low is unsupported; api_key=[REDACTED]"
  );
});

test("chat facade forwards provider text deltas before returning the final response", async () => {
  const settings = structuredClone(defaultRuntimeSettings);
  settings.providerMode = "custom";
  settings.defaultCustomProviderId = "test-provider";
  settings.customProviders = [{
    id: "test-provider",
    name: "Test provider",
    enabled: true,
    baseUrl: "https://example.invalid",
    apiKey: "secret-value",
    defaultModel: "test-model",
    path: "/v1/chat/completions",
    models: [{ id: "test-model", tags: ["text"] }]
  } as (typeof settings.customProviders)[number]];
  const deltas: string[] = [];
  const message = {
    role: "assistant" as const,
    content: [{ type: "text" as const, text: "Hello" }],
    api: "openai-completions" as const,
    provider: "test-provider",
    model: "test-model",
    usage: {
      input: 1,
      output: 2,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 3,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason: "stop" as const,
    timestamp: Date.now()
  };
  const facade = createMiniAppAiFacade({
    appId: "mini-chat",
    dataDir: ".",
    capabilities: ["text"],
    getSettings: () => settings,
    completeText: async () => { throw new Error("streaming call used the buffered transport"); },
    streamText: (_model, _context, options) => {
      assert.equal(options?.reasoning, "low");
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: "text_delta", contentIndex: 0, delta: "Hel", partial: message };
          yield { type: "text_delta", contentIndex: 0, delta: "lo", partial: message };
          yield { type: "done", reason: "stop", message };
        },
        result: async () => message
      } as any;
    }
  });

  const result = await facade.chat({
    messages: [{ role: "user", content: "hello" }],
    onTextDelta: (delta) => deltas.push(delta)
  });

  assert.deepEqual(deltas, ["Hel", "lo"]);
  assert.equal(result.text, "Hello");
});

test("text model discovery is credential-free and chat validates a per-call model override", async () => {
  const settings = structuredClone(defaultRuntimeSettings);
  settings.providerMode = "custom";
  settings.defaultCustomProviderId = "test-provider";
  settings.customProviders = [{
    id: "test-provider",
    name: "Test provider",
    enabled: true,
    baseUrl: "https://example.invalid",
    apiKey: "super-secret-api-key",
    defaultModel: "first-model",
    path: "/v1/chat/completions",
    models: [
      { id: "first-model", alias: "Fast", tags: ["text"] },
      { id: "second-model", alias: "Careful", tags: ["text"] }
    ]
  } as (typeof settings.customProviders)[number]];
  const selected: string[] = [];
  const facade = createMiniAppAiFacade({
    appId: "mini-chat",
    dataDir: ".",
    capabilities: ["text"],
    getSettings: () => settings,
    executeText: async ({ settings: routed }) => {
      selected.push(routed.customProviders[0]?.defaultModel ?? "");
      return {
        text: "done",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        provider: "test-provider",
        model: routed.customProviders[0]?.defaultModel ?? "",
        api: "openai-completions"
      };
    }
  });

  const models = await facade.listTextModels();
  assert.equal(models.currentKey, "custom|test-provider|first-model");
  assert.deepEqual(
    models.options.filter(({ key }) => key.startsWith("custom|test-provider|")).map(({ key, label }) => ({ key, label })),
    [
      { key: "custom|test-provider|first-model", label: "Fast" },
      { key: "custom|test-provider|second-model", label: "Careful" }
    ]
  );
  assert.doesNotMatch(JSON.stringify(models), /super-secret-api-key/);

  await facade.chat({
    messages: [{ role: "user", content: "hello" }],
    modelKey: "custom|test-provider|second-model"
  });
  assert.deepEqual(selected, ["second-model"]);
  await assert.rejects(
    () => facade.chat({ messages: [{ role: "user", content: "hello" }], modelKey: "custom|missing|model" }),
    (cause: unknown) => cause instanceof MiniAppAiError && cause.code === "invalid_request"
  );
});

test("per-call model override wins over the configured global text route", async () => {
  const settings = structuredClone(defaultRuntimeSettings);
  settings.providerMode = "custom";
  settings.defaultCustomProviderId = "test-provider";
  settings.modelRouting.textModelKey = "custom|test-provider|default-model";
  settings.customProviders = [{
    id: "test-provider",
    name: "Test provider",
    enabled: true,
    baseUrl: "https://example.invalid",
    apiKey: "test-key",
    defaultModel: "default-model",
    path: "",
    models: [
      { id: "default-model", tags: ["text"] },
      { id: "selected-model", tags: ["text"] }
    ]
  } as (typeof settings.customProviders)[number]];

  const selectedModels: string[] = [];
  const facade = createMiniAppAiFacade({
    appId: "mini-chat",
    dataDir: ".",
    capabilities: ["text"],
    getSettings: () => settings,
    completeText: async (model) => {
      selectedModels.push(model.id);
      return {
        role: "assistant",
        content: [{ type: "text", text: "done" }],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
        },
        stopReason: "stop",
        timestamp: Date.now()
      };
    }
  });

  await facade.chat({
    messages: [{ role: "user", content: "hello" }],
    modelKey: "custom|test-provider|selected-model"
  });
  assert.deepEqual(selectedModels, ["selected-model"]);
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
