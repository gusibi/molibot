import assert from "node:assert/strict";
import test from "node:test";
import { fauxAssistantMessage, type Context, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { completeSimple } from "@earendil-works/pi-ai/compat";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";
import { resolveModel } from "$lib/server/agent/routing/modelRouting.js";
import {
  buildAdaptiveThinkingContext,
  createAdaptiveThinkingProvider,
  createDecisionModelProvider,
  listAvailableDecisionModelIds,
  LlmDecisionProvider,
  resolveAdaptiveThinking,
  resolveAutoEffectiveThinkingLevel,
  hasSemanticThinkingChoice,
  type DecisionProvider
} from "$lib/server/agent/decision/adaptiveThinking.js";
import { CloudflareJevProvider, TypeSafeJevProvider } from "./jev/index.js";

const settings = () => structuredClone(defaultRuntimeSettings.adaptiveThinking);
const enabledJev = (patch: Partial<ReturnType<typeof settings>> = {}) => ({
  ...settings(),
  enabled: true,
  decisionModels: [{ id: "jev" as const, provider: "jev" as const, baseUrl: "https://api.typesafe.ai", apiKey: "secret" }],
  selectedDecisionModelId: "jev",
  ...patch
});

function provider(result: Parameters<DecisionProvider["decide"]>[0] extends never ? never : Awaited<ReturnType<DecisionProvider["decide"]>>): DecisionProvider {
  return {
    async decide() {
      return result;
    }
  };
}

test("Auto resolution accepts a valid confident Choice", async () => {
  const result = await resolveAdaptiveThinking({
    strategy: "auto",
    fixedLevel: "off",
    settings: enabledJev(),
    context: buildAdaptiveThinkingContext("Fix the failing test."),
    provider: provider({ level: "high", confidence: 0.9, provider: "typesafe", model: "jev-test" }),
    signal: new AbortController().signal
  });
  assert.equal(result.requestedLevel, "high");
  assert.equal(result.fallbackReason, undefined);
});

test("Auto resolution falls back on low confidence and service errors", async () => {
  const low = await resolveAdaptiveThinking({
    strategy: "auto",
    fixedLevel: "off",
    settings: enabledJev({ fallbackThinkingLevel: "medium", confidenceThreshold: 0.7 }),
    context: buildAdaptiveThinkingContext("Continue."),
    provider: provider({ level: "low", confidence: 0.5 }),
    signal: new AbortController().signal
  });
  assert.equal(low.requestedLevel, "medium");
  assert.equal(low.fallbackReason, "low_confidence");

  const failed: DecisionProvider = {
    async decide() {
      throw new Error("network down");
    }
  };
  const error = await resolveAdaptiveThinking({
    strategy: "auto",
    fixedLevel: "off",
    settings: enabledJev(),
    context: buildAdaptiveThinkingContext("Continue."),
    provider: failed,
    signal: new AbortController().signal
  });
  assert.equal(error.fallbackReason, "network_error");
});

test("a failed decision uses the configured fallback level", async () => {
  const failed = await resolveAdaptiveThinking({
    strategy: "auto",
    fixedLevel: "off",
    settings: enabledJev({ fallbackThinkingLevel: "low" }),
    context: buildAdaptiveThinkingContext("Continue."),
    provider: { async decide() { throw new Error("network down"); } },
    signal: new AbortController().signal
  });
  assert.equal(failed.requestedLevel, "low");
  assert.equal(failed.fallbackReason, "network_error");
});

test("Auto skips classification when no viable model has two levels within the ceiling", () => {
  assert.equal(hasSemanticThinkingChoice([["off", "high"], ["high"]], "low"), false);
  assert.equal(hasSemanticThinkingChoice([["off", "high"]], "high"), true);
  assert.equal(hasSemanticThinkingChoice([["off"], ["medium", "high"]], "medium"), false);
});

test("Auto ceiling never lets pi capability clamping promote the final level", () => {
  assert.deepEqual(
    resolveAutoEffectiveThinkingLevel({
      requestedLevel: "low",
      fallbackLevel: "medium",
      ceiling: "medium",
      supportedLevels: ["off", "high"]
    }),
    { level: "off", compatible: true }
  );
  assert.deepEqual(
    resolveAutoEffectiveThinkingLevel({
      requestedLevel: "high",
      fallbackLevel: "medium",
      ceiling: "high",
      supportedLevels: ["off", "high"]
    }),
    { level: "high", compatible: true }
  );
});

test("Adaptive context keeps the request and bounds recent history", () => {
  const context = buildAdaptiveThinkingContext(
    "continue",
    Array.from({ length: 20 }, (_, index) => ({ role: "assistant", content: "step " + index, timestamp: index } as never)),
    { attachmentCount: 1, project: "demo" }
  );
  assert.match(context.state, /current_request: continue/);
  assert.match(context.state, /assistant: step 19/);
  assert.ok(context.estimatedTokens <= 2048);
  assert.ok(context.serializedBytes <= 12 * 1024);
});

test("Fixed strategy never invokes the decision provider", async () => {
  let calls = 0;
  const fixedProvider: DecisionProvider = {
    async decide() {
      calls += 1;
      return { level: "high", confidence: 1 };
    }
  };
  const result = await resolveAdaptiveThinking({
    strategy: "fixed",
    fixedLevel: "low",
    settings: settings(),
    context: buildAdaptiveThinkingContext("simple"),
    provider: fixedProvider,
    signal: new AbortController().signal
  });
  assert.equal(result.requestedLevel, "low");
  assert.equal(calls, 0);
});

test("a disabled decision model never runs during Auto", async () => {
  let calls = 0;
  const result = await resolveAdaptiveThinking({
    strategy: "auto",
    fixedLevel: "off",
    settings: enabledJev({
      decisionModels: [{ id: "jev", provider: "jev", enabled: false, baseUrl: "https://api.typesafe.ai", apiKey: "secret" }]
    }),
    context: buildAdaptiveThinkingContext("Continue."),
    provider: { async decide() { calls += 1; return { level: "high", confidence: 1 }; } },
    signal: new AbortController().signal
  });
  assert.equal(calls, 0);
  assert.equal(result.fallbackReason, "disabled");
});

test("A provider result that arrives after the deadline is ignored", async () => {
  const slow: DecisionProvider = {
    async decide() {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return { level: "high", confidence: 1 };
    }
  };
  const result = await resolveAdaptiveThinking({
    strategy: "auto",
    fixedLevel: "off",
    settings: enabledJev({ timeoutMs: 5, fallbackThinkingLevel: "medium" }),
    context: buildAdaptiveThinkingContext("slow"),
    provider: slow,
    signal: new AbortController().signal
  });
  assert.equal(result.requestedLevel, "medium");
  assert.equal(result.fallbackReason, "timeout");
});

test("Auto resolution falls back when the configured LLM model is missing", async () => {
  const result = await resolveAdaptiveThinking({
    strategy: "auto",
    fixedLevel: "off",
    settings: {
      ...settings(),
      enabled: true,
      decisionModels: [{ id: "llm", provider: "llm", llmModelKey: "" }],
      selectedDecisionModelId: "llm",
      fallbackThinkingLevel: "low"
    },
    context: buildAdaptiveThinkingContext("Continue."),
    provider: null,
    signal: new AbortController().signal
  });
  assert.equal(result.requestedLevel, "low");
  assert.equal(result.fallbackReason, "missing_model");
});

test("LLM decision requests use no tools and accept only a bounded level result", async () => {
  let capturedContext: Context | undefined;
  let capturedOptions: SimpleStreamOptions | undefined;
  const complete: typeof completeSimple = async (_model, context, options) => {
    capturedContext = context;
    capturedOptions = options;
    return fauxAssistantMessage('{"level":"high","confidence":0.9}');
  };
  const decisionProvider = new LlmDecisionProvider(
    resolveModel(defaultRuntimeSettings, "text"),
    "test-api-key",
    complete
  );
  const result = await decisionProvider.decide({
    context: buildAdaptiveThinkingContext("Review a multi-step failure."),
    signal: new AbortController().signal
  });

  assert.deepEqual(result, {
    level: "high",
    confidence: 0.9,
    provider: resolveModel(defaultRuntimeSettings, "text").provider,
    model: resolveModel(defaultRuntimeSettings, "text").id
  });
  assert.deepEqual(capturedContext?.tools, []);
  assert.equal(capturedOptions?.maxTokens, 128);
  assert.equal(capturedOptions?.reasoning, "low");
  assert.match(capturedContext?.systemPrompt ?? "", /Do not include explanations or chain-of-thought/);
});

test("the selected decision model determines Auto routing and readiness per entry", async () => {
  const runtimeSettings = structuredClone(defaultRuntimeSettings);
  runtimeSettings.adaptiveThinking = {
    ...runtimeSettings.adaptiveThinking,
    enabled: true,
    decisionModels: [
      { id: "jev", provider: "jev", baseUrl: "https://api.typesafe.ai", apiKey: "secret" },
      { id: "llm", provider: "llm", llmModelKey: "missing-model" }
    ],
    selectedDecisionModelId: "jev"
  };
  const selected = await createAdaptiveThinkingProvider(runtimeSettings);
  assert.ok(selected instanceof TypeSafeJevProvider);
  assert.deepEqual(await listAvailableDecisionModelIds(runtimeSettings), ["jev"]);
});

test("Cloudflare Jev can be selected without sharing TypeSafe host credentials", async () => {
  const runtimeSettings = structuredClone(defaultRuntimeSettings);
  runtimeSettings.adaptiveThinking = {
    ...runtimeSettings.adaptiveThinking,
    enabled: true,
    decisionModels: [{ id: "cloudflare-jev", provider: "cloudflare", accountId: "cf-account", apiToken: "cf-token" }],
    selectedDecisionModelId: "cloudflare-jev"
  };
  assert.ok(await createAdaptiveThinkingProvider(runtimeSettings) instanceof CloudflareJevProvider);
  assert.deepEqual(await listAvailableDecisionModelIds(runtimeSettings), ["cloudflare-jev"]);
});

test("SiliconFlow Jev model uses the configurable TypeSafe System One host and model ID", async () => {
  const runtimeSettings = structuredClone(defaultRuntimeSettings);
  const configured = {
    id: "siliconflow" as const,
    provider: "siliconflow" as const,
    baseUrl: "https://api.siliconflow.cn",
    modelId: "diffusiongemma",
    apiKey: "sf-secret"
  };
  runtimeSettings.adaptiveThinking = {
    ...runtimeSettings.adaptiveThinking,
    enabled: true,
    decisionModels: [configured],
    selectedDecisionModelId: "siliconflow"
  };
  assert.deepEqual(await listAvailableDecisionModelIds(runtimeSettings), ["siliconflow"]);
  const provider = await createDecisionModelProvider(runtimeSettings, configured);
  assert.ok(provider instanceof TypeSafeJevProvider);
  let url = "";
  let request: Record<string, unknown> = {};
  let authorization = "";
  const fetchRequest = (async (input: string | URL | Request, init?: RequestInit) => {
    url = String(input);
    authorization = new Headers(init?.headers).get("authorization") ?? "";
    request = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      model: configured.modelId,
      answers: {
        thinking_level: {
          type: "choice",
          choice: "low",
          confidence: 0.9,
          probabilities: { low: 0.9, medium: 0.08, high: 0.02 }
        }
      }
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const isolatedProvider = new TypeSafeJevProvider(configured.baseUrl, configured.apiKey, fetchRequest, configured.modelId, "siliconflow");
  const result = await isolatedProvider.decide({ context: buildAdaptiveThinkingContext("Summarize this note."), signal: new AbortController().signal });
    assert.equal(url, "https://api.siliconflow.cn/v1/systemone");
    assert.equal(authorization, "Bearer sf-secret");
    assert.equal(request.model, configured.modelId);
    assert.equal(result.level, "low");
    assert.equal(result.provider, "siliconflow");
    assert.equal(result.model, "diffusiongemma");
});
