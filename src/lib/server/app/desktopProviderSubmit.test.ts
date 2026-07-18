import assert from "node:assert/strict";
import test from "node:test";
import type { DesktopProviderCreateRequest } from "$lib/shared/desktop";
import { buildNewCustomProvider, desktopProviderCreatePolicy } from "./desktopProviderSubmit";

function request(overrides: Partial<DesktopProviderCreateRequest> = {}): DesktopProviderCreateRequest {
  return {
    id: "test-provider",
    name: "  Test Provider  ",
    enabled: true,
    protocol: "openai-compatible",
    baseUrl: "https://api.example.com/v1/",
    apiKey: "sk-test-key-123",
    models: [{ id: "  gpt-4o  ", tags: ["text"], supportedRoles: ["system", "user", "assistant", "tool"], enabled: true, verification: {} }],
    defaultModel: "gpt-4o",
    path: "",
    supportsThinking: null,
    thinkingFormat: null,
    reasoningEffortMap: {},
    ...overrides
  };
}

test("built-in provider creation keeps Pi routing and does not require a custom endpoint", () => {
  assert.deepEqual(desktopProviderCreatePolicy("openai"), {
    builtin: true,
    requiresEndpointCredentials: false,
    activateAsDefault: false,
    switchToCustomMode: false
  });
});

test("self-hosted provider creation still requires endpoint credentials and activates custom mode", () => {
  assert.deepEqual(desktopProviderCreatePolicy("my-provider"), {
    builtin: false,
    requiresEndpointCredentials: true,
    activateAsDefault: true,
    switchToCustomMode: true
  });
});

test("buildNewCustomProvider builds a valid provider config with all required fields", () => {
  const provider = buildNewCustomProvider(request());

  assert.equal(provider.id, "test-provider");
  assert.equal(provider.name, "Test Provider");
  assert.equal(provider.enabled, true);
  assert.equal(provider.protocol, "openai-compatible");
  assert.equal(provider.baseUrl, "https://api.example.com/v1");
  assert.equal(provider.apiKey, "sk-test-key-123");
  assert.equal(provider.defaultModel, "gpt-4o");
  assert.equal(provider.path, "/v1/chat/completions");
  assert.equal(provider.models.length, 1);
  assert.equal(provider.models[0].id, "gpt-4o");
  assert.deepEqual(provider.models[0].tags, ["text"]);
  assert.equal(provider.models[0].enabled, true);
  assert.deepEqual(provider.models[0].supportedRoles, ["system", "user", "assistant", "tool"]);
});

test("uses the anthropic path for anthropic protocol", () => {
  const provider = buildNewCustomProvider(request({
    id: "anthropic",
    name: "Anthropic Provider",
    protocol: "anthropic",
    baseUrl: "https://api.anthropic.com",
    apiKey: "sk-ant-key",
    models: [{ id: "claude-sonnet-4-20250514", tags: ["text"], supportedRoles: ["system", "user", "assistant", "tool"], enabled: true, verification: {} }],
    defaultModel: "claude-sonnet-4-20250514"
  }));

  assert.equal(provider.protocol, "anthropic");
  assert.equal(provider.path, "/v1/messages");
  assert.equal(provider.baseUrl, "https://api.anthropic.com");
});

test("strips trailing slash from baseUrl", () => {
  const provider = buildNewCustomProvider(request({ baseUrl: "https://api.example.com/" }));

  assert.equal(provider.baseUrl, "https://api.example.com");
});

test("never spreads source — only known fields appear", () => {
  // Add extra properties to the input and verify they don't leak through
  const input = {
    ...request(),
    extraSecret: "should-not-leak",
    someOtherField: 42
  };

  const provider = buildNewCustomProvider(input);
  const serialized = JSON.stringify(provider);
  assert.ok(!serialized.includes("should-not-leak"));
  assert.ok(!serialized.includes("extraSecret"));
  assert.ok(!serialized.includes("someOtherField"));
});

test("keeps the requested id and full model metadata", () => {
  const provider = buildNewCustomProvider(request({
    id: "custom-provider",
    models: [{ id: "vision-model", tags: ["text", "vision"], supportedRoles: ["system", "user", "assistant"], contextWindow: 128000, enabled: true, verification: { vision: "passed" } }],
    defaultModel: "vision-model"
  }));
  assert.equal(provider.id, "custom-provider");
  assert.deepEqual(provider.models[0].tags, ["text", "vision"]);
  assert.equal(provider.models[0].contextWindow, 128000);
  assert.deepEqual(provider.models[0].verification, { vision: "passed" });
});
