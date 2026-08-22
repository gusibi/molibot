import assert from "node:assert/strict";
import test from "node:test";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";
import { listCoreSettingsPlugins, setCoreSettingsPluginEnabled } from "./coreSettings.js";

test("core settings catalog always exposes memory and daily materials", () => {
  const settings = structuredClone(defaultRuntimeSettings);
  settings.plugins.memory.enabled = true;
  settings.plugins.memory.dailyMaterials.enabled = false;
  const items = listCoreSettingsPlugins(settings);
  assert.deepEqual(items.map((item) => item.id), ["memory", "daily-materials"]);
  assert.equal(items[0].enabled, true);
  assert.equal(items[1].enabled, false);
});

test("core settings enablement updates only the requested built-in", () => {
  let settings = structuredClone(defaultRuntimeSettings);
  const runtime = {
    getSettings: () => settings,
    updateSettings: (patch: Partial<typeof settings>) => {
      settings = { ...settings, ...patch };
      return settings;
    }
  };

  setCoreSettingsPluginEnabled(runtime, "daily-materials", true);
  assert.equal(settings.plugins.memory.dailyMaterials.enabled, true);
  assert.equal(settings.plugins.memory.enabled, defaultRuntimeSettings.plugins.memory.enabled);
});
