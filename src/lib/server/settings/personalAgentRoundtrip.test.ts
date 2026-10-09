import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { defaultRuntimeSettings } from "./defaults.js";
import { SettingsStore } from "./store.js";
import { sanitizeSettings } from "./sanitize.js";

test("Agent metadata, default and navigation round-trip without dropping unrelated settings", t => {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-personal-settings-"));
  const original = { ...storagePaths };
  storagePaths.settingsFile = path.join(root, "settings.json");
  storagePaths.settingsDbFile = path.join(root, "settings.sqlite");
  t.after(() => { Object.assign(storagePaths, original); rmSync(root, { recursive: true, force: true }); });
  new SettingsStore().save({ ...defaultRuntimeSettings, agents: [{ id: "writer", name: "Writer", enabled: true, description: "" }] });
  const current = new SettingsStore().load();
  assert.ok(current.agents.some(agent => agent.id === "default"));
  const expected = sanitizeSettings({
    defaultAgentId: "researcher",
    deletedAgentIds: ["retired"],
    desktopNavigation: { expandedAgentIds: ["researcher"], page: "agent", agentId: "researcher", sessionId: "" },
    agents: [...current.agents, { id: "researcher", name: "Researcher", enabled: true, description: "Research", visible: false, avatar: "https://example.test/avatar.png", shareOwnerMemory: false }]
  }, current);
  expected.agents.sort((a, b) => a.id.localeCompare(b.id));
  new SettingsStore().save(expected);
  const staticBefore = readFileSync(storagePaths.settingsFile, "utf8");
  const navigation = { ...expected.desktopNavigation, page: "session", sessionId: "older-session" };
  new SettingsStore().saveDesktopNavigation({ ...expected, desktopNavigation: navigation });
  assert.equal(readFileSync(storagePaths.settingsFile, "utf8"), staticBefore);
  expected.desktopNavigation = navigation;
  const actual = new SettingsStore().load();
  assert.equal(actual.defaultAgentId, "researcher");
  assert.deepEqual(actual.deletedAgentIds, ["retired"]);
  assert.deepEqual(actual.desktopNavigation, expected.desktopNavigation);
  assert.deepEqual(actual.agents, expected.agents);
  assert.deepEqual(actual, expected);
});
