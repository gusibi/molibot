import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { TurnOrchestrator, type TurnDecisionPolicy } from "./turnOrchestrator.js";

const policy: TurnDecisionPolicy = {
  strategy: "auto",
  fixedLevel: "medium",
  enabled: true,
  selectedDecisionModelId: "jev",
  maxThinkingLevel: "high",
  fallbackThinkingLevel: "low",
  confidenceThreshold: 0.6,
  timeoutMs: 1000
};

test("a logical Turn keeps its policy and resolved decision across a fresh store", () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-turn-decision-"));
  const path = join(directory, "settings.sqlite");
  try {
    const first = new TurnOrchestrator(undefined, path);
    assert.deepEqual(first.beginTurnDecision("turn-1", policy), { state: "pending", policy });
    first.markTurnDecisionDispatched("turn-1");
    first.commitTurnDecision("turn-1", {
      strategy: "auto", requestedLevel: "high", confidence: 0.9,
      provider: "typesafe", model: "jev-latest", latencyMs: 42
    });
    first.close();

    const restarted = new TurnOrchestrator(undefined, path);
    const changedPolicy = { ...policy, maxThinkingLevel: "low" as const, fallbackThinkingLevel: "medium" as const };
    assert.deepEqual(restarted.beginTurnDecision("turn-1", changedPolicy), {
      state: "resolved", policy,
      resolution: { strategy: "auto", requestedLevel: "high", confidence: 0.9, provider: "typesafe", model: "jev-latest", latencyMs: 42 }
    });
    restarted.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an unresolved dispatched decision remains identifiable after restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-turn-decision-"));
  const path = join(directory, "settings.sqlite");
  try {
    const first = new TurnOrchestrator(undefined, path);
    first.beginTurnDecision("turn-2", policy);
    first.markTurnDecisionDispatched("turn-2");
    first.close();

    const restarted = new TurnOrchestrator(undefined, path);
    assert.deepEqual(restarted.getTurnDecision("turn-2"), { state: "dispatched", policy });
    restarted.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("admission preserves strategy precedence and the connection destination without credentials", async () => {
  const { defaultRuntimeSettings } = await import("$lib/server/settings/defaults.js");
  const { resolveTurnDecisionPolicy, resolveTurnAdaptiveSettings } = await import("./turnOrchestrator.js");
  const settings = structuredClone(defaultRuntimeSettings);
  settings.adaptiveThinking.defaultStrategy = "auto";
  settings.adaptiveThinking.decisionModels = [{ id: "jev", provider: "jev", baseUrl: "https://original.example", apiKey: "old-secret" }];
  settings.adaptiveThinking.selectedDecisionModelId = "jev";
  assert.equal(resolveTurnDecisionPolicy(settings).strategy, "auto");
  assert.equal(resolveTurnDecisionPolicy(settings, { project: "high" }).source, "project");
  assert.equal(resolveTurnDecisionPolicy(settings, { project: "high", session: "off" }).fixedLevel, "off");
  assert.equal(resolveTurnDecisionPolicy(settings, { project: "high", session: "off", request: "auto" }).source, "request");
  const unconfigured = resolveTurnDecisionPolicy({ ...settings, adaptiveThinking: { ...settings.adaptiveThinking, decisionModels: [] } });
  assert.deepEqual(resolveTurnAdaptiveSettings(settings, unconfigured).decisionModels, []);
  const admitted = resolveTurnDecisionPolicy(settings, { session: "auto" });
  assert.ok(!JSON.stringify(admitted).includes("old-secret"));
  settings.adaptiveThinking.decisionModels[0] = { id: "jev", provider: "jev", enabled: false, baseUrl: "https://original.example", apiKey: "rotated-secret" };
  const rotated = resolveTurnAdaptiveSettings(settings, admitted);
  assert.equal(rotated.decisionModels[0].enabled, undefined);
  assert.equal((rotated.decisionModels[0] as { apiKey: string }).apiKey, "rotated-secret");
  settings.adaptiveThinking.decisionModels[0] = { id: "jev", provider: "jev", baseUrl: "https://new.example", apiKey: "new-destination-secret" };
  const changed = resolveTurnAdaptiveSettings(settings, admitted);
  assert.equal((changed.decisionModels[0] as { baseUrl: string }).baseUrl, "https://original.example");
  assert.equal((changed.decisionModels[0] as { apiKey: string }).apiKey, "");
});

test("queued LLM decision keeps the referenced text model destination across a fresh store", async () => {
  const { defaultRuntimeSettings } = await import("$lib/server/settings/defaults.js");
  const { resolveTurnDecisionPolicy, resolveTurnAdaptiveSettings } = await import("./turnOrchestrator.js");
  const settings = structuredClone(defaultRuntimeSettings);
  settings.providerMode = "custom";
  settings.defaultCustomProviderId = "decision-text";
  settings.customProviders = [{ id: "decision-text", name: "Decision text", enabled: true,
    protocol: "openai-compatible", baseUrl: "https://host-a.example/v1?target=A&api_key=query-secret", apiKey: "server-only-key", path: "/chat/completions",
    defaultModel: "decision-model", models: [{ id: "decision-model", enabled: true, tags: ["text"],
      supportedRoles: ["system", "user", "assistant", "tool", "developer"] }] }];
  settings.adaptiveThinking = { ...settings.adaptiveThinking, enabled: true, selectedDecisionModelId: "llm",
    decisionModels: [{ id: "llm", provider: "llm", llmModelKey: "custom|decision-text|decision-model" }] };
  const directory = mkdtempSync(join(tmpdir(), "molibot-llm-admission-"));
  const database = join(directory, "decisions.sqlite");
  try {
    const first = new TurnOrchestrator(undefined, database);
    first.beginTurnDecision("queued-llm", resolveTurnDecisionPolicy(settings, { session: "auto" }));
    first.close();
    const recovered = new TurnOrchestrator(undefined, database);
    const policy = recovered.getTurnDecision("queued-llm")!.policy;
    assert.equal(policy.llmDecisionModel?.baseUrl, "https://host-a.example/v1");
    assert.ok(!JSON.stringify(policy).includes("server-only-key"));
    assert.ok(!JSON.stringify(policy).includes("query-secret"));
    assert.ok(!JSON.stringify(policy).includes("target=A"));
    const restoredSettings = JSON.parse(JSON.stringify(settings));
    restoredSettings.adaptiveThinking.decisionModels[0] = { llmModelKey: "custom|decision-text|decision-model", provider: "llm", id: "llm" };
    assert.equal((resolveTurnAdaptiveSettings(restoredSettings, policy).decisionModels[0] as { llmModelKey: string }).llmModelKey,
      "custom|decision-text|decision-model");
    settings.customProviders[0].baseUrl = "https://host-a.example/v1?target=B&api_key=query-secret";
    assert.equal((resolveTurnAdaptiveSettings(settings, policy).decisionModels[0] as { llmModelKey: string }).llmModelKey, "");
    settings.customProviders[0].baseUrl = "https://host-b.example/v1";
    assert.equal((resolveTurnAdaptiveSettings(settings, policy).decisionModels[0] as { llmModelKey: string }).llmModelKey, "");
    recovered.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
