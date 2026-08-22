import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import {
  isSafePluginScopeId,
  isValidPluginId,
  pluginCacheDir,
  pluginConfigDir,
  pluginDataDir,
  pluginPackageDir,
  pluginSecretsFilePath,
  pluginSettingsFilePath
} from "./paths.js";
import { readMolibotPluginManifest } from "./manifest.js";
import {
  PluginConfigStore,
  resetPluginConfigStoreForTests
} from "./configStore.js";
import { sanitizePluginEntries, RESERVED_PLUGIN_KEYS } from "$lib/server/settings/sanitize.js";

/**
 * Slice 1 test suite (Issue #34):
 * 1. Storage & scope safety (traversal, invalid ids, symlinks, encoded escapes)
 * 2. Manifest validation (strict schema/custom mode, rejection of unknowns)
 * 3. ConfigStore persistence, serialization, atomicity, secrets separation
 * 4. RuntimeSettings.plugins.entries sanitization
 */

test("plugin paths: id validation rejects traversal, characters, and dot segments", () => {
  assert.equal(isValidPluginId("sample-plugin"), true);
  assert.equal(isValidPluginId("subagent"), true);
  assert.equal(isValidPluginId("my-ext-1"), true);

  // Invalid IDs for packages
  assert.equal(isValidPluginId("../escape"), false);
  assert.equal(isValidPluginId(".."), false);
  assert.equal(isValidPluginId("."), false);
  assert.equal(isValidPluginId("UpperCase"), false);
  assert.equal(isValidPluginId("plugin_with_underscore"), false);
  assert.equal(isValidPluginId("plugin@name"), false);
  assert.equal(isValidPluginId("plugin:name"), false);
  assert.equal(isValidPluginId(""), false);
  assert.equal(isValidPluginId("a".repeat(64)), false);

  // Safe plugin scope ids (for config/data/cache) allow pi extension directory names
  assert.equal(isSafePluginScopeId("my_ext"), true);
  assert.equal(isSafePluginScopeId("Ext.Name"), true);
  assert.equal(isSafePluginScopeId(".."), false);
  assert.equal(isSafePluginScopeId("."), false);
  assert.equal(isSafePluginScopeId("../escape"), false);
  assert.equal(isSafePluginScopeId("sub/dir"), false);
});

test("plugin paths: derived paths stay inside assigned storage roots", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "molibot-plugin-paths-"));
  const originals = { ...storagePaths };
  try {
    storagePaths.pluginsPackagesDir = path.join(root, "packages");
    storagePaths.pluginsConfigDir = path.join(root, "config");
    storagePaths.pluginsDataDir = path.join(root, "data");
    storagePaths.pluginsCacheDir = path.join(root, "cache");

    fs.mkdirSync(storagePaths.pluginsPackagesDir, { recursive: true });
    fs.mkdirSync(path.join(storagePaths.pluginsPackagesDir, "good-plugin"), { recursive: true });

    // Package dir must exist directly under packages/
    assert.notEqual(pluginPackageDir("good-plugin"), null);
    assert.equal(pluginPackageDir("non-existent"), null);

    // Symlinked package directory pointing outside is rejected
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "molibot-outside-"));
    fs.symlinkSync(outside, path.join(storagePaths.pluginsPackagesDir, "symlinked"));
    assert.equal(pluginPackageDir("symlinked"), null);
    fs.rmSync(outside, { recursive: true, force: true });

    // Scoped dirs
    assert.equal(pluginConfigDir("good-plugin"), path.join(storagePaths.pluginsConfigDir, "good-plugin"));
    assert.equal(pluginDataDir("good-plugin"), path.join(storagePaths.pluginsDataDir, "good-plugin"));
    assert.equal(pluginCacheDir("good-plugin"), path.join(storagePaths.pluginsCacheDir, "good-plugin"));
    assert.equal(pluginSettingsFilePath("good-plugin"), path.join(storagePaths.pluginsConfigDir, "good-plugin", "settings.json"));
    assert.equal(pluginSecretsFilePath("good-plugin"), path.join(storagePaths.pluginsConfigDir, "good-plugin", "secrets.json"));

    // Traversal attempts return null
    assert.equal(pluginConfigDir("../escape"), null);
    assert.equal(pluginDataDir(".."), null);
    assert.equal(pluginCacheDir("foo/bar"), null);
  } finally {
    Object.assign(storagePaths, originals);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("manifest validator: accepts valid schema-mode manifest and compiles schema", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "molibot-manifest-"));
  try {
    const pkg = {
      name: "sample-plugin",
      version: "1.0.0",
      molibot: {
        plugin: {
          manifestVersion: 1,
          id: "sample-plugin",
          name: "Sample Plugin",
          version: "1.0.0",
          description: "A test schema plugin",
          engines: { molibot: ">=2.0.0" },
          config: { schemaVersion: 1 },
          settings: {
            mode: "schema",
            schema: {
              type: "object",
              properties: {
                apiKey: { type: "string" },
                endpoint: { type: "string" },
                enabled: { type: "boolean" }
              },
              required: ["endpoint"]
            },
            presentation: [
              {
                key: "endpoint",
                label: { zh: "服务地址", en: "Endpoint" },
                description: { zh: "API 根路径", en: "API base path" },
                placeholder: "https://api.example.com"
              },
              {
                key: "apiKey",
                label: { zh: "密钥", en: "API Key" },
                secret: true
              }
            ]
          }
        }
      }
    };
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify(pkg), "utf8");

    const result = readMolibotPluginManifest(root, "sample-plugin");
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.value.manifest.id, "sample-plugin");
    assert.equal(result.value.manifest.settings?.mode, "schema");
    assert.notEqual(result.value.settingsValidator, null);
    assert.equal(result.value.settingsValidator?.({ endpoint: "https://a.com" }), true);
    assert.equal(result.value.settingsValidator?.({ apiKey: "123" }), false); // missing required endpoint
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("manifest validator: accepts valid custom-mode manifest and verifies entries", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "molibot-manifest-"));
  try {
    fs.mkdirSync(path.join(root, "ui"), { recursive: true });
    fs.writeFileSync(path.join(root, "ui", "index.html"), "<h1>Settings</h1>", "utf8");
    fs.writeFileSync(path.join(root, "ui", "icon.svg"), "<svg></svg>", "utf8");
    fs.writeFileSync(path.join(root, "runtime.mjs"), "export function onAction() {}", "utf8");

    const pkg = {
      name: "custom-plugin",
      version: "1.0.0",
      molibot: {
        plugin: {
          manifestVersion: 1,
          id: "custom-plugin",
          name: "Custom Plugin",
          version: "1.0.0",
          engines: { molibot: ">=2.0.0" },
          config: { schemaVersion: 1 },
          runtime: { entry: "runtime.mjs", actions: ["detect"] },
          capabilities: ["spawn", "network"],
          settings: {
            mode: "custom",
            ui: {
              entry: "ui/index.html",
              icon: "ui/icon.svg"
            }
          }
        }
      }
    };
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify(pkg), "utf8");

    const result = readMolibotPluginManifest(root, "custom-plugin");
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.value.manifest.settings?.mode, "custom");
    assert.notEqual(result.value.runtimeEntryPath, null);
    assert.notEqual(result.value.settingsUiEntryPath, null);
    assert.notEqual(result.value.iconPath, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("manifest validator: rejects unknown fields and escaping paths", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "molibot-manifest-"));
  try {
    const pkg = {
      name: "bad-plugin",
      version: "1.0.0",
      molibot: {
        plugin: {
          manifestVersion: 1,
          id: "bad-plugin",
          name: "Bad",
          version: "1.0.0",
          engines: { molibot: ">=2.0.0" },
          config: { schemaVersion: 1 },
          unknownField: true
        }
      }
    };
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify(pkg), "utf8");

    const result = readMolibotPluginManifest(root, "bad-plugin");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /unknown field "unknownField"/);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("configStore: serialized atomic read/write and secrets isolation", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "molibot-config-store-"));
  const originals = { ...storagePaths };
  try {
    storagePaths.pluginsConfigDir = path.join(root, "config");
    storagePaths.pluginsDataDir = path.join(root, "data");
    storagePaths.pluginsCacheDir = path.join(root, "cache");
    resetPluginConfigStoreForTests();

    const store = new PluginConfigStore();

    // 1. Missing read returns status: 'missing'
    assert.deepEqual(store.readConfig("my-plugin", 1), { status: "missing" });

    // 2. Write valid config
    const writeRes = await store.writeConfig("my-plugin", 1, { endpoint: "https://api.test", count: 42 });
    assert.equal(writeRes.ok, true);

    // 3. Read back returns saved values
    const readRes = store.readConfig("my-plugin", 1);
    assert.equal(readRes.status, "ok");
    if (readRes.status === "ok") {
      assert.equal(readRes.schemaVersion, 1);
      assert.deepEqual(readRes.values, { endpoint: "https://api.test", count: 42 });
    }

    // 4. Schema version mismatch returns status: 'incompatible' (no implicit guessing)
    assert.deepEqual(store.readConfig("my-plugin", 2), { status: "incompatible", foundSchemaVersion: 1 });

    // 5. Validation failure leaves previous file intact
    const invalidWrite = await store.writeConfig("my-plugin", 1, { bad: true }, {
      validate: (v) => ("bad" in v ? "No bad field allowed" : null)
    });
    assert.equal(invalidWrite.ok, false);
    assert.deepEqual(store.readConfig("my-plugin", 1), {
      status: "ok",
      schemaVersion: 1,
      values: { endpoint: "https://api.test", count: 42 }
    });

    // 6. Secrets write / replace / clear
    await store.writeSecrets("my-plugin", {
      replace: { apiKey: "secret_123", token: "tok_abc" }
    });

    // Public listSecrets returns only presence metadata
    assert.deepEqual(store.listSecrets("my-plugin"), {
      apiKey: { present: true },
      token: { present: true }
    });

    // Runtime-only readSecretValues gets the raw values
    assert.deepEqual(store.readSecretValues("my-plugin"), {
      apiKey: "secret_123",
      token: "tok_abc"
    });

    // Clear one secret; other survives
    await store.writeSecrets("my-plugin", { clear: ["token"] });
    assert.deepEqual(store.listSecrets("my-plugin"), {
      apiKey: { present: true }
    });
    assert.deepEqual(store.readSecretValues("my-plugin"), {
      apiKey: "secret_123"
    });

    // 7. POSIX file mode for secrets is 0600 on POSIX platforms
    if (process.platform !== "win32") {
      const secretsPath = pluginSecretsFilePath("my-plugin")!;
      const stat = fs.statSync(secretsPath);
      // Mode mask 0777 -> check mode ends with 0600
      assert.equal(stat.mode & 0o777, 0o600);
    }

    // 8. Lifecycle: delete config / data / cache
    assert.equal(store.deleteConfigDir("my-plugin"), true);
    assert.deepEqual(store.readConfig("my-plugin", 1), { status: "missing" });
    assert.deepEqual(store.listSecrets("my-plugin"), {});
  } finally {
    resetPluginConfigStoreForTests();
    Object.assign(storagePaths, originals);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("sanitizePluginEntries: only accepts safe ids and boolean enabled state", () => {
  const sanitized = sanitizePluginEntries({
    "valid-plugin": { enabled: true, source: { kind: "builtin" } },
    "another-one": { enabled: false },
    "INVALID_UPPERCASE": { enabled: true },
    "../traversal": { enabled: true },
    "has-arbitrary-blob": {
      enabled: true,
      credentials: { secret: "leak" },
      randomField: 123
    }
  });

  // Only valid ids survived, and arbitrary fields are stripped
  assert.deepEqual(sanitized, {
    "valid-plugin": { enabled: true, source: { kind: "builtin" } },
    "another-one": { enabled: false },
    "has-arbitrary-blob": { enabled: true }
  });

  // RESERVED_PLUGIN_KEYS includes "entries"
  assert.equal(RESERVED_PLUGIN_KEYS.includes("entries"), true);
});
