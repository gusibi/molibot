import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";
import { sanitizeAdaptiveThinkingSettings } from "$lib/server/settings/sanitize.js";
import { SettingsStore } from "$lib/server/settings/store.js";
import { storagePaths } from "$lib/server/infra/db/storage.js";

const defaultJev = defaultRuntimeSettings.adaptiveThinking.decisionModels.find((model) => model.provider === "jev");
const defaultJevBaseUrl = defaultJev?.provider === "jev" ? defaultJev.baseUrl : "https://api.typesafe.ai";

test("adaptive thinking sanitizes provider entries and keeps the auto policy bounded", () => {
  const result = sanitizeAdaptiveThinkingSettings({
    enabled: true,
    decisionModels: [{
      id: "jev",
      provider: "jev",
      baseUrl: "https://jev.example.test///",
      apiKey: " key "
    }, {
      id: "cloudflare-jev",
      provider: "cloudflare",
      accountId: " account-123 ",
      apiToken: " cf-token "
    }],
    selectedDecisionModelId: "jev",
    defaultStrategy: "auto",
    maxThinkingLevel: "max",
    fallbackThinkingLevel: "xhigh",
    confidenceThreshold: 4,
    timeoutMs: 60000
  });
  assert.deepEqual(result.decisionModels.map((model) => model.id), ["jev", "llm", "siliconflow", "cloudflare-jev"]);
  assert.deepEqual(result.decisionModels[0], { id: "jev", provider: "jev", enabled: true, baseUrl: "https://jev.example.test", apiKey: "key" });
  assert.deepEqual(result.decisionModels[3], { id: "cloudflare-jev", provider: "cloudflare", enabled: true, accountId: "account-123", apiToken: "cf-token" });
  assert.equal(result.selectedDecisionModelId, "jev");
  assert.equal(result.defaultStrategy, "auto");
  assert.equal(result.maxThinkingLevel, "high");
  assert.equal(result.fallbackThinkingLevel, "medium");
  assert.equal(result.confidenceThreshold, 1);
  assert.equal(result.timeoutMs, 5000);
});

test("decision model sanitizer rejects unsafe Jev Hosts and deduplicates provider entries", () => {
  const result = sanitizeAdaptiveThinkingSettings({
    decisionModels: [
      { id: "jev", provider: "jev", baseUrl: "https://user:pass@example.test", apiKey: "secret" },
      { id: "jev", provider: "jev", baseUrl: "https://ignored.example", apiKey: "ignored" },
      { id: "llm", provider: "llm", llmModelKey: " model-key " },
      { id: "cloudflare-jev", provider: "cloudflare", accountId: "acct-a", apiToken: "secret" },
      { id: "cloudflare-jev", provider: "cloudflare", accountId: "ignored", apiToken: "ignored" }
    ],
    selectedDecisionModelId: "llm"
  });
  assert.deepEqual(result.decisionModels.map((model) => model.id), ["jev", "llm", "siliconflow", "cloudflare-jev"]);
  assert.equal(result.decisionModels[0]?.provider === "jev" ? result.decisionModels[0].baseUrl : "", defaultJevBaseUrl);
  assert.equal(result.decisionModels[1]?.provider === "llm" ? result.decisionModels[1].llmModelKey : "", "model-key");
  assert.equal(result.decisionModels[3]?.provider === "cloudflare" ? result.decisionModels[3].accountId : "", "acct-a");
  assert.equal(result.selectedDecisionModelId, "llm");
  const invalidQuery = sanitizeAdaptiveThinkingSettings({
    decisionModels: [{ id: "jev", provider: "jev", baseUrl: "https://example.test/?token=secret", apiKey: "key" }]
  });
  assert.equal(invalidQuery.decisionModels[0]?.provider === "jev" ? invalidQuery.decisionModels[0].baseUrl : "", defaultJevBaseUrl);
});

test("the first configured SiliconFlow entry is the fixed third model", () => {
  const configured = { id: "siliconflow-1", provider: "siliconflow", enabled: true, baseUrl: "https://api.siliconflow.cn", modelId: "diffusiongemma", apiKey: "secret" };
  const result = sanitizeAdaptiveThinkingSettings({
    decisionModels: [
      { id: "siliconflow", provider: "siliconflow", enabled: false, baseUrl: "https://api.siliconflow.cn", modelId: "", apiKey: "" },
      configured,
      { id: "siliconflow-2", provider: "siliconflow", enabled: true, baseUrl: "https://api.siliconflow.cn", modelId: "Kev-4b", apiKey: "second" }
    ],
    selectedDecisionModelId: "siliconflow-1"
  });
  assert.deepEqual(result.decisionModels.map((model) => model.id), ["jev", "llm", "siliconflow-1", "siliconflow-2"]);
  assert.deepEqual(result.decisionModels[2], configured);
  assert.equal(result.selectedDecisionModelId, "siliconflow-1");
});

test("adaptive thinking keeps fallback levels within the supported auto set", () => {
  const result = sanitizeAdaptiveThinkingSettings({
    ...defaultRuntimeSettings.adaptiveThinking,
    maxThinkingLevel: "high",
    fallbackThinkingLevel: "off"
  });
  assert.equal(result.fallbackThinkingLevel, "medium");
});

test("decision model collection and selection round-trip through a fresh SettingsStore", () => {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-decision-models-"));
  const originalSettingsFile = storagePaths.settingsFile;
  const originalSettingsDbFile = storagePaths.settingsDbFile;
  storagePaths.settingsFile = path.join(root, "settings.json");
  storagePaths.settingsDbFile = path.join(root, "settings.sqlite");
  try {
    const adaptiveThinking = {
      ...defaultRuntimeSettings.adaptiveThinking,
      enabled: true,
      decisionModels: [
        { id: "jev" as const, provider: "jev" as const, enabled: true, baseUrl: "https://jev.example.test/proxy", apiKey: "secret-key" },
        { id: "llm" as const, provider: "llm" as const, enabled: false, llmModelKey: "pi|openai|gpt-test" },
        { id: "siliconflow", provider: "siliconflow" as const, enabled: true, baseUrl: "https://api.siliconflow.cn", modelId: "diffusiongemma", apiKey: "sf-secret" },
        { id: "cloudflare-jev" as const, provider: "cloudflare" as const, enabled: false, accountId: "cf-account", apiToken: "cf-secret" },
        { id: "custom-jev-1", provider: "custom-jev" as const, enabled: true, name: "My Jev", baseUrl: "https://custom.example.test/proxy", modelId: "my-model", apiKey: "custom-secret" }
      ],
      selectedDecisionModelId: "custom-jev-1",
      defaultStrategy: "auto" as const,
      maxThinkingLevel: "medium" as const,
      fallbackThinkingLevel: "low" as const,
      confidenceThreshold: 0.73,
      timeoutMs: 1800
    };
    new SettingsStore().save({ ...defaultRuntimeSettings, adaptiveThinking });
    const loaded = new SettingsStore().load();
    assert.deepEqual(loaded.adaptiveThinking, adaptiveThinking);

    const oldSiliconFlow = { id: "siliconflow-1", provider: "siliconflow" as const, enabled: true, baseUrl: "https://api.siliconflow.cn", modelId: "diffusiongemma", apiKey: "saved-key" };
    new SettingsStore().save({
      ...loaded,
      adaptiveThinking: {
        ...loaded.adaptiveThinking,
        decisionModels: [
          { id: "jev", provider: "jev", enabled: false, baseUrl: "https://api.typesafe.ai", apiKey: "" },
          { id: "llm", provider: "llm", enabled: false, llmModelKey: "" },
          { id: "siliconflow", provider: "siliconflow", enabled: false, baseUrl: "https://api.siliconflow.cn", modelId: "", apiKey: "" },
          oldSiliconFlow
        ],
        selectedDecisionModelId: "siliconflow-1"
      }
    });
    const reloaded = new SettingsStore().load().adaptiveThinking;
    assert.deepEqual(reloaded.decisionModels.map((model) => model.id), ["jev", "llm", "siliconflow-1"]);
    assert.deepEqual(reloaded.decisionModels[2], oldSiliconFlow);
    assert.equal(reloaded.selectedDecisionModelId, "siliconflow-1");
  } finally {
    storagePaths.settingsFile = originalSettingsFile;
    storagePaths.settingsDbFile = originalSettingsDbFile;
    rmSync(root, { recursive: true, force: true });
  }
});
