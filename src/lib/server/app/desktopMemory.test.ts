import assert from "node:assert/strict";
import test from "node:test";
import type { RuntimeSettings } from "$lib/server/settings/schema";
import type { MemoryBackendCapabilities, MemoryCandidate, MemoryRecord } from "$lib/server/memory/types";
import { buildDesktopMemorySummary, desktopAgentMemoryScope, desktopAgentMemoryRecords, readDesktopHomeMemoryReview } from "./desktopMemory";

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
    { plugins: { memory: { enabled: true, backend: "mory" } } } as RuntimeSettings,
    { enabled: true, capabilities: caps(), embedding: null }
  );

  assert.equal(summary.enabled, true);
  assert.equal(summary.configEnabled, true);
  assert.equal(summary.backend, "mory");
  assert.equal(summary.embedding, null);
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
    { enabled: false, capabilities: caps({ supportsHybridSearch: false, supportsIncrementalFlush: false }), embedding: null }
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

test("home memory review uses the saved sharing scope and reports bounded or unavailable data honestly", () => {
  const settings = { defaultAgentId: "researcher", agents: [{ id: "researcher", shareOwnerMemory: false }] } as unknown as RuntimeSettings;
  let namespaces: string[] = [];
  let namespacePrefixes: string[] = [];
  const memory = { listReviewCandidates: (scope: string[], limit: number, _skills: boolean, prefixes: string[]) => {
    namespaces = scope;
    namespacePrefixes = prefixes;
    // Candidates are counted up to 100; skills keep the small probe.
    assert.equal(limit, _skills ? 11 : 100);
    return Array.from({ length: 11 }, (_, index) => ({ id: String(index), sources: [] })) as unknown as import("$lib/server/memory/types").MemoryCandidate[];
  } };
  assert.equal(readDesktopHomeMemoryReview(settings, memory).hasMore, true);
  assert.deepEqual(namespaces, ["agent:researcher"]);
  assert.deepEqual(namespacePrefixes, ["project:owner:"]);
  settings.agents[0].shareOwnerMemory = true;
  assert.equal(readDesktopHomeMemoryReview(settings, memory).items.length, 10);
  assert.deepEqual(namespaces, ["agent:researcher", "owner:owner"]);
  assert.deepEqual(namespacePrefixes, ["project:owner:"]);
  assert.deepEqual(readDesktopHomeMemoryReview(settings, { listReviewCandidates: () => { throw new Error("unavailable"); } }), { items: [], hasMore: false, unavailable: true });
});

test("home memory review includes owner-project candidates but excludes other owners' projects", async () => {
  const { MemoryCandidateStore } = await import("$lib/server/memory/candidateStore.js");
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "molibot-home-memory-review-"));
  const store = new MemoryCandidateStore(join(dir, "candidates.sqlite"));
  try {
    const base = { runKey: "review-1", domain: "project" as const, type: "user_fact" as const, subject: "focus", path: "mory://user_fact/focus", confidence: 0.9, reason: "extraction", sources: [{ channel: "web" as const, sessionId: "session-1", conversationMessageId: "message-1" }], layer: "long_term" as const };
    const own = store.create({ ...base, namespace: "project:owner:momo-agent", value: "Owner project fact" });
    const other = store.create({ ...base, runKey: "review-2", namespace: "project:someoneelse:secret", value: "Other owner project fact" });
    const settings = { defaultAgentId: "researcher", agents: [{ id: "researcher" }] } as unknown as RuntimeSettings;
    const review = readDesktopHomeMemoryReview(settings, store);
    assert.deepEqual(review.items.map(item => item.id), [own!.id]);
    assert.ok(!review.items.some(item => item.id === other!.id));
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

function comparisonCandidate(overrides: Partial<MemoryCandidate> = {}): MemoryCandidate {
  return { id: 'candidate', fingerprint: 'comparison', status: 'pending', namespace: 'owner:owner', domain: 'owner', type: 'user_preference', subject: 'report_style', path: 'mory://user_preference/report_style', value: 'Conclusions first', confidence: 0.9, reason: 'User update', sources: [], layer: 'long_term', createdAt: 'v1', updatedAt: 'v1', supersedesMemoryId: 'old', ...overrides };
}
function comparisonRecord(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return { id: 'old', namespace: 'owner:owner', channel: 'web', externalUserId: 'owner', content: 'Original preference', tags: [], layer: 'long_term', state: 'active', version: 1, accessCount: 0, injectionCount: 0, createdAt: 'original-v1', updatedAt: 'original-v1', ...overrides };
}

test('candidate comparison exposes only declared originals in the saved namespace', async () => {
  const { readDesktopMemoryComparison } = await import('./desktopMemory');
  const settings = { defaultAgentId: 'researcher', agents: [{ id: 'researcher', shareOwnerMemory: true }] } as RuntimeSettings;
  const candidate = comparisonCandidate({ disputesMemoryId: 'private' });
  const memory = {
    isEnabled: () => true,
    getCandidate: () => candidate,
    getForGovernance: async (_scope: unknown, id: string) => comparisonRecord({ id, content: id === 'old' ? 'Original preference' : 'Secret preference', privacySuppressed: id === 'private' })
  };
  const comparison = await readDesktopMemoryComparison(settings, memory, { id: candidate.id, expectedUpdatedAt: 'v1' });
  assert.deepEqual(comparison.originals, [{ relation: 'replaces', available: true, content: 'Original preference', updatedAt: 'original-v1' }, { relation: 'disputes', available: false }]);
  assert.equal(JSON.stringify(comparison).includes('Secret'), false);
  await assert.rejects(readDesktopMemoryComparison(settings, memory, { id: candidate.id, expectedUpdatedAt: 'stale' }));
  settings.agents[0].shareOwnerMemory = false;
  await assert.rejects(readDesktopMemoryComparison(settings, memory, { id: candidate.id, expectedUpdatedAt: 'v1' }));
  settings.agents[0].shareOwnerMemory = true;
  candidate.namespace = 'project:owner:momo-agent';
  memory.getForGovernance = async (scope: unknown, id: string) => {
    if (id === 'old') assert.equal((scope as { projectId?: string }).projectId, 'momo-agent');
    return comparisonRecord({ id, namespace: 'project:owner:momo-agent', content: id === 'old' ? 'Original project fact' : 'Secret project fact', privacySuppressed: id === 'private' });
  };
  const projectComparison = await readDesktopMemoryComparison(settings, memory, { id: candidate.id, expectedUpdatedAt: 'v1' });
  assert.deepEqual(projectComparison.originals, [{ relation: 'replaces', available: true, content: 'Original project fact', updatedAt: 'original-v1' }, { relation: 'disputes', available: false }]);
  assert.equal(JSON.stringify(projectComparison).includes('Secret'), false);
  candidate.namespace = 'project:someoneelse:secret';
  await assert.rejects(readDesktopMemoryComparison(settings, memory, { id: candidate.id, expectedUpdatedAt: 'v1' }));
});

test('candidate comparison rejects a candidate resolved while loading originals', async () => {
  const { readDesktopMemoryComparison } = await import('./desktopMemory');
  const settings = { defaultAgentId: 'researcher', agents: [{ id: 'researcher', shareOwnerMemory: true }] } as RuntimeSettings;
  let candidate = comparisonCandidate();
  await assert.rejects(readDesktopMemoryComparison(settings, {
    isEnabled: () => true, getCandidate: () => candidate,
    getForGovernance: async () => { candidate = { ...candidate, status: 'ignored', updatedAt: 'v2' }; return null; }
  }, { id: candidate.id, expectedUpdatedAt: 'v1' }), /changed/);
});
