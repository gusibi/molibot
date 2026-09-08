import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { SessionStore } from "$lib/server/sessions/store.js";
import { ConversationSearchIndex } from "$lib/server/sessions/conversationSearch.js";
import { listAuthorizedConversationSources } from "$lib/server/sessions/conversationAuthorization.js";
import { SessionLifecycleStore } from "$lib/server/sessions/sessionLifecycleStore.js";
import { SessionLifecycleService } from "$lib/server/sessions/sessionLifecycleService.js";
import { SessionTrashCleanupService } from "$lib/server/sessions/sessionTrashCleanup.js";
import { MemoryCandidateStore } from "$lib/server/memory/candidateStore.js";

const OWNER = "web:personal:web-anonymous";

interface Fixture {
  root: string;
  sessions: SessionStore;
  lifecycle: SessionLifecycleStore;
  service: SessionLifecycleService;
  cleanup: SessionTrashCleanupService;
  search: ConversationSearchIndex;
  candidates: MemoryCandidateStore;
  agentContexts: Map<string, Set<string>>;
  agentCalls: Array<{ chatId: string; sessionId: string }>;
  failStep: { value: "search" | "ui" | "agent" | null };
  now: { value: Date };
  originals: Record<string, string>;
  teardown(): void;
}

function setup(): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-trash-cleanup-"));
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
  const service = new SessionLifecycleService({ sessions, lifecycle, clock });
  sessions.setSessionActivitySink(service);
  const candidates = new MemoryCandidateStore(path.join(root, "candidates.sqlite"));
  const agentContexts = new Map<string, Set<string>>();
  const agentCalls: Array<{ chatId: string; sessionId: string }> = [];
  const failStep: { value: "search" | "ui" | "agent" | null } = { value: null };
  const cleanup = new SessionTrashCleanupService({
    lifecycle,
    clock,
    deleteUiConversation: (conversationId) => {
      if (failStep.value === "ui") throw new Error("ui store unavailable");
      const owner = sessions.getWebConversationOwner(conversationId);
      if (owner) sessions.deleteConversation(conversationId, "web", owner);
    },
    listAgentChatIds: (conversationId) => {
      const chats: string[] = [];
      for (const [chatId, ids] of agentContexts) {
        if (ids.has(conversationId)) chats.push(chatId);
      }
      return chats;
    },
    deleteAgentSession: (chatId, sessionId) => {
      agentCalls.push({ chatId, sessionId });
      if (failStep.value === "agent") throw new Error("agent store unavailable");
      agentContexts.get(chatId)?.delete(sessionId);
    },
    finalizeSearchConversation: (conversationId) => {
      if (failStep.value === "search") throw new Error("search store unavailable");
      const owner = sessions.getWebConversationOwner(conversationId);
      const conversation = owner ? sessions.getConversationById(conversationId, "web", owner) : null;
      if (conversation) sessions.removeConversationSearchProjection(conversation);
      else search.enqueueDeleteConversation(`web:web:${OWNER}`, conversationId);
    }
  });
  let closed = false;
  return {
    root, sessions, lifecycle, service, cleanup, search, candidates,
    agentContexts, agentCalls, failStep, now, originals,
    teardown() {
      if (closed) return;
      closed = true;
      try { candidates.close(); } catch { /* already closed */ }
      try { search.close(); } catch { /* already closed */ }
      try { lifecycle.close(); } catch { /* already closed */ }
      Object.assign(storagePaths, originals);
      rmSync(root, { recursive: true, force: true });
    }
  };
}

function makeTrashedSession(fx: Fixture, keyword: string): string {
  const conversation = fx.sessions.createWebConversation(OWNER);
  fx.sessions.appendMessage(conversation.id, "user", `cleanup target ${keyword}`);
  fx.sessions.appendMessage(conversation.id, "assistant", "reply here");
  fx.agentContexts.set(OWNER, new Set([...(fx.agentContexts.get(OWNER) ?? []), conversation.id]));
  assert.equal(fx.service.trash({ conversationId: conversation.id, requesterExternalUserId: OWNER }).status, "succeeded");
  return conversation.id;
}

function authorizedHits(fx: Fixture, query: string) {
  return fx.search.search({
    query,
    authorizedSources: listAuthorizedConversationSources({ botId: "web", channel: "web", chatId: OWNER })
  });
}

function candidateInput(sessionId: string) {
  return {
    runKey: `run-${sessionId}`,
    namespace: "owner:owner" as const,
    domain: "owner" as const,
    type: "user_preference" as const,
    subject: "cleanup_proof",
    path: "mory://user_preference/cleanup_proof",
    value: "saved memory must survive session purge",
    confidence: 0.9,
    reason: "trash cleanup test",
    sources: [{ channel: "web", sessionId, conversationMessageId: "m1", observedAt: "2026-09-01T00:00:00.000Z" }],
    layer: "long_term" as const
  };
}

test("expired purge clears Session-owned data but keeps memories and independent files", (t) => {
  const fx = setup();
  t.after(() => fx.teardown());
  const id = makeTrashedSession(fx, "purgeable uniquekey alpha");
  assert.ok(authorizedHits(fx, "alpha").length === 0);
  const saved = fx.candidates.create(candidateInput(id));
  assert.ok(saved);
  const independentDoc = path.join(fx.root, "independent-doc.md");
  writeFileSync(independentDoc, "# independent document");

  const outcomes = fx.cleanup.purgeExpiredTrash({ now: new Date("2026-10-05T10:00:00.000Z") });
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0]?.status, "succeeded");

  // Session-owned UI metadata, Agent Context and lifecycle row are gone.
  assert.equal(fx.sessions.getConversationById(id, "web", OWNER), null);
  assert.equal(fx.agentContexts.get(OWNER)?.has(id), false);
  assert.equal(fx.lifecycle.get(id), null);
  assert.deepEqual(fx.agentCalls, [{ chatId: OWNER, sessionId: id }]);
  // Finalized search deletion cannot be resurrected by a late reindex.
  fx.search.enqueueUpsert({
    messageId: "late-m1", conversationId: id, role: "user", content: "cleanup target purgeable uniquekey alpha",
    createdAt: "2026-09-01T00:00:00.000Z", botId: "web", channel: "web", chatId: OWNER,
    purpose: "chat", sourceKey: `web:web:${OWNER}`
  });
  assert.equal(authorizedHits(fx, "alpha").length, 0);
  // Saved memories and independent documents survive the purge.
  assert.equal(fx.candidates.list("pending").length, 1);
});

test("unexpired trash is left alone", (t) => {
  const fx = setup();
  t.after(() => fx.teardown());
  const id = makeTrashedSession(fx, "fresh uniquekey beta");
  const outcomes = fx.cleanup.purgeExpiredTrash({ now: new Date("2026-09-20T10:00:00.000Z") });
  assert.deepEqual(outcomes, []);
  assert.notEqual(fx.sessions.getConversationById(id, "web", OWNER), null);
  assert.equal(fx.lifecycle.get(id)?.state, "trashed");
});

test("partial agent failure keeps trash recoverable and reconcile finishes it", (t) => {
  const fx = setup();
  t.after(() => fx.teardown());
  const id = makeTrashedSession(fx, "flaky uniquekey gamma");
  fx.failStep.value = "agent";

  const outcomes = fx.cleanup.purgeExpiredTrash({ now: new Date("2026-10-05T10:00:00.000Z") });
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0]?.status, "failed");
  // Never resurrected, never lost: still trashed with a recorded intent.
  // Steps before the failure already applied (UI file gone); the remaining
  // Agent Context step stays as recoverable cleanup work.
  assert.equal(fx.lifecycle.get(id)?.state, "trashed");
  assert.equal(fx.sessions.getConversationById(id, "web", OWNER), null);
  assert.equal(fx.agentContexts.get(OWNER)?.has(id), true);
  assert.deepEqual(fx.lifecycle.listCleanupIntents().map((intent) => intent.conversationId), [id]);
  assert.equal(fx.lifecycle.listCleanupIntents()[0]?.failedStep, "agent");

  fx.failStep.value = null;
  const retried = fx.cleanup.reconcilePending({ now: new Date("2026-10-05T10:00:00.000Z") });
  assert.equal(retried.filter((item) => item.conversationId === id && item.status === "succeeded").length, 1);
  assert.equal(fx.lifecycle.get(id), null);
  assert.equal(fx.agentContexts.get(OWNER)?.has(id), false);
  assert.deepEqual(fx.lifecycle.listCleanupIntents(), []);
});

test("reconcile leaves a session restored after failure alone", (t) => {
  const fx = setup();
  t.after(() => fx.teardown());
  const id = makeTrashedSession(fx, "restored uniquekey delta");
  fx.failStep.value = "search";
  assert.equal(fx.cleanup.purgeExpiredTrash({ now: new Date("2026-10-05T10:00:00.000Z") })[0]?.status, "failed");
  fx.failStep.value = null;
  // Nothing was removed before the search-step failure, so full restore works.
  assert.notEqual(fx.sessions.getConversationById(id, "web", OWNER), null);

  assert.equal(fx.service.restoreTrashed({ conversationId: id, requesterExternalUserId: OWNER }).status, "succeeded");
  const retried = fx.cleanup.reconcilePending({ now: new Date("2026-10-06T10:00:00.000Z") });
  assert.ok(retried.every((item) => item.conversationId !== id));
  assert.notEqual(fx.sessions.getConversationById(id, "web", OWNER), null);
  assert.deepEqual(fx.lifecycle.listCleanupIntents(), []);
});

test("restart reopens intents and reconciles them", (t) => {
  const fx = setup();
  const id = makeTrashedSession(fx, "restart uniquekey epsilon");
  fx.failStep.value = "agent";
  assert.equal(fx.cleanup.purgeExpiredTrash({ now: new Date("2026-10-05T10:00:00.000Z") })[0]?.status, "failed");
  const dbFile = path.join(fx.root, "sessions.db");
  fx.lifecycle.close();
  fx.search.close();
  fx.candidates.close();

  const reopened = new SessionLifecycleStore(dbFile);
  t.after(() => {
    reopened.close();
    fx.teardown();
  });
  assert.deepEqual(reopened.listCleanupIntents().map((intent) => intent.conversationId), [id]);
  const cleanup = new SessionTrashCleanupService({
    lifecycle: reopened,
    deleteUiConversation: (conversationId) => {
      const owner = fx.sessions.getWebConversationOwner(conversationId);
      if (owner) fx.sessions.deleteConversation(conversationId, "web", owner);
    },
    listAgentChatIds: () => [OWNER],
    deleteAgentSession: (chatId, sessionId) => { fx.agentContexts.get(chatId)?.delete(sessionId); },
    finalizeSearchConversation: () => {}
  });
  const outcomes = cleanup.reconcilePending({ now: new Date("2026-10-06T10:00:00.000Z") });
  assert.equal(outcomes.find((item) => item.conversationId === id)?.status, "succeeded");
  assert.equal(reopened.get(id), null);
  assert.deepEqual(reopened.listCleanupIntents(), []);
});

test("unauthorized purge requests are skipped without touching trash", (t) => {
  const fx = setup();
  t.after(() => fx.teardown());
  const id = makeTrashedSession(fx, "guarded uniquekey zeta");
  const guarded = new SessionTrashCleanupService({
    lifecycle: fx.lifecycle,
    deleteUiConversation: () => { throw new Error("must not run"); },
    listAgentChatIds: () => [],
    deleteAgentSession: () => { throw new Error("must not run"); },
    finalizeSearchConversation: () => { throw new Error("must not run"); },
    isAuthorized: () => false
  });
  const outcomes = guarded.purgeExpiredTrash({ now: new Date("2026-10-05T10:00:00.000Z"), requesterExternalUserId: "web:stranger:web-anonymous" });
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0]?.status, "skipped");
  assert.equal(fx.lifecycle.get(id)?.state, "trashed");
});

test("purgeSingleExpired backs the lifecycle purge callback without resurrecting on failure", (t) => {
  const fx = setup();
  t.after(() => fx.teardown());
  const id = makeTrashedSession(fx, "callback uniquekey eta");
  fx.failStep.value = "agent";
  const outcomes = fx.service.purgeExpired({
    now: new Date("2026-10-05T10:00:00.000Z"),
    purge: (conversationId) => fx.cleanup.purgeSingleExpired(conversationId, new Date("2026-10-05T10:00:00.000Z"))
  });
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0]?.status, "failed");
  assert.equal(fx.lifecycle.get(id)?.state, "trashed");
  assert.equal(fx.agentContexts.get(OWNER)?.has(id), true);
});
