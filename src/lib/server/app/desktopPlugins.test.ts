import assert from "node:assert/strict";
import test from "node:test";
import { buildDesktopPluginItem, buildDesktopPluginsSettings, buildDesktopPluginsSummary } from "./desktopPlugins";
import type { RuntimeSettings } from "$lib/server/settings/schema";
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
