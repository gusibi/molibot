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

test("Mini App enable state and built-in tombstones survive a settings store restart", () => {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-miniapp-settings-"));
  const originalSettingsFile = storagePaths.settingsFile;
  const originalSettingsDbFile = storagePaths.settingsDbFile;
  storagePaths.settingsFile = path.join(root, "settings.json");
  storagePaths.settingsDbFile = path.join(root, "settings.sqlite");

  try {
    new SettingsStore().save({
      ...defaultRuntimeSettings,
      plugins: {
        ...defaultRuntimeSettings.plugins,
        miniApps: {
          ai: {
            textModelKey: "custom|local|small-text",
            transcriptionModelKey: "custom|local|whisper"
          },
          entries: {
            todo: { enabled: false, removedBuiltin: true },
            expenses: { enabled: true },
            budget: { enabled: false }
          }
        }
      }
    });

    const restarted = new SettingsStore().load();
    // The tombstone is the field a narrow serializer drops first, and losing it
    // silently reinstalls a built-in the owner deliberately removed.
    assert.deepEqual(restarted.plugins.miniApps.entries.todo, { enabled: false, removedBuiltin: true });
    assert.deepEqual(restarted.plugins.miniApps.entries.expenses, { enabled: true });
    assert.deepEqual(restarted.plugins.miniApps.entries.budget, { enabled: false });
    assert.deepEqual(restarted.plugins.miniApps.ai, {
      textModelKey: "custom|local|small-text",
      transcriptionModelKey: "custom|local|whisper"
    });
  } finally {
    storagePaths.settingsFile = originalSettingsFile;
    storagePaths.settingsDbFile = originalSettingsDbFile;
    rmSync(root, { recursive: true, force: true });
  }
});

test("custom provider model alias survives a settings store restart", () => {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-model-alias-settings-"));
  const originalSettingsFile = storagePaths.settingsFile;
  const originalSettingsDbFile = storagePaths.settingsDbFile;
  storagePaths.settingsFile = path.join(root, "settings.json");
  storagePaths.settingsDbFile = path.join(root, "settings.sqlite");

  try {
    new SettingsStore().save({
      ...defaultRuntimeSettings,
      customProviders: [
        {
          id: "cliproxy",
          name: "CliProxyAPI",
          enabled: true,
          protocol: "openai-compatible",
          baseUrl: "https://example.test",
          apiKey: "sk-test",
          models: [
            { id: "deepseek/deepseek-v4-pro-0711", alias: "DeepSeek V4", tags: ["text"], supportedRoles: ["system", "user", "assistant", "tool"], enabled: true },
            { id: "plain", tags: ["text"], supportedRoles: ["system", "user", "assistant", "tool"], enabled: true }
          ],
          defaultModel: "deepseek/deepseek-v4-pro-0711",
          path: "/v1/chat/completions"
        }
      ]
    });

    const restarted = new SettingsStore().load();
    const models = restarted.customProviders.find((provider) => provider.id === "cliproxy")?.models ?? [];
    assert.equal(models.find((model) => model.id === "deepseek/deepseek-v4-pro-0711")?.alias, "DeepSeek V4");
    // A model with no alias must load back as undefined, not "".
    assert.equal(models.find((model) => model.id === "plain")?.alias, undefined);
  } finally {
    storagePaths.settingsFile = originalSettingsFile;
    storagePaths.settingsDbFile = originalSettingsDbFile;
    rmSync(root, { recursive: true, force: true });
  }
});

test("pi extension enable state and per-bot exclusions survive a settings store restart", () => {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-pi-extension-settings-"));
  const originalSettingsFile = storagePaths.settingsFile;
  const originalSettingsDbFile = storagePaths.settingsDbFile;
  storagePaths.settingsFile = path.join(root, "settings.json");
  storagePaths.settingsDbFile = path.join(root, "settings.sqlite");

  try {
    new SettingsStore().save({
      ...defaultRuntimeSettings,
      plugins: {
        ...defaultRuntimeSettings.plugins,
        piExtensions: {
          enabled: true,
          entries: {
            "hello-ext": { enabled: false, disabledBots: ["momo", "work-bot"], flags: { verbose: true } },
            "other-ext": { enabled: true, disabledBots: [] }
          }
        }
      }
    });

    const restarted = new SettingsStore().load();
    assert.equal(restarted.plugins.piExtensions.enabled, true);
    assert.equal(restarted.plugins.piExtensions.entries["hello-ext"].enabled, false);
    assert.deepEqual(restarted.plugins.piExtensions.entries["hello-ext"].disabledBots, ["momo", "work-bot"]);
    assert.deepEqual(restarted.plugins.piExtensions.entries["hello-ext"].flags, { verbose: true });
    assert.equal(restarted.plugins.piExtensions.entries["other-ext"].enabled, true);
  } finally {
    storagePaths.settingsFile = originalSettingsFile;
    storagePaths.settingsDbFile = originalSettingsDbFile;
    rmSync(root, { recursive: true, force: true });
  }
});

test("parent and subagent runtime budgets survive a settings store restart independently", () => {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-agent-budget-settings-"));
  const originalSettingsFile = storagePaths.settingsFile;
  const originalSettingsDbFile = storagePaths.settingsDbFile;
  storagePaths.settingsFile = path.join(root, "settings.json");
  storagePaths.settingsDbFile = path.join(root, "settings.sqlite");

  try {
    new SettingsStore().save({
      ...defaultRuntimeSettings,
      budget: { maxToolCalls: 40, maxToolFailures: 4, maxModelAttempts: 5 },
      subagentRuntime: {
        maxToolCalls: 140,
        maxToolFailures: 10,
        maxModelTurns: 24,
        deadlineMs: 3_600_000,
        maxTasks: 7,
        maxConcurrency: 3,
        compactionEnabled: true,
        persistSessions: true
      }
    });

    const restarted = new SettingsStore().load();
    assert.deepEqual(restarted.budget, {
      maxToolCalls: 40,
      maxToolFailures: 4,
      maxModelAttempts: 5
    });
    assert.deepEqual(restarted.subagentRuntime, {
      maxToolCalls: 140,
      maxToolFailures: 10,
      maxModelTurns: 24,
      deadlineMs: 3_600_000,
      maxTasks: 7,
      maxConcurrency: 3,
      compactionEnabled: true,
      persistSessions: true
    });
  } finally {
    storagePaths.settingsFile = originalSettingsFile;
    storagePaths.settingsDbFile = originalSettingsDbFile;
    rmSync(root, { recursive: true, force: true });
  }
});

test("MCP server enable state and transport configuration survive a settings store restart", () => {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-mcp-settings-"));
  const originalSettingsFile = storagePaths.settingsFile;
  const originalSettingsDbFile = storagePaths.settingsDbFile;
  storagePaths.settingsFile = path.join(root, "settings.json");
  storagePaths.settingsDbFile = path.join(root, "settings.sqlite");

  const mcpServers = [
    {
      id: "local-tools",
      name: "Local tools",
      enabled: false,
      transport: "stdio" as const,
      stdio: { command: "node", args: ["server.mjs"], env: { TOKEN: "secret" }, cwd: "workspace" },
      http: { url: "", headers: {} },
      toolNamePrefix: "local"
    },
    {
      id: "remote-tools",
      name: "Remote tools",
      enabled: true,
      transport: "http" as const,
      stdio: { command: "", args: [], env: {}, cwd: "" },
      http: { url: "http://127.0.0.1:9123/mcp", headers: { Authorization: "Bearer secret" } },
      toolNamePrefix: "remote"
    }
  ];

  try {
    new SettingsStore().save({ ...defaultRuntimeSettings, mcpServers });
    const restarted = new SettingsStore().load();
    assert.deepEqual(restarted.mcpServers, mcpServers);
  } finally {
    storagePaths.settingsFile = originalSettingsFile;
    storagePaths.settingsDbFile = originalSettingsDbFile;
    rmSync(root, { recursive: true, force: true });
  }
});

test("OpenConnector settings survive a full save and settings store restart", () => {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-open-connector-settings-"));
  const originalSettingsFile = storagePaths.settingsFile;
  const originalSettingsDbFile = storagePaths.settingsDbFile;
  storagePaths.settingsFile = path.join(root, "settings.json");
  storagePaths.settingsDbFile = path.join(root, "settings.sqlite");
  const openConnector = { enabled: true, baseUrl: "https://opc.example.com", consoleUrl: "https://opc.example.com/providers", runtimeToken: "oct-secret" };
  try {
    new SettingsStore().save({ ...defaultRuntimeSettings, openConnector });
    assert.deepEqual(new SettingsStore().load().openConnector, openConnector);
  } finally {
    storagePaths.settingsFile = originalSettingsFile;
    storagePaths.settingsDbFile = originalSettingsDbFile;
    rmSync(root, { recursive: true, force: true });
  }
});

test("fail-closed sandbox settings survive a full save and settings store restart", () => {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-sandbox-settings-"));
  const originalSettingsFile = storagePaths.settingsFile;
  const originalSettingsDbFile = storagePaths.settingsDbFile;
  storagePaths.settingsFile = path.join(root, "settings.json");
  storagePaths.settingsDbFile = path.join(root, "settings.sqlite");

  const toolSandbox = {
    ...defaultRuntimeSettings.toolSandbox,
    enabled: true,
    initFailureMode: "block" as const,
    env: { inheritMode: "allowlist" as const, allow: ["CI"], deny: ["TOKEN"] },
    network: { allowedDomains: ["registry.npmjs.org"], deniedDomains: ["example.com"] },
    filesystem: { denyRead: [".env"], allowWrite: ["scratch"], denyWrite: ["*.pem"] }
  };

  try {
    new SettingsStore().save({ ...defaultRuntimeSettings, toolSandbox });
    const restarted = new SettingsStore().load();
    assert.deepEqual(restarted.toolSandbox, toolSandbox);
  } finally {
    storagePaths.settingsFile = originalSettingsFile;
    storagePaths.settingsDbFile = originalSettingsDbFile;
    rmSync(root, { recursive: true, force: true });
  }
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

test("a raised tool-call budget carries the failure budget with it unless one is set explicitly", () => {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-budget-scaling-"));
  const originalSettingsFile = storagePaths.settingsFile;
  const originalSettingsDbFile = storagePaths.settingsDbFile;
  storagePaths.settingsFile = path.join(root, "settings.json");
  storagePaths.settingsDbFile = path.join(root, "settings.sqlite");

  try {
    // The two limits are one policy, but only maxToolCalls is discoverable.
    // Raising it to 100 and leaving the failure budget at 6 meant a long run
    // still died on its sixth failed tool — not what the owner asked for.
    new SettingsStore().save({
      ...defaultRuntimeSettings,
      budget: { maxToolCalls: 100 } as never
    });
    assert.equal(new SettingsStore().load().budget.maxToolFailures, 25);

    // An explicit value always wins, in either direction.
    new SettingsStore().save({
      ...defaultRuntimeSettings,
      budget: { maxToolCalls: 100, maxToolFailures: 3 } as never
    });
    assert.equal(new SettingsStore().load().budget.maxToolFailures, 3);
  } finally {
    storagePaths.settingsFile = originalSettingsFile;
    storagePaths.settingsDbFile = originalSettingsDbFile;
    rmSync(root, { recursive: true, force: true });
  }
});

test("permission mode survives a settings store restart at every level", () => {
  // CLAUDE.md pitfall 11: a new settings field needs save -> fresh store ->
  // load against a temporary database, because narrow serialization silently
  // resets fields on restart. `toStaticSettings` enumerates its fields, so
  // omitting one there is exactly how that happens.
  const root = mkdtempSync(path.join(tmpdir(), "molibot-permission-mode-settings-"));
  const originalSettingsFile = storagePaths.settingsFile;
  const originalSettingsDbFile = storagePaths.settingsDbFile;
  storagePaths.settingsFile = path.join(root, "settings.json");
  storagePaths.settingsDbFile = path.join(root, "settings.sqlite");

  try {
    new SettingsStore().save({
      ...defaultRuntimeSettings,
      permissionMode: "manual",
      agents: defaultRuntimeSettings.agents.map((agent) =>
        agent.id === "default" ? { ...agent, permissionMode: "plan" as const } : agent
      )
    });

    const restarted = new SettingsStore().load();
    assert.equal(restarted.permissionMode, "manual", "the global default must survive");
    assert.equal(
      restarted.agents.find((agent) => agent.id === "default")?.permissionMode,
      "plan",
      "the agent-level override must survive"
    );
    // The other axis is untouched: mode and sandbox are orthogonal.
    assert.equal(restarted.toolSandbox.enabled, defaultRuntimeSettings.toolSandbox.enabled);
  } finally {
    storagePaths.settingsFile = originalSettingsFile;
    storagePaths.settingsDbFile = originalSettingsDbFile;
    rmSync(root, { recursive: true, force: true });
  }
});

test("an unset permission mode loads as the Accept edits default, not as undefined", () => {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-permission-mode-default-"));
  const originalSettingsFile = storagePaths.settingsFile;
  const originalSettingsDbFile = storagePaths.settingsDbFile;
  storagePaths.settingsFile = path.join(root, "settings.json");
  storagePaths.settingsDbFile = path.join(root, "settings.sqlite");

  try {
    // A settings file written before this field existed.
    new SettingsStore().save({ ...defaultRuntimeSettings, permissionMode: undefined as never });
    const restarted = new SettingsStore().load();
    assert.equal(restarted.permissionMode, "accept_edits");

    // ...and a value this build does not recognize must not become the gate.
    new SettingsStore().save({ ...defaultRuntimeSettings, permissionMode: "bypass" as never });
    assert.equal(new SettingsStore().load().permissionMode, "accept_edits");
  } finally {
    storagePaths.settingsFile = originalSettingsFile;
    storagePaths.settingsDbFile = originalSettingsDbFile;
    rmSync(root, { recursive: true, force: true });
  }
});
