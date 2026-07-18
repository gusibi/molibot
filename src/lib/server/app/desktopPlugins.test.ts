import assert from "node:assert/strict";
import test from "node:test";
import { buildDesktopPluginItem, buildDesktopPluginsSettings, buildDesktopPluginsSummary } from "./desktopPlugins";
import type { RuntimeSettings } from "$lib/server/settings/schema";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults";
import type { PluginCatalog } from "$lib/server/plugins/types";

test("buildDesktopPluginItem projects identity/version/status and drops on-disk paths", () => {
  const item = buildDesktopPluginItem(
    {
      key: "telegram",
      name: "Telegram",
      version: "1.2.0",
      description: "Telegram channel",
      source: "built-in",
      status: "active",
      enabled: true,
      // These exist on the real catalog entry but are intentionally untyped/dropped.
      ...({
        manifestPath: "/Users/secret/.molibot/plugins/telegram/plugin.json",
        entryPath: "/Users/secret/.molibot/plugins/telegram/index.js",
        settingsFields: [{ key: "botToken", secret: true }]
      } as Record<string, unknown>)
    },
    "channel"
  );

  assert.equal(item.kind, "channel");
  assert.equal(item.key, "telegram");
  assert.equal(item.name, "Telegram");
  assert.equal(item.version, "1.2.0");
  assert.equal(item.source, "built-in");
  assert.equal(item.status, "active");
  assert.equal(item.enabled, true);

  const serialized = JSON.stringify(item);
  assert.equal(serialized.includes("/Users/"), false);
  assert.equal(serialized.includes("manifestPath"), false);
  assert.equal(serialized.includes("entryPath"), false);
  assert.equal(serialized.includes("settingsFields"), false);
  assert.equal(serialized.includes("botToken"), false);
});

test("buildDesktopPluginItem coerces unknown kind/status and defaults enabled to true", () => {
  const item = buildDesktopPluginItem(
    { key: "x", name: "", kind: "weird", status: "broken" } as never,
    "provider"
  );
  assert.equal(item.kind, "feature");
  assert.equal(item.status, "discovered");
  assert.equal(item.name, "x");
  assert.equal(item.enabled, true);
  assert.equal(item.source, "built-in");
});

test("buildDesktopPluginsSummary flattens groups in known-kind order and counts", () => {
  const summary = buildDesktopPluginsSummary({
    channels: [{ key: "tg", name: "Telegram", status: "active", source: "built-in" }],
    providers: [{ key: "pi", name: "Pi", status: "active", source: "external" }],
    features: [{ key: "f1", name: "Feature 1", status: "discovered", enabled: false }],
    memoryBackends: [{ key: "m1", name: "Mory", status: "error", source: "external" }]
  });

  assert.deepEqual(summary.items.map((i) => i.kind), ["channel", "provider", "feature", "memory-backend"]);
  assert.equal(summary.counts.total, 4);
  assert.equal(summary.counts.active, 2);
  assert.equal(summary.counts.external, 2);
});

test("buildDesktopPluginsSummary tolerates an empty catalog", () => {
  const summary = buildDesktopPluginsSummary({});
  assert.deepEqual(summary.items, []);
  assert.deepEqual(summary.counts, { total: 0, active: 0, external: 0 });
});

test("plugin summary exposes safe fields and only a configured flag for passwords", () => {
  const catalog = {
    channels: [], providers: [], memoryBackends: [{ kind: "memory-backend", key: "mory", name: "Mory", version: "1", source: "built-in", status: "active" }],
    features: [{ kind: "feature", key: "publish", name: "Publish", version: "1", source: "built-in", status: "active", settingsKey: "cloudflareHtml", settingsFields: [{ key: "enabled", label: "Enabled", type: "boolean" }, { key: "workerBaseHost", label: "Host", type: "text" }, { key: "secretAccessKey", label: "Secret", type: "password" }] }]
  } as PluginCatalog;
  const settings = { plugins: { memory: { enabled: true, backend: "mory" }, cloudflareHtml: { enabled: true, workerBaseHost: "https://example.test", secretAccessKey: "secret-value" } } } as unknown as RuntimeSettings;
  const summary = buildDesktopPluginsSummary(catalog, settings);
  assert.equal(summary.memory.backend, "mory");
  assert.equal(summary.featureSettings[0].fields[1].value, "https://example.test");
  assert.equal(summary.featureSettings[0].fields[2].value, "");
  assert.equal(summary.featureSettings[0].fields[2].configured, true);
  assert.equal(JSON.stringify(summary).includes("secret-value"), false);
});

test("plugin save preserves omitted passwords, replaces or clears explicitly", () => {
  const catalog = {
    channels: [], providers: [], memoryBackends: [{ kind: "memory-backend", key: "mory", name: "Mory", version: "1", source: "built-in", status: "active" }],
    features: [{ kind: "feature", key: "publish", name: "Publish", version: "1", source: "built-in", status: "active", settingsKey: "cloudflareHtml", settingsFields: [{ key: "enabled", label: "Enabled", type: "boolean" }, { key: "secretAccessKey", label: "Secret", type: "password" }] }]
  } as PluginCatalog;
  const settings = { plugins: { memory: { enabled: false, backend: "json-file" }, cloudflareHtml: { enabled: false, secretAccessKey: "old" }, hooks: [] } } as unknown as RuntimeSettings;
  const preserved = buildDesktopPluginsSettings(settings, catalog, { memoryEnabled: true, memoryBackend: "mory", values: { publish: { enabled: true } } });
  assert.equal(preserved.cloudflareHtml.secretAccessKey, "old");
  const replaced = buildDesktopPluginsSettings(settings, catalog, { memoryEnabled: false, memoryBackend: "json-file", values: {}, secretValues: { publish: { secretAccessKey: "new" } } });
  assert.equal(replaced.cloudflareHtml.secretAccessKey, "new");
  const cleared = buildDesktopPluginsSettings(settings, catalog, { memoryEnabled: false, memoryBackend: "json-file", values: {}, clearSecrets: { publish: ["secretAccessKey"] } });
  assert.equal(cleared.cloudflareHtml.secretAccessKey, "");
});

test("plugin save validates and persists daily materials project settings", () => {
  const settings = { plugins: { memory: { enabled: true, backend: "mory", dailyMaterials: { enabled: false, time: "23:30", projectId: "", dir: "content/daily-materials", promptPath: "templates/daily-material-prompt.md", notifications: true } }, cloudflareHtml: {}, hooks: [] } } as unknown as RuntimeSettings;
  const input = { memoryEnabled: true, memoryBackend: "mory", memoryEmbeddingProviderId: "", memoryEmbeddingModel: "", memoryReflectionTime: "03:00", memoryReflectionNotifications: true, memoryDailyMaterials: { enabled: true, time: "22:45", projectId: "momo-agent", dir: "content/daily-materials", promptPath: "templates/daily-material-prompt.md", notifications: false, scanTokenBudget: 120000, scanModelKey: "" }, values: {} };
  const saved = buildDesktopPluginsSettings(settings, { channels: [], providers: [], features: [], memoryBackends: [{ key: "mory" }] } as PluginCatalog, input, { get: (id: string) => id === "momo-agent" ? { id } : null } as any);
  assert.deepEqual(saved.memory.dailyMaterials, input.memoryDailyMaterials);
});

test("plugin summary and save expose the shared memory task target from authorized chats only", () => {
  const settings = {
    plugins: {
      memory: { ...defaultRuntimeSettings.plugins.memory, reflectionNotificationTarget: { channel: "feishu", botId: "momo", chatId: "oc_daily" } },
      cloudflareHtml: {}, hooks: []
    },
    channels: {
      telegram: { instances: [{ id: "news", name: "News", enabled: true, allowedChatIds: ["-1001"], credentials: {} }] },
      feishu: { instances: [{ id: "momo", name: "Momo", enabled: true, allowedChatIds: ["oc_daily"], credentials: {} }] },
      qq: { instances: [{ id: "qq", name: "QQ", enabled: true, allowedChatIds: ["qq-chat"], credentials: {} }] }
    }
  } as unknown as RuntimeSettings;
  const catalog = { channels: [], providers: [], features: [], memoryBackends: [{ key: "mory" }] } as PluginCatalog;
  const summary = buildDesktopPluginsSummary(catalog, settings);
  assert.equal(summary.memory.reflectionNotificationTargets.length, 2);
  assert.match(summary.memory.reflectionNotificationTargets[0].label, /Telegram/);
  assert.match(summary.memory.reflectionNotificationTargets[1].label, /Feishu/);
  assert.equal(summary.memory.reflectionNotificationTarget, summary.memory.reflectionNotificationTargets[1].value);

  const saved = buildDesktopPluginsSettings(settings, catalog, {
    memoryEnabled: true,
    memoryBackend: "mory",
    memoryEmbeddingProviderId: "",
    memoryEmbeddingModel: "",
    memoryReflectionTime: "03:00",
    memoryReflectionNotifications: true,
    memoryReflectionNotificationTarget: summary.memory.reflectionNotificationTargets[0].value,
    memoryDailyMaterials: settings.plugins.memory.dailyMaterials,
    values: {}
  });
  assert.deepEqual(saved.memory.reflectionNotificationTarget, { channel: "telegram", botId: "news", chatId: "-1001" });
  assert.throws(() => buildDesktopPluginsSettings(settings, catalog, {
    memoryEnabled: true,
    memoryBackend: "mory",
    memoryReflectionNotifications: true,
    memoryReflectionNotificationTarget: JSON.stringify({ channel: "telegram", botId: "news", chatId: "not-authorized" }),
    values: {}
  } as any), /unauthorized/);
});
