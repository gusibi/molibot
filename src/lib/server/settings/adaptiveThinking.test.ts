import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";
import { sanitizeAdaptiveThinkingSettings } from "$lib/server/settings/sanitize.js";
import { SettingsStore } from "$lib/server/settings/store.js";
import { storagePaths } from "$lib/server/infra/db/storage.js";

test("adaptive thinking sanitizes unsafe values and keeps the auto policy bounded", () => {
  const result = sanitizeAdaptiveThinkingSettings({
    enabled: true,
    baseUrl: "https://jev.example.test///",
    apiKey: " key ",
    defaultStrategy: "auto",
    maxThinkingLevel: "max",
    fallbackThinkingLevel: "xhigh",
    confidenceThreshold: 4,
    timeoutMs: 60000
  });
  assert.deepEqual(result, {
    enabled: true,
    baseUrl: "https://jev.example.test",
    apiKey: "key",
    defaultStrategy: "auto",
    maxThinkingLevel: "high",
    fallbackThinkingLevel: "medium",
    confidenceThreshold: 1,
    timeoutMs: 5000
  });
});

test("adaptive thinking rejects embedded credentials and normalizes the endpoint suffix", () => {
  const result = sanitizeAdaptiveThinkingSettings({
    baseUrl: "https://api.typesafe.ai/proxy/v1/systemone/"
  });
  assert.equal(result.baseUrl, "https://api.typesafe.ai/proxy");
  assert.equal(
    sanitizeAdaptiveThinkingSettings({ baseUrl: "https://user:pass@example.test" }).baseUrl,
    defaultRuntimeSettings.adaptiveThinking.baseUrl
  );
  assert.equal(
    sanitizeAdaptiveThinkingSettings({ baseUrl: "https://example.test/?token=secret" }).baseUrl,
    defaultRuntimeSettings.adaptiveThinking.baseUrl
  );
});

test("adaptive thinking keeps fallback levels within the supported auto set", () => {
  const result = sanitizeAdaptiveThinkingSettings({
    ...defaultRuntimeSettings.adaptiveThinking,
    maxThinkingLevel: "high",
    fallbackThinkingLevel: "off"
  });
  assert.equal(result.fallbackThinkingLevel, "medium");
});

test("adaptive thinking settings round-trip through a fresh SettingsStore", () => {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-adaptive-thinking-"));
  const originalSettingsFile = storagePaths.settingsFile;
  const originalSettingsDbFile = storagePaths.settingsDbFile;
  storagePaths.settingsFile = path.join(root, "settings.json");
  storagePaths.settingsDbFile = path.join(root, "settings.sqlite");
  try {
    const adaptiveThinking = {
      ...defaultRuntimeSettings.adaptiveThinking,
      enabled: true,
      baseUrl: "https://jev.example.test/proxy",
      apiKey: "secret-key",
      defaultStrategy: "auto" as const,
      maxThinkingLevel: "medium" as const,
      fallbackThinkingLevel: "low" as const,
      confidenceThreshold: 0.73,
      timeoutMs: 1800
    };
    new SettingsStore().save({ ...defaultRuntimeSettings, adaptiveThinking });
    const loaded = new SettingsStore().load();
    assert.deepEqual(loaded.adaptiveThinking, adaptiveThinking);
  } finally {
    storagePaths.settingsFile = originalSettingsFile;
    storagePaths.settingsDbFile = originalSettingsDbFile;
    rmSync(root, { recursive: true, force: true });
  }
});
