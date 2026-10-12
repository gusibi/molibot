import assert from "node:assert/strict";
import test from "node:test";
import type { RuntimeSettings } from "../schema.js";
import { defaultRuntimeSettings } from "../defaults.js";
import { upsertAgent, replaceAgents } from "./agents.js";
import { setChannelAgentBinding } from "./channels.js";

test("Agent binding changes preserve credentials, policy and unrelated settings", () => {
  let current: RuntimeSettings = { ...defaultRuntimeSettings, agents: [...defaultRuntimeSettings.agents, { id: "researcher", name: "Researcher", description: "", enabled: true }], channels: { custom: { instances: [{ id: "bot", name: "Bot", enabled: false, agentId: "default", credentials: { token: "fixture", unknown: "keep" }, allowedChatIds: ["chat"], permissionMode: "manual" as const, display: { toolProgress: "verbose" as const } }] } } };
  const before = structuredClone(current);
  const runtime = { getSettings: () => current, updateSettings: (patch: Partial<RuntimeSettings>) => current = { ...current, ...patch } };
  setChannelAgentBinding(runtime, "custom", "bot", "researcher");
  assert.deepEqual(current, { ...before, channels: { custom: { instances: [{ ...before.channels.custom.instances[0], agentId: "researcher" }] } } });
  assert.throws(() => setChannelAgentBinding(runtime, "custom", "missing", "default"), /not found/);
  assert.throws(() => setChannelAgentBinding(runtime, "custom", "bot", ""), /not found/);
  assert.throws(() => setChannelAgentBinding(runtime, "custom", "bot", "missing"), /not found/);
});


test("Other Agent editors preserve independent settings they do not submit", () => {
  let current: RuntimeSettings = { ...defaultRuntimeSettings, agents: defaultRuntimeSettings.agents.map(agent => ({ ...agent, disabledTools: ["bash"], disabledSkillPaths: ["skills/fixture/SKILL.md"] })) };
  const runtime = { getSettings: () => current, updateSettings: (patch: Partial<RuntimeSettings>) => current = { ...current, ...patch } };
  upsertAgent(runtime, { id: "default", name: "Edited name" });
  assert.deepEqual(current.agents[0].disabledTools, ["bash"]);
  assert.deepEqual(current.agents[0].disabledSkillPaths, ["skills/fixture/SKILL.md"]);
  replaceAgents(runtime, [{ id: "default", description: "Edited description" }]);
  assert.equal(current.agents[0].name, "Edited name");
  assert.deepEqual(current.agents[0].disabledTools, ["bash"]);
  upsertAgent(runtime, { id: "default", disabledTools: [], disabledSkillPaths: [] });
  assert.deepEqual(current.agents[0].disabledTools, []);
  assert.deepEqual(current.agents[0].disabledSkillPaths, []);
});
