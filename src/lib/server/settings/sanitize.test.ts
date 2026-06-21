import assert from "node:assert/strict";
import test from "node:test";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";
import { sanitizeMcpServers, sanitizeSettings } from "$lib/server/settings/sanitize.js";
import type { RuntimeSettings } from "$lib/server/settings/schema.js";

test("sanitizeSettings backfills imageGenerate for legacy settings", () => {
  const legacySettings = { ...defaultRuntimeSettings } as Partial<RuntimeSettings>;
  delete legacySettings.imageGenerate;

  const sanitized = sanitizeSettings({}, legacySettings as RuntimeSettings);

  assert.equal(sanitized.imageGenerate.enabled, defaultRuntimeSettings.imageGenerate.enabled);
  assert.equal(sanitized.imageGenerate.defaultEngine, defaultRuntimeSettings.imageGenerate.defaultEngine);
  assert.deepEqual(Object.keys(sanitized.imageGenerate.engines).sort(), ["agnes", "google", "modelscope", "openai", "openai-chat", "volcengine"]);
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

test("sanitizeSettings backfills ttsGenerate for legacy settings", () => {
  const legacySettings = { ...defaultRuntimeSettings } as Partial<RuntimeSettings>;
  delete legacySettings.ttsGenerate;

  const sanitized = sanitizeSettings({}, legacySettings as RuntimeSettings);

  assert.equal(sanitized.ttsGenerate.enabled, defaultRuntimeSettings.ttsGenerate.enabled);
  assert.equal(sanitized.ttsGenerate.defaultProvider, "macos");
  assert.deepEqual(Object.keys(sanitized.ttsGenerate.providers).sort(), ["macos", "xiaomi"]);
  assert.equal(sanitized.ttsGenerate.providers.xiaomi.model, "mimo-v2-tts");
  assert.equal(sanitized.ttsGenerate.providers.xiaomi.voice, "mimo_default");
});

test("sanitizeSettings normalizes ttsGenerate provider fields", () => {
  const sanitized = sanitizeSettings({
    ttsGenerate: {
      enabled: true,
      defaultProvider: "invalid-provider",
      providers: {
        macos: {
          enabled: "",
          voice: "  Tingting  "
        },
        xiaomi: {
          enabled: true,
          apiKey: "  secret-key  ",
          baseUrl: "  https://api.xiaomimimo.com/v1/  ",
          model: "  mimo-v2-tts  ",
          voice: "  default_zh  ",
          format: "  wav  "
        }
      }
    }
  }, defaultRuntimeSettings);

  assert.equal(sanitized.ttsGenerate.enabled, true);
  assert.equal(sanitized.ttsGenerate.defaultProvider, defaultRuntimeSettings.ttsGenerate.defaultProvider);
  assert.equal(sanitized.ttsGenerate.providers.macos.enabled, false);
  assert.equal(sanitized.ttsGenerate.providers.macos.voice, "Tingting");
  assert.equal(sanitized.ttsGenerate.providers.xiaomi.enabled, true);
  assert.equal(sanitized.ttsGenerate.providers.xiaomi.apiKey, "secret-key");
  assert.equal(sanitized.ttsGenerate.providers.xiaomi.baseUrl, "https://api.xiaomimimo.com/v1");
  assert.equal(sanitized.ttsGenerate.providers.xiaomi.model, "mimo-v2-tts");
  assert.equal(sanitized.ttsGenerate.providers.xiaomi.voice, "default_zh");
  assert.equal(sanitized.ttsGenerate.providers.xiaomi.format, "wav");
});

test("sanitizeSettings only accepts supported runtime locales", () => {
  assert.equal(sanitizeSettings({ locale: "zh-CN" }, defaultRuntimeSettings).locale, "zh-CN");
  assert.equal(
    sanitizeSettings({ locale: "fr-FR" as RuntimeSettings["locale"] }, defaultRuntimeSettings).locale,
    "en-US"
  );
});

test("sanitizeMcpServers infers http transport from url and keeps top-level headers", () => {
  const servers = sanitizeMcpServers({
    tdx: {
      url: " https://mcp.tdx.com.cn:3001/mcp ",
      headers: {
        "tdx-api-key": " 您的密钥 "
      },
      enabled: false
    }
  });

  assert.equal(servers.length, 1);
  assert.equal(servers[0]?.id, "tdx");
  assert.equal(servers[0]?.enabled, false);
  assert.equal(servers[0]?.transport, "http");
  assert.equal(servers[0]?.http.url, "https://mcp.tdx.com.cn:3001/mcp");
  assert.deepEqual(servers[0]?.http.headers, { "tdx-api-key": "您的密钥" });
});
