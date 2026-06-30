import assert from "node:assert/strict";
import test from "node:test";
import type { CustomProviderConfig, RuntimeSettings } from "$lib/server/settings/schema";
import {
  buildDesktopProviderItem,
  buildDesktopProvidersSummary
} from "./desktopProviders";

function provider(overrides: Partial<CustomProviderConfig> = {}): CustomProviderConfig {
  return {
    id: "openrouter",
    name: "OpenRouter",
    enabled: true,
    protocol: "openai-compatible",
    baseUrl: "https://openrouter.ai/api",
    apiKey: "sk-super-secret-key-1234567890",
    models: [
      { id: "gpt-4o", tags: [], supportedRoles: [], enabled: true },
      { id: "claude-3", tags: [], supportedRoles: [], enabled: true }
    ],
    defaultModel: "gpt-4o",
    path: "",
    ...overrides
  } as CustomProviderConfig;
}

function settings(overrides: Partial<RuntimeSettings> = {}): RuntimeSettings {
  return {
    providerMode: "custom",
    piModelProvider: "anthropic",
    piModelName: "claude-sonnet-4-6",
    defaultCustomProviderId: "openrouter",
    customProviders: [provider()],
    ...overrides
  } as RuntimeSettings;
}

test("buildDesktopProviderItem drops apiKey but keeps identity, endpoint, and model count", () => {
  const item = buildDesktopProviderItem(provider(), "openrouter");

  assert.equal(item.id, "openrouter");
  assert.equal(item.name, "OpenRouter");
  assert.equal(item.enabled, true);
  assert.equal(item.isDefault, true);
  assert.equal(item.protocol, "openai-compatible");
  assert.equal(item.baseUrl, "https://openrouter.ai/api");
  assert.equal(item.hasApiKey, true);
  assert.equal(item.modelCount, 2);
  assert.equal(item.defaultModel, "gpt-4o");
  assert.equal(item.models.length, 2);
  assert.equal(item.models[0].id, "gpt-4o");
  assert.equal(item.path, "");
  assert.equal(item.supportsThinking, null);
  assert.equal(item.thinkingFormat, null);

  const serialized = JSON.stringify(item);
  assert.equal(serialized.includes("sk-super-secret-key"), false);
  assert.equal(serialized.includes("apiKey"), false);
});

test("buildDesktopProviderItem reports a missing api key and non-default provider", () => {
  const item = buildDesktopProviderItem(
    provider({ id: "local", apiKey: "   ", enabled: false, protocol: "anthropic" }),
    "openrouter"
  );

  assert.equal(item.hasApiKey, false);
  assert.equal(item.enabled, false);
  assert.equal(item.isDefault, false);
  assert.equal(item.protocol, "anthropic");
});

test("buildDesktopProvidersSummary maps mode + pi model and never leaks a key", () => {
  const summary = buildDesktopProvidersSummary(settings());

  assert.equal(summary.providerMode, "custom");
  assert.equal(summary.piProvider, "anthropic");
  assert.equal(summary.piModel, "claude-sonnet-4-6");
  assert.equal(summary.defaultCustomProviderId, "openrouter");
  assert.equal(summary.customProviders.length, 1);
  assert.ok(summary.builtinProviders.length > 0);
  assert.ok(summary.builtinProviders.every((provider) => Array.isArray(provider.models)));
  assert.equal(JSON.stringify(summary).includes("sk-super-secret-key"), false);
});
