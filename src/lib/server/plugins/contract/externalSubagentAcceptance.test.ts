import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { PluginContractCatalog } from "./catalog.js";
import { getPluginConfigStore, resetPluginConfigStoreForTests } from "./configStore.js";
import { invokePluginSettingsAction } from "./actionHost.js";
import { SettingsStore } from "$lib/server/settings/store.js";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";
import { ensureBuiltinPlugins } from "./builtinBootstrap.js";
import { buildPluginPackages } from "../../../../../scripts/build-plugin-packages.mjs";
import { resolveExternalSubagentConfig } from "$lib/server/plugins/externalSubagent/config.js";

/**
 * Slice 4 Acceptance Seam Test (Issue #34):
 * Full lifecycle of External Subagent as a contract plugin.
 */

test("External Subagent reference migration full acceptance seam", async () => {
  await buildPluginPackages();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "molibot-acceptance-"));
  const originals = { ...storagePaths };
  try {
    storagePaths.dataDir = root;
    storagePaths.dbDir = path.join(root, "db");
    storagePaths.settingsDbFile = path.join(storagePaths.dbDir, "settings.sqlite");
    storagePaths.settingsFile = path.join(root, "settings.json");
    storagePaths.sessionsIndexFile = path.join(root, "sessions-index.json");
    storagePaths.pluginsPackagesDir = path.join(root, "plugins", "packages");
    storagePaths.pluginsConfigDir = path.join(root, "plugins", "config");
    storagePaths.pluginsDataDir = path.join(root, "plugins", "data");
    storagePaths.pluginsCacheDir = path.join(root, "plugins", "cache");
    resetPluginConfigStoreForTests();

    // 1. Boot / stage built-in package
    ensureBuiltinPlugins();

    const catalog = new PluginContractCatalog();
    let settingsStore = new SettingsStore();
    settingsStore.save(defaultRuntimeSettings);

    // 2. Catalog discovers it
    const items = catalog.listPlugins(settingsStore.load());
    const subagentItem = items.find((i) => i.id === "external-subagent");
    assert.notEqual(subagentItem, undefined);
    assert.equal(subagentItem?.hasSettings, true);
    assert.equal(subagentItem?.settingsMode, "custom");
    assert.equal(subagentItem?.enabled, false);

    // 3. Enable it in host settings
    const previousSettings = settingsStore.load();
    settingsStore.save({
      ...previousSettings,
      plugins: {
        ...previousSettings.plugins,
        entries: {
          ...previousSettings.plugins.entries,
          "external-subagent": { enabled: true, source: { kind: "builtin" as const } }
        }
      }
    });
    assert.equal(resolveExternalSubagentConfig(settingsStore.load()).codexEnabled, false);
    assert.equal(resolveExternalSubagentConfig(settingsStore.load()).claudeCodeEnabled, false);

    // 4. Save custom configuration via contract store
    const configStore = getPluginConfigStore();
    const writeRes = await configStore.writeConfig("external-subagent", 1, {
      codexEnabled: true,
      codexPermissionMode: "approve-for-me",
      codexPath: "/custom/bin/codex",
      claudeCodeEnabled: true,
      claudeCodePermissionMode: "acceptEdits",
      claudeCodePath: "/custom/bin/claude"
    });
    assert.equal(writeRes.ok, true);

    // 5. Restart with fresh SettingsStore and fresh PluginConfigStore
    resetPluginConfigStoreForTests();
    const restartedSettingsStore = new SettingsStore();
    const restartedConfigStore = getPluginConfigStore();

    // Both read the same state
    const restartedSettings = restartedSettingsStore.load();
    assert.equal(restartedSettings.plugins.entries?.["external-subagent"]?.enabled, true);

    const restartedConfig = restartedConfigStore.readConfig("external-subagent", 1);
    assert.equal(restartedConfig.status, "ok");
    if (restartedConfig.status === "ok") {
      assert.equal(restartedConfig.values.codexEnabled, true);
      assert.equal(restartedConfig.values.codexPermissionMode, "approve-for-me");
      assert.equal(restartedConfig.values.codexPath, "/custom/bin/codex");
      assert.equal(restartedConfig.values.claudeCodeEnabled, true);
      assert.equal(restartedConfig.values.claudeCodePermissionMode, "acceptEdits");
    }
    const restartedDetail = catalog.getPluginDetail("external-subagent", restartedSettings);
    assert.equal(restartedDetail?.settingsValues?.codexPermissionMode, "approve-for-me");
    assert.equal(restartedDetail?.settingsValues?.claudeCodePermissionMode, "acceptEdits");

    // 6. Runtime settings action executes in fault domain
    const actionRes = await invokePluginSettingsAction({
      pluginId: "external-subagent",
      action: "detectEnvironment",
      input: { provider: "codex", customPath: "/non-existent/path" },
      settings: restartedSettings
    });
    assert.equal(actionRes.ok, true, actionRes.error);
    assert.equal((actionRes.result as any)?.available, false);
    assert.match((actionRes.result as any)?.error || "", /does not exist/);

    // 7. Upgrade code: config & data remain untouched
    // Plant dummy domain data
    const dataDir = path.join(storagePaths.pluginsDataDir, "external-subagent");
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, "test.txt"), "durable domain data");

    // Re-run staging (simulate upgrade)
    const installedPackageJson = path.join(storagePaths.pluginsPackagesDir, "external-subagent", "package.json");
    const installedPackage = JSON.parse(fs.readFileSync(installedPackageJson, "utf8"));
    installedPackage.version = "0.1.0";
    fs.writeFileSync(installedPackageJson, JSON.stringify(installedPackage), "utf8");
    ensureBuiltinPlugins();

    // Verify config and data survived
    assert.equal(fs.existsSync(path.join(dataDir, "test.txt")), true);
    assert.equal(restartedConfigStore.readConfig("external-subagent", 1).status, "ok");
    assert.equal(fs.readdirSync(storagePaths.pluginsPackagesDir).some((name) => name.startsWith("external-subagent.backup-")), true);

    // 8. Structural check: RuntimeSettings contains NO externalSubagent property
    assert.equal("externalSubagent" in (restartedSettings.plugins as any), false);
  } finally {
    resetPluginConfigStoreForTests();
    Object.assign(storagePaths, originals);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("structural guard: generic settings schema, defaults, and sanitizers have no externalSubagent special cases", () => {
  const schemaSrc = fs.readFileSync(path.resolve("src/lib/server/settings/schema.ts"), "utf8");
  const defaultsSrc = fs.readFileSync(path.resolve("src/lib/server/settings/defaults.ts"), "utf8");
  const sanitizeSrc = fs.readFileSync(path.resolve("src/lib/server/settings/sanitize.ts"), "utf8");
  const storeSrc = fs.readFileSync(path.resolve("src/lib/server/settings/store.ts"), "utf8");

  for (const [name, src] of [["schema", schemaSrc], ["defaults", defaultsSrc], ["sanitize", sanitizeSrc], ["store", storeSrc]]) {
    assert.equal(src.includes("externalSubagent"), false, `Found externalSubagent in generic settings module: ${name}`);
  }
});
