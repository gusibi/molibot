import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { PluginContractCatalog } from "./catalog.js";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";
import { resetPluginConfigStoreForTests } from "./configStore.js";

/**
 * Slice 2 tests:
 * 1. Catalog discovery (built-in, invalid/error, schema-mode, custom-mode, without-settings)
 * 2. Detail projection & retained state
 * 3. Structural guard: no hardcoded plugin id in generic catalog code
 */

test("catalog discovers plugins with varied sources, modes, and statuses", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "molibot-catalog-test-"));
  const originals = { ...storagePaths };
  try {
    storagePaths.pluginsPackagesDir = path.join(root, "packages");
    storagePaths.pluginsConfigDir = path.join(root, "config");
    storagePaths.pluginsDataDir = path.join(root, "data");
    storagePaths.pluginsCacheDir = path.join(root, "cache");
    resetPluginConfigStoreForTests();

    fs.mkdirSync(storagePaths.pluginsPackagesDir, { recursive: true });

    // 1. Schema plugin
    const schemaPkgDir = path.join(storagePaths.pluginsPackagesDir, "schema-plugin");
    fs.mkdirSync(schemaPkgDir);
    fs.writeFileSync(
      path.join(schemaPkgDir, "package.json"),
      JSON.stringify({
        name: "schema-plugin",
        version: "1.2.0",
        molibot: {
          plugin: {
            manifestVersion: 1,
            id: "schema-plugin",
            name: "Schema Plugin",
            version: "1.2.0",
            description: "Has JSON schema settings",
            engines: { molibot: ">=2.0.0" },
            config: { schemaVersion: 1 },
            settings: {
              mode: "schema",
              schema: { type: "object", properties: { key: { type: "string" } } }
            }
          }
        }
      })
    );

    // 2. Custom UI plugin
    const customPkgDir = path.join(storagePaths.pluginsPackagesDir, "custom-plugin");
    fs.mkdirSync(path.join(customPkgDir, "ui"), { recursive: true });
    fs.writeFileSync(path.join(customPkgDir, "ui", "index.html"), "<h1>UI</h1>");
    fs.writeFileSync(path.join(customPkgDir, "ui", "icon.svg"), "<svg></svg>");
    fs.writeFileSync(path.join(customPkgDir, "runtime.mjs"), "export function onAction() {}");
    fs.writeFileSync(
      path.join(customPkgDir, "package.json"),
      JSON.stringify({
        name: "custom-plugin",
        version: "2.0.0",
        molibot: {
          plugin: {
            manifestVersion: 1,
            id: "custom-plugin",
            name: "Custom UI Plugin",
            version: "2.0.0",
            engines: { molibot: ">=2.0.0" },
            config: { schemaVersion: 1 },
            runtime: { entry: "runtime.mjs", actions: ["detect"] },
            settings: {
              mode: "custom",
              ui: { entry: "ui/index.html", icon: "ui/icon.svg" }
            }
          }
        }
      })
    );

    // 3. Plugin without settings
    const noSettingsDir = path.join(storagePaths.pluginsPackagesDir, "bare-plugin");
    fs.mkdirSync(noSettingsDir);
    fs.writeFileSync(
      path.join(noSettingsDir, "package.json"),
      JSON.stringify({
        name: "bare-plugin",
        version: "0.1.0",
        molibot: {
          plugin: {
            manifestVersion: 1,
            id: "bare-plugin",
            name: "Bare Plugin",
            version: "0.1.0",
            engines: { molibot: ">=2.0.0" },
            config: { schemaVersion: 1 }
          }
        }
      })
    );

    // 4. Broken manifest plugin
    const brokenDir = path.join(storagePaths.pluginsPackagesDir, "broken-plugin");
    fs.mkdirSync(brokenDir);
    fs.writeFileSync(path.join(brokenDir, "package.json"), "invalid json");

    const catalog = new PluginContractCatalog();
    const settings = {
      ...defaultRuntimeSettings,
      plugins: {
        ...defaultRuntimeSettings.plugins,
        entries: {
          "schema-plugin": { enabled: true, source: { kind: "builtin" as const } },
          "custom-plugin": { enabled: false, source: { kind: "npm" as const, package: "@test/custom", version: "2.0.0" } }
        }
      }
    };

    const items = catalog.listPlugins(settings);
    assert.equal(items.length, 4);

    const schemaItem = items.find((i) => i.id === "schema-plugin");
    assert.notEqual(schemaItem, undefined);
    assert.equal(schemaItem?.enabled, true);
    assert.equal(schemaItem?.status, "active");
    assert.equal(schemaItem?.hasSettings, true);
    assert.equal(schemaItem?.settingsMode, "schema");

    const customItem = items.find((i) => i.id === "custom-plugin");
    assert.notEqual(customItem, undefined);
    assert.equal(customItem?.enabled, false);
    assert.equal(customItem?.status, "disabled");
    assert.equal(customItem?.hasSettings, true);
    assert.equal(customItem?.settingsMode, "custom");
    assert.equal(customItem?.iconUri, "/plugins/custom-plugin/ui/icon.svg");

    const bareItem = items.find((i) => i.id === "bare-plugin");
    assert.notEqual(bareItem, undefined);
    assert.equal(bareItem?.hasSettings, false);

    const brokenItem = items.find((i) => i.id === "broken-plugin");
    assert.notEqual(brokenItem, undefined);
    assert.equal(brokenItem?.status, "error");

    // Detail projection
    const detail = catalog.getPluginDetail("schema-plugin", settings);
    assert.notEqual(detail, null);
    assert.equal(detail?.manifest?.id, "schema-plugin");
    assert.deepEqual(detail?.retainedState, { hasConfig: false, hasData: false, hasCache: false });
  } finally {
    resetPluginConfigStoreForTests();
    Object.assign(storagePaths, originals);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("structural guard: generic catalog and paths code contains no hardcoded plugin ids", () => {
  const catalogSrc = fs.readFileSync(path.resolve("src/lib/server/plugins/contract/catalog.ts"), "utf8");
  const pathsSrc = fs.readFileSync(path.resolve("src/lib/server/plugins/contract/paths.ts"), "utf8");
  const manifestSrc = fs.readFileSync(path.resolve("src/lib/server/plugins/contract/manifest.ts"), "utf8");

  for (const src of [catalogSrc, pathsSrc, manifestSrc]) {
    assert.equal(src.includes("external-subagent"), false, "Found hardcoded external-subagent in generic contract module");
    assert.equal(src.includes("cloudflare-html"), false, "Found hardcoded cloudflare-html in generic contract module");
  }
});
