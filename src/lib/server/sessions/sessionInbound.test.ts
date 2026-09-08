import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { SessionStore } from "$lib/server/sessions/store.js";
import { ConversationSearchIndex } from "$lib/server/sessions/conversationSearch.js";
import { PersistentTaskQueue } from "$lib/server/channels/shared/persistentTaskQueue.js";
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
  busy: Set<string>;
  originals: Record<string, string>;
  cleanup(): void;
}

function setup(): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-session-inbound-"));
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

  const busy = new Set<string>();
  const sessions = new SessionStore();
  const search = new ConversationSearchIndex(":memory:");
  sessions.setConversationSearchIndex(search, "web");
  const lifecycle = new SessionLifecycleStore(path.join(root, "sessions.db"));
  const service = new SessionLifecycleService({ sessions, lifecycle, isBusy: (id) => busy.has(id) });
  sessions.setSessionActivitySink(service);
  // Same wiring as the production runtime: archived resumes on the same
  // identity, trashed refuses reuse so inbound walks the new-conversation
  // path. Reads never restore.
  sessions.setInboundLifecyclePolicy({
    peekState: (conversationId, requesterExternalUserId) =>
      service.peekLifecycleState(conversationId, requesterExternalUserId),
    resumeForInbound: (conversationId, requesterExternalUserId) => {
      service.resumeForInboundMessage({ conversationId, requesterExternalUserId });
    }
  });
  let closed = false;
  return {
    root,
    sessions,
    lifecycle,
    service,
    search,
    busy,
    originals,
    cleanup() {
      if (closed) return;
      closed = true;
      try { search.close(); } catch { /* already closed */ }
      try { lifecycle.close(); } catch { /* already closed */ }
      Object.assign(storagePaths, originals);
      rmSync(root, { recursive: true, force: true });
    }
  };
}

test("browsing an archived session never restores it", (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const conversation = fx.sessions.createWebConversation(OWNER);
  fx.sessions.appendMessage(conversation.id, "user", "browse me");
  assert.equal(fx.service.archive({ conversationId: conversation.id, requesterExternalUserId: OWNER }).status, "succeeded");

  assert.notEqual(fx.sessions.getConversationById(conversation.id, "web", OWNER), null);
  assert.equal(fx.sessions.listMessages(conversation.id).length, 1);
  assert.equal(fx.sessions.listMessageMetadata(conversation.id).length, 1);
  assert.equal(fx.service.query({ requesterExternalUserId: OWNER, state: "archived" }).length, 1);
  assert.equal(fx.lifecycle.get(conversation.id)?.state, "archived");
});

test("authorized new message resumes the archived session on the same identity", (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const conversation = fx.sessions.createWebConversation(OWNER);
  fx.sessions.appendMessage(conversation.id, "user", "first");
  assert.equal(fx.service.archive({ conversationId: conversation.id, requesterExternalUserId: OWNER }).status, "succeeded");

  const resumed = fx.sessions.getOrCreateConversation("web", OWNER, conversation.id);
  assert.equal(resumed.id, conversation.id);
  assert.equal(fx.lifecycle.get(conversation.id)?.state, "active");
  fx.sessions.appendMessage(resumed.id, "user", "second");
  assert.equal(fx.sessions.listMessages(conversation.id).length, 2);
  assert.equal(fx.service.query({ requesterExternalUserId: OWNER }).length, 1);
});

test("unauthorized sender neither resumes nor reuses the archived session", (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const conversation = fx.sessions.createWebConversation(OWNER);
  fx.sessions.appendMessage(conversation.id, "user", "private");
  assert.equal(fx.service.archive({ conversationId: conversation.id, requesterExternalUserId: OWNER }).status, "succeeded");

  const outcome = fx.service.resumeForInboundMessage({ conversationId: conversation.id, requesterExternalUserId: OTHER });
  assert.equal(outcome.decision, "not-found");
  assert.equal(fx.lifecycle.get(conversation.id)?.state, "archived");
  const other = fx.sessions.getOrCreateConversation("web", OTHER, conversation.id);
  assert.notEqual(other.id, conversation.id);
  assert.equal(fx.lifecycle.get(conversation.id)?.state, "archived");
});

test("concurrent restore and new message converge on one active identity", (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const conversation = fx.sessions.createWebConversation(OWNER);
  fx.sessions.appendMessage(conversation.id, "user", "race");
  assert.equal(fx.service.archive({ conversationId: conversation.id, requesterExternalUserId: OWNER }).status, "succeeded");

  const first = fx.service.restoreArchived({ conversationId: conversation.id, requesterExternalUserId: OWNER });
  const second = fx.service.resumeForInboundMessage({ conversationId: conversation.id, requesterExternalUserId: OWNER });
  const third = fx.sessions.getOrCreateConversation("web", OWNER, conversation.id);
  assert.equal(first.status, "succeeded");
  assert.ok(second.decision === "reused" || second.decision === "resumed");
  assert.equal(third.id, conversation.id);
  assert.equal(fx.lifecycle.get(conversation.id)?.state, "active");
  assert.equal(fx.sessions.listConversations("web", OWNER).filter((item) => item.id === conversation.id).length, 1);
});

test("trashed sessions refuse reuse: inbound creates new, old restore keeps the new binding", (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const old = fx.sessions.createWebConversation(OWNER);
  fx.sessions.appendMessage(old.id, "user", "disposable");
  assert.equal(fx.service.trash({ conversationId: old.id, requesterExternalUserId: OWNER }).status, "succeeded");

  // Explicit id on a trashed session walks the new-conversation path.
  const fresh = fx.sessions.getOrCreateConversation("web", OWNER, old.id);
  assert.notEqual(fresh.id, old.id);
  assert.equal(fx.lifecycle.get(old.id)?.state, "trashed");
  // Default inbound (no id) also refuses the trashed latest.
  const latest = fx.sessions.getOrCreateConversation("web", OWNER);
  assert.notEqual(latest.id, old.id);

  // Restoring the old trash reinstates its row without overtaking the new
  // active binding: updatedAt untouched, latest-first order unchanged.
  const restored = fx.service.restoreTrashed({ conversationId: old.id, requesterExternalUserId: OWNER });
  assert.equal(restored.status, "succeeded");
  assert.equal(fx.sessions.listConversations("web", OWNER)[0]?.id, latest.id);
  assert.notEqual(fx.sessions.listConversations("web", OWNER)[0]?.id, old.id);
});

test("admission wins the archive race and cleanup never cancels work", (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const conversation = fx.sessions.createWebConversation(OWNER);
  fx.sessions.appendMessage(conversation.id, "user", "ongoing work");
  fx.busy.add(conversation.id);
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
  fx.busy.delete(conversation.id);
  assert.equal(fx.service.archive({ conversationId: conversation.id, requesterExternalUserId: OWNER }).status, "succeeded");

  // A message admitted while work restarts resumes the same session even
  // though the target reads busy — lifecycle never drops or cancels it.
  fx.busy.add(conversation.id);
  const resumed = fx.service.resumeForInboundMessage({ conversationId: conversation.id, requesterExternalUserId: OWNER });
  assert.equal(resumed.decision, "resumed");
  const reused = fx.sessions.getOrCreateConversation("web", OWNER, conversation.id);
  assert.equal(reused.id, conversation.id);
  fx.sessions.appendMessage(reused.id, "user", "continued under load");
  assert.equal(fx.sessions.listMessages(conversation.id).length, 2);
  assert.equal(fx.lifecycle.get(conversation.id)?.state, "active");
});

test("terminal queue rows are never retained or duplicated", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "molibot-inbound-terminal-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbFile = path.join(dir, "queue.sqlite");
  let processed = 0;
  const queue = new PersistentTaskQueue<{ text: string }>({
    channel: "test",
    instanceId: "bot-t5",
    dbFile,
    process: async () => {
      processed += 1;
    }
  });
  t.after(() => queue.close());

  const id = queue.enqueue("chat-1", { text: "work" }, { preview: "work" });
  for (let i = 0; i < 100 && processed < 1; i += 1) await delay(5);
  assert.equal(processed, 1);
  for (let i = 0; i < 100 && queue.size("chat-1") !== 0; i += 1) await delay(5);
  assert.equal(queue.size("chat-1"), 0);
  assert.deepEqual(queue.list("chat-1"), []);
  assert.equal(queue.retryRecovery("chat-1", id), "not_found");

  // Re-enqueueing after a terminal outcome creates exactly one row — the
  // finished attempt is never copied or retained.
  const retry = queue.enqueue("chat-1", { text: "work" }, { preview: "work" });
  for (let i = 0; i < 100 && processed < 2; i += 1) await delay(5);
  assert.equal(processed, 2);
  for (let i = 0; i < 100 && queue.size("chat-1") !== 0; i += 1) await delay(5);
  assert.equal(queue.size("chat-1"), 0);
  assert.deepEqual(queue.list("chat-1"), []);
  assert.ok(retry > id);
});
