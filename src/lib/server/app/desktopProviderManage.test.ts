import assert from "node:assert/strict";
import test from "node:test";
import type { CustomProviderConfig, RuntimeSettings } from "$lib/server/settings/schema";
import type { DesktopProviderUpdateRequest } from "$lib/shared/desktop";
import {
  buildProviderDeletePatch,
  buildProviderGlobalsPatch,
  buildProviderUpdatePatch,
  buildUpdatedDesktopProvider
} from "./desktopProviderManage";

function provider(id = "p1", overrides: Partial<CustomProviderConfig> = {}): CustomProviderConfig {
  return {
    id,
    name: id,
    enabled: true,
    protocol: "openai-compatible",
    baseUrl: "https://api.example.com/v1",
    apiKey: "sk-existing-secret",
    models: [{ id: "m1", tags: ["text"], supportedRoles: ["system", "user", "assistant", "tool"], enabled: true }],
    defaultModel: "m1",
    path: "/v1/chat/completions",
    ...overrides
  };
}

function request(overrides: Partial<DesktopProviderUpdateRequest> = {}): DesktopProviderUpdateRequest {
  return {
    id: "p1",
    name: "Renamed",
    enabled: true,
    protocol: "anthropic",
    baseUrl: "https://api.anthropic.com/",
    models: [
      { id: "claude", tags: ["text", "vision"], supportedRoles: ["system", "user", "assistant", "tool"], contextWindow: 200000, enabled: true, verification: {} }
    ],
    defaultModel: "claude",
    path: "",
    supportsThinking: true,
    thinkingFormat: "anthropic",
    reasoningEffortMap: { low: "1024", high: "8192" },
    ...overrides
  };
}

test("provider update preserves a saved key when no replacement is supplied", () => {
  const updated = buildUpdatedDesktopProvider(provider(), request());
  assert.equal(updated.apiKey, "sk-existing-secret");
  assert.equal(updated.protocol, "anthropic");
  assert.equal(updated.baseUrl, "https://api.anthropic.com");
  assert.equal(updated.path, "/v1/messages");
  assert.equal(updated.defaultModel, "claude");
  assert.equal(updated.models[0].contextWindow, 200000);
  assert.deepEqual(updated.reasoningEffortMap, { low: "1024", high: "8192" });
});

test("provider update can replace or explicitly clear a key", () => {
  assert.equal(buildUpdatedDesktopProvider(provider(), request({ apiKey: "sk-new" })).apiKey, "sk-new");
  assert.equal(buildUpdatedDesktopProvider(provider(), request({ clearApiKey: true })).apiKey, "");
});

test("provider patch changes only the selected provider and repairs a disabled default", () => {
  const settings = {
    customProviders: [provider("p1"), provider("p2")],
    defaultCustomProviderId: "p1"
  } as RuntimeSettings;
  const patch = buildProviderUpdatePatch(settings, request({ enabled: false }));
  assert.equal(patch.customProviders[0].enabled, false);
  assert.equal(patch.customProviders[1].apiKey, "sk-existing-secret");
  assert.equal(patch.defaultCustomProviderId, "p2");
});

test("provider delete removes one row and repairs the default", () => {
  const settings = {
    customProviders: [provider("p1"), provider("p2")],
    defaultCustomProviderId: "p1"
  } as RuntimeSettings;
  const patch = buildProviderDeletePatch(settings, "p1");
  assert.deepEqual(patch.customProviders.map((row) => row.id), ["p2"]);
  assert.equal(patch.defaultCustomProviderId, "p2");
});

test("provider globals accept only an enabled configured default", () => {
  const settings = {
    customProviders: [provider("p1", { enabled: false }), provider("p2")]
  } as RuntimeSettings;
  const patch = buildProviderGlobalsPatch(settings, {
    providerMode: "custom",
    piProvider: "anthropic",
    piModel: "claude-sonnet",
    defaultCustomProviderId: "p1"
  });
  assert.equal(patch.providerMode, "custom");
  assert.equal(patch.defaultCustomProviderId, "p2");
});
