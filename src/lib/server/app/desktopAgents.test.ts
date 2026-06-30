import assert from "node:assert/strict";
import test from "node:test";
import type { AgentSettings, RuntimeSettings } from "$lib/server/settings/schema";
import {
  buildDesktopAgentItem,
  buildDesktopAgentsSummary,
  deleteDesktopAgent,
  saveDesktopAgent
} from "./desktopAgents";

function agent(overrides: Partial<AgentSettings> = {}): AgentSettings {
  return {
    id: "default",
    name: "Default Agent",
    description: "Handles general chat",
    enabled: true,
    sandboxEnabled: true,
    modelRouting: { textModelKey: "custom:gpt-4o", visionModelKey: "", sttModelKey: "" },
    ...overrides
  } as AgentSettings;
}

function settings(overrides: Partial<RuntimeSettings> = {}): RuntimeSettings {
  return { agents: [agent()], ...overrides } as RuntimeSettings;
}

test("buildDesktopAgentItem projects display fields and counts model overrides", () => {
  const item = buildDesktopAgentItem(agent());

  assert.equal(item.id, "default");
  assert.equal(item.name, "Default Agent");
  assert.equal(item.description, "Handles general chat");
  assert.equal(item.enabled, true);
  assert.equal(item.sandboxEnabled, true);
  assert.equal(item.modelOverrides, 1);
  assert.equal(item.modelRouting.textModelKey, "custom:gpt-4o");
});

test("buildDesktopAgentItem treats missing routing/sandbox as no overrides and inherited", () => {
  const item = buildDesktopAgentItem(
    agent({ id: "lean", name: "", sandboxEnabled: undefined, modelRouting: undefined, enabled: false })
  );

  assert.equal(item.name, "lean");
  assert.equal(item.sandboxEnabled, null);
  assert.equal(item.modelOverrides, 0);
  assert.equal(item.enabled, false);
});

test("buildDesktopAgentItem never leaks unprojected agent fields while exposing editable routing", () => {
  const raw = {
    id: "x",
    name: "X",
    description: "ok to show",
    enabled: true,
    sandboxEnabled: false,
    modelRouting: { textModelKey: "custom:secret-model-id", visionModelKey: "", sttModelKey: "" },
    // fields that may exist on the runtime object but must never reach the WebView
    systemPrompt: "SECRET-INSTRUCTIONS",
    apiKey: "sk-agent-secret"
  } as unknown as AgentSettings;

  const item = buildDesktopAgentItem(raw);
  const serialized = JSON.stringify(item);

  assert.equal(serialized.includes("SECRET-INSTRUCTIONS"), false);
  assert.equal(serialized.includes("sk-agent-secret"), false);
  assert.equal(item.modelRouting.textModelKey, "custom:secret-model-id");
  assert.equal(item.modelOverrides, 1);
  assert.equal(item.description, "ok to show");
});

test("saveDesktopAgent adds or replaces one normalized agent", () => {
  const current = settings({ agents: [agent(), agent({ id: "other" })] });
  const next = saveDesktopAgent(current, {
    previousId: "default", id: "default", name: "Renamed", description: "Updated", enabled: false,
    sandboxEnabled: null, modelRouting: { textModelKey: "", visionModelKey: "vision:v1", sttModelKey: "" }
  });
  assert.equal(next.length, 2);
  assert.equal(next.find((item) => item.id === "default")?.name, "Renamed");
  assert.equal(next.find((item) => item.id === "default")?.sandboxEnabled, undefined);
  assert.equal(next.find((item) => item.id === "default")?.modelRouting?.visionModelKey, "vision:v1");
});

test("deleteDesktopAgent rejects linked agents and removes unreferenced agents", () => {
  const current = settings({
    agents: [agent(), agent({ id: "other" })],
    channels: { web: { instances: [{ id: "web", name: "Web", enabled: true, agentId: "default", credentials: {}, allowedChatIds: [] }] } }
  });
  assert.throws(() => deleteDesktopAgent(current, "default"), /still linked/);
  assert.deepEqual(deleteDesktopAgent(current, "other").map((item) => item.id), ["default"]);
});

test("buildDesktopAgentsSummary counts total and enabled", () => {
  const summary = buildDesktopAgentsSummary(
    settings({ agents: [agent(), agent({ id: "b", enabled: false }), agent({ id: "c" })] })
  );

  assert.equal(summary.counts.total, 3);
  assert.equal(summary.counts.enabled, 2);
  assert.equal(summary.items.length, 3);
});
