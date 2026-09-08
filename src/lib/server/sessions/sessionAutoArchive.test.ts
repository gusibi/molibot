import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { SessionStore } from "$lib/server/sessions/store.js";
import { ConversationSearchIndex } from "$lib/server/sessions/conversationSearch.js";
import { SessionLifecycleStore } from "$lib/server/sessions/sessionLifecycleStore.js";
import { SessionLifecycleService } from "$lib/server/sessions/sessionLifecycleService.js";
import type { ExternalManagedCandidate } from "$lib/server/sessions/sessionQueryService.js";
import {
  AUTO_ARCHIVE_DAY_MS,
  SessionAutoArchiveService,
  resolveAutoArchiveThreshold
} from "$lib/server/sessions/sessionAutoArchiveService.js";
import { SessionAutoArchiveStore } from "$lib/server/sessions/sessionAutoArchiveStore.js";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";
import { sanitizeSettings } from "$lib/server/settings/sanitize.js";
import { SettingsStore } from "$lib/server/settings/store.js";
import type { SessionAutoArchiveSettings } from "$lib/server/settings/schema.js";
import {
  deleteSessionAutoArchiveBot,
  getSessionAutoArchive,
  updateSessionAutoArchiveGlobal,
  upsertSessionAutoArchiveBot
} from "$lib/server/settings/handlers/sessionAutoArchive.js";
import { ensureOwnerSessionAutoArchiveEvent } from "$lib/server/agent/taskScheduler.js";
import { existsSync, readFileSync } from "node:fs";

const OWNER = "web:personal:web-anonymous";
const NOW = new Date("2026-09-08T00:00:00.000Z");
const daysAgoIso = (days: number) => new Date(NOW.getTime() - days * AUTO_ARCHIVE_DAY_MS).toISOString();

function policy(overrides?: Partial<SessionAutoArchiveSettings>): SessionAutoArchiveSettings {
  return {
    enabled: true,
    inactiveDays: 30,
    bots: {},
    ...overrides
  };
}

interface Fixture {
  root: string;
  sessions: SessionStore;
  lifecycle: SessionLifecycleStore;
  service: SessionLifecycleService;
  runs: SessionAutoArchiveStore;
  auto: SessionAutoArchiveService;
  search: ConversationSearchIndex;
  externals: ExternalManagedCandidate[];
  originals: Record<string, string>;
  cleanup(): void;
}

function setup(opts?: { busy?: (id: string) => boolean }): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-session-auto-archive-"));
  const originals = {
    webWorkspaceDir: storagePaths.webWorkspaceDir,
    sessionsDir: storagePaths.sessionsDir,
    sessionsIndexFile: storagePaths.sessionsIndexFile,
    projectsDir: storagePaths.projectsDir
  };
  storagePaths.webWorkspaceDir = path.join(root, "web");
  storagePaths.sessionsDir = path.join(root, "legacy");
  storagePaths.sessionsIndexFile = path.join(root, "legacy-index.json");
  storagePaths.projectsDir = path.join(root, "projects");

  const clock = () => new Date(NOW);
  const sessions = new SessionStore();
  const search = new ConversationSearchIndex(":memory:");
  sessions.setConversationSearchIndex(search, "web");
  const externals: ExternalManagedCandidate[] = [];
  const lifecycle = new SessionLifecycleStore(path.join(root, "sessions.db"), { clock });
  const service = new SessionLifecycleService({
    sessions,
    lifecycle,
    clock,
    isBusy: opts?.busy,
    listExternal: () => [...externals]
  });
  sessions.setSessionActivitySink(service);
  const runs = new SessionAutoArchiveStore(path.join(root, "sessions.db"), { clock });
  const auto = new SessionAutoArchiveService({ lifecycle: service, runs, clock });
  let closed = false;
  return {
    root,
    sessions,
    lifecycle,
    service,
    runs,
    auto,
    search,
    externals,
    originals,
    cleanup() {
      if (closed) return;
      closed = true;
      try { search.close(); } catch { /* already closed */ }
      try { runs.close(); } catch { /* already closed */ }
      try { lifecycle.close(); } catch { /* already closed */ }
      Object.assign(storagePaths, originals);
      rmSync(root, { recursive: true, force: true });
    }
  };
}

/** Create a web session and pin its lifecycle activity to an exact age. */
function agedSession(fx: Fixture, owner: string, daysAgo: number | null): string {
  const conversation = fx.sessions.createWebConversation(owner);
  fx.sessions.appendMessage(conversation.id, "user", "hello");
  const row = fx.lifecycle.ensureRow(conversation.id, { createdAt: conversation.createdAt });
  if (daysAgo !== null) {
    fx.lifecycle.updateWithVersion(conversation.id, row.version, {
      lastActivityAt: daysAgoIso(daysAgo)
    });
  }
  return conversation.id;
}

test("automatic archive is off by default with a 30-day threshold", () => {
  assert.equal(defaultRuntimeSettings.sessionAutoArchive.enabled, false);
  assert.equal(defaultRuntimeSettings.sessionAutoArchive.inactiveDays, 30);
  assert.deepEqual(defaultRuntimeSettings.sessionAutoArchive.bots, {});
});

test("exact threshold qualifies, one second under does not", () => {
  const fx = setup();
  try {
    const exact = agedSession(fx, OWNER, 30);
    const fresh = agedSession(fx, OWNER, null);
    // Nudge the fresh session to 29 days, 23:59:59 ago (one second under).
    const row = fx.lifecycle.get(fresh);
    assert.ok(row);
    fx.lifecycle.updateWithVersion(fresh, row.version, {
      lastActivityAt: new Date(NOW.getTime() - 30 * AUTO_ARCHIVE_DAY_MS + 1000).toISOString()
    });
    const candidates = fx.auto.previewCandidates(policy());
    const ids = candidates.map((item) => item.conversationId);
    assert.ok(ids.includes(exact), "exactly 30 elapsed days qualifies");
    assert.ok(!ids.includes(fresh), "one second under the threshold does not qualify");
  } finally {
    fx.cleanup();
  }
});

test("preview counts without mutating sessions", () => {
  const fx = setup();
  try {
    agedSession(fx, OWNER, 45);
    const before = fx.auto.previewCandidates(policy());
    assert.equal(before.length, 1);
    const after = fx.auto.previewCandidates(policy());
    assert.equal(after.length, 1);
    assert.equal(fx.service.queryManaged({ state: "active" }).total, 1);
    assert.equal(fx.service.queryManaged({ state: "archived" }).total, 0);
  } finally {
    fx.cleanup();
  }
});

test("disabled policy never runs", () => {
  const fx = setup();
  try {
    agedSession(fx, OWNER, 90);
    const result = fx.auto.runSweep(policy({ enabled: false }));
    assert.equal(result.ran, false);
    assert.equal(result.archivedCount, 0);
    assert.equal(fx.service.queryManaged({ state: "active" }).total, 1);
    assert.equal(fx.runs.getLastRun(), null);
  } finally {
    fx.cleanup();
  }
});

test("sweep archives old sessions, skips fresh ones", () => {
  const fx = setup();
  try {
    const oldId = agedSession(fx, OWNER, 45);
    agedSession(fx, OWNER, 5);
    const result = fx.auto.runSweep(policy());
    assert.equal(result.ran, true);
    assert.equal(result.candidateCount, 1);
    assert.equal(result.archivedCount, 1);
    assert.deepEqual(result.archivedIds, [oldId]);
    assert.equal(fx.service.queryManaged({ state: "active" }).total, 1);
    assert.equal(fx.service.queryManaged({ state: "archived" }).total, 1);
  } finally {
    fx.cleanup();
  }
});

test("busy sessions are skipped by the sweep", () => {
  let busyId = "";
  const fx = setup({ busy: (id) => id === busyId });
  try {
    busyId = agedSession(fx, OWNER, 60);
    const plain = agedSession(fx, OWNER, 60);
    const result = fx.auto.runSweep(policy());
    assert.equal(result.archivedCount, 1);
    assert.deepEqual(result.archivedIds, [plain]);
    assert.equal(result.skippedCount, 1);
    assert.equal(fx.service.queryManaged({ state: "archived" }).total, 1);
  } finally {
    fx.cleanup();
  }
});

test("protected, trashed and already-archived sessions are skipped", () => {
  const fx = setup();
  try {
    const retained = agedSession(fx, OWNER, 60);
    fx.service.setRetain({ conversationId: retained, retain: true });
    const trashed = agedSession(fx, OWNER, 60);
    assert.equal(fx.service.trash({ conversationId: trashed }).status, "succeeded");
    const archived = agedSession(fx, OWNER, 60);
    assert.equal(fx.service.archive({ conversationId: archived }).status, "succeeded");
    const result = fx.auto.runSweep(policy());
    assert.equal(result.candidateCount, 1);
    assert.equal(result.skippedCount, 1);
    assert.equal(result.archivedCount, 0);
    // Trash row keeps its state; sweep never touches trash expiry.
    assert.equal(fx.service.queryManaged({ state: "trashed" }).total, 1);
    assert.equal(fx.service.queryManaged({ state: "archived" }).total, 1);
  } finally {
    fx.cleanup();
  }
});

test("per-BOT threshold resolution: local/project inherit global, external honors overrides", () => {
  const base = policy({ bots: { botA: { mode: "disabled" }, botB: { mode: "custom", inactiveDays: 7 } } });
  assert.equal(resolveAutoArchiveThreshold("local", "botA", base), 30);
  assert.equal(resolveAutoArchiveThreshold("project", "botB", base), 30);
  assert.equal(resolveAutoArchiveThreshold("external", "botA", base), null);
  assert.equal(resolveAutoArchiveThreshold("external", "botB", base), 7);
  assert.equal(resolveAutoArchiveThreshold("external", "unknown", base), 30);
  assert.equal(
    resolveAutoArchiveThreshold("external", "botB", policy({ bots: { botB: { mode: "custom" } } })),
    30,
    "custom without days falls back to global"
  );
});

test("disabled per-BOT external sessions never appear as candidates", () => {
  const fx = setup();
  try {
    const createdAt = daysAgoIso(90);
    fx.externals.push({
      conversation: {
        id: "ext-disabled-1",
        channel: "telegram",
        externalUserId: "bot:botA:chat:1:ext-disabled-1",
        title: "old external",
        createdAt,
        updatedAt: createdAt
      },
      botId: "botA",
      channel: "telegram"
    });
    fx.lifecycle.ensureRow("ext-disabled-1", { createdAt, lastActivityAt: createdAt });
    const preview = fx.auto.previewCandidates(
      policy({ bots: { botA: { mode: "disabled" } } })
    );
    assert.ok(!preview.some((item) => item.conversationId === "ext-disabled-1"));
    const result = fx.auto.runSweep(policy({ bots: { botA: { mode: "disabled" } } }));
    assert.equal(result.archivedCount, 0);
  } finally {
    fx.cleanup();
  }
});

test("overlapping and replayed sweeps converge without duplicate work", () => {
  const fx = setup();
  try {
    agedSession(fx, OWNER, 60);
    agedSession(fx, OWNER, 61);
    const first = fx.auto.runSweep(policy(), { runId: "sweep-1" });
    assert.equal(first.archivedCount, 2);
    const replay = fx.auto.runSweep(policy(), { runId: "sweep-2" });
    assert.equal(replay.ran, true);
    assert.equal(replay.candidateCount, 0);
    assert.equal(replay.archivedCount, 0);
    assert.equal(fx.service.queryManaged({ state: "archived" }).total, 2);
    // Manual archive of the same id is idempotent too (success, no duplicate work).
    const again = fx.service.archive({ conversationId: first.archivedIds[0] });
    assert.equal(again.status, "succeeded");
    assert.equal(fx.service.queryManaged({ state: "archived" }).total, 2);
  } finally {
    fx.cleanup();
  }
});

test("crashed sweep reconciles on next run without replaying missed days", () => {
  const fx = setup();
  try {
    agedSession(fx, OWNER, 60);
    fx.runs.beginRun("crashed-run");
    assert.equal(fx.runs.reconcileInterrupted(), 1);
    const interrupted = fx.runs.get("crashed-run");
    assert.equal(interrupted?.status, "interrupted");
    const result = fx.auto.runSweep(policy(), { runId: "after-crash" });
    assert.equal(result.ran, true);
    assert.equal(result.archivedCount, 1, "one fresh pass, not one replay per missed day");
    const last = fx.runs.getLastRun();
    assert.equal(last?.runId, "after-crash");
    assert.equal(last?.status, "completed");
  } finally {
    fx.cleanup();
  }
});

test("last run result is available for the management page", () => {
  const fx = setup();
  try {
    assert.equal(fx.auto.getLastRun(), null);
    agedSession(fx, OWNER, 60);
    const result = fx.auto.runSweep(policy());
    const last = fx.auto.getLastRun();
    assert.ok(last);
    assert.equal(last.runId, result.runId);
    assert.equal(last.archivedCount, 1);
    assert.equal(last.candidateCount, 1);
  } finally {
    fx.cleanup();
  }
});

test("elapsed-day threshold is stable across configured timezones", () => {
  const previousTz = process.env.TZ;
  const fx = setup();
  try {
    agedSession(fx, OWNER, 30);
    process.env.TZ = "Pacific/Kiritimati";
    const east = fx.auto.previewCount(policy());
    process.env.TZ = "Pacific/Midway";
    const west = fx.auto.previewCount(policy());
    assert.equal(east, 1);
    assert.equal(west, 1);
  } finally {
    if (previousTz === undefined) delete process.env.TZ;
    else process.env.TZ = previousTz;
    fx.cleanup();
  }
});

test("policy survives save, new store and load with other settings untouched", () => {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-auto-archive-settings-"));
  const originalFile = storagePaths.settingsFile;
  const originalDb = storagePaths.settingsDbFile;
  storagePaths.settingsFile = path.join(root, "settings.json");
  storagePaths.settingsDbFile = path.join(root, "settings.sqlite");
  try {
    const edited: typeof defaultRuntimeSettings = {
      ...defaultRuntimeSettings,
      sessionAutoArchive: {
        enabled: true,
        inactiveDays: 7,
        bots: { botA: { mode: "custom", inactiveDays: 3 }, botB: { mode: "disabled" } }
      }
    };
    new SettingsStore().save(edited);
    const restarted = new SettingsStore().load();
    assert.deepEqual(restarted.sessionAutoArchive, edited.sessionAutoArchive);
    assert.equal(restarted.providerMode, defaultRuntimeSettings.providerMode);
  } finally {
    storagePaths.settingsFile = originalFile;
    storagePaths.settingsDbFile = originalDb;
    rmSync(root, { recursive: true, force: true });
  }
});

test("sanitize clamps thresholds and drops invalid per-BOT rows", () => {
  const current = defaultRuntimeSettings;
  const next = sanitizeSettings(
    {
      sessionAutoArchive: {
        enabled: "true" as unknown as boolean,
        inactiveDays: 500,
        bots: {
          ok: { mode: "custom", inactiveDays: 3 },
          bad: { mode: "sometimes" } as unknown as { mode: "inherit" },
          overflow: { mode: "custom", inactiveDays: -5 }
        }
      }
    },
    current
  );
  assert.equal(next.sessionAutoArchive.enabled, true);
  assert.equal(next.sessionAutoArchive.inactiveDays, 365);
  assert.deepEqual(next.sessionAutoArchive.bots.ok, { mode: "custom", inactiveDays: 3 });
  assert.ok(!("bad" in next.sessionAutoArchive.bots));
  assert.deepEqual(next.sessionAutoArchive.bots.overflow, { mode: "custom" });
});

test("fine-grained handlers never overwrite other bots or global fields", () => {
  let current: typeof defaultRuntimeSettings = {
    ...defaultRuntimeSettings,
    sessionAutoArchive: { enabled: true, inactiveDays: 30, bots: { keep: { mode: "disabled" } } }
  };
  const patches: Array<Partial<typeof defaultRuntimeSettings>> = [];
  const runtime = {
    getSettings: () => current,
    updateSettings: (patch: Partial<typeof defaultRuntimeSettings>) => {
      patches.push(patch);
      current = { ...current, ...patch };
      return current;
    }
  };
  const saved = upsertSessionAutoArchiveBot(runtime, " newcomer ", { mode: "custom", inactiveDays: 9 });
  assert.equal(saved.botId, "newcomer");
  assert.deepEqual(current.sessionAutoArchive.bots.keep, { mode: "disabled" });
  assert.deepEqual(current.sessionAutoArchive.bots.newcomer, { mode: "custom", inactiveDays: 9 });
  assert.equal(patches.length, 1);
  assert.ok(!("providerMode" in (patches[0] as Record<string, unknown>)));

  const global = updateSessionAutoArchiveGlobal(runtime, { inactiveDays: 14 });
  assert.equal(global.inactiveDays, 14);
  assert.equal(global.enabled, true);
  assert.deepEqual(current.sessionAutoArchive.bots.keep, { mode: "disabled" });

  const read = getSessionAutoArchive(runtime);
  assert.deepEqual(read, current.sessionAutoArchive);
  assert.notEqual(read.bots, current.sessionAutoArchive.bots, "returns a copy");

  assert.deepEqual(deleteSessionAutoArchiveBot(runtime, "keep"), { ok: true });
  assert.ok(!("keep" in current.sessionAutoArchive.bots));
  assert.ok("newcomer" in current.sessionAutoArchive.bots);
});

test("watched-event JSON enables and disables the daily sweep", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "molibot-auto-archive-events-"));
  try {
    const written = ensureOwnerSessionAutoArchiveEvent(dir, {
      ...defaultRuntimeSettings,
      sessionAutoArchive: { enabled: true, inactiveDays: 30, bots: {} }
    });
    assert.ok(written);
    assert.ok(existsSync(written as string));
    const event = JSON.parse(readFileSync(written as string, "utf8")) as {
      internal?: { kind?: string };
      execution?: string;
      schedule?: string;
    };
    assert.equal(event.internal?.kind, "session-auto-archive");
    assert.equal(event.execution, "internal");

    const removed = ensureOwnerSessionAutoArchiveEvent(dir, {
      ...defaultRuntimeSettings,
      sessionAutoArchive: { enabled: false, inactiveDays: 30, bots: {} }
    });
    assert.equal(removed, null);
    const disabled = JSON.parse(readFileSync(written as string, "utf8")) as { enabled?: boolean };
    assert.equal(disabled.enabled, false, "disabling keeps the watched file but turns it off");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("auto-archive store persists progress in a temporary database only", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "molibot-auto-archive-runs-"));
  const dbFile = path.join(dir, "sessions.db");
  try {
    const store = new SessionAutoArchiveStore(dbFile);
    store.beginRun("run-1");
    const finished = store.finishRun("run-1", {
      candidateCount: 2,
      archivedCount: 1,
      skippedCount: 1,
      failedCount: 0
    });
    assert.equal(finished.status, "completed");
    store.close();
    const reopened = new SessionAutoArchiveStore(dbFile);
    try {
      assert.deepEqual(reopened.getLastRun(), finished);
    } finally {
      reopened.close();
    }
    const sqliteFiles = new DatabaseSync(dbFile)
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='auto_archive_runs'")
      .get();
    assert.ok(sqliteFiles);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
