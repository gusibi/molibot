import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";
import type { RuntimeSettings } from "$lib/server/settings/schema.js";
import { buildModelOptions } from "$lib/server/settings/modelSwitch.js";
import { LlmDecisionProvider } from "$lib/server/agent/decision/adaptiveThinking.js";
import { evaluationCase } from "$lib/server/agent/decision/jev/evaluationCases.js";
import {
  readAdaptiveThinkingConfig,
  readAvailableDecisionModelIds,
  testDecisionModelCase,
  updateAdaptiveThinkingConfig
} from "$lib/server/settings/handlers/adaptiveThinking.js";

function accessor(initial: RuntimeSettings = structuredClone(defaultRuntimeSettings)) {
  let settings = initial;
  return {
    getSettings: () => settings,
    updateSettings: (patch: Partial<RuntimeSettings>) => {
      settings = { ...settings, ...patch };
      return settings;
    }
  };
}

const jev = (apiKey: string, baseUrl = "https://api.typesafe.ai") => ({
  id: "jev" as const,
  provider: "jev" as const,
  baseUrl,
  apiKey
});
const cloudflare = (apiToken: string, accountId = "account-123") => ({
  id: "cloudflare-jev" as const,
  provider: "cloudflare" as const,
  accountId,
  apiToken
});

test("decision model projection redacts each Jev API key", () => {
  const runtime = accessor({
    ...structuredClone(defaultRuntimeSettings),
    adaptiveThinking: {
      ...defaultRuntimeSettings.adaptiveThinking,
      decisionModels: [jev("secret")],
      selectedDecisionModelId: "jev"
    }
  });
  const value = readAdaptiveThinkingConfig(runtime);
  assert.equal(value.decisionModels.length, 1);
  assert.equal(value.decisionModels[0]?.provider, "jev");
  assert.equal(value.decisionModels[0]?.provider === "jev" ? value.decisionModels[0].hasApiKey : false, true);
  assert.equal(JSON.stringify(value).includes("secret"), false);
});

test("decision model projection redacts Cloudflare API tokens", () => {
  const runtime = accessor({
    ...structuredClone(defaultRuntimeSettings),
    adaptiveThinking: {
      ...defaultRuntimeSettings.adaptiveThinking,
      decisionModels: [cloudflare("cf-secret")],
      selectedDecisionModelId: "cloudflare-jev"
    }
  });
  const value = readAdaptiveThinkingConfig(runtime);
  assert.equal(value.decisionModels[0]?.provider, "cloudflare");
  assert.equal(value.decisionModels[0]?.provider === "cloudflare" ? value.decisionModels[0].hasApiToken : false, true);
  assert.equal(JSON.stringify(value).includes("cf-secret"), false);
});

test("SiliconFlow entries keep independent model IDs and API keys without exposing secrets", () => {
  const runtime = accessor();
  const model = { id: "siliconflow-1", provider: "siliconflow", baseUrl: "https://api.siliconflow.cn", modelId: "diffusiongemma" };
  const other = { id: "siliconflow-2", provider: "siliconflow", baseUrl: "https://api-st.siliconflow.cn", modelId: "Kev-4b" };
  updateAdaptiveThinkingConfig(runtime, { decisionModels: [model, other], apiKeys: { "siliconflow-1": "sf-secret", "siliconflow-2": "sf-other-secret" }, selectedDecisionModelId: "siliconflow-2" });
  const projected = readAdaptiveThinkingConfig(runtime);
  const firstProjected = projected.decisionModels.find((item) => item.id === "siliconflow-1");
  const secondProjected = projected.decisionModels.find((item) => item.id === "siliconflow-2");
  assert.equal(firstProjected?.provider, "siliconflow");
  assert.equal(firstProjected?.provider === "siliconflow" ? firstProjected.hasApiKey : false, true);
  assert.equal(secondProjected?.provider === "siliconflow" ? secondProjected.hasApiKey : false, true);
  assert.equal(JSON.stringify(projected).includes("sf-secret"), false);
  assert.equal(JSON.stringify(projected).includes("sf-other-secret"), false);
  updateAdaptiveThinkingConfig(runtime, { decisionModels: [model, other] });
  let stored = runtime.getSettings().adaptiveThinking.decisionModels.find((item) => item.id === "siliconflow-1");
  assert.equal(stored?.provider === "siliconflow" ? stored.apiKey : "", "sf-secret");
  updateAdaptiveThinkingConfig(runtime, { decisionModels: [{ ...model, enabled: false }, other], clearApiKeys: ["siliconflow-1"] });
  stored = runtime.getSettings().adaptiveThinking.decisionModels.find((item) => item.id === "siliconflow-1");
  assert.equal(stored?.provider === "siliconflow" ? stored.apiKey : "non-siliconflow", "");
  stored = runtime.getSettings().adaptiveThinking.decisionModels.find((item) => item.id === "siliconflow-2");
  assert.equal(stored?.provider === "siliconflow" ? stored.apiKey : "", "sf-other-secret");
});

test("decision model update retains, replaces, and clears Jev credentials", () => {
  const runtime = accessor({
    ...structuredClone(defaultRuntimeSettings),
    adaptiveThinking: { ...defaultRuntimeSettings.adaptiveThinking, decisionModels: [jev("old")] }
  });
  const model = { id: "jev", provider: "jev", baseUrl: "https://api.typesafe.ai" };
  updateAdaptiveThinkingConfig(runtime, { decisionModels: [model] });
  let stored = runtime.getSettings().adaptiveThinking.decisionModels[0];
  assert.equal(stored?.provider === "jev" ? stored.apiKey : "", "old");

  updateAdaptiveThinkingConfig(runtime, { decisionModels: [model], apiKeys: { jev: "new" } });
  stored = runtime.getSettings().adaptiveThinking.decisionModels[0];
  assert.equal(stored?.provider === "jev" ? stored.apiKey : "", "new");

  updateAdaptiveThinkingConfig(runtime, { decisionModels: [{ ...model, enabled: false }], clearApiKeys: ["jev"] });
  stored = runtime.getSettings().adaptiveThinking.decisionModels[0];
  assert.equal(stored?.provider === "jev" ? stored.apiKey : "", "");
});

test("changing a configured Jev Host requires a new key", () => {
  const runtime = accessor({
    ...structuredClone(defaultRuntimeSettings),
    adaptiveThinking: { ...defaultRuntimeSettings.adaptiveThinking, decisionModels: [jev("old")] }
  });
  assert.throws(
    () => updateAdaptiveThinkingConfig(runtime, {
      decisionModels: [{ id: "jev", provider: "jev", baseUrl: "https://other.example" }]
    }),
    /requires entering a new API key/
  );
});

test("Cloudflare credentials are retained, replaced, cleared, and rebound to the account", () => {
  const runtime = accessor({
    ...structuredClone(defaultRuntimeSettings),
    adaptiveThinking: { ...defaultRuntimeSettings.adaptiveThinking, decisionModels: [cloudflare("old-token")] }
  });
  const model = { id: "cloudflare-jev", provider: "cloudflare", accountId: "account-123" };

  updateAdaptiveThinkingConfig(runtime, { decisionModels: [model] });
  let stored = runtime.getSettings().adaptiveThinking.decisionModels.find((item) => item.id === "cloudflare-jev");
  assert.equal(stored?.provider === "cloudflare" ? stored.apiToken : "", "old-token");
  updateAdaptiveThinkingConfig(runtime, { decisionModels: [model], apiKeys: { "cloudflare-jev": "new-token" } });
  stored = runtime.getSettings().adaptiveThinking.decisionModels.find((item) => item.id === "cloudflare-jev");
  assert.equal(stored?.provider === "cloudflare" ? stored.apiToken : "", "new-token");
  assert.throws(
    () => updateAdaptiveThinkingConfig(runtime, {
      decisionModels: [{ ...model, accountId: "other-account" }]
    }),
    /requires entering a new API token/
  );
  updateAdaptiveThinkingConfig(runtime, { decisionModels: [{ ...model, enabled: false }], clearApiKeys: ["cloudflare-jev"] });
  stored = runtime.getSettings().adaptiveThinking.decisionModels.find((item) => item.id === "cloudflare-jev");
  assert.equal(stored?.provider === "cloudflare" ? stored.apiToken : "", "");
});

test("Cloudflare case test reuses the saved token only for its saved account", async () => {
  const runtime = accessor({
    ...structuredClone(defaultRuntimeSettings),
    adaptiveThinking: { ...defaultRuntimeSettings.adaptiveThinking, decisionModels: [cloudflare("saved-token")] }
  });
  const originalFetch = globalThis.fetch;
  let authorization = "";
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    authorization = new Headers(init?.headers).get("authorization") ?? "";
    return new Response(JSON.stringify({
      model: "jev-test",
      answers: { department: { type: "choice", choice: "billing", confidence: 0.9, probabilities: { billing: 0.9, technical: 0.05, other: 0.05 } } }
    }), { status: 200 });
  }) as typeof globalThis.fetch;
  try {
    const result = await testDecisionModelCase(runtime, {
      provider: "cloudflare",
      accountId: "account-123",
      testCaseId: "choice"
    });
    assert.deepEqual(result, {
      provider: "cloudflare", model: "jev-test", testCase: evaluationCase("choice"),
      answers: { department: { type: "choice", choice: "billing", confidence: 0.9, probabilities: { billing: 0.9, technical: 0.05, other: 0.05 } } }
    });
    assert.equal(authorization, "Bearer saved-token");
    await assert.rejects(
      () => testDecisionModelCase(runtime, {
        provider: "cloudflare",
        accountId: "other-account",
        testCaseId: "choice"
      }),
      /Account ID and API token are required/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("TypeSafe case test reuses a saved key only for its saved Host", async () => {
  const runtime = accessor({
    ...structuredClone(defaultRuntimeSettings),
    adaptiveThinking: { ...defaultRuntimeSettings.adaptiveThinking, decisionModels: [jev("saved-key")] }
  });
  const originalFetch = globalThis.fetch;
  let authorization = "";
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    authorization = new Headers(init?.headers).get("authorization") ?? "";
    return new Response(JSON.stringify({ model: "jev-test", answers: { refund_requested: { type: "noul", noul: 0.96 } } }), { status: 200 });
  }) as typeof globalThis.fetch;
  try {
    const result = await testDecisionModelCase(runtime, {
      provider: "jev", baseUrl: "https://api.typesafe.ai", testCaseId: "noul"
    });
    assert.equal(authorization, "Bearer saved-key");
    assert.deepEqual(result.answers, { refund_requested: { type: "noul", noul: 0.96 } });
    await assert.rejects(() => testDecisionModelCase(runtime, {
      provider: "jev", baseUrl: "https://different.example", testCaseId: "noul"
    }), /Host and API key are required/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("thinking policy selects one entry from the configured decision model collection", () => {
  const runtime = accessor();
  const textModelKey = buildModelOptions(defaultRuntimeSettings, "text")[0]?.key;
  assert.ok(textModelKey);
  updateAdaptiveThinkingConfig(runtime, {
    enabled: true,
    decisionModels: [
      { id: "jev", provider: "jev", baseUrl: "https://api.typesafe.ai" },
      { id: "cloudflare-jev", provider: "cloudflare", accountId: "cf-account" },
      { id: "llm", provider: "llm", llmModelKey: textModelKey }
    ],
    apiKeys: { jev: "secret", "cloudflare-jev": "cf-token" },
    selectedDecisionModelId: "llm"
  });
  assert.deepEqual(runtime.getSettings().adaptiveThinking.decisionModels.map((model) => model.id), ["jev", "llm", "siliconflow", "cloudflare-jev"]);
  assert.equal(runtime.getSettings().adaptiveThinking.selectedDecisionModelId, "llm");
  const projected = readAdaptiveThinkingConfig(runtime);
  assert.deepEqual(projected.availableDecisionModelIds, []);
  assert.equal(JSON.stringify(projected).includes("secret"), false);
});

test("custom Jev entries keep their name, Host, model ID, enabled state, and redacted key", async () => {
  const runtime = accessor();
  const custom = { id: "custom-jev-1", provider: "custom-jev", enabled: false, name: "My Jev", baseUrl: "https://jev.example.test/proxy", modelId: "custom-model" };
  updateAdaptiveThinkingConfig(runtime, { decisionModels: [custom], apiKeys: { [custom.id]: "custom-secret" } });
  const projected = readAdaptiveThinkingConfig(runtime);
  const entry = projected.decisionModels.find((model) => model.id === custom.id);
  assert.equal(entry?.provider, "custom-jev");
  assert.equal(entry?.provider === "custom-jev" ? entry.hasApiKey : false, true);
  assert.equal(entry?.provider === "custom-jev" ? entry.name : "", "My Jev");
  assert.equal(JSON.stringify(projected).includes("custom-secret"), false);
  assert.equal((await readAvailableDecisionModelIds(runtime)).includes(custom.id), false);

  updateAdaptiveThinkingConfig(runtime, { decisionModels: [{ ...custom, enabled: true }] });
  assert.equal((await readAvailableDecisionModelIds(runtime)).includes(custom.id), true);
  assert.throws(
    () => updateAdaptiveThinkingConfig(runtime, { decisionModels: [{ ...custom, enabled: true, baseUrl: "https://other.example.test" }] }),
    /requires entering a new API key/
  );
  updateAdaptiveThinkingConfig(runtime, { decisionModels: [{ ...custom, enabled: false, baseUrl: "https://other.example.test" }], apiKeys: { [custom.id]: "new-secret" } });
  const stored = runtime.getSettings().adaptiveThinking.decisionModels.find((model) => model.id === custom.id);
  assert.equal(stored?.provider === "custom-jev" ? stored.apiKey : "", "new-secret");
});

test("an enabled custom Jev entry requires complete configuration", () => {
  const runtime = accessor();
  assert.throws(
    () => updateAdaptiveThinkingConfig(runtime, {
      decisionModels: [{ id: "custom-jev-1", provider: "custom-jev", enabled: true, name: "My Jev", baseUrl: "", modelId: "m" }]
    }),
    /Configure the custom Jev/
  );
});

test("custom Jev connection test uses its saved key while the entry is disabled", async () => {
  const runtime = accessor();
  updateAdaptiveThinkingConfig(runtime, {
    decisionModels: [{ id: "custom-jev-1", provider: "custom-jev", enabled: false, name: "My Jev", baseUrl: "https://jev.example.test/proxy", modelId: "my-model" }],
    apiKeys: { "custom-jev-1": "saved-secret" }
  });
  const originalFetch = globalThis.fetch;
  let url = "";
  let authorization = "";
  let model = "";
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    url = String(input);
    authorization = new Headers(init?.headers).get("authorization") ?? "";
    model = String((JSON.parse(String(init?.body)) as { model?: string }).model ?? "");
    return new Response(JSON.stringify({
      model: "my-model",
      answers: { department: { type: "choice", choice: "billing", confidence: 0.9, probabilities: { billing: 0.9, technical: 0.05, other: 0.05 } } }
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  try {
    const result = await testDecisionModelCase(runtime, {
      provider: "custom-jev", decisionModelId: "custom-jev-1",
      baseUrl: "https://jev.example.test/proxy", modelId: "my-model", testCaseId: "choice"
    });
    assert.equal(result.model, "my-model");
    assert.equal(url, "https://jev.example.test/proxy/v1/systemone");
    assert.equal(authorization, "Bearer saved-secret");
    assert.equal(model, "my-model");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("LLM case test can finish when the model takes longer than the Auto decision budget", async () => {
  const settings = structuredClone(defaultRuntimeSettings);
  settings.customProviders = [{
    id: "decision-test",
    name: "Decision Test",
    enabled: true,
    protocol: "openai-compatible",
    baseUrl: "https://example.invalid/v1",
    apiKey: "test-key",
    models: [{ id: "model-a", tags: ["text"], supportedRoles: ["system", "user", "assistant"], enabled: true }],
    defaultModel: "model-a",
    path: "/chat/completions"
  }];
  const decide = mock.method(LlmDecisionProvider.prototype, "evaluateTestCase", async (id: Parameters<LlmDecisionProvider["evaluateTestCase"]>[0], signal: AbortSignal) => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    if (signal.aborted) throw new Error("LLM decision request was aborted");
    return { provider: "decision-test", model: "model-a", testCase: evaluationCase(id), answers: { refund_requested: { type: "noul", noul: 0.9 } } };
  });
  try {
    const request = {
      provider: "llm",
      llmModelKey: "custom|decision-test|model-a",
      testCaseId: "noul",
      timeoutMs: 100
    };
    const result = await testDecisionModelCase(accessor(settings), request);
    assert.equal(result.answers.refund_requested && (result.answers.refund_requested as { noul: number }).noul, 0.9);
  } finally {
    decide.mock.restore();
  }
});
