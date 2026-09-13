import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { SettingsStore } from "$lib/server/settings/store.js";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";
import { isTraceViewerEnabled, traceViewerFeaturePlugin } from "./plugin.js";
import { readMolibotPluginManifest } from "$lib/server/plugins/contract/manifest.js";

test("the bundled plugin validates and its enable setting survives a full store round trip", () => {
  const root = mkdtempSync(join(tmpdir(), "trace-settings-"));
  const previous = { ...storagePaths };
  try {
    storagePaths.settingsDbFile = join(root, "settings.sqlite");
    storagePaths.settingsFile = join(root, "settings.json");
    const store = new SettingsStore();
    store.save(defaultRuntimeSettings);
    const expected = store.load();
    expected.plugins.entries = { ...expected.plugins.entries, "trace-viewer": { enabled: true, source: { kind: "builtin" } } };
    store.save(expected);
    const loaded = new SettingsStore().load();
    assert.deepEqual(loaded, expected);
    assert.equal(isTraceViewerEnabled(loaded), true);
    assert.equal(readMolibotPluginManifest(join(process.cwd(), "package/trace-viewer"), "trace-viewer").ok, true);
    const tools = traceViewerFeaturePlugin.createTools!({ getSettings: () => loaded, cwd: root, workspaceDir: root });
    assert.equal(tools[0].name, "viewTrace");
  } finally { Object.assign(storagePaths, previous); rmSync(root, { recursive: true, force: true }); }
});
