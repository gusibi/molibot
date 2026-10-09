import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryCandidateStore } from "./candidateStore.js";
import { MemoryGateway } from "./gateway.js";
import { MemoryProfileSnapshotStore } from "./profileSnapshotStore.js";
import type { MemoryBackend, MemoryRecord } from "./types.js";

function record(id: string, content: string): MemoryRecord {
  return {
    id, channel: "web", externalUserId: "profile-1", content, tags: [], layer: "long_term",
    namespace: "owner:owner", domain: "owner", type: "user_preference", subject: "answer_length", path: `mory://user_preference/${id}`,
    state: "active", version: 1, confidence: 0.9, utility: 0.5, accessCount: 0, injectionCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function harness(records: MemoryRecord[], agents: Array<{ id: string; enabled: boolean; shareOwnerMemory?: boolean }> = [], deletedAgentIds: string[] = []) {
  const dir = mkdtempSync(join(tmpdir(), "molibot-profile-summary-gateway-"));
  const backend: MemoryBackend = {
    capabilities: () => ({ supportsHybridSearch: true, supportsVectorSearch: false, supportsIncrementalFlush: true, supportsLayeredMemory: true, supportsCandidates: true }),
    add: async () => { throw new Error("not used"); },
    get: async () => null, search: async () => [], searchAll: async () => [], delete: async () => false, update: async () => null,
    flush: async () => ({ scannedMessages: 0, addedCount: 0, memories: [], updatedCursorConversations: 0 }),
    compact: async () => ({ scannedCount: 0, removedCount: 0, scopesAffected: 0 }),
    listProfileRecords: async () => records
  };
  const snapshots = new MemoryProfileSnapshotStore(join(dir, "settings.sqlite"));
  const candidates = new MemoryCandidateStore(join(dir, "candidates.sqlite"));
  const gateway = new MemoryGateway(
    () => ({ agents, deletedAgentIds, plugins: { memory: { enabled: true, backend: "mory" } } }) as any,
    {} as any,
    undefined,
    { candidateStore: candidates, backends: { mory: backend }, backendDefinitions: [{ key: "mory", name: "mory", description: "test", create: () => backend }], importers: [], profileSnapshotStore: snapshots }
  );
  const scope = { ownerId: "owner", botId: "momo", channel: "web", externalUserId: "profile-1", includeOwner: true, includeAgentSelf: true };
  const cleanup = () => { snapshots.close(); candidates.close(); rmSync(dir, { recursive: true, force: true }); };
  return { gateway, backend, records, scope, cleanup };
}

test("buildProfile synthesizes the summary once per fingerprint and reuses the cache", async () => {
  const h = harness([record("memory-1", "主人偏好简短直接的回答")]);
  try {
    let calls = 0;
    h.gateway.setProfileSummarizer(async () => { calls += 1; return "你偏好简短直接的回答。"; });
    const first = await h.gateway.buildProfile(h.scope);
    assert.equal(first.summary, "你偏好简短直接的回答。");
    assert.equal(calls, 1);
    const second = await h.gateway.buildProfile(h.scope);
    assert.equal(second.summary, "你偏好简短直接的回答。");
    assert.equal(calls, 1);
    h.records.push(record("memory-2", "主人在推进 Molibot 桌面端"));
    const third = await h.gateway.buildProfile(h.scope);
    assert.equal(calls, 2);
    assert.equal(third.summary, "你偏好简短直接的回答。");
  } finally { h.cleanup(); }
});

test("buildProfile falls back to the concatenated summary when synthesis fails or yields nothing", async () => {
  const h = harness([record("memory-1", "主人偏好简短直接的回答")]);
  try {
    h.gateway.setProfileSummarizer(async () => { throw new Error("llm unavailable"); });
    const failed = await h.gateway.buildProfile(h.scope);
    assert.equal(failed.summary, "主人偏好简短直接的回答");
    h.gateway.setProfileSummarizer(async () => "   ");
    const blank = await h.gateway.buildProfile(h.scope);
    assert.equal(blank.summary, "主人偏好简短直接的回答");
  } finally { h.cleanup(); }
});

test("buildProfile skips synthesis without a summarizer or without profile records", async () => {
  const empty = harness([]);
  try {
    let calls = 0;
    empty.gateway.setProfileSummarizer(async () => { calls += 1; return "unused"; });
    const profile = await empty.gateway.buildProfile(empty.scope);
    assert.equal(calls, 0);
    assert.equal(profile.summary, "");
  } finally { empty.cleanup(); }
});

test("ordinary profiles share only authorized owner memory and never another or deleted Agent", async () => {
  const owner = record("owner-fact", "OWNER_FACT");
  const research = { ...record("research-fact", "RESEARCH_PRIVATE"), namespace: "agent:researcher", domain: "agent_self", type: "skill" } as MemoryRecord;
  const writing = { ...record("writing-fact", "WRITER_PRIVATE"), namespace: "agent:writer", domain: "agent_self", type: "skill" } as MemoryRecord;
  const deleted: string[] = [];
  const agents = [{ id: "researcher", enabled: true, shareOwnerMemory: true }, { id: "writer", enabled: true, shareOwnerMemory: false }];
  const h = harness([owner, research, writing], agents, deleted);
  try {
    const scope = { ...h.scope, agentId: "researcher" };
    const first = await h.gateway.buildProfile(scope);
    assert.match(JSON.stringify(first), /OWNER_FACT|RESEARCH_PRIVATE/);
    assert.doesNotMatch(JSON.stringify(first), /WRITER_PRIVATE/);
    const second = await h.gateway.buildProfile({ ...scope, externalUserId: "second-session" });
    assert.match(JSON.stringify(second), /RESEARCH_PRIVATE/);
    const isolated = await h.gateway.buildProfile({ ...scope, agentId: "writer" });
    assert.doesNotMatch(JSON.stringify(isolated), /OWNER_FACT|RESEARCH_PRIVATE/);
    deleted.push("researcher");
    assert.doesNotMatch(JSON.stringify(await h.gateway.buildProfile(scope)), /OWNER_FACT|RESEARCH_PRIVATE/);
    assert.doesNotMatch(JSON.stringify(await h.gateway.buildProfile({ ...scope, agentId: "new-researcher" })), /RESEARCH_PRIVATE/);
  } finally { h.cleanup(); }
});


test("captured Agent scopes recheck owner sharing and deletion before mutations", async () => {
  const agents = [{ id: "researcher", enabled: true, shareOwnerMemory: true }];
  const deleted: string[] = [];
  const h = harness([], agents, deleted);
  const observed: any[] = [];
  h.backend.get = async () => null;
  h.backend.update = async scope => { observed.push(scope); return null; };
  h.backend.delete = async scope => { observed.push(scope); return false; };
  h.backend.flush = async scope => { observed.push(scope); return { scannedMessages: 0, addedCount: 0, memories: [], updatedCursorConversations: 0 }; };
  h.backend.compact = async scope => { observed.push(scope); return { scannedCount: 0, removedCount: 0, scopesAffected: 0 }; };
  try {
    const captured = { ...h.scope, agentId: "researcher", shareOwner: true };
    agents[0].shareOwnerMemory = false;
    await h.gateway.update(captured, "owner-memory", { content: "New fact" });
    await h.gateway.delete(captured, "owner-memory");
    await h.gateway.flush(captured);
    await h.gateway.compact(captured);
    assert.equal(observed.length, 4);
    assert.ok(observed.every(scope => scope.shareOwner === false));
    deleted.push("researcher");
    await h.gateway.update(captured, "private-memory", {});
    await h.gateway.delete(captured, "private-memory");
    await h.gateway.flush(captured);
    await h.gateway.compact(captured);
    assert.equal(observed.length, 4);
  } finally { h.cleanup(); }
});
