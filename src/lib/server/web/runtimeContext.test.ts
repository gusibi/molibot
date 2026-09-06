import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveRunnerChatId, resolveWebConversationIdentity } from "./runtimeContext.js";
import { loadConversationMessages, configureConversationProjectionRuntime } from "./conversationProjection.js";
import { storagePaths } from "$lib/server/infra/db/storage";
import { SessionStore } from "$lib/server/sessions/store.js";

/**
 * Regression guards for conversation-identity resolution. The Desktop sidebar
 * aggregates every Web owner's conversations (plan §12), so reads, sends,
 * stops and steers must act under the identity the conversation was created
 * with. Keying by the caller's derived `web:<profile>:web-anonymous` identity
 * 404'd browser-created sessions on read (which rendered as an empty "new
 * conversation" pane) and silently continued or created a different session on
 * send via the getOrCreateConversation fallback.
 */
const runtime = {
  sessions: {
    getConversationProjectId: (conversationId: string) => (conversationId === "proj-conv" ? "project-1" : null),
    getWebConversationOwner: (conversationId: string) =>
      conversationId === "browser-conv" ? "web:personal:browser-user" : null,
    getProjectConversation: (projectId: string, conversationId: string) =>
      projectId === "project-1" && conversationId === "proj-conv"
        ? { externalUserId: "telegram:12345" }
        : null
  }
};

function withRuntime<T>(fn: () => T): T {
  (globalThis as unknown as Record<string, unknown>).__molibotRuntime = runtime;
  try {
    return fn();
  } finally {
    delete (globalThis as unknown as Record<string, unknown>).__molibotRuntime;
  }
}

test("resolveRunnerChatId keys a Web conversation by its recorded owner", () => {
  withRuntime(() => {
    assert.equal(
      resolveRunnerChatId("browser-conv", "web:personal:web-anonymous"),
      "web:personal:browser-user"
    );
  });
});

test("resolveRunnerChatId falls back to the caller identity for unknown or new conversations", () => {
  withRuntime(() => {
    assert.equal(resolveRunnerChatId("fresh-conv", "web:personal:web-anonymous"), "web:personal:web-anonymous");
    assert.equal(resolveRunnerChatId(undefined, "web:personal:web-anonymous"), "web:personal:web-anonymous");
    assert.equal(resolveRunnerChatId("", "web:personal:web-anonymous"), "web:personal:web-anonymous");
  });
});

test("resolveRunnerChatId still keys project conversations by their own identity", () => {
  withRuntime(() => {
    assert.equal(resolveRunnerChatId("proj-conv", "web:personal:web-anonymous"), "telegram:12345");
  });
});

test("resolveWebConversationIdentity resolves profile and user from the recorded owner", () => {
  withRuntime(() => {
    assert.deepEqual(
      resolveWebConversationIdentity({ profileId: "personal", conversationId: "browser-conv" }),
      { profileId: "personal", userId: "browser-user", externalUserId: "web:personal:browser-user" }
    );
  });
});

test("resolveWebConversationIdentity falls back to the derived identity without an owner", () => {
  withRuntime(() => {
    assert.deepEqual(
      resolveWebConversationIdentity({ profileId: "personal", userId: "", conversationId: "fresh-conv" }),
      { profileId: "personal", userId: "web-anonymous", externalUserId: "web:personal:web-anonymous" }
    );
    assert.deepEqual(
      resolveWebConversationIdentity({ profileId: "personal", conversationId: null }),
      { profileId: "personal", userId: "web-anonymous", externalUserId: "web:personal:web-anonymous" }
    );
  });
});

/**
 * End-to-end guard over real storage: a session created by a browser user
 * (`web:personal:browser-user`) must open on the Desktop, whose derived
 * identity is `web:personal:web-anonymous`. This is the read half of the
 * "clicked an updated session, got an empty new-conversation pane" bug: the
 * detail read used to 404 because it trusted the caller's identity instead of
 * resolving the conversation's recorded owner.
 */
test("a browser-created session opens through the Desktop identity path", () => {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-identity-e2e-"));
  const original = {
    webWorkspaceDir: storagePaths.webWorkspaceDir,
    sessionsDir: storagePaths.sessionsDir,
    sessionsIndexFile: storagePaths.sessionsIndexFile
  };
  storagePaths.webWorkspaceDir = path.join(root, "web");
  storagePaths.sessionsDir = path.join(root, "legacy");
  storagePaths.sessionsIndexFile = path.join(root, "legacy-index.json");

  const store = new SessionStore();
  const owner = "web:personal:browser-user";
  const conversation = store.createWebConversation(owner);
  store.appendMessage(conversation.id, "user", "来自浏览器的提问");
  store.appendMessage(conversation.id, "assistant", "来自浏览器的回答");

  const runtimeStub = {
    sessions: store,
    getSettings: () => ({ locale: "zh-CN" })
  };
  (globalThis as unknown as Record<string, unknown>).__molibotRuntime = runtimeStub;
  configureConversationProjectionRuntime(() => ({ sessions: store }));

  try {
    const identity = resolveWebConversationIdentity({ profileId: "personal", conversationId: conversation.id });
    assert.equal(identity.externalUserId, owner);
    assert.equal(identity.userId, "browser-user");

    // The old trust-the-caller identity must still fail — proving the fix is
    // the owner resolution, not a loosened lookup.
    assert.equal(store.getConversationById(conversation.id, "web", "web:personal:web-anonymous"), null);

    const conversationResolved = store.getConversationById(conversation.id, "web", identity.externalUserId);
    assert.ok(conversationResolved, "session must resolve under its recorded owner");

    assert.equal(resolveRunnerChatId(conversation.id, "web:personal:web-anonymous"), owner);

    const messages = loadConversationMessages({ profileId: "personal", conversationId: conversation.id });
    assert.deepEqual(
      messages.map((message) => [message.role, message.content]),
      [["user", "来自浏览器的提问"], ["assistant", "来自浏览器的回答"]]
    );
  } finally {
    delete (globalThis as unknown as Record<string, unknown>).__molibotRuntime;
    storagePaths.webWorkspaceDir = original.webWorkspaceDir;
    storagePaths.sessionsDir = original.sessionsDir;
    storagePaths.sessionsIndexFile = original.sessionsIndexFile;
    rmSync(root, { recursive: true, force: true });
  }
});
