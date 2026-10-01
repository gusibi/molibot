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
    context: buildAdaptiveThinkingContext("Review the failing test."),
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
    context: buildAdaptiveThinkingContext("Review the failing test."),
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
    context: buildAdaptiveThinkingContext("Review the failing test."),
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
    context: buildAdaptiveThinkingContext("Review the failing test."),
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
    context: buildAdaptiveThinkingContext("Review the failing test."),
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
    usage: { inputTokens: 0, outputTokens: 0 },
    estimatedCost: 0,
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

test("deadline and cancellation settle even when the provider ignores its signal", async () => {
  for (const cancelled of [false, true]) {
    const controller = new AbortController();
    let providerSignal: AbortSignal | undefined;
    const decision = resolveAdaptiveThinking({
      strategy: "auto", fixedLevel: "off", settings: enabledJev({ timeoutMs: 10 }),
      context: buildAdaptiveThinkingContext("review the code"), signal: controller.signal,
      provider: { decide({ signal }) { providerSignal = signal; return new Promise(() => {}); } }
    });
    if (cancelled) controller.abort();
    let guard: ReturnType<typeof setTimeout> | undefined;
    try {
      const outcome = await Promise.race([
        decision.then(value => value, error => error),
        new Promise(resolve => { guard = setTimeout(() => resolve("still pending"), 100); })
      ]);
      if (cancelled) assert.ok(outcome instanceof Error);
      else assert.equal((outcome as { fallbackReason?: string }).fallbackReason, "timeout");
      assert.equal(providerSignal?.aborted, true);
    } finally { clearTimeout(guard); }
  }
});

test("pre-cancelled requests cannot resolve through fixed or Auto fast paths", async () => {
  const controller = new AbortController();
  controller.abort();
  for (const strategy of ["fixed", "auto"] as const) {
    for (const configured of [settings(), enabledJev()]) {
      await assert.rejects(resolveAdaptiveThinking({
        strategy, fixedLevel: "low", settings: configured,
        context: buildAdaptiveThinkingContext("hello"), provider: null, signal: controller.signal
      }));
    }
  }
});

test("confidence must be a JSON number without coercion", async () => {
  for (const confidence of [null, "0.9", false, undefined, NaN, Infinity, -0.1, 1.1]) {
    const result = await resolveAdaptiveThinking({
      strategy: "auto", fixedLevel: "off", settings: enabledJev({ confidenceThreshold: 0 }),
      context: buildAdaptiveThinkingContext("review code"), signal: new AbortController().signal,
      provider: { async decide() { return { level: "high", confidence } as never; } }
    });
    assert.equal(result.fallbackReason, "invalid_confidence", String(confidence));
  }
});

test("context marks early trimming and only includes conversational history", () => {
  assert.equal(buildAdaptiveThinkingContext("x".repeat(30000)).truncated, true);
  assert.equal(buildAdaptiveThinkingContext("hello", [
    { role: "assistant", content: "x".repeat(10000), timestamp: 0 } as never
  ]).truncated, true);
  const history = [
    { role: "user", content: "previous request", timestamp: 0 },
    ...Array.from({ length: 4 }, () => ({ role: "toolResult", content: "secret tool output", timestamp: 1 }))
  ];
  const context = buildAdaptiveThinkingContext("hello", history as never);
  assert.match(context.state, /previous request/);
  assert.doesNotMatch(context.state, /secret tool output/);
});

test("LLM JSON decisions reject null and string confidence", async () => {
  for (const confidence of [null, "0.9"]) {
    const decisionProvider = new LlmDecisionProvider(
      resolveModel(defaultRuntimeSettings, "text"), "test-api-key",
      async () => fauxAssistantMessage(JSON.stringify({ level: "high", confidence }))
    );
    await assert.rejects(decisionProvider.decide({
      context: buildAdaptiveThinkingContext("review code"), signal: new AbortController().signal
    }), /malformed_response/);
  }
});

test("missing essential context falls back without dispatch while follow-ups with history work", async () => {
  let calls = 0;
  const decisionProvider: DecisionProvider = { async decide() { calls += 1; return { level: "low", confidence: 1 }; } };
  const contexts = [
    buildAdaptiveThinkingContext("Continue.", [], { project: "demo" }),
    buildAdaptiveThinkingContext("继续"),
    buildAdaptiveThinkingContext("Review the attachment", [], { essentialAttachmentContentUnavailable: true }),
    buildAdaptiveThinkingContext("continue", [{ role: "assistant", content: "The next step is to run the integration checks", timestamp: 0 } as never])
  ];
  for (const [index, context] of contexts.entries()) {
    const result = await resolveAdaptiveThinking({
      strategy: "auto", fixedLevel: "off", settings: enabledJev(), context,
      signal: new AbortController().signal, provider: decisionProvider
    });
    assert.equal(result.fallbackReason, index < 3 ? "insufficient_context" : undefined);
  }
  assert.equal(calls, 1);
});

 test("decision measurements survive accepted and rejected decisions with original context metadata", async () => {
  for (const result of [
    { level: "high", confidence: 0.9 }, { level: "high", confidence: 0.1 },
    { level: "unknown", confidence: 0.9 }, { level: "high", confidence: NaN }
  ]) {
    const context = buildAdaptiveThinkingContext("Diagnose the failing asynchronous test.");
    const resolution = await resolveAdaptiveThinking({ strategy: "auto", fixedLevel: "off", settings: enabledJev(), context,
      signal: new AbortController().signal, provider: provider({ ...result, usage: { inputTokens: 12, outputTokens: 3 }, estimatedCost: 0.002 }) });
    assert.deepEqual(resolution.usage, { inputTokens: 12, outputTokens: 3 });
    assert.equal(resolution.estimatedCost, 0.002);
    assert.equal(resolution.contextTokens, context.estimatedTokens);
    assert.equal(resolution.contextBytes, context.serializedBytes);
    assert.equal(resolution.contextTruncated, context.truncated);
    assert.ok(resolution.rubricVersion);
  }
});

test("LLM provider exposes supplied token usage and estimated cost", async () => {
  const decisionProvider = new LlmDecisionProvider(resolveModel(defaultRuntimeSettings, "text"), "test-api-key", async () => {
    const response = fauxAssistantMessage('{"level":"medium","confidence":0.9}');
    response.usage.input = 50;
    response.usage.output = 12;
    response.usage.cost.total = 0.003;
    return response;
  });
  const result = await decisionProvider.decide({ context: buildAdaptiveThinkingContext("Diagnose the bug."), signal: new AbortController().signal });
  assert.deepEqual(result.usage, { inputTokens: 50, outputTokens: 12 });
  assert.equal(result.estimatedCost, 0.003);
});
