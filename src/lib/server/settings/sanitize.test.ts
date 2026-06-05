import assert from "node:assert/strict";
import test from "node:test";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";
import { sanitizeSettings } from "$lib/server/settings/sanitize.js";
import type { RuntimeSettings } from "$lib/server/settings/schema.js";

test("sanitizeSettings backfills imageGenerate for legacy settings", () => {
  const legacySettings = { ...defaultRuntimeSettings } as Partial<RuntimeSettings>;
  delete legacySettings.imageGenerate;

  const sanitized = sanitizeSettings({}, legacySettings as RuntimeSettings);

  assert.equal(sanitized.imageGenerate.enabled, defaultRuntimeSettings.imageGenerate.enabled);
  assert.equal(sanitized.imageGenerate.defaultEngine, defaultRuntimeSettings.imageGenerate.defaultEngine);
  assert.deepEqual(Object.keys(sanitized.imageGenerate.engines).sort(), ["agnes", "google", "modelscope", "volcengine"]);
});

test("sanitizeSettings enables configured default image engine when legacy enabled flag is false", () => {
  const settings = {
    ...defaultRuntimeSettings,
    imageGenerate: {
      ...defaultRuntimeSettings.imageGenerate,
      enabled: true,
      defaultEngine: "agnes",
      engines: {
        ...defaultRuntimeSettings.imageGenerate.engines,
        agnes: {
          enabled: false,
          apiKey: "agnes-key",
          baseUrl: "https://apihub.agnes-ai.com"
        }
      }
    }
  } as RuntimeSettings;

  const sanitized = sanitizeSettings({}, settings);

  assert.equal(sanitized.imageGenerate.defaultEngine, "agnes");
  assert.equal(sanitized.imageGenerate.engines.agnes.enabled, true);
  assert.equal(sanitized.imageGenerate.engines.agnes.apiKey, "agnes-key");
});

test("sanitizeSettings only accepts supported runtime locales", () => {
  assert.equal(sanitizeSettings({ locale: "zh-CN" }, defaultRuntimeSettings).locale, "zh-CN");
  assert.equal(
    sanitizeSettings({ locale: "fr-FR" as RuntimeSettings["locale"] }, defaultRuntimeSettings).locale,
    "en-US"
  );
});
