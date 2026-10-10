import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { readSessionOriginMetadata, writeSessionOriginMetadata } from "$lib/server/agent/session/metadata.js";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";
import { associateSessionAgents } from "./sessionAgentAssociation.js";
import { SessionStore } from "./store.js";

function setup(t: test.TestContext) {
  const root = mkdtempSync(join(tmpdir(), "molibot-associate-agent-"));
  const originals = { ...storagePaths };
  storagePaths.webWorkspaceDir = join(root, "moli-w");
  storagePaths.sessionsDir = join(root, "sessions");
  storagePaths.sessionsIndexFile = join(root, "index.json");
  storagePaths.projectsDir = join(root, "projects");
  t.after(() => { Object.assign(storagePaths, originals); rmSync(root, { recursive: true, force: true }); });
  const settings = structuredClone(defaultRuntimeSettings);
  settings.agents.push({ id: "researcher", name: "Researcher", description: "", enabled: false });
  for (const channel of ["web", "telegram"]) {
    settings.channels[channel] = { instances: [{ id: "personal", name: "Personal", enabled: true, agentId: "researcher", credentials: {}, allowedChatIds: [] }] };
  }
  const seed = (channel: string, bot: string, chat: string, id: string, agentId?: string) => {
    const dir = join(root, channel, "bots", bot, chat, "contexts");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${id}.jsonl`), "historical transcript\n");
    if (agentId) writeSessionOriginMetadata(dir, id, { agentId });
    return dir;
  };
  return { root, settings, sessions: new SessionStore(), seed };
}

test("Bot directory ownership automatically pins history, preserves transcripts and survives rebinding", t => {
  const { root, settings, sessions, seed } = setup(t);
  const dir = seed("moli-t", "personal", "123", "old");
  const pinned = seed("moli-t", "personal", "123", "known", "default");
  const unknown = seed("moli-t", "removed", "123", "orphan");
  const automation = seed("moli-t", "personal", "123", "t-task");
  assert.deepEqual(associateSessionAgents(sessions, settings, root), { contexts: 1, web: 0, conflicts: 0 });
  assert.equal(readSessionOriginMetadata(dir, "old")?.agentId, "researcher");
  assert.equal(readSessionOriginMetadata(pinned, "known")?.agentId, "default");
  assert.equal(readSessionOriginMetadata(unknown, "orphan")?.agentId, undefined);
  assert.equal(readSessionOriginMetadata(automation, "t-task")?.agentId, undefined);
  assert.equal(readFileSync(join(dir, "old.jsonl"), "utf8"), "historical transcript\n");
  settings.channels.telegram.instances[0].agentId = "default";
  assert.deepEqual(associateSessionAgents(new SessionStore(), settings, root), { contexts: 0, web: 0, conflicts: 0 });
  assert.equal(readSessionOriginMetadata(dir, "old")?.agentId, "researcher");
});

test("Web history and Context identities agree before applying the current Bot binding", t => {
  const { root, settings, sessions, seed } = setup(t);
  const owner = "web:personal:owner";
  const old = sessions.createWebConversation(owner);
  sessions.appendMessage(old.id, "user", "old message");
  const activity = sessions.getConversationById(old.id, "web", owner)?.updatedAt;
  const known = sessions.createWebConversation(owner, undefined, "default");
  const knownDir = seed("moli-w", "personal", owner, known.id);
  const contextPinned = sessions.createWebConversation(owner);
  seed("moli-w", "personal", owner, contextPinned.id, "default");
  const project = sessions.getOrCreateConversation("web", owner, undefined, { projectId: "project" });
  assert.deepEqual(associateSessionAgents(sessions, settings, root), { contexts: 0, web: 2, conflicts: 0 });
  const restarted = new SessionStore();
  assert.equal(restarted.getConversationById(old.id, "web", owner)?.agentId, "researcher");
  assert.equal(restarted.getConversationById(old.id, "web", owner)?.updatedAt, activity);
  assert.equal(restarted.listMessages(old.id)[0]?.content, "old message");
  assert.equal(readSessionOriginMetadata(knownDir, known.id)?.agentId, "default");
  assert.equal(restarted.getConversationById(contextPinned.id, "web", owner)?.agentId, "default");
  assert.equal(restarted.getConversationById(project.id, "web", owner)?.agentId, undefined);
  assert.deepEqual(associateSessionAgents(restarted, settings, root), { contexts: 0, web: 0, conflicts: 0 });
});

test("missing and deleted Agent bindings cannot assign unowned history", t => {
  const { root, settings, sessions, seed } = setup(t);
  const dir = seed("moli-t", "personal", "123", "old");
  settings.deletedAgentIds.push("researcher");
  assert.deepEqual(associateSessionAgents(sessions, settings, root), { contexts: 0, web: 0, conflicts: 0 });
  settings.channels.telegram.instances[0].agentId = "missing";
  assert.deepEqual(associateSessionAgents(sessions, settings, root), { contexts: 0, web: 0, conflicts: 0 });
  assert.equal(readSessionOriginMetadata(dir, "old")?.agentId, undefined);
});

test("Web Context automation and conflicting identities remain untouched and conflicts are reported", t => {
  const { root, settings, sessions, seed } = setup(t);
  const owner = "web:personal:owner";
  const automation = sessions.createWebConversation(owner);
  const automationDir = seed("moli-w", "personal", owner, automation.id);
  writeSessionOriginMetadata(automationDir, automation.id, { origin: "automation" });
  const conflict = sessions.createWebConversation(owner, undefined, "default");
  const conflictDir = seed("moli-w", "personal", owner, conflict.id, "researcher");
  assert.deepEqual(associateSessionAgents(sessions, settings, root), { contexts: 0, web: 0, conflicts: 1 });
  assert.equal(sessions.getConversationById(automation.id, "web", owner)?.agentId, undefined);
  assert.equal(readSessionOriginMetadata(automationDir, automation.id)?.agentId, undefined);
  assert.equal(sessions.getConversationById(conflict.id, "web", owner)?.agentId, "default");
  assert.equal(readSessionOriginMetadata(conflictDir, conflict.id)?.agentId, "researcher");
});
