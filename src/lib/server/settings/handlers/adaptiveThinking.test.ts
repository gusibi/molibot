import assert from "node:assert/strict";
import test from "node:test";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";
import type { RuntimeSettings } from "$lib/server/settings/schema.js";
import {
  readAdaptiveThinkingConfig,
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

test("adaptive settings projection never exposes the Jev API key", () => {
  const runtime = accessor({
    ...structuredClone(defaultRuntimeSettings),
    adaptiveThinking: { ...defaultRuntimeSettings.adaptiveThinking, apiKey: "secret" }
  });
  const value = readAdaptiveThinkingConfig(runtime);
  assert.equal(value.hasApiKey, true);
  assert.equal("apiKey" in value, false);
  assert.equal(JSON.stringify(value).includes("secret"), false);
});
test("adaptive settings update retains, replaces, and clears credentials", () => {
  const runtime = accessor({
    ...structuredClone(defaultRuntimeSettings),
    adaptiveThinking: { ...defaultRuntimeSettings.adaptiveThinking, apiKey: "old" }
  });
  updateAdaptiveThinkingConfig(runtime, { enabled: true });
  assert.equal(runtime.getSettings().adaptiveThinking.apiKey, "old");
  updateAdaptiveThinkingConfig(runtime, { apiKey: "new" });
  assert.equal(runtime.getSettings().adaptiveThinking.apiKey, "new");
  updateAdaptiveThinkingConfig(runtime, { clearApiKey: true });
  assert.equal(runtime.getSettings().adaptiveThinking.apiKey, "");
});

test("changing a configured Jev Host requires a new key", () => {
  const runtime = accessor({
    ...structuredClone(defaultRuntimeSettings),
    adaptiveThinking: { ...defaultRuntimeSettings.adaptiveThinking, apiKey: "old" }
  });
  assert.throws(
    () => updateAdaptiveThinkingConfig(runtime, { baseUrl: "https://other.example" }),
    /requires entering a new API key/
  );
});
