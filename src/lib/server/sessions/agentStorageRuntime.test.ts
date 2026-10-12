import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MomRuntimeStore } from "$lib/server/agent/session/store.js";
import { agentWorkspaceDir } from "./agentStorage.js";
test("Agent sessions share resources while current routes and rebinding preserve their ownership", () => {
  const root = mkdtempSync(join(tmpdir(), "molibot-agent-storage-"));
  try {
    let agent = "default";
    const store = new MomRuntimeStore(agentWorkspaceDir(root, agent), { source: { channel: "telegram", botId: "one" }, getAgentId: () => agent });
    const first = store.createSession("chat");
    store.appendContextMessage("chat", { role: "user", content: "original", timestamp: 1 }, first);
    const second = store.createSession("other");
    assert.equal(store.getChatDir("chat"), store.getChatDir("other"));
    assert.equal(existsSync(join(root, "sessions/default/chat")), false);
    assert.equal(store.readSessionOrigin("chat", first)?.agentId, "default");
    agent = "research";
    const next = store.createSession("chat");
    assert.equal(store.readSessionOrigin("chat", next)?.agentId, "research");
    assert.equal(store.forSession("chat", first).getWorkspaceDir(), join(root, "sessions/default"));
    assert.equal(store.loadContext("chat", first).length, 1);
    assert.equal(store.getActiveSession("other"), second);
    const reopened = new MomRuntimeStore(agentWorkspaceDir(root, agent), { source: { channel: "telegram", botId: "one" }, getAgentId: () => agent });
    assert.equal(reopened.getActiveSession("chat"), next);
    assert.equal(reopened.getActiveSession("other"), second);
    assert.ok(store.listSessions("chat").includes(first));
    assert.ok(!store.listSessions("chat").includes(second));
    const attachment = store.forSession("chat", first).saveAttachment("chat", "a.txt", "1", Buffer.from("file"));
    store.deleteSession("chat", first);
    assert.equal(existsSync(join(root, "sessions/default", attachment.local)), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});


test("shared task archives persist automation metadata and fixed Agent ownership", () => {
  const root = mkdtempSync(join(tmpdir(), "molibot-agent-archive-"));
  try {
    const store = new MomRuntimeStore(agentWorkspaceDir(root, "default"), { source: { channel: "telegram", botId: "one" }, getAgentId: () => "default" });
    const eventStore = store.forAgent("research");
    const archive = eventStore.beginTaskArchiveSession("chat", "task");
    eventStore.setTaskArchiveReturnSession("chat", archive, "prior");
    const meta = eventStore.readSessionOrigin("chat", archive)!;
    assert.equal(meta.agentId, "research");
    assert.equal(meta.origin, "automation");
    assert.equal(meta.taskId, "task");
    assert.equal(meta.archiveMode, "shared");
    assert.equal(meta.returnSessionId, "prior");
    assert.equal(store.forSession("chat", archive).getWorkspaceDir(), agentWorkspaceDir(root, "research"));
    assert.equal(eventStore.beginTaskArchiveSession("chat", "task"), archive);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
