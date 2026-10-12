import assert from "node:assert/strict";
import test from "node:test";
import type { RuntimeSettings } from "$lib/server/settings/schema";
import type { MemoryBackendCapabilities } from "$lib/server/memory/types";
import { buildDesktopMemorySummary, desktopAgentMemoryScope, desktopAgentMemoryRecords } from "./desktopMemory";

function caps(overrides: Partial<MemoryBackendCapabilities> = {}): MemoryBackendCapabilities {
  return {
    supportsHybridSearch: true,
    supportsVectorSearch: false,
    supportsIncrementalFlush: true,
    supportsLayeredMemory: false,
    ...overrides
  };
}

test("buildDesktopMemorySummary maps config + runtime state + capabilities", () => {
  const summary = buildDesktopMemorySummary(
    { plugins: { memory: { enabled: true, backend: "mory", embeddingProviderId: "", embeddingModel: "" } } } as RuntimeSettings,
    { enabled: true, capabilities: caps() }
  );

  assert.equal(summary.enabled, true);
  assert.equal(summary.configEnabled, true);
  assert.equal(summary.backend, "mory");
  assert.deepEqual(summary.capabilities, {
    hybridSearch: true,
    vectorSearch: false,
    incrementalFlush: true,
    layeredMemory: false,
    domains: false,
    versioning: false,
    candidates: false
  });
});

test("buildDesktopMemorySummary falls back when memory config is absent", () => {
  const summary = buildDesktopMemorySummary(
    {} as RuntimeSettings,
    { enabled: false, capabilities: caps({ supportsHybridSearch: false, supportsIncrementalFlush: false }) }
  );

  assert.equal(summary.enabled, false);
  assert.equal(summary.configEnabled, false);
  assert.equal(summary.backend, "");
  assert.equal(summary.capabilities.hybridSearch, false);
  assert.equal(summary.capabilities.incrementalFlush, false);
});


test("Agent memory view uses current Agent identity and saved sharing authorization", () => {
  const settings = { agents: [{ id: "researcher", shareOwnerMemory: false }, { id: "writer", shareOwnerMemory: true }], deletedAgentIds: [] } as unknown as RuntimeSettings;
  assert.deepEqual(desktopAgentMemoryScope(settings, "researcher"), { agentId: "researcher", botId: "researcher", channel: "web", externalUserId: "desktop-agent-memory", ownerId: "owner", shareOwner: false });
  assert.equal(desktopAgentMemoryScope(settings, "writer").shareOwner, true);
  assert.throws(() => desktopAgentMemoryScope(settings, "missing"), /Agent not found/);
  settings.deletedAgentIds = ["researcher"];
  assert.throws(() => desktopAgentMemoryScope(settings, "researcher"), /Agent not found/);
});


test("Agent memory records exclude other Agents, conversations, content and unauthorized owners", () => {
  const records = ["agent:researcher", "agent:writer", "owner:owner", "owner:other", "chat:researcher:web:user", "content:researcher"].map(namespace => ({ namespace })) as import("$lib/server/memory/types").MemoryRecord[];
  const scope = { agentId: "researcher", botId: "researcher", channel: "web", externalUserId: "desktop-agent-memory", ownerId: "owner", shareOwner: false };
  assert.deepEqual(desktopAgentMemoryRecords(scope, records).map(item => item.namespace), ["agent:researcher"]);
  assert.deepEqual(desktopAgentMemoryRecords({ ...scope, shareOwner: true }, records).map(item => item.namespace), ["agent:researcher", "owner:owner"]);
});
