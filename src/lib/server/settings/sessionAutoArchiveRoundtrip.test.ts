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
 * B4 acceptance: editing the session auto-archive policy must round-trip the
 * whole settings object — save → fresh store → load against a temporary
 * database — without dropping unrelated BOT, provider or model configuration.
 * A narrow serializer that only knows the policy fields fails this test.
 */
test("sessionAutoArchive edit round-trips the whole settings object", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-session-policy-roundtrip-"));
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
    providerMode: "custom",
    customProviders: [
      {
        id: "cliproxy",
        name: "CliProxyAPI",
        enabled: true,
        protocol: "openai-compatible",
        baseUrl: "https://example.test",
        apiKey: "sk-test",
        models: [
          {
            id: "deepseek/deepseek-v3",
            alias: "DeepSeek V3",
            tags: ["text"],
            supportedRoles: ["system", "user", "assistant", "tool"],
            enabled: true
          }
        ],
        defaultModel: "deepseek/deepseek-v3",
        path: "/v1/chat/completions"
      }
    ],
    agents: [
      ...(defaultRuntimeSettings.agents ?? []),
      {
        id: "roundtrip-agent",
        name: "Roundtrip Agent",
        description: "Temporary BOT entry for the round-trip regression.",
        enabled: true
      }
    ] as typeof defaultRuntimeSettings.agents,
    sessionAutoArchive: {
      enabled: false,
      inactiveDays: 30,
      bots: { personal: { mode: "disabled" } }
    }
  };
  new SettingsStore().save(baseline);

  // Edit only the policy, through the same fine-grained path production uses
  // (patch merged over the latest persisted snapshot, never a whole-object
  // overwrite from stale memory).
  const loaded = new SettingsStore().load();
  const edited = sanitizeSettings(
    {
      sessionAutoArchive: {
        enabled: true,
        inactiveDays: 7,
        bots: { ...loaded.sessionAutoArchive.bots, work: { mode: "custom", inactiveDays: 3 } }
      }
    },
    loaded
  );
  new SettingsStore().save(edited);

  const restarted = new SettingsStore().load();
  assert.deepEqual(restarted.sessionAutoArchive, {
    enabled: true,
    inactiveDays: 7,
    bots: { personal: { mode: "disabled" }, work: { mode: "custom", inactiveDays: 3 } }
  });
  // Everything outside the policy survives untouched. The store normalizes
  // absent optional fields to explicit undefined on load, so both sides go
  // through a JSON round-trip that drops undefined before comparing.
  const denull = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
  assert.equal(restarted.providerMode, "custom");
  assert.deepEqual(denull(restarted.customProviders), denull(baseline.customProviders));
  assert.deepEqual(denull(restarted.agents), denull(baseline.agents));
});
