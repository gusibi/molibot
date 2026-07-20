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

test("sanitizeSettings backfills default agent and links default Web profile", () => {
  const legacySettings = {
    ...defaultRuntimeSettings,
    agents: [],
    channels: {
      ...defaultRuntimeSettings.channels,
      web: {
        instances: [{
          id: "default",
          name: "Default Web",
          enabled: true,
          agentId: "",
          credentials: {},
          allowedChatIds: []
        }]
      }
    }
  } as RuntimeSettings;

  const sanitized = sanitizeSettings({}, legacySettings);

  assert.equal(sanitized.agents.length, 1);
  assert.equal(sanitized.agents[0]?.id, "default");
  assert.equal(sanitized.agents[0]?.name, "Momo");
  assert.equal(sanitized.channels.web.instances[0]?.agentId, "default");
});

test("sanitizeSettings renames only the legacy Default placeholder to Momo", () => {
  const legacy = sanitizeSettings({
    agents: [{
      id: "default",
      name: "Default",
      description: "Default assistant used by Web and new channel profiles.",
      enabled: true
    }]
  }, defaultRuntimeSettings);
  assert.equal(legacy.agents[0]?.name, "Momo");

  const customized = sanitizeSettings({
    agents: [{ id: "default", name: "My Assistant", description: "Custom", enabled: true }]
  }, defaultRuntimeSettings);
  assert.equal(customized.agents[0]?.name, "My Assistant");
  assert.equal(customized.agents[0]?.description, "Custom");
});

test("sanitizeSettings backfills DuckDuckGo web search defaults for incomplete legacy settings", () => {
  const legacySettings = {
    ...defaultRuntimeSettings,
    webSearch: {
      ...defaultRuntimeSettings.webSearch,
      defaultEngine: "auto",
      engines: {} as RuntimeSettings["webSearch"]["engines"]
    }
  } as RuntimeSettings;

  const sanitized = sanitizeSettings({}, legacySettings);

  assert.equal(defaultRuntimeSettings.webSearch.defaultEngine, "duckduckgo");
  assert.equal(sanitized.webSearch.defaultEngine, "auto");
  assert.equal(sanitized.webSearch.engines.duckduckgo.enabled, true);
  assert.equal(sanitized.webSearch.engines.duckduckgo.apiKey, "");
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

test("sanitizeSettings backfills and confines daily materials settings", () => {
  const legacy = structuredClone(defaultRuntimeSettings);
  delete (legacy.plugins.memory as Partial<typeof legacy.plugins.memory>).dailyMaterials;
  const backfilled = sanitizeSettings({}, legacy);
  assert.deepEqual(backfilled.plugins.memory.dailyMaterials, {
    enabled: false, time: "23:30", projectId: "", dir: "content/daily-materials", promptPath: "templates/daily-material-prompt.md", notifications: true, scanTokenBudget: 120000, scanModelKey: ""
  });
  const sanitized = sanitizeSettings({ plugins: { ...defaultRuntimeSettings.plugins, memory: { ...defaultRuntimeSettings.plugins.memory, dailyMaterials: { enabled: true, time: "99:99", projectId: "momo-agent", dir: "../outside", promptPath: "/tmp/prompt.md", notifications: false } } } }, defaultRuntimeSettings);
  assert.equal(sanitized.plugins.memory.dailyMaterials.time, "23:30");
  assert.equal(sanitized.plugins.memory.dailyMaterials.dir, "content/daily-materials");
  assert.equal(sanitized.plugins.memory.dailyMaterials.promptPath, "templates/daily-material-prompt.md");
});

test("sanitizeSettings preserves dynamic feature-plugin settings keys", () => {
  const withExtras = sanitizeSettings(
    { plugins: { ...defaultRuntimeSettings.plugins, myFeature: { token: "abc" } } as typeof defaultRuntimeSettings.plugins },
    defaultRuntimeSettings
  );
  assert.deepEqual((withExtras.plugins as unknown as Record<string, unknown>).myFeature, { token: "abc" });
  // A later unrelated patch must not drop the stored feature settings.
  const keptExtras = sanitizeSettings({ locale: "zh-CN" }, withExtras);
  assert.deepEqual((keptExtras.plugins as unknown as Record<string, unknown>).myFeature, { token: "abc" });
  assert.equal(keptExtras.plugins.memory.reflectionTime, defaultRuntimeSettings.plugins.memory.reflectionTime);
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
