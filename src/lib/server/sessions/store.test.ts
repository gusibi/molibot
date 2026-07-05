import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
      "users",
      "web_personal_web-anonymous",
      "sessions",
      `${session.id}.json`
    );
    assert.equal(existsSync(sessionFile), true);
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

test("listExternalSessions returns non-web conversations sorted by updatedAt desc and skips missing files", () => {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-desktop-external-"));
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
    const webSession = store.createWebConversation("web:personal:web-anonymous");
    store.appendMessage(webSession.id, "user", "hello web");

    const tgNew = store.getOrCreateConversation("telegram", "tg-user-1");
    store.appendMessage(tgNew.id, "user", "newer message");
    const tgOld = store.getOrCreateConversation("telegram", "tg-user-2");
    store.appendMessage(tgOld.id, "user", "older message");
    // Force a deterministic older updatedAt on the second session so the
    // newest-first ordering can be verified.
    const legacySessionFile = path.join(root, "legacy", `${tgOld.id}.json`);
    const data = JSON.parse(readFileSync(legacySessionFile, "utf8"));
    data.conversation.updatedAt = "2026-01-01T00:00:00.000Z";
    writeFileSync(legacySessionFile, JSON.stringify(data));

    const external = store.listExternalSessions();

    assert.equal(external.length, 2);
    assert.equal(external.every((s) => s.channel !== "web"), true);
    assert.deepEqual(external.map((s) => s.conversation.id), [tgNew.id, tgOld.id]);
    assert.equal(external[0].channel, "telegram");
    assert.equal(external[0].externalUserId, "tg-user-1");
  } finally {
    storagePaths.webWorkspaceDir = original.webWorkspaceDir;
    storagePaths.sessionsDir = original.sessionsDir;
    storagePaths.sessionsIndexFile = original.sessionsIndexFile;
    rmSync(root, { recursive: true, force: true });
  }
});

test("listExternalSessions hides automation conversations from ordinary session navigation", () => {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-desktop-automation-sessions-"));
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
    const visible = store.getOrCreateConversation("telegram", "bot:main:chat:user-1:s-20260704-abcd");
    store.appendMessage(visible.id, "user", "ordinary chat");
    const automation = store.getOrCreateConversation("telegram", "bot:main:chat:user-1:task-20260704-wxyz");
    store.appendMessage(automation.id, "user", "scheduled report");

    assert.deepEqual(store.listExternalSessions().map((item) => item.conversation.id), [visible.id]);
    assert.ok(store.getExternalSession(automation.id), "automation transcript remains available by id");
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
