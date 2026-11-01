import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";
import { SettingsStore } from "$lib/server/settings/store.js";
import { sanitizeDesktopNavigation, sanitizeSettings } from "$lib/server/settings/sanitize.js";
import type { DesktopHandoverSnapshot } from "$lib/shared/desktop.js";

const snapshot: DesktopHandoverSnapshot = {
  capturedAt: "2026-10-23T09:00:00.000Z",
  itemCount: 2,
  pendingCount: 1,
  counts: { completed: 1, failed: 1, pending: 1, recovered: 0 },
  items: [
    {
      id: "task:lease-1",
      executionId: "lease-1",
      kind: "task-failed",
      occurredAt: "2026-10-23T08:00:00.000Z",
      agentId: "default",
      sessionId: "session-1",
      runId: "run-1",
      taskId: "task-1",
      title: "Morning briefing",
      durationMs: 2000,
      attempts: 2
    },
    {
      id: "run:run-2",
      kind: "run-completed",
      occurredAt: "2026-10-23T08:30:00.000Z",
      agentId: "default",
      sessionId: "session-2",
      runId: "run-2",
      title: "Summary"
    }
  ]
};

test("Handover window and previous generation round-trip through a fresh store", (t) => {
  const root = mkdtempSync(join(tmpdir(), "molibot-handover-settings-"));
  const original = { ...storagePaths };
  storagePaths.settingsFile = join(root, "settings.json");
  storagePaths.settingsDbFile = join(root, "settings.sqlite");
  t.after(() => {
    Object.assign(storagePaths, original);
    rmSync(root, { recursive: true, force: true });
  });

  const initial = structuredClone(defaultRuntimeSettings);
  new SettingsStore().save(initial);
  const baseline = new SettingsStore().load();
  const staticBefore = readFileSync(storagePaths.settingsFile, "utf8");

  const navigation = {
    expandedAgentIds: ["default", "writer"],
    page: "session",
    agentId: "default",
    sessionId: "session-9",
    lastAcknowledgedAt: "2026-10-23T09:00:00.000Z",
    previousHandover: snapshot
  };
  new SettingsStore().saveDesktopNavigation({ ...initial, desktopNavigation: navigation });
  assert.equal(readFileSync(storagePaths.settingsFile, "utf8"), staticBefore, "navigation-only writes must not touch settings.json");

  const loaded = new SettingsStore().load();
  assert.deepEqual(loaded.desktopNavigation, navigation);
  assert.deepEqual(loaded, { ...baseline, desktopNavigation: navigation });
});

test("Handover settings sanitizer keeps a valid generation and drops an invalid one", () => {
  const valid = sanitizeDesktopNavigation({
    expandedAgentIds: ["default"],
    page: "agent",
    agentId: "default",
    sessionId: "",
    lastAcknowledgedAt: "2026-10-23T09:00:00.000Z",
    previousHandover: snapshot
  });
  assert.equal(valid.lastAcknowledgedAt, "2026-10-23T09:00:00.000Z");
  assert.deepEqual(valid.previousHandover, snapshot);

  const invalid = sanitizeDesktopNavigation({
    expandedAgentIds: [],
    page: "agent",
    agentId: "",
    sessionId: "",
    lastAcknowledgedAt: "not-a-date",
    previousHandover: { capturedAt: "not-a-date", items: [{}] }
  });
  assert.equal(invalid.lastAcknowledgedAt, undefined);
  assert.equal(invalid.previousHandover, undefined);
});

test("Handover snapshot sanitizer caps retained entries at twenty", () => {  const items = Array.from({ length: 25 }, (_, index) => ({
    id: `run:${index}`,
    kind: "run-completed",
    occurredAt: "2026-10-23T08:00:00.000Z",
    agentId: "default",
    title: `Item ${index}`
  }));
  const sanitized = sanitizeDesktopNavigation({
    expandedAgentIds: [],
    page: "agent",
    agentId: "",
    sessionId: "",
    previousHandover: {
      ...snapshot,
      itemCount: 25,
      items
    }
  });
  assert.equal(sanitized.previousHandover?.items.length, 20);
});

test("A partial navigation patch inherits the Handover window and generation", () => {
  const current = sanitizeSettings(
    { desktopNavigation: { expandedAgentIds: [], page: "session", agentId: "default", sessionId: "s-1" } },
    structuredClone(defaultRuntimeSettings)
  );
  current.desktopNavigation = {
    ...current.desktopNavigation,
    lastAcknowledgedAt: "2026-10-23T09:00:00.000Z",
    previousHandover: snapshot
  };

  const next = sanitizeSettings(
    { desktopNavigation: { expandedAgentIds: ["default"], page: "session", agentId: "default", sessionId: "s-2" } },
    current
  );
  assert.equal(next.desktopNavigation.sessionId, "s-2");
  assert.equal(next.desktopNavigation.lastAcknowledgedAt, "2026-10-23T09:00:00.000Z");
  assert.deepEqual(next.desktopNavigation.previousHandover, snapshot);
});
