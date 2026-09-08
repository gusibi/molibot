import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { encodeExternalSessionId } from "$lib/server/app/externalSessionsFromContexts.js";
import { isExternalSessionId } from "$lib/server/app/sessionMaintenance.js";
import { SessionStore } from "$lib/server/sessions/store.js";
import { ConversationSearchIndex } from "$lib/server/sessions/conversationSearch.js";
import { SessionLifecycleStore } from "$lib/server/sessions/sessionLifecycleStore.js";
import { assembleSessionLifecycle } from "$lib/server/sessions/sessionServiceAssembly.js";
import type { ExternalManagedCandidate } from "$lib/server/sessions/sessionQueryService.js";
import type { Conversation } from "$lib/shared/types/message.js";

const OWNER_A = "web:personal:user-a";

interface Fixture {
  root: string;
  sessions: SessionStore;
  lifecycle: SessionLifecycleStore;
  search: ConversationSearchIndex;
  originals: Record<string, string>;
  cleanup(): void;
}

function setup(): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-session-assembly-"));
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
  let closed = false;
  return {
    root,
    sessions,
    lifecycle,
    search,
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

function externalCandidate(botId: string, chatId: string, sessionId: string, title: string): ExternalManagedCandidate {
  const conversation: Conversation = {
    id: encodeExternalSessionId({ channel: "telegram", botId, chatId, sessionId }),
    channel: "telegram",
    externalUserId: `bot:${botId}:chat:${chatId}:${sessionId}`,
    title,
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-02T10:00:00.000Z"
  };
  return { conversation, botId, channel: "telegram" };
}

test("B1: controlled busy signals block archive/delete through the real assembly", (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const running = new Set<string>();
  const approvals = new Set<string>();
  const linked = new Set<string>();
  const service = assembleSessionLifecycle({
    sessions: fx.sessions,
    lifecycle: fx.lifecycle,
    search: { index: fx.search, botId: "web" },
    busyReaders: {
      listRunningSessionIds: () => [...running],
      listPendingApprovalSessionIds: () => [...approvals],
      hasNonterminalLinkedTask: (id) => linked.has(id)
    }
  });

  const conversation = fx.sessions.createWebConversation(OWNER_A);
  const id = conversation.id;

  running.add(id);
  assert.deepEqual(service.archive({ conversationId: id }), {
    status: "skipped",
    conversationId: id,
    reason: "busy"
  });
  assert.deepEqual(service.trash({ conversationId: id, requesterExternalUserId: OWNER_A }), {
    status: "skipped",
    conversationId: id,
    reason: "busy"
  });
  running.delete(id);

  approvals.add(id);
  assert.equal(service.archive({ conversationId: id }).status, "skipped");
  assert.equal((service.archive({ conversationId: id }) as { reason?: string }).reason, "busy");
  approvals.delete(id);

  linked.add(id);
  assert.equal(service.trash({ conversationId: id, requesterExternalUserId: OWNER_A }).status, "skipped");
  linked.delete(id);

  assert.equal(service.archive({ conversationId: id }).status, "succeeded");
  assert.equal(service.trash({ conversationId: id, requesterExternalUserId: OWNER_A }).status, "succeeded");
});

test("B1: default assembly without signals leaves ordinary sessions manageable", (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const service = assembleSessionLifecycle({ sessions: fx.sessions, lifecycle: fx.lifecycle });
  const conversation = fx.sessions.createWebConversation(OWNER_A);
  assert.equal(service.archive({ conversationId: conversation.id }).status, "succeeded");
});

test("B2/US2: managed query lists external-channel sessions alongside local ones", (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const externals = [
    externalCandidate("alpha", "chat-1", "s-1", "Alpha deploy notes"),
    externalCandidate("beta", "chat-2", "s-2", "Beta gardening")
  ];
  const service = assembleSessionLifecycle({
    sessions: fx.sessions,
    lifecycle: fx.lifecycle,
    search: { index: fx.search, botId: "web" },
    listExternal: () => [...externals],
    isExternalSession: isExternalSessionId
  });
  const local = fx.sessions.createWebConversation(OWNER_A);

  const result = service.queryManaged({});
  const byId = new Map(result.items.map((item) => [item.conversationId, item]));
  assert.ok(byId.has(local.id), "local session stays visible");
  for (const external of externals) {
    const item = byId.get(external.conversation.id);
    assert.ok(item, `external session visible: ${external.conversation.title}`);
    assert.equal(item?.source, "external");
    assert.equal(item?.botId, external.botId);
  }
});

test("B2/US3: BOT filter and keyword search apply to external sessions", (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const externals = [
    externalCandidate("alpha", "chat-1", "s-1", "Alpha deploy notes"),
    externalCandidate("beta", "chat-2", "s-2", "Beta gardening")
  ];
  const service = assembleSessionLifecycle({
    sessions: fx.sessions,
    lifecycle: fx.lifecycle,
    search: { index: fx.search, botId: "web" },
    listExternal: () => [...externals],
    isExternalSession: isExternalSessionId
  });

  const byBot = service.queryManaged({ botIds: ["alpha"] });
  assert.deepEqual(byBot.items.map((item) => item.conversationId), [externals[0].conversation.id]);

  const byKeyword = service.queryManaged({ keyword: "gardening" });
  assert.deepEqual(byKeyword.items.map((item) => item.conversationId), [externals[1].conversation.id]);

  const externalOnly = service.queryManaged({ sources: ["external"] });
  assert.equal(externalOnly.total, 2);
});

test("B2: lifecycle mutations on external sessions skip as read-only, never not_found", (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const externals = [externalCandidate("alpha", "chat-1", "s-1", "Alpha deploy notes")];
  const service = assembleSessionLifecycle({
    sessions: fx.sessions,
    lifecycle: fx.lifecycle,
    listExternal: () => [...externals],
    isExternalSession: isExternalSessionId
  });
  const id = externals[0].conversation.id;

  for (const outcome of [
    service.archive({ conversationId: id }),
    service.restoreArchived({ conversationId: id }),
    service.trash({ conversationId: id }),
    service.restoreTrashed({ conversationId: id }),
    service.setRetain({ conversationId: id, retain: true })
  ]) {
    assert.equal(outcome.status, "skipped", `expected skip, got ${JSON.stringify(outcome)}`);
    assert.equal((outcome as { reason?: string }).reason, "not_applicable");
  }
  // Unknown ids still report not_found — the skip is reserved for real externals.
  assert.equal((service.archive({ conversationId: "missing-local-id" }) as { reason?: string }).reason, "not_found");
});
