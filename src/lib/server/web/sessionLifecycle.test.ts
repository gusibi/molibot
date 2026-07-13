import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { MomRuntimeStore } from "$lib/server/agent/session/store.js";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { SessionStore } from "$lib/server/sessions/store.js";
import { deleteWebSessionWith } from "$lib/server/web/sessionLifecycle.js";

test("Web Session lifecycle deletes UI and Agent artifacts together", () => {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-web-session-lifecycle-"));
  const original = { ...storagePaths };
  try {
    storagePaths.webWorkspaceDir = path.join(root, "web");
    storagePaths.sessionsDir = path.join(root, "legacy");
    storagePaths.sessionsIndexFile = path.join(root, "legacy-index.json");
    const sessions = new SessionStore();
    const owner = "web:personal:web-anonymous";
    const conversation = sessions.createWebConversation(owner);
    const agent = new MomRuntimeStore(path.join(root, "agent"));
    agent.clearSessionContext(owner, conversation.id);
    agent.markSessionOrigin(owner, conversation.id, { origin: "chat" });
    const entries = agent.getSessionEntriesPath(owner, conversation.id);
    let resets = 0;

    const result = deleteWebSessionWith({
      sessions,
      getContext: () => ({
        store: agent,
        pool: {
          get: () => ({ isRunning: () => false }),
          reset: () => { resets += 1; }
        }
      })
    }, { conversationId: conversation.id, expectedExternalUserId: owner });

    assert.equal(result, "deleted");
    assert.equal(sessions.getConversationById(conversation.id, "web", owner), null);
    assert.equal(existsSync(entries), false);
    assert.equal(existsSync(entries.replace(/\.jsonl$/, ".json")), false);
    assert.equal(existsSync(entries.replace(/\.jsonl$/, ".meta.json")), false);
    assert.equal(resets, 1);
  } finally {
    Object.assign(storagePaths, original);
    rmSync(root, { recursive: true, force: true });
  }
});

test("Web Session lifecycle refuses running and wrong-owner deletions", () => {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-web-session-running-"));
  const original = { ...storagePaths };
  try {
    storagePaths.webWorkspaceDir = path.join(root, "web");
    storagePaths.sessionsDir = path.join(root, "legacy");
    storagePaths.sessionsIndexFile = path.join(root, "legacy-index.json");
    const sessions = new SessionStore();
    const owner = "web:personal:web-anonymous";
    const conversation = sessions.createWebConversation(owner);
    const agent = new MomRuntimeStore(path.join(root, "agent"));
    agent.clearSessionContext(owner, conversation.id);

    const dependencies = {
      sessions,
      getContext: () => ({
        store: agent,
        pool: {
          get: () => ({ isRunning: () => true }),
          reset: () => assert.fail("running session must not reset")
        }
      })
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
  } finally {
    Object.assign(storagePaths, original);
    rmSync(root, { recursive: true, force: true });
  }
});
