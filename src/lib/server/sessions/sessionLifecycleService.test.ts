import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { SessionStore } from "$lib/server/sessions/store.js";
import { ConversationSearchIndex } from "$lib/server/sessions/conversationSearch.js";
import { listAuthorizedConversationSources } from "$lib/server/sessions/conversationAuthorization.js";
import { SessionLifecycleStore } from "$lib/server/sessions/sessionLifecycleStore.js";
import { SessionLifecycleService } from "$lib/server/sessions/sessionLifecycleService.js";

const OWNER = "web:personal:web-anonymous";
const OTHER = "web:other:web-anonymous";

interface Fixture {
  root: string;
  sessions: SessionStore;
  lifecycle: SessionLifecycleStore;
  service: SessionLifecycleService;
  search: ConversationSearchIndex;
  now: { value: Date };
  originals: Record<string, string>;
  cleanup(): void;
}

function setup(opts?: { busy?: (id: string) => boolean }): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-session-lifecycle-"));
  const originals = {
    webWorkspaceDir: storagePaths.webWorkspaceDir,
    sessionsDir: storagePaths.sessionsDir,
    sessionsIndexFile: storagePaths.sessionsIndexFile
  };
  storagePaths.webWorkspaceDir = path.join(root, "web");
  storagePaths.sessionsDir = path.join(root, "legacy");
  storagePaths.sessionsIndexFile = path.join(root, "legacy-index.json");

  const now = { value: new Date("2026-09-01T10:00:00.000Z") };
  const clock = () => new Date(now.value);
  const sessions = new SessionStore();
  const search = new ConversationSearchIndex(":memory:");
  sessions.setConversationSearchIndex(search, "web");
  const lifecycle = new SessionLifecycleStore(path.join(root, "sessions.db"), { clock });
  const service = new SessionLifecycleService({ sessions, lifecycle, clock, isBusy: opts?.busy });
  sessions.setSessionActivitySink(service);
  let closed = false;
  return {
    root,
    sessions,
    lifecycle,
    service,
    search,
    now,
    originals,
    cleanup() {
      if (closed) return;
      closed = true;
      try { search.close(); } catch { /* already closed by the test */ }
      try { lifecycle.close(); } catch { /* already closed by the test */ }
      Object.assign(storagePaths, originals);
      rmSync(root, { recursive: true, force: true });
    }
  };
}

function authorizedHits(fx: Fixture, query: string) {
  return fx.search.search({
    query,
    authorizedSources: listAuthorizedConversationSources({ botId: "web", channel: "web", chatId: OWNER })
  });
}

test("archive hides from active, stays searchable, restore returns it", (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const conversation = fx.sessions.createWebConversation(OWNER);
  fx.sessions.appendMessage(conversation.id, "user", "archive me please");
  fx.sessions.appendMessage(conversation.id, "assistant", "archived content here");

  const archived = fx.service.archive({ conversationId: conversation.id, requesterExternalUserId: OWNER });
  assert.equal(archived.status, "succeeded");
  assert.deepEqual(fx.service.query({ requesterExternalUserId: OWNER }).map((item) => item.conversation.id), []);
  const archivedView = fx.service.query({ requesterExternalUserId: OWNER, state: "archived" });
  assert.deepEqual(archivedView.map((item) => item.conversation.id), [conversation.id]);
  assert.ok(archivedView[0]?.lifecycle.archivedAt);
  // Archived sessions remain searchable.
  assert.ok(authorizedHits(fx, "archive").length > 0);

  const restored = fx.service.restoreArchived({ conversationId: conversation.id, requesterExternalUserId: OWNER });
  assert.equal(restored.status, "succeeded");
  assert.deepEqual(fx.service.query({ requesterExternalUserId: OWNER }).map((item) => item.conversation.id), [conversation.id]);
});

test("trash is recoverable: transcript retained, search removed, restore returns pre-trash state", (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const conversation = fx.sessions.createWebConversation(OWNER);
  fx.sessions.appendMessage(conversation.id, "user", "trashable unique keyword zxqwert");
  fx.sessions.appendMessage(conversation.id, "assistant", "reply here");
  assert.ok(authorizedHits(fx, "zxqwert").length > 0);

  const trashed = fx.service.trash({ conversationId: conversation.id, requesterExternalUserId: OWNER });
  assert.equal(trashed.status, "succeeded");
  if (trashed.status !== "succeeded") return;
  assert.equal(trashed.state, "trashed");
  // Transcript and messages survive trash for full restore.
  assert.notEqual(fx.sessions.getConversationById(conversation.id, "web", OWNER), null);
  assert.equal(fx.sessions.listMessages(conversation.id).length, 2);
  // Search projection is removed immediately.
  assert.equal(authorizedHits(fx, "zxqwert").length, 0);
  assert.equal(fx.service.query({ requesterExternalUserId: OWNER, state: "trashed" }).length, 1);

  const restored = fx.service.restoreTrashed({ conversationId: conversation.id, requesterExternalUserId: OWNER });
  assert.equal(restored.status, "succeeded");
  if (restored.status !== "succeeded") return;
  assert.equal(restored.state, "active");
  assert.ok(authorizedHits(fx, "zxqwert").length > 0);
  assert.equal(fx.service.query({ requesterExternalUserId: OWNER }).length, 1);
});

test("restore returns an archived session to archived, not active", (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const conversation = fx.sessions.createWebConversation(OWNER);
  assert.equal(fx.service.archive({ conversationId: conversation.id, requesterExternalUserId: OWNER }).status, "succeeded");
  assert.equal(fx.service.trash({ conversationId: conversation.id, requesterExternalUserId: OWNER }).status, "succeeded");
  const restored = fx.service.restoreTrashed({ conversationId: conversation.id, requesterExternalUserId: OWNER });
  assert.equal(restored.status, "succeeded");
  if (restored.status !== "succeeded") return;
  assert.equal(restored.state, "archived");
});

test("cross-owner isolation: operations and queries recheck authorization", (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const conversation = fx.sessions.createWebConversation(OWNER);

  assert.deepEqual(fx.service.trash({ conversationId: conversation.id, requesterExternalUserId: OTHER }), {
    status: "skipped",
    conversationId: conversation.id,
    reason: "unauthorized"
  });
  assert.deepEqual(fx.service.archive({ conversationId: conversation.id, requesterExternalUserId: OTHER }), {
    status: "skipped",
    conversationId: conversation.id,
    reason: "unauthorized"
  });
  assert.equal(fx.service.query({ requesterExternalUserId: OTHER }).length, 0);
  assert.equal(fx.service.query({ requesterExternalUserId: OWNER }).length, 1);
  assert.deepEqual(fx.service.trash({ conversationId: "missing-id", requesterExternalUserId: OWNER }), {
    status: "skipped",
    conversationId: "missing-id",
    reason: "not_found"
  });
});

test("busy targets refuse archive and deletion", (t) => {
  const busy = new Set<string>();
  const fx = setup({ busy: (id) => busy.has(id) });
  t.after(() => fx.cleanup());
  const conversation = fx.sessions.createWebConversation(OWNER);
  busy.add(conversation.id);

  assert.deepEqual(fx.service.archive({ conversationId: conversation.id, requesterExternalUserId: OWNER }), {
    status: "skipped",
    conversationId: conversation.id,
    reason: "busy"
  });
  assert.deepEqual(fx.service.trash({ conversationId: conversation.id, requesterExternalUserId: OWNER }), {
    status: "skipped",
    conversationId: conversation.id,
    reason: "busy"
  });
  busy.delete(conversation.id);
  assert.equal(fx.service.archive({ conversationId: conversation.id, requesterExternalUserId: OWNER }).status, "succeeded");
});

test("stale versions are skipped instead of acting on preview assumptions", (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const conversation = fx.sessions.createWebConversation(OWNER);
  const row = fx.lifecycle.ensureRow(conversation.id);
  assert.deepEqual(fx.service.archive({ conversationId: conversation.id, requesterExternalUserId: OWNER, expectedVersion: row.version + 5 }), {
    status: "skipped",
    conversationId: conversation.id,
    reason: "stale_version"
  });
  assert.equal(fx.service.query({ requesterExternalUserId: OWNER }).length, 1);
});

test("long-term retention blocks deletion but allows explicit archive", (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const conversation = fx.sessions.createWebConversation(OWNER);
  assert.equal(fx.service.setRetain({ conversationId: conversation.id, retain: true, requesterExternalUserId: OWNER }).status, "succeeded");
  const trashed = fx.service.trash({ conversationId: conversation.id, requesterExternalUserId: OWNER });
  assert.equal(trashed.status, "skipped");
  if (trashed.status !== "skipped") return;
  assert.equal(trashed.reason, "protected");
  assert.equal(fx.service.archive({ conversationId: conversation.id, requesterExternalUserId: OWNER }).status, "succeeded");
});

test("last activity advances only for user/assistant messages, backfilled from evidence", (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const conversation = fx.sessions.createWebConversation(OWNER);
  // No messages yet: no fabricated activity date.
  assert.equal(fx.lifecycle.ensureRow(conversation.id).lastActivityAt, null);

  fx.sessions.appendMessage(conversation.id, "user", "hello");
  const afterUser = fx.lifecycle.get(conversation.id)?.lastActivityAt;
  assert.ok(afterUser);

  fx.sessions.renameConversation(conversation.id, "web", OWNER, "renamed title");
  assert.equal(fx.lifecycle.get(conversation.id)?.lastActivityAt, afterUser);

  // Historical evidence backfills without fabricating a recent date: a fresh
  // store row over the same transcript resolves the same activity timestamp.
  fx.lifecycle.deleteRow(conversation.id);
  const backfilled = fx.service.query({ requesterExternalUserId: OWNER })[0]?.lifecycle;
  assert.equal(backfilled?.lastActivityAt, afterUser);
});

test("failed purge keeps the session trashed and recoverable", (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const conversation = fx.sessions.createWebConversation(OWNER);
  assert.equal(fx.service.trash({ conversationId: conversation.id, requesterExternalUserId: OWNER }).status, "succeeded");
  const outcomes = fx.service.purgeExpired({
    now: new Date("2026-10-05T10:00:00.000Z"),
    purge: () => { throw new Error("cross-store delete failed"); }
  });
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0]?.status, "failed");
  // A partial failure must not resurrect or lose the session: still trashed, transcript intact.
  assert.equal(fx.service.query({ requesterExternalUserId: OWNER, state: "trashed" }).length, 1);
  assert.notEqual(fx.sessions.getConversationById(conversation.id, "web", OWNER), null);
});
test("lifecycle state survives store restart", (t) => {
  const fx = setup();
  const conversation = fx.sessions.createWebConversation(OWNER);
  fx.now.value = new Date("2026-09-02T10:00:00.000Z");
  assert.equal(fx.service.archive({ conversationId: conversation.id, requesterExternalUserId: OWNER }).status, "succeeded");
  const dbFile = path.join(fx.root, "sessions.db");
  fx.lifecycle.close();
  fx.search.close();

  const reopened = new SessionLifecycleStore(dbFile);
  t.after(() => {
    reopened.close();
    fx.cleanup();
  });
  const row = reopened.get(conversation.id);
  assert.equal(row?.state, "archived");
  assert.equal(row?.version, 1 + 1);
  const service = new SessionLifecycleService({ sessions: fx.sessions, lifecycle: reopened });
  assert.equal(service.query({ requesterExternalUserId: OWNER, state: "archived" }).length, 1);
});

test("purgeExpired clears only expired trash", (t) => {  const fx = setup();
  t.after(() => fx.cleanup());
  const oldSession = fx.sessions.createWebConversation(OWNER);
  assert.equal(fx.service.trash({ conversationId: oldSession.id, requesterExternalUserId: OWNER }).status, "succeeded");
  // The fresh session is trashed weeks later, inside its recovery period at purge time.
  fx.now.value = new Date("2026-09-20T10:00:00.000Z");
  const freshSession = fx.sessions.createWebConversation(OWNER);
  assert.equal(fx.service.trash({ conversationId: freshSession.id, requesterExternalUserId: OWNER }).status, "succeeded");

  const purged: string[] = [];
  const outcomes = fx.service.purgeExpired({
    now: new Date("2026-10-02T10:00:01.000Z"),
    purge: (id) => {
      purged.push(id);
      fx.sessions.deleteConversation(id, "web", OWNER);
      fx.lifecycle.deleteRow(id);
    }
  });
  // Only the old session is past the 30-day recovery period.
  assert.deepEqual(outcomes.map((item) => item.conversationId), [oldSession.id]);
  assert.deepEqual(purged, [oldSession.id]);
  assert.equal(fx.sessions.getConversationById(oldSession.id, "web", OWNER), null);
  assert.deepEqual(fx.service.query({ requesterExternalUserId: OWNER, state: "trashed" }).map((item) => item.conversation.id), [freshSession.id]);
});

test("restore refuses while fresh work is running and never replays the transcript", (t) => {
  const busy = new Set<string>();
  const fx = setup({ busy: (id) => busy.has(id) });
  t.after(() => fx.cleanup());
  const conversation = fx.sessions.createWebConversation(OWNER);
  fx.sessions.appendMessage(conversation.id, "user", "restore replay uniquekey omega");
  fx.sessions.appendMessage(conversation.id, "assistant", "reply here");
  assert.equal(fx.service.trash({ conversationId: conversation.id, requesterExternalUserId: OWNER }).status, "succeeded");

  busy.add(conversation.id);
  assert.deepEqual(fx.service.restoreTrashed({ conversationId: conversation.id, requesterExternalUserId: OWNER }), {
    status: "skipped",
    conversationId: conversation.id,
    reason: "busy"
  });
  busy.delete(conversation.id);

  const restored = fx.service.restoreTrashed({ conversationId: conversation.id, requesterExternalUserId: OWNER });
  assert.equal(restored.status, "succeeded");
  // No republishing, no tool replay: the transcript is byte-identical and the
  // rebuilt search projection holds exactly the eligible entries.
  assert.equal(fx.sessions.listMessages(conversation.id).length, 2);
  assert.equal(authorizedHits(fx, "omega").length, 1);
});
