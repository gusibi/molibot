import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";
import { sanitizeSettings } from "$lib/server/settings/sanitize.js";
import { SettingsStore } from "$lib/server/settings/store.js";

/**
 * Durable Execution executor policy must survive save → fresh store → load.
 * This guards the narrow-serializer failure mode where a new field is dropped
 * on restart (the exact class the sessionAutoArchive round-trip covers).
 */
test("durable settings round-trip the whole settings object", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-durable-settings-roundtrip-"));
  const originalSettingsFile = storagePaths.settingsFile;
  const originalSettingsDbFile = storagePaths.settingsDbFile;
  storagePaths.settingsFile = path.join(root, "settings.json");
  storagePaths.settingsDbFile = path.join(root, "settings.sqlite");
  t.after(() => {
    storagePaths.settingsFile = originalSettingsFile;
    storagePaths.settingsDbFile = originalSettingsDbFile;
    rmSync(root, { recursive: true, force: true });
  });

  const baseline: typeof defaultRuntimeSettings = {
    ...defaultRuntimeSettings,
    events: { ...defaultRuntimeSettings.events, executionTimeoutMs: 600_000 },
    durable: { leaseDurationMs: 600_000, wakeupMode: "db", wakeupRetentionDays: 7, instanceGuard: true }
  };
  new SettingsStore().save(baseline);

  const loaded = new SettingsStore().load();
  const edited = sanitizeSettings(
    {
      durable: { leaseDurationMs: 900_000, wakeupMode: "both", wakeupRetentionDays: 3, instanceGuard: false }
    },
    loaded
  );
  new SettingsStore().save(edited);

  const restarted = new SettingsStore().load();
  assert.deepEqual(restarted.durable, {
    leaseDurationMs: 900_000,
    wakeupMode: "both",
    wakeupRetentionDays: 3,
    instanceGuard: false
  });
  // The generic event timeout is no longer the executor lease; editing one must
  // not move the other.
  assert.equal(restarted.events.executionTimeoutMs, 600_000);
});

test("durable settings sanitize unknown modes and clamp bounds", () => {
  const sanitized = sanitizeSettings(
    { durable: { leaseDurationMs: 1, wakeupMode: "sqlite", wakeupRetentionDays: 999, instanceGuard: "true" } },
    defaultRuntimeSettings
  );
  assert.equal(sanitized.durable.leaseDurationMs, 5_000);
  assert.equal(sanitized.durable.wakeupMode, defaultRuntimeSettings.durable.wakeupMode);
  assert.equal(sanitized.durable.wakeupRetentionDays, 365);
  assert.equal(sanitized.durable.instanceGuard, true);
});
