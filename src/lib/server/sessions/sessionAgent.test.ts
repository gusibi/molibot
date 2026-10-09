import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { SessionStore } from "$lib/server/sessions/store.js";

const OWNER = "web:personal:owner";

function setup(t: test.TestContext): SessionStore {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-session-agent-"));
  const originals = { ...storagePaths };
  storagePaths.webWorkspaceDir = path.join(root, "web");
  storagePaths.sessionsDir = path.join(root, "sessions");
  storagePaths.sessionsIndexFile = path.join(root, "index.json");
  storagePaths.projectsDir = path.join(root, "projects");
  t.after(() => {
    Object.assign(storagePaths, originals);
    rmSync(root, { recursive: true, force: true });
  });
  return new SessionStore();
}

test("ordinary session retains its Agent and model override across store restart", (t) => {
  const store = setup(t);
  const conversation = store.createWebConversation(OWNER, undefined, "researcher");
  store.setConversationModelKey(conversation.id, "custom|provider|model");
  store.appendMessage(conversation.id, "user", "research this");
  const restarted = new SessionStore();
  const restored = restarted.getConversationById(conversation.id, "web", OWNER);
  assert.equal(restored?.agentId, "researcher");
  assert.equal(restored?.modelKey, "custom|provider|model");
  assert.equal(restarted.getOrCreateConversation("web", OWNER, conversation.id, { agentId: "researcher" }).id, conversation.id);
  assert.throws(() => restarted.getOrCreateConversation("web", OWNER, conversation.id, { agentId: "writer" }), /Agent mismatch/);
  assert.equal(restarted.getConversationById(conversation.id, "web", OWNER)?.agentId, "researcher");
});

test("Agent changes create independent ordinary sessions without reassigning history", (t) => {
  const store = setup(t);
  const first = store.getOrCreateConversation("web", OWNER, undefined, { agentId: "researcher" });
  store.appendMessage(first.id, "user", "private research");
  const second = store.getOrCreateConversation("web", OWNER, undefined, { agentId: "writer" });
  assert.notEqual(first.id, second.id);
  assert.equal(second.agentId, "writer");
  assert.equal(store.getOrCreateConversation("web", OWNER, undefined, { agentId: "researcher" }).id, first.id);
  assert.equal(store.listMessages(second.id).length, 0);
});

test("unassigned history requires an owner-authorized claim and cannot change Agent later", (t) => {
  const store = setup(t);
  const old = store.createWebConversation(OWNER);
  store.appendMessage(old.id, "user", "historical message");
  assert.equal(new SessionStore().getConversationById(old.id, "web", OWNER)?.agentId, undefined);
  assert.throws(() => store.getOrCreateConversation("web", OWNER, old.id, { agentId: "researcher" }), /Agent mismatch/);
  assert.equal(store.claimConversationAgent(old.id, "web:other:owner", "researcher"), null);
  assert.equal(store.claimConversationAgent(old.id, OWNER, "researcher")?.agentId, "researcher");
  const activityTime = store.getConversationById(old.id, "web", OWNER)?.updatedAt;
  assert.equal(store.claimConversationAgent(old.id, OWNER, "researcher")?.agentId, "researcher");
  assert.equal(store.getConversationById(old.id, "web", OWNER)?.updatedAt, activityTime);
  assert.throws(() => store.claimConversationAgent(old.id, OWNER, "writer"), /Agent mismatch/);
  const restarted = new SessionStore();
  assert.equal(restarted.getConversationById(old.id, "web", OWNER)?.agentId, "researcher");
  assert.equal(restarted.listMessages(old.id)[0]?.content, "historical message");
});

test("Project sessions do not acquire Agent ownership", (t) => {
  const store = setup(t);
  const project = store.getOrCreateConversation("web", OWNER, undefined, { projectId: "project", agentId: "researcher" });
  assert.equal(project.agentId, undefined);
  assert.equal(store.claimConversationAgent(project.id, OWNER, "writer"), null);
  assert.equal(store.getOrCreateConversation("web", OWNER, project.id, { projectId: "project", agentId: "writer" }).id, project.id);
  assert.equal(store.getOrCreateConversation("web", OWNER, project.id, { agentId: "writer" }).id, project.id);
});

test("empty draft sessions are reused only within the selected Agent", (t) => {
  const store = setup(t);
  const researcher = store.getOrCreateEmptyWebConversation(OWNER, "researcher");
  const writer = store.getOrCreateEmptyWebConversation(OWNER, "writer");
  assert.equal(researcher.conversation.agentId, "researcher");
  assert.equal(writer.conversation.agentId, "writer");
  assert.notEqual(researcher.conversation.id, writer.conversation.id);
  assert.deepEqual(store.getOrCreateEmptyWebConversation(OWNER, "researcher"), { conversation: researcher.conversation, reused: true });
});

test("shared admission rejects unassigned history and disabled Agents without changing the saved identity", async t => {
  const store = setup(t);
  const { admitAgentConversation, claimAgentConversation, resolveOrdinaryWebConversation } = await import("./sessionAgentService.js");
  const { defaultRuntimeSettings } = await import("../settings/defaults.js");
  const settings = structuredClone(defaultRuntimeSettings);
  settings.agents.push({ id: "researcher", name: "Researcher", description: "", enabled: true });
  const unknown = store.createWebConversation(OWNER);
  assert.throws(() => resolveOrdinaryWebConversation(store, settings, { externalUserId: OWNER, profileId: "personal", conversationId: unknown.id }), /unassigned/);
  claimAgentConversation(store, settings, { externalUserId: OWNER, conversationId: unknown.id, agentId: "researcher" });
  assert.equal(admitAgentConversation(store, settings, { externalUserId: OWNER, conversationId: unknown.id, agentId: "researcher" }).id, unknown.id);
  settings.agents.find(agent => agent.id === "researcher")!.enabled = false;
  assert.throws(() => admitAgentConversation(store, settings, { externalUserId: OWNER, conversationId: unknown.id, agentId: "researcher" }), /disabled/);
  assert.equal(store.getConversationById(unknown.id, "web", OWNER)?.agentId, "researcher");
});

test("stored admission rebinds new input, preserves history and lets only persisted approval resume a disabled Agent", async t => {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-stored-admission-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { MomRuntimeStore } = await import("../agent/session/store.js");
  const { admitStoredAgentSession } = await import("./sessionAgentService.js");
  const { defaultRuntimeSettings } = await import("../settings/defaults.js");
  const settings = structuredClone(defaultRuntimeSettings);
  settings.agents.push({ id: "writer", name: "Writer", description: "", enabled: true });
  const store = new MomRuntimeStore(root);
  const original = store.createSession("chat");
  store.markSessionOrigin("chat", original, { agentId: "default" });
  store.appendContextMessage("chat", { role: "user", content: "OLD_PRIVATE", timestamp: Date.now() }, original);
  const next = admitStoredAgentSession(store, settings, { chatId: "chat", sessionId: original, explicit: false, agentId: "writer" });
  assert.notEqual(next, original);
  assert.equal(store.readSessionOrigin("chat", original)?.agentId, "default");
  assert.equal(store.readSessionOrigin("chat", next)?.agentId, "writer");
  assert.deepEqual(store.loadContext("chat", next), []);
  settings.agents.find(agent => agent.id === "default")!.enabled = false;
  assert.throws(() => admitStoredAgentSession(store, settings, { chatId: "chat", sessionId: original, explicit: true, agentId: "writer" }), /disabled/);
  store.appendRuntimeEvent("chat", { code: "PI_APPROVAL_SUSPENDED", level: "info", summary: "Approval suspended", details: { runId: "approved-run", userId: "owner" } }, original);
  assert.equal(admitStoredAgentSession(store, settings, { chatId: "chat", sessionId: original, explicit: true, agentId: "writer", recoveryRunId: "approved-run", userId: "owner" }), original);
  assert.throws(() => admitStoredAgentSession(store, settings, { chatId: "chat", sessionId: original, explicit: true, agentId: "writer", recoveryRunId: "different-run", userId: "owner" }), /disabled/);
});
