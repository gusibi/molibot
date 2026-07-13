import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { storagePaths } from "$lib/server/infra/db/storage";
import { SessionStore } from "./store";

test("deleting a Web conversation removes its file and index entry", () => {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-desktop-sessions-"));
  const original = {
    webWorkspaceDir: storagePaths.webWorkspaceDir,
    sessionsDir: storagePaths.sessionsDir,
    sessionsIndexFile: storagePaths.sessionsIndexFile
  };

  try {
    storagePaths.webWorkspaceDir = path.join(root, "web");
    storagePaths.sessionsDir = path.join(root, "legacy");
    storagePaths.sessionsIndexFile = path.join(root, "legacy-index.json");

    const store = new SessionStore();
    const externalUserId = "web:personal:web-anonymous";
    const session = store.createWebConversation(externalUserId);
    store.appendMessage(session.id, "user", "hello", {
      activities: [{ key: "read-1", kind: "tool", label: "Read file", state: "success", summary: "done" }]
    });
    assert.deepEqual(store.listMessages(session.id)[0]?.activities, [
      { key: "read-1", kind: "tool", label: "Read file", state: "success", summary: "done" }
    ]);

    const sessionFile = path.join(
      root,
      "web",
      "ui-sessions",
      "web_personal_web-anonymous",
      `${session.id}.json`
    );
    assert.equal(existsSync(sessionFile), true);
    assert.equal(existsSync(path.join(root, "web", "ui-sessions", "index.json")), true);
    assert.equal(existsSync(path.join(root, "web", "users")), false);
    assert.equal(existsSync(path.join(root, "web", "sessions-index.json")), false);
    assert.equal(store.deleteConversation(session.id, "web", externalUserId), true);
    assert.equal(existsSync(sessionFile), false);
    assert.deepEqual(store.listConversations("web", externalUserId), []);
    assert.equal(store.deleteConversation(session.id, "web", externalUserId), false);
  } finally {
    storagePaths.webWorkspaceDir = original.webWorkspaceDir;
    storagePaths.sessionsDir = original.sessionsDir;
    storagePaths.sessionsIndexFile = original.sessionsIndexFile;
    rmSync(root, { recursive: true, force: true });
  }
});

test("legacy Web users layout migrates to ui-sessions without losing ordering", () => {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-ui-session-migration-"));
  const original = {
    webWorkspaceDir: storagePaths.webWorkspaceDir,
    sessionsDir: storagePaths.sessionsDir,
    sessionsIndexFile: storagePaths.sessionsIndexFile
  };

  try {
    const webRoot = path.join(root, "web");
    const externalUserId = "web:personal:web-anonymous";
    const conversationIds = ["legacy-first", "legacy-second"];
    const legacySessionDir = path.join(webRoot, "users", "web_personal_web-anonymous", "sessions");
    mkdirSync(legacySessionDir, { recursive: true });
    for (const conversationId of conversationIds) {
      writeFileSync(path.join(legacySessionDir, `${conversationId}.json`), JSON.stringify({
        conversation: {
          id: conversationId,
          channel: "web",
          externalUserId,
          title: `Legacy ${conversationId}`,
          createdAt: "2026-07-13T00:00:00.000Z",
          updatedAt: "2026-07-13T00:00:00.000Z"
        },
        messages: []
      }));
    }
    writeFileSync(path.join(webRoot, "sessions-index.json"), JSON.stringify({
      byUserId: { [externalUserId]: conversationIds },
      byConversationId: Object.fromEntries(conversationIds.map((id) => [id, { externalUserId }]))
    }));
    storagePaths.webWorkspaceDir = webRoot;
    storagePaths.sessionsDir = path.join(root, "legacy");
    storagePaths.sessionsIndexFile = path.join(root, "legacy-index.json");

    const store = new SessionStore();
    assert.deepEqual(store.listConversations("web", externalUserId).map((item) => item.id), conversationIds);
    for (const conversationId of conversationIds) {
      assert.equal(existsSync(path.join(webRoot, "ui-sessions", "web_personal_web-anonymous", `${conversationId}.json`)), true);
    }
    assert.equal(existsSync(path.join(webRoot, "ui-sessions", "index.json")), true);
    const migratedIndex = JSON.parse(readFileSync(path.join(webRoot, "ui-sessions", "index.json"), "utf8"));
    assert.deepEqual(migratedIndex.byUserId[externalUserId], conversationIds);
    assert.equal(existsSync(path.join(webRoot, "sessions-index.json")), false);
    assert.equal(existsSync(path.join(webRoot, "users")), false);
  } finally {
    storagePaths.webWorkspaceDir = original.webWorkspaceDir;
    storagePaths.sessionsDir = original.sessionsDir;
    storagePaths.sessionsIndexFile = original.sessionsIndexFile;
    rmSync(root, { recursive: true, force: true });
  }
});

test("automation Web conversations persist their origin for the shared sidebar filter", () => {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-automation-origin-"));
  const original = {
    webWorkspaceDir: storagePaths.webWorkspaceDir,
    sessionsDir: storagePaths.sessionsDir,
    sessionsIndexFile: storagePaths.sessionsIndexFile
  };

  try {
    storagePaths.webWorkspaceDir = path.join(root, "web");
    storagePaths.sessionsDir = path.join(root, "legacy");
    storagePaths.sessionsIndexFile = path.join(root, "legacy-index.json");

    const store = new SessionStore();
    const conversation = store.getOrCreateConversation(
      "web",
      "bot:default:chat:web:default:web-anonymous:task-20260710-test",
      undefined,
      { origin: "automation" } as any
    );
    assert.equal(conversation.origin, "automation");
    assert.equal(store.listAllWebConversations()[0]?.conversation.origin, "automation");
  } finally {
    storagePaths.webWorkspaceDir = original.webWorkspaceDir;
    storagePaths.sessionsDir = original.sessionsDir;
    storagePaths.sessionsIndexFile = original.sessionsIndexFile;
    rmSync(root, { recursive: true, force: true });
  }
});

test("external-channel conversations no longer persist to the legacy sessions store", () => {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-external-noop-"));
  const original = {
    webWorkspaceDir: storagePaths.webWorkspaceDir,
    sessionsDir: storagePaths.sessionsDir,
    sessionsIndexFile: storagePaths.sessionsIndexFile
  };

  try {
    storagePaths.webWorkspaceDir = path.join(root, "web");
    storagePaths.sessionsDir = path.join(root, "legacy");
    storagePaths.sessionsIndexFile = path.join(root, "legacy-index.json");

    const store = new SessionStore();
    const tg = store.getOrCreateConversation("telegram", "bot:main:chat:user-1:s-20260704-abcd");
    // Callers still receive a valid conversation + message object...
    const message = store.appendMessage(tg.id, "user", "hello from telegram");
    assert.equal(message.content, "hello from telegram");

    // ...but nothing is written to the legacy `sessions/` flat store or its index.
    // The Desktop viewer now derives external transcripts from the Agent
    // `contexts/` store (see externalSessionsFromContexts.ts).
    assert.equal(existsSync(path.join(root, "legacy", `${tg.id}.json`)), false);
    assert.equal(existsSync(path.join(root, "legacy-index.json")), false);
  } finally {
    storagePaths.webWorkspaceDir = original.webWorkspaceDir;
    storagePaths.sessionsDir = original.sessionsDir;
    storagePaths.sessionsIndexFile = original.sessionsIndexFile;
    rmSync(root, { recursive: true, force: true });
  }
});

test("project conversations use isolated project storage and remain outside Web lists", () => {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-project-sessions-"));
  const original = {
    projectsDir: storagePaths.projectsDir,
    webWorkspaceDir: storagePaths.webWorkspaceDir,
    sessionsDir: storagePaths.sessionsDir,
    sessionsIndexFile: storagePaths.sessionsIndexFile
  };
  try {
    storagePaths.projectsDir = path.join(root, "projects");
    storagePaths.webWorkspaceDir = path.join(root, "web");
    storagePaths.sessionsDir = path.join(root, "legacy");
    storagePaths.sessionsIndexFile = path.join(root, "legacy-index.json");
    const store = new SessionStore();
    const owner = "web:personal:user";
    const project = store.getOrCreateConversation("web", owner, undefined, { projectId: "wiki" });
    store.appendMessage(project.id, "user", "Project hello");
    const ordinary = store.createWebConversation(owner);
    store.appendMessage(ordinary.id, "user", "Web hello");

    assert.equal(existsSync(path.join(root, "projects", "wiki", "sessions", `${project.id}.json`)), true);
    assert.deepEqual(store.listProjectConversations("wiki").map((item) => item.id), [project.id]);
    assert.deepEqual(store.listConversations("web", owner).map((item) => item.id), [ordinary.id]);
    assert.equal(store.listMessages(project.id)[0]?.content, "Project hello");

    const escaped = store.createProjectConversation("../evil", owner);
    assert.equal(existsSync(path.join(root, "projects", ".._evil", "sessions", `${escaped.id}.json`)), true);
    assert.equal(existsSync(path.join(root, "evil", "sessions", `${escaped.id}.json`)), false);

    const renamed = store.renameProjectConversation("wiki", project.id, "My project chat");
    assert.equal(renamed?.title, "My project chat");
    assert.equal(store.getProjectConversation("wiki", project.id)?.title, "My project chat");
    assert.equal(store.renameProjectConversation("wiki", "missing", "x"), null);

    assert.equal(store.deleteProjectConversation("wiki", project.id), true);
    assert.equal(store.getProjectConversation("wiki", project.id), null);
    assert.equal(store.deleteProjectConversation("wiki", project.id), false);
  } finally {
    Object.assign(storagePaths, original);
    rmSync(root, { recursive: true, force: true });
  }
});

test("empty conversations are reused once per Web profile and project", () => {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-empty-session-"));
  const original = {
    projectsDir: storagePaths.projectsDir,
    webWorkspaceDir: storagePaths.webWorkspaceDir,
    sessionsDir: storagePaths.sessionsDir,
    sessionsIndexFile: storagePaths.sessionsIndexFile
  };
  try {
    storagePaths.projectsDir = path.join(root, "projects");
    storagePaths.webWorkspaceDir = path.join(root, "web");
    storagePaths.sessionsDir = path.join(root, "legacy");
    storagePaths.sessionsIndexFile = path.join(root, "legacy-index.json");
    const store = new SessionStore();
    const personal = "web:personal:user";
    const work = "web:work:user";

    const firstWeb = store.getOrCreateEmptyWebConversation(personal);
    const reusedWeb = store.getOrCreateEmptyWebConversation(personal);
    assert.equal(firstWeb.reused, false);
    assert.equal(reusedWeb.reused, true);
    assert.equal(reusedWeb.conversation.id, firstWeb.conversation.id);
    assert.notEqual(store.getOrCreateEmptyWebConversation(work).conversation.id, firstWeb.conversation.id);

    store.appendMessage(firstWeb.conversation.id, "user", "Start work");
    const nextWeb = store.getOrCreateEmptyWebConversation(personal);
    assert.equal(nextWeb.reused, false);
    assert.notEqual(nextWeb.conversation.id, firstWeb.conversation.id);

    const firstProject = store.getOrCreateEmptyProjectConversation("wiki", personal);
    const reusedProject = store.getOrCreateEmptyProjectConversation("wiki", personal);
    assert.equal(firstProject.reused, false);
    assert.equal(reusedProject.reused, true);
    assert.equal(reusedProject.conversation.id, firstProject.conversation.id);
    assert.notEqual(store.getOrCreateEmptyProjectConversation("notes", personal).conversation.id, firstProject.conversation.id);
  } finally {
    Object.assign(storagePaths, original);
    rmSync(root, { recursive: true, force: true });
  }
});

test("truncateMessagesFrom drops the picked message and everything after it", () => {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-truncate-"));
  const original = {
    webWorkspaceDir: storagePaths.webWorkspaceDir,
    sessionsDir: storagePaths.sessionsDir,
    sessionsIndexFile: storagePaths.sessionsIndexFile
  };

  try {
    storagePaths.webWorkspaceDir = path.join(root, "web");
    storagePaths.sessionsDir = path.join(root, "legacy");
    storagePaths.sessionsIndexFile = path.join(root, "legacy-index.json");

    const store = new SessionStore();
    const externalUserId = "web:personal:web-anonymous";
    const session = store.createWebConversation(externalUserId);
    const user1 = store.appendMessage(session.id, "user", "first turn").id;
    const assistant1 = store.appendMessage(session.id, "assistant", "first answer").id;
    const user2 = store.appendMessage(session.id, "user", "second turn").id;
    const assistant2 = store.appendMessage(session.id, "assistant", "second answer").id;
    assert.equal(store.listMessages(session.id).length, 4);

    const removed = store.truncateMessagesFrom(session.id, user2);
    assert.equal(removed, 2);
    const remaining = store.listMessages(session.id);
    assert.deepEqual(remaining.map((m) => m.id), [user1, assistant1]);

    // Unknown message id: throws MESSAGE_NOT_FOUND with a hint about the
    // current message count so the client can show a useful error.
    assert.throws(
      () => store.truncateMessagesFrom(session.id, "does-not-exist"),
      /Message not found \(session has 2 messages\)/
    );
    assert.equal(store.listMessages(session.id).length, 2);

    // Re-truncating at the head drops everything.
    assert.equal(store.truncateMessagesFrom(session.id, user1), 2);
    assert.deepEqual(store.listMessages(session.id), []);

    // No-op on a session that was never persisted: throws SESSION_NOT_FOUND.
    assert.throws(
      () => store.truncateMessagesFrom("never-existed", user1),
      /Session not found/
    );
  } finally {
    Object.assign(storagePaths, original);
    rmSync(root, { recursive: true, force: true });
  }
});
