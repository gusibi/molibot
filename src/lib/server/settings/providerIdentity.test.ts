import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { isDeepStrictEqual } from "node:util";
import { buildDesktopProvidersSummary } from "$lib/server/app/desktopProviders.js";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { upsertCustomProvider } from "./handlers/customProviders.js";
import { defaultRuntimeSettings } from "./defaults.js";
import { sanitizeSettings } from "./sanitize.js";
import { SettingsStore } from "./store.js";
import type { CustomProviderConfig } from "./schema.js";

function provider(id: string, overrides: Partial<CustomProviderConfig> = {}): CustomProviderConfig {
  return {
    id, name: `[Built-in] ${id}`, enabled: true, protocol: "openai-compatible",
    baseUrl: "", apiKey: "fixture-key", path: "/v1/chat/completions",
    models: [{ id: "fixture-model", tags: ["text"], supportedRoles: ["user"], enabled: true }],
    defaultModel: "fixture-model",
    ...overrides
  };
}

const staleProviders = () => [
  provider("azure-openai-responses"),
  provider("google-antigravity"),
  provider("google-gemini-cli"),
  provider("user-proxy", { name: "User proxy", baseUrl: "https://proxy.example/v1" })
];

test("provider saves remove unsupported built-ins and keep Azure in the built-in rail", () => {
  const settings = sanitizeSettings({
    customProviders: staleProviders(), defaultCustomProviderId: "google-antigravity"
  }, defaultRuntimeSettings);
  assert.deepEqual(settings.customProviders.map(p => p.id), ["azure", "user-proxy"]);
  assert.equal(settings.customProviders[0].apiKey, "fixture-key");
  assert.equal(settings.customProviders[0].name, "[Built-in] azure");
  assert.equal(settings.defaultCustomProviderId, "user-proxy");

  const summary = buildDesktopProvidersSummary(settings);
  const builtinIds = new Set(summary.builtinProviders.map(p => p.id));
  assert.ok(builtinIds.has("azure"));
  assert.deepEqual(summary.customProviders.filter(p => !builtinIds.has(p.id)).map(p => p.id), ["user-proxy"]);
  assert.equal(JSON.stringify(summary).includes("fixture-key"), false);
});

test("the current Azure config wins over its obsolete duplicate in either order", () => {
  const old = provider("azure-openai-responses");
  const current = provider("azure", { name: "Configured Azure", apiKey: "current-fixture-key" });
  for (const rows of [[old, current], [current, old]]) {
    const settings = sanitizeSettings({ customProviders: rows }, defaultRuntimeSettings);
    assert.equal(settings.customProviders.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(settings.customProviders[0])), JSON.parse(JSON.stringify(current)));
  }
});

test("single-provider saves return the canonical identity and reject removed providers before writing", () => {
  let settings = structuredClone(defaultRuntimeSettings);
  let writes = 0;
  const runtime = {
    getSettings: () => settings,
    updateSettings: (patch: Partial<typeof settings>) => {
      writes++;
      settings = sanitizeSettings(patch, settings);
      return settings;
    }
  };
  const { saved } = upsertCustomProvider(runtime, provider("azure-openai-responses"));
  assert.equal(saved.id, "azure");
  assert.equal(saved.apiKey, "fixture-key");
  assert.equal(writes, 1);
  for (const id of ["google-antigravity", "google-gemini-cli"]) {
    assert.throws(() => upsertCustomProvider(runtime, provider(id)), /no longer supported/);
  }
  assert.equal(writes, 1);
  assert.deepEqual(settings.customProviders.map(p => p.id), ["azure"]);
});

test("a fresh settings store removes stale provider identities and round-trips the entire settings object", () => {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-provider-identity-"));
  const originals = { ...storagePaths };
  storagePaths.settingsFile = path.join(root, "settings.json");
  storagePaths.settingsDbFile = path.join(root, "settings.sqlite");
  try {
    const store = new SettingsStore();
    const before = store.load();
    store.save({ ...before, customProviders: staleProviders(), defaultCustomProviderId: "google-gemini-cli" });
    const expected = sanitizeSettings({
      customProviders: [provider("azure"), staleProviders()[3]], defaultCustomProviderId: "user-proxy"
    }, before);
    const loaded = new SettingsStore().load();
    assert.deepEqual(loaded.customProviders.map(p => p.id), ["azure", "user-proxy"]);
    const matches = (value: unknown) => isDeepStrictEqual(JSON.parse(JSON.stringify(value)), JSON.parse(JSON.stringify(expected)));
    assert.equal(matches(loaded), true, "entire settings object survives the first load");
    assert.equal(matches(new SettingsStore().load()), true, "entire settings object survives the second load");
  } finally {
    Object.assign(storagePaths, originals);
    rmSync(root, { recursive: true, force: true });
  }
});
