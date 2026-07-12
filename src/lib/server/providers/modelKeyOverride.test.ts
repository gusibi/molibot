import test from "node:test";
import assert from "node:assert/strict";
import { overrideSettingsForModelKey } from "./assistantService.js";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";

test("empty or malformed model key leaves settings untouched", () => {
  const base = structuredClone(defaultRuntimeSettings);
  assert.equal(overrideSettingsForModelKey(base, ""), base);
  assert.equal(overrideSettingsForModelKey(base, undefined), base);
  assert.equal(overrideSettingsForModelKey(base, "garbage"), base);
  assert.equal(overrideSettingsForModelKey(base, "pi|onlyprovider"), base);
});

test("pi model key forces provider mode and model", () => {
  const base = structuredClone(defaultRuntimeSettings);
  const next = overrideSettingsForModelKey(base, "pi|anthropic|claude-haiku-4-5");
  assert.equal(next.providerMode, "pi");
  assert.equal(next.piModelProvider, "anthropic");
  assert.equal(next.piModelName, "claude-haiku-4-5");
  // original untouched
  assert.notEqual(next, base);
});

test("custom model key selects the provider and overrides its default model", () => {
  const base = structuredClone(defaultRuntimeSettings);
  base.customProviders = [
    { id: "cheap", name: "Cheap", enabled: true, baseUrl: "https://x", apiKey: "k", models: [{ id: "small-a", tags: ["text"] }, { id: "small-b", tags: ["text"] }], defaultModel: "small-a", path: "" } as (typeof base.customProviders)[number]
  ];
  const next = overrideSettingsForModelKey(base, "custom|cheap|small-b");
  assert.equal(next.providerMode, "custom");
  assert.equal(next.defaultCustomProviderId, "cheap");
  assert.equal(next.customProviders.find((p) => p.id === "cheap")?.defaultModel, "small-b");
  // other providers (none here) and base object are untouched
  assert.equal(base.customProviders[0].defaultModel, "small-a");
});
