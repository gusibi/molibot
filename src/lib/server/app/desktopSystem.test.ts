import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults";
import { SettingsStore } from "$lib/server/settings/store";
import { storagePaths } from "$lib/server/infra/db/storage";
import { readDesktopSystem, updateDesktopSystem } from "./desktopSystem";
import type { RuntimeSettings } from "$lib/server/settings/schema";

test("Desktop System saves field patches and round-trips the whole settings object without changing other pages", async () => {
  const root = mkdtempSync(join(tmpdir(), "molibot-desktop-system-"));
  const originalPaths = { settingsFile: storagePaths.settingsFile, settingsDbFile: storagePaths.settingsDbFile };
  Object.assign(storagePaths, { settingsFile: join(root, "settings.json"), settingsDbFile: join(root, "settings.sqlite") });
  try {
    let store = new SettingsStore();
    store.save(structuredClone(defaultRuntimeSettings));
    let settings = store.load();
    const initial = structuredClone(settings);
    const runtime = { getSettings: () => settings, updateSettings: (patch: Partial<RuntimeSettings>) => {
      store.save({ ...settings, ...patch }); settings = store.load(); return settings;
    } };
    assert.deepEqual(Object.keys(readDesktopSystem(runtime)).sort(), ["serverPort", "timezone", "budget", "subagentRuntime", "browserAutomation", "display"].sort());
    await updateDesktopSystem(runtime, {
      timezone: "Asia/Tokyo", budget: { maxModelAttempts: 9 },
      subagentRuntime: { maxModelRetries: 25, deadlineMs: 1_800_000 },
      browserAutomation: { defaultTimeoutMs: 90000 },
      display: { toolProgress: "verbose", showReasoning: "stream", gatewayNotifyInterval: 10 }
    });
    assert.equal(settings.budget.maxModelAttempts, 9);
    assert.equal(settings.budget.maxToolCalls, initial.budget.maxToolCalls);
    assert.equal(settings.subagentRuntime.maxModelRetries, 25);
    assert.equal(settings.subagentRuntime.maxTasks, initial.subagentRuntime.maxTasks);
    assert.equal(settings.display!.runLogNotice, initial.display!.runLogNotice);
    for (const key of Object.keys(initial).filter(key => !["timezone", "budget", "subagentRuntime", "browserAutomation", "display"].includes(key)) as Array<keyof RuntimeSettings>) {
      assert.deepEqual(settings[key], initial[key], `unrelated field ${key} must remain unchanged`);
    }
    const saved = structuredClone(settings);
    store = new SettingsStore();
    assert.deepEqual(store.load(), saved);
    await assert.rejects(() => updateDesktopSystem(runtime, { timezone: "Not/A_Timezone" }), /timezone|时区/i);
  } finally { Object.assign(storagePaths, originalPaths); rmSync(root, { recursive: true, force: true }); }
});
