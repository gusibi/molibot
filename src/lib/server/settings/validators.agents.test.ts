import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "molibot-agent-validators-"));
process.env.DATA_DIR = dataDir;
const { validateAgentReferences } = await import("./validators.js");
const { defaultRuntimeSettings } = await import("./defaults.js");

function base(): any {
  const settings = structuredClone(defaultRuntimeSettings);
  settings.agents = [
    { id: "default", name: "Momo", description: "", enabled: true },
    { id: "writer", name: "Writer", description: "", enabled: true }
  ];
  settings.deletedAgentIds = [];
  settings.pendingAgentDeletions = [];
  settings.channels = {
    ...settings.channels,
    telegram: { instances: [{ id: "personal", name: "Personal", enabled: true, agentId: "writer", credentials: {}, allowedChatIds: [] }] }
  };
  return settings;
}

test.after(() => rmSync(dataDir, { recursive: true, force: true }));

test("the default Agent cannot be disabled, deleted or left without an enabled replacement", () => {
  const settings = base();
  const disabled = settings.agents.map((agent: any) => agent.id === "default" ? { ...agent, enabled: false } : agent);
  assert.match(String(validateAgentReferences(settings, { agents: disabled })), /enabled default Agent/);
  const removed = settings.agents.filter((agent: any) => agent.id !== "default");
  assert.match(String(validateAgentReferences(settings, { agents: removed })), /enabled default Agent/);
  const replaced = settings.agents.map((agent: any) => agent.id === "default" ? { ...agent, enabled: false } : agent);
  assert.equal(validateAgentReferences(settings, { agents: replaced, defaultAgentId: "writer" }), null);
});

test("deleted and deleting Agent IDs cannot be reused", () => {
  const settings = base();
  settings.deletedAgentIds = ["old"];
  assert.match(String(validateAgentReferences(settings, { agents: [...settings.agents, { id: "old", name: "Old", description: "", enabled: true }] })), /cannot be reused/);
  settings.deletedAgentIds = [];
  settings.pendingAgentDeletions = ["old"];
  assert.match(String(validateAgentReferences(settings, { agents: [...settings.agents, { id: "old", name: "Old", description: "", enabled: true }] })), /cannot be reused/);
});

test("a channel binding to a missing Agent is rejected", () => {
  const settings = base();
  const agents = settings.agents.filter((agent: any) => agent.id !== "writer");
  assert.match(String(validateAgentReferences(settings, { agents })), /references missing agent 'writer'/);
});
