import assert from "node:assert/strict";
import test from "node:test";
import { OAuthLoginError } from "$lib/server/agent/identity/auth.js";
import { defaultProbeModel, providerAuthError, savedApiKeyOverrideIds } from "$lib/server/app/providerAuthApi.js";

test("provider auth HTTP errors preserve machine codes and use conflict/not-found statuses", () => {
  assert.deepEqual(providerAuthError(new OAuthLoginError("provider_busy", "busy")), {
    status: 409,
    payload: { ok: false, error: "busy", code: "provider_busy" }
  });
  assert.equal(providerAuthError(new OAuthLoginError("session_not_found", "gone")).status, 404);
  assert.equal(providerAuthError(new OAuthLoginError("invalid_answer", "bad")).status, 400);
});

test("unexpected provider auth errors redact credentials before entering an HTTP response", () => {
  const failure = providerAuthError(new Error(
    'request failed: Authorization: Bearer sk-live-secret https://example.test/?api_key=query-secret {"client_secret":"json-secret"}'
  ));

  assert.equal(failure.status, 500);
  assert.doesNotMatch(failure.payload.error, /sk-live-secret|query-secret|json-secret/);
  assert.match(failure.payload.error, /<redacted>/);
});

test("only non-empty saved API keys count as an override that shadows a credential", () => {
  const ids = savedApiKeyOverrideIds({
    customProviders: [
      { id: "anthropic", apiKey: "sk-ant-live" },
      { id: "openai-codex", apiKey: "   " },
      { id: "xai", apiKey: "" },
      { id: "  ", apiKey: "sk-orphan" },
      { id: "github-copilot" }
    ]
  } as any);

  assert.deepEqual([...ids], ["anthropic"]);
});

test("missing provider settings never throw on the status path", () => {
  assert.equal(savedApiKeyOverrideIds({} as any).size, 0);
});

test("the probe defaults to the configured model, not the catalog's first entry", () => {
  const settings = {
    customProviders: [
      { id: "kimi-coding", defaultModel: "kimi-for-coding", models: [{ id: "k3" }, { id: "kimi-for-coding" }] },
      { id: "no-default", defaultModel: "  ", models: [{ id: "disabled", enabled: false }, { id: "usable" }] },
      { id: "empty", defaultModel: "", models: [] }
    ]
  } as any;

  assert.equal(defaultProbeModel(settings, "kimi-coding"), "kimi-for-coding");
  assert.equal(defaultProbeModel(settings, "no-default"), "usable");
  assert.equal(defaultProbeModel(settings, "empty"), undefined);
  assert.equal(defaultProbeModel(settings, "unknown"), undefined);
});
