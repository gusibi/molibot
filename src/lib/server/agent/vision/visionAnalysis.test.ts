import assert from "node:assert/strict";
import test from "node:test";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { defaultRuntimeSettings, type RuntimeSettings } from "$lib/server/settings/index.js";
import {
  analyzeImageWithConfiguredVision,
  resolveVisionAnalysisTarget
} from "$lib/server/agent/vision/visionAnalysis.js";

const ZERO_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
};

function visionSettings(verification: "untested" | "passed" | "failed" = "passed"): RuntimeSettings {
  return {
    ...defaultRuntimeSettings,
    modelRouting: {
      ...defaultRuntimeSettings.modelRouting,
      visionModelKey: "custom|vision-provider|vision-model"
    },
    customProviders: [{
      id: "vision-provider",
      name: "Vision Provider",
      enabled: true,
      protocol: "openai-compatible",
      baseUrl: "https://vision.example/v1",
      apiKey: "test-key",
      path: "/chat/completions",
      defaultModel: "vision-model",
      models: [{
        id: "vision-model",
        enabled: true,
        tags: ["text", "vision"],
        verification: { vision: verification },
        supportedRoles: ["system", "user", "assistant"]
      }]
    }]
  };
}

test("vision analysis uses the configured route and keeps the caller instruction outside image content", async () => {
  let captured: any;
  const message: AssistantMessage = {
    role: "assistant",
    content: [{ type: "text", text: "Invoice number: A-42" }],
    api: "openai-completions",
    provider: "vision-provider",
    model: "vision-model",
    usage: ZERO_USAGE,
    stopReason: "stop",
    timestamp: Date.now()
  };
  const result = await analyzeImageWithConfiguredVision({
    channel: "test",
    settings: visionSettings(),
    image: { type: "image", mimeType: "image/png", data: "aGVsbG8=" },
    instruction: "Transcribe every visible character.",
    streamFn: async (model, context, options) => {
      captured = { model, context, options };
      return { result: async () => message };
    }
  });

  assert.equal(result.text, "Invoice number: A-42");
  assert.equal(result.providerId, "vision-provider");
  assert.equal(result.modelId, "vision-model");
  assert.deepEqual(captured.model.input, ["text", "image"]);
  assert.equal(captured.model.reasoning, false);
  assert.equal(captured.model.thinkingLevelMap, undefined);
  assert.match(captured.context.messages[0].content[0].text, /Transcribe every visible character/);
  assert.equal(captured.context.messages[0].content[1].type, "image");
  assert.equal(captured.options.apiKey, "test-key");
});

test("vision analysis refuses an absent, undeclared, or failed route before network execution", async () => {
  assert.equal(resolveVisionAnalysisTarget(defaultRuntimeSettings), null);
  let called = false;
  const failed = await analyzeImageWithConfiguredVision({
    channel: "test",
    settings: visionSettings("failed"),
    image: { type: "image", mimeType: "image/png", data: "aGVsbG8=" },
    streamFn: async () => {
      called = true;
      throw new Error("must not run");
    }
  });
  assert.equal(called, false);
  assert.match(failed.errorMessage ?? "", /验证失败/);
});

test("vision analysis does not retry deterministic provider 4xx errors", async () => {
  let calls = 0;
  const result = await analyzeImageWithConfiguredVision({
    channel: "test",
    settings: visionSettings(),
    image: { type: "image", mimeType: "image/png", data: "aGVsbG8=" },
    maxAttempts: 3,
    retryDelayMs: 1,
    streamFn: async () => {
      calls += 1;
      return { result: async () => { throw new Error("400: invalid image"); } };
    }
  });
  assert.equal(calls, 1);
  assert.match(result.errorMessage ?? "", /400: invalid image/);
});
