import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { buildSessionTrashCleanup } from "$lib/server/app/sessionMaintenance.js";
import { listAuthorizedConversationSources } from "$lib/server/sessions/conversationAuthorization.js";
import { ConversationSearchIndex } from "$lib/server/sessions/conversationSearch.js";
import { SessionLifecycleStore } from "$lib/server/sessions/sessionLifecycleStore.js";
import { SessionLifecycleService } from "$lib/server/sessions/sessionLifecycleService.js";
import { SessionStore } from "$lib/server/sessions/store.js";

const OWNER = "web:personal:web-anonymous";
const DAY_MS = 86_400_000;

interface Fixture {
  root: string;
  sessions: SessionStore;
  lifecycle: SessionLifecycleStore;
  service: SessionLifecycleService;
  search: ConversationSearchIndex;
  originals: Record<string, string>;
  teardown(): void;
}

function setup(): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-trash-ports-"));
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

  const sessions = new SessionStore();
  const search = new ConversationSearchIndex(":memory:");
  sessions.setConversationSearchIndex(search, "web");
  const lifecycle = new SessionLifecycleStore(path.join(root, "sessions.db"));
  const service = new SessionLifecycleService({ sessions, lifecycle });
  sessions.setSessionActivitySink(service);
  let closed = false;
  return {
    root,
    sessions,
    lifecycle,
    service,
    search,
    originals,
    teardown() {
      if (closed) return;
      closed = true;
      try { search.close(); } catch { /* already closed */ }
      try { lifecycle.close(); } catch { /* already closed */ }
      Object.assign(storagePaths, originals);
      rmSync(root, { recursive: true, force: true });
    }
  };
}

function makeExpiredTrash(fx: Fixture, keyword: string): string {
  const conversation = fx.sessions.createWebConversation(OWNER);
  fx.sessions.appendMessage(conversation.id, "user", `purge target ${keyword}`);
  fx.sessions.appendMessage(conversation.id, "assistant", "reply here");
  assert.equal(
    fx.service.trash({ conversationId: conversation.id, requesterExternalUserId: OWNER }).status,
    "succeeded"
  );
  const row = fx.lifecycle.get(conversation.id)!;
  fx.lifecycle.updateWithVersion(conversation.id, row.version, {
    trashedAt: new Date(Date.now() - 31 * DAY_MS).toISOString()
  });
  return conversation.id;
}

function authorizedHits(fx: Fixture, query: string) {
  return fx.search.search({
    query,
    authorizedSources: listAuthorizedConversationSources({ botId: "web", channel: "web", chatId: OWNER })
  });
}

test("B3: expired trash purges through the real production ports", (t) => {
  const fx = setup();
  t.after(() => fx.teardown());
  const id = makeExpiredTrash(fx, "ports-alpha");
  assert.equal(authorizedHits(fx, "ports-alpha").length, 0, "trash already revoked search at delete time");

  const outcomes = buildSessionTrashCleanup(fx.sessions, fx.lifecycle).purgeExpiredTrash();
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0]?.status, "succeeded");
  assert.equal(fx.sessions.getConversationById(id, "web", OWNER), null);
  assert.equal(fx.lifecycle.get(id), null);
  assert.equal(fx.service.queryManaged({ state: "trashed" }).total, 0);
});

test("B3: purge of another owner's trash is refused without touching it", (t) => {
  const fx = setup();
  t.after(() => fx.teardown());
  const id = makeExpiredTrash(fx, "ports-beta");

  const outcomes = buildSessionTrashCleanup(fx.sessions, fx.lifecycle).purgeExpiredTrash({
    requesterExternalUserId: "web:personal:someone-else"
  });
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0]?.status, "skipped");
  assert.equal((outcomes[0] as { reason?: string }).reason, "unauthorized");
  assert.ok(fx.sessions.getConversationById(id, "web", OWNER), "refused purge leaves the session alone");
});

test("B3: startup reconciliation completes a recorded cleanup intent", (t) => {
  const fx = setup();
  t.after(() => fx.teardown());
  const conversation = fx.sessions.createWebConversation(OWNER);
  fx.sessions.appendMessage(conversation.id, "user", "purge target reconcile-gamma");
  assert.equal(
    fx.service.trash({ conversationId: conversation.id, requesterExternalUserId: OWNER }).status,
    "succeeded"
  );
  // Simulate a crash between stores: the intent was recorded, the purge never ran.
  fx.lifecycle.recordCleanupIntent(conversation.id, "ui", "simulated crash before purge");

  // A fresh service instance — as built at process startup — retries it.
  const outcomes = buildSessionTrashCleanup(fx.sessions, fx.lifecycle).reconcilePending();
  assert.ok(outcomes.some((item) => item.conversationId === conversation.id && item.status === "succeeded"));
  assert.equal(fx.sessions.getConversationById(conversation.id, "web", OWNER), null);
  assert.equal(fx.lifecycle.get(conversation.id), null);
});
