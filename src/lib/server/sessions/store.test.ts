import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
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
