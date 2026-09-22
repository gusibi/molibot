import assert from "node:assert/strict";
import test from "node:test";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";
import {
  buildAdaptiveThinkingContext,
  resolveAdaptiveThinking,
  resolveAutoEffectiveThinkingLevel,
  TypeSafeJevProvider,
  type DecisionProvider
} from "$lib/server/agent/decision/adaptiveThinking.js";

const settings = () => structuredClone(defaultRuntimeSettings.adaptiveThinking);

function provider(result: Parameters<DecisionProvider["decide"]>[0] extends never ? never : Awaited<ReturnType<DecisionProvider["decide"]>>): DecisionProvider {
  return {
    async decide() {
      return result;
    },
    async testConnection() {
      return { provider: "typesafe", model: "jev-test" };
    }
  };
}

test("Auto resolution accepts a valid confident Choice", async () => {
  const result = await resolveAdaptiveThinking({
    strategy: "auto",
    fixedLevel: "off",
    settings: { ...settings(), enabled: true, apiKey: "secret" },
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
    settings: { ...settings(), enabled: true, apiKey: "secret", fallbackThinkingLevel: "medium", confidenceThreshold: 0.7 },
    context: buildAdaptiveThinkingContext("Continue."),
    provider: provider({ level: "low", confidence: 0.5 }),
    signal: new AbortController().signal
  });
  assert.equal(low.requestedLevel, "medium");
  assert.equal(low.fallbackReason, "low_confidence");

  const failed: DecisionProvider = {
    async decide() {
      throw new Error("network down");
    },
    async testConnection() {
      return {};
    }
  };
  const error = await resolveAdaptiveThinking({
    strategy: "auto",
    fixedLevel: "off",
    settings: { ...settings(), enabled: true, apiKey: "secret" },
    context: buildAdaptiveThinkingContext("Continue."),
    provider: failed,
    signal: new AbortController().signal
  });
  assert.equal(error.fallbackReason, "network_error");
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
    },
    async testConnection() {
      return {};
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

test("A provider result that arrives after the deadline is ignored", async () => {
  const slow: DecisionProvider = {
    async decide() {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return { level: "high", confidence: 1 };
    },
    async testConnection() {
      return {};
    }
  };
  const result = await resolveAdaptiveThinking({
    strategy: "auto",
    fixedLevel: "off",
    settings: { ...settings(), enabled: true, apiKey: "secret", timeoutMs: 5, fallbackThinkingLevel: "medium" },
    context: buildAdaptiveThinkingContext("slow"),
    provider: slow,
    signal: new AbortController().signal
  });
  assert.equal(result.requestedLevel, "medium");
  assert.equal(result.fallbackReason, "timeout");
});

test("Jev adapter rejects unsafe unsaved Hosts before making a request", async () => {
  await assert.rejects(
    () => new TypeSafeJevProvider().testConnection({
      baseUrl: "https://user:pass@example.test/?token=secret",
      apiKey: "secret",
      signal: new AbortController().signal
    }),
    /invalid_configuration/
  );
});
