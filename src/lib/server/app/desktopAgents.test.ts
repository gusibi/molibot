import assert from "node:assert/strict";
import test from "node:test";
import type { AgentSettings, RuntimeSettings } from "$lib/server/settings/schema";
import { buildDesktopAgentItem, buildDesktopAgentsSummary } from "./desktopAgents";

function agent(overrides: Partial<AgentSettings> = {}): AgentSettings {
  return {
    id: "default",
    name: "Default Agent",
    description: "Handles general chat",
    enabled: true,
    permissionMode: "auto",
    modelRouting: { textModelKey: "custom:gpt-4o", sttModelKey: "" },
    ...overrides
  } as AgentSettings;
}

function settings(overrides: Partial<RuntimeSettings> = {}): RuntimeSettings {
  return { agents: [agent()], deletedAgentIds: [], ...overrides } as RuntimeSettings;
}

test("buildDesktopAgentItem projects display fields, mode, and counts model overrides", () => {
  const item = buildDesktopAgentItem(agent());

  assert.equal(item.id, "default");
  assert.equal(item.name, "Default Agent");
  assert.equal(item.description, "Handles general chat");
  assert.equal(item.enabled, true);
  assert.equal(item.permissionMode, "auto");
  assert.equal(item.modelOverrides, 1);
  assert.equal(item.modelRouting.textModelKey, "custom:gpt-4o");
});

test("buildDesktopAgentItem treats missing routing/mode as no overrides and inherited", () => {
  const item = buildDesktopAgentItem(
    agent({ id: "lean", name: "", permissionMode: undefined, modelRouting: undefined, enabled: false })
  );

  assert.equal(item.name, "lean");
  assert.equal(item.permissionMode, null);
  assert.equal(item.modelOverrides, 0);
  assert.equal(item.enabled, false);
});

test("buildDesktopAgentItem never leaks unprojected agent fields while exposing editable routing", () => {
  const raw = {
    id: "x",
    name: "X",
    description: "ok to show",
    enabled: true,
    permissionMode: "plan",
    modelRouting: { textModelKey: "custom:secret-model-id", sttModelKey: "" },
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

test("buildDesktopAgentsSummary counts total and enabled", () => {
  const summary = buildDesktopAgentsSummary(
    settings({ agents: [agent(), agent({ id: "b", enabled: false }), agent({ id: "c" })] })
  );

  assert.equal(summary.counts.total, 3);
  assert.equal(summary.counts.enabled, 2);
  assert.equal(summary.items.length, 3);
});
