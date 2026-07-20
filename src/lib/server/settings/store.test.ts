import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { SettingsStore } from "$lib/server/settings/store.js";

test("SettingsStore legacy table migration works and drops old tables", () => {
  const db = new DatabaseSync(":memory:");

  // Create legacy tables
  db.exec(`
    CREATE TABLE settings_web_search (
      id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL,
      default_route TEXT NOT NULL,
      default_engine TEXT NOT NULL,
      engine_selection_strategy TEXT NOT NULL,
      max_results INTEGER NOT NULL,
      timeout_ms INTEGER NOT NULL,
      retry_timeout_ms INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE settings_web_search_engines (
      engine_id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL,
      api_key TEXT NOT NULL,
      base_url TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE settings_dynamic (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // Insert legacy search data
  db.prepare(`
    INSERT INTO settings_web_search (id, enabled, default_route, default_engine, engine_selection_strategy, max_results, timeout_ms, retry_timeout_ms, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run("global", 1, "china", "baidu", "priority", 5, 5000, 10000, "2026-06-06T12:00:00Z");

  db.prepare(`
    INSERT INTO settings_web_search_engines (engine_id, enabled, api_key, base_url, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run("baidu", 1, "baidu-key-123", "https://api.baidu.com", "2026-06-06T12:00:00Z");

  // Instantiate SettingsStore (mock storage path is not triggered since we call helper directly)
  const store = new SettingsStore();

  // Run the migration
  store["migrateLegacyTables"](db);

  // Check if legacy tables were dropped
  const checkWebSearch = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='settings_web_search'").get();
  const checkWebSearchEngines = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='settings_web_search_engines'").get();
  assert.equal(checkWebSearch, undefined, "settings_web_search table should be dropped");
  assert.equal(checkWebSearchEngines, undefined, "settings_web_search_engines table should be dropped");

  // Check if data is now in settings_dynamic
  const dynamicRow = db.prepare("SELECT value_json FROM settings_dynamic WHERE key = ?").get("settings_web_search") as { value_json: string } | undefined;
  assert.ok(dynamicRow, "settings_web_search key should exist in settings_dynamic");

  const webSearch = JSON.parse(dynamicRow.value_json);
  assert.equal(webSearch.enabled, true);
  assert.equal(webSearch.defaultRoute, "china");
  assert.equal(webSearch.defaultEngine, "baidu");
  assert.equal(webSearch.maxResults, 5);
  assert.equal(webSearch.engines.baidu.enabled, true);
  assert.equal(webSearch.engines.baidu.apiKey, "baidu-key-123");
  assert.equal(webSearch.engines.baidu.baseUrl, "https://api.baidu.com");
});

test("settings store persists ttsGenerate dynamic settings", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE settings_dynamic (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const store = new SettingsStore();
  const initial = defaultRuntimeSettings;
  const updated = {
    ...initial,
    ttsGenerate: {
      ...initial.ttsGenerate,
      enabled: true,
      defaultProvider: "xiaomi" as const,
      providers: {
        ...initial.ttsGenerate.providers,
        xiaomi: {
          enabled: true,
          apiKey: "persisted-key",
          baseUrl: "https://api.xiaomimimo.com/v1",
          model: "mimo-v2-tts",
          voice: "default_en",
          format: "wav" as const
        }
      }
    }
  };

  store["saveTtsGenerateSettings"](db, updated.ttsGenerate);
  const reloaded = store["loadTtsGenerateSettings"](db);

  assert.equal(updated.ttsGenerate.defaultProvider, "xiaomi");
  assert.equal(updated.ttsGenerate.providers.xiaomi.apiKey, "persisted-key");
  assert.ok(reloaded);
  assert.equal(reloaded.defaultProvider, "xiaomi");
  assert.equal(reloaded.providers.xiaomi.apiKey, "persisted-key");
  assert.equal(reloaded.providers.xiaomi.voice, "default_en");
});

test("settings serialization keeps full plugins block (reflection, daily materials, hooks, feature settings)", () => {
  const store = new SettingsStore();
  const settings = {
    ...defaultRuntimeSettings,
    plugins: {
      ...defaultRuntimeSettings.plugins,
      memory: {
        ...defaultRuntimeSettings.plugins.memory,
        enabled: true,
        reflectionTime: "05:15",
        reflectionNotifications: false,
        dailyMaterials: {
          ...defaultRuntimeSettings.plugins.memory.dailyMaterials,
          enabled: true,
          time: "22:45",
          projectId: "proj-1"
        }
      },
      hooks: [{ id: "daily-review", enabled: true }],
      // Dynamic feature-plugin settings keyed by the plugin's settingsKey.
      myFeature: { apiKey: "k", mode: "fast" }
    } as typeof defaultRuntimeSettings.plugins
  };

  const raw = store["toStaticSettings"](settings) as unknown as { plugins: Record<string, unknown> };
  const memory = raw.plugins.memory as Record<string, unknown>;
  assert.equal(memory.reflectionTime, "05:15");
  assert.equal(memory.reflectionNotifications, false);
  const daily = memory.dailyMaterials as Record<string, unknown>;
  assert.equal(daily.enabled, true);
  assert.equal(daily.time, "22:45");
  assert.equal(daily.projectId, "proj-1");
  assert.deepEqual(raw.plugins.hooks, [{ id: "daily-review", enabled: true }]);
  assert.deepEqual(raw.plugins.myFeature, { apiKey: "k", mode: "fast" });
});

test("memory reflection and daily materials survive a settings store restart", () => {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-plugin-settings-"));
  const originalSettingsFile = storagePaths.settingsFile;
  const originalSettingsDbFile = storagePaths.settingsDbFile;
  storagePaths.settingsFile = path.join(root, "settings.json");
  storagePaths.settingsDbFile = path.join(root, "settings.sqlite");

  try {
    const firstStore = new SettingsStore();
    firstStore.save({
      ...defaultRuntimeSettings,
      plugins: {
        ...defaultRuntimeSettings.plugins,
        memory: {
          ...defaultRuntimeSettings.plugins.memory,
          enabled: true,
          backend: "mory",
          reflectionTime: "05:15",
          reflectionNotifications: false,
          reflectionNotificationTarget: { channel: "feishu", botId: "momo", chatId: "oc_daily" },
          dailyMaterials: {
            ...defaultRuntimeSettings.plugins.memory.dailyMaterials,
            enabled: true,
            time: "22:45",
            projectId: "project-1"
          }
        }
      }
    });

    const restarted = new SettingsStore().load();
    assert.equal(restarted.plugins.memory.enabled, true);
    assert.equal(restarted.plugins.memory.backend, "mory");
    assert.equal(restarted.plugins.memory.reflectionTime, "05:15");
    assert.equal(restarted.plugins.memory.reflectionNotifications, false);
    assert.deepEqual(restarted.plugins.memory.reflectionNotificationTarget, { channel: "feishu", botId: "momo", chatId: "oc_daily" });
    assert.equal(restarted.plugins.memory.dailyMaterials.enabled, true);
    assert.equal(restarted.plugins.memory.dailyMaterials.time, "22:45");
    assert.equal(restarted.plugins.memory.dailyMaterials.projectId, "project-1");
  } finally {
    storagePaths.settingsFile = originalSettingsFile;
    storagePaths.settingsDbFile = originalSettingsDbFile;
    rmSync(root, { recursive: true, force: true });
  }
});

test("legacy Default Agent migrates to Momo across a settings restart without renaming custom Agents", () => {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-default-agent-settings-"));
  const originalSettingsFile = storagePaths.settingsFile;
  const originalSettingsDbFile = storagePaths.settingsDbFile;
  storagePaths.settingsFile = path.join(root, "settings.json");
  storagePaths.settingsDbFile = path.join(root, "settings.sqlite");

  try {
    new SettingsStore().save({
      ...defaultRuntimeSettings,
      agents: [
        {
          id: "default",
          name: "Default",
          description: "Default assistant used by Web and new channel profiles.",
          enabled: true
        },
        { id: "custom", name: "My Coach", description: "Keep this name", enabled: true }
      ]
    });

    const restarted = new SettingsStore().load();
    assert.equal(restarted.agents.find((agent) => agent.id === "default")?.name, "Momo");
    assert.equal(restarted.agents.find((agent) => agent.id === "custom")?.name, "My Coach");
  } finally {
    storagePaths.settingsFile = originalSettingsFile;
    storagePaths.settingsDbFile = originalSettingsDbFile;
    rmSync(root, { recursive: true, force: true });
  }
});
