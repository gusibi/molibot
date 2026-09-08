import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { MomRuntimeStore } from "$lib/server/agent/session/store.js";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { SessionStore } from "$lib/server/sessions/store.js";
import { SessionLifecycleStore } from "$lib/server/sessions/sessionLifecycleStore.js";
import { deleteWebSessionWith } from "$lib/server/web/sessionLifecycle.js";

function setupTempStorage(): { root: string; restore(): void } {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-web-session-lifecycle-"));
  const original = { ...storagePaths };
  storagePaths.webWorkspaceDir = path.join(root, "web");
  storagePaths.sessionsDir = path.join(root, "legacy");
  storagePaths.sessionsIndexFile = path.join(root, "legacy-index.json");
  return {
    root,
    restore() {
      Object.assign(storagePaths, original);
      rmSync(root, { recursive: true, force: true });
    }
  };
}

test("Web Session deletion moves to trash and keeps UI and Agent artifacts recoverable", () => {
  const storage = setupTempStorage();
  const lifecycle = new SessionLifecycleStore(path.join(storage.root, "sessions.db"));
  try {
    const sessions = new SessionStore();
    const owner = "web:personal:web-anonymous";
    const conversation = sessions.createWebConversation(owner);
    sessions.appendMessage(conversation.id, "user", "keep me");
    const agent = new MomRuntimeStore(path.join(storage.root, "agent"));
    agent.clearSessionContext(owner, conversation.id);
    agent.markSessionOrigin(owner, conversation.id, { origin: "chat" });
    const entries = agent.getSessionEntriesPath(owner, conversation.id);

    const result = deleteWebSessionWith({
      sessions,
      lifecycle,
      getContext: () => ({
        pool: {
          get: () => ({ isRunning: () => false })
        }
      })
    }, { conversationId: conversation.id, expectedExternalUserId: owner });

    assert.equal(result, "deleted");
    // Recoverable: transcript and Agent artifacts stay for restore.
    assert.notEqual(sessions.getConversationById(conversation.id, "web", owner), null);
    assert.equal(existsSync(entries), true);
    assert.equal(lifecycle.get(conversation.id)?.state, "trashed");
  } finally {
    lifecycle.close();
    storage.restore();
  }
});

test("Web Session lifecycle refuses running, wrong-owner and protected deletions", () => {
  const storage = setupTempStorage();
  const lifecycle = new SessionLifecycleStore(path.join(storage.root, "sessions.db"));
  const busy = new Set<string>();
  try {
    const sessions = new SessionStore();
    const owner = "web:personal:web-anonymous";
    const conversation = sessions.createWebConversation(owner);
    const agent = new MomRuntimeStore(path.join(storage.root, "agent"));
    agent.clearSessionContext(owner, conversation.id);
    busy.add(conversation.id);

    const dependencies = {
      sessions,
      lifecycle,
      isBusy: (id: string) => busy.has(id)
    };
    assert.equal(deleteWebSessionWith(dependencies, {
      conversationId: conversation.id,
      expectedExternalUserId: "web:other:web-anonymous"
    }), "not_found");
    assert.equal(deleteWebSessionWith(dependencies, {
      conversationId: conversation.id,
      expectedExternalUserId: owner
    }), "running");
    assert.notEqual(sessions.getConversationById(conversation.id, "web", owner), null);

    busy.delete(conversation.id);
    lifecycle.ensureRow(conversation.id);
    lifecycle.updateWithVersion(conversation.id, 1, { retain: true });
    assert.equal(deleteWebSessionWith(dependencies, {
      conversationId: conversation.id,
      expectedExternalUserId: owner
    }), "protected");
    assert.notEqual(sessions.getConversationById(conversation.id, "web", owner), null);
  } finally {
    lifecycle.close();
    storage.restore();
  }
});
