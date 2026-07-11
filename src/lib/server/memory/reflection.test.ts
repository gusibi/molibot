import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryCandidateStore } from "./candidateStore.js";
import { MemoryGateway } from "./gateway.js";
import { MemoryReflectionService, ReflectionStateStore, reflectionTargetId, type ReflectionSourceProjection, type ReflectionTarget } from "./reflection.js";
import type { MemoryBackend } from "./types.js";

function harness() {
  const dir = mkdtempSync(join(tmpdir(), "molibot-reflection-"));
  const candidates = new MemoryCandidateStore(join(dir, "candidates.sqlite"));
  const state = new ReflectionStateStore(join(dir, "reflection.sqlite"));
  const backend: MemoryBackend = {
    capabilities: () => ({ supportsHybridSearch: true, supportsVectorSearch: false, supportsIncrementalFlush: true, supportsLayeredMemory: true, supportsCandidates: true }),
    add: async () => { throw new Error("pending reflection candidate must not write backend"); },
    get: async () => null, search: async () => [], searchAll: async () => [], delete: async () => false, update: async () => null,
    flush: async () => ({ scannedMessages: 0, addedCount: 0, memories: [], updatedCursorConversations: 0 }),
    compact: async () => ({ scannedCount: 0, removedCount: 0, scopesAffected: 0 })
  };
  const gateway = new MemoryGateway(
    () => ({ plugins: { memory: { enabled: true, backend: "mory" } } }) as any,
    {} as any,
    undefined,
    { candidateStore: candidates, backends: { mory: backend }, backendDefinitions: [{ key: "mory", name: "mory", description: "test", create: () => backend }], importers: [] }
  );
  const target: ReflectionTarget = { ownerId: "owner", botId: "momo", timezone: "Asia/Shanghai", sourceScopes: [{ channel: "web", externalUserId: "profile-1", botId: "momo" }] };
  const targetId = reflectionTargetId(target);
  const projection: ReflectionSourceProjection = {
    scope: target.sourceScopes[0],
    conversationId: "session-1",
    messages: [{ id: "message-1", conversationId: "session-1", sessionId: "session-1", channel: "web", role: "user", content: "你每次都写太长了", createdAt: "2026-07-11T02:00:00.000Z" }]
  };
  const cleanup = () => { candidates.close(); state.close(); rmSync(dir, { recursive: true, force: true }); };
  return { candidates, state, gateway, target, targetId, projection, cleanup };
}

test("reflection creates pending candidate once and advances watermark only after success", async () => {
  const h = harness();
  try {
    const reader = { read: async () => h.state.get(h.targetId, "session-1") ? [] : [h.projection] };
    const extractor = { extract: async () => [{ namespace: "owner:owner" as const, domain: "owner" as const, type: "user_preference" as const, subject: "answer_length", path: "mory://user_preference/answer_length", value: "主人明确希望回答更加简短直接", confidence: 0.92, reason: "主人抱怨回答过长", layer: "long_term" as const }] };
    const service = new MemoryReflectionService(h.gateway, reader, h.state, extractor);
    const first = await service.run(h.target, { now: new Date("2026-07-11T12:00:00.000Z") });
    const second = await service.run(h.target, { now: new Date("2026-07-11T12:00:00.000Z") });
    assert.equal(first.createdCandidates, 1);
    assert.equal(second.createdCandidates, 0);
    assert.equal(h.candidates.list("pending").length, 1);
    assert.ok(h.state.get(h.targetId, "session-1"));
  } finally { h.cleanup(); }
});

test("03:00 reflection reads the previous complete local calendar day", async () => {
  const h = harness();
  try {
    let requestedDate = "";
    const service = new MemoryReflectionService(h.gateway, {
      read: async (_target, localDate) => { requestedDate = localDate; return []; }
    }, h.state, { extract: async () => [] });
    const result = await service.run(h.target, { now: new Date("2026-07-12T19:00:00.000Z") });
    assert.equal(requestedDate, "2026-07-12");
    assert.ok(result.runKey.endsWith(":2026-07-12"));
  } finally { h.cleanup(); }
});

test("invalid extracted candidate does not suppress valid siblings or watermark advancement", async () => {
  const h = harness();
  try {
    const service = new MemoryReflectionService(h.gateway, { read: async () => [h.projection] }, h.state, {
      extract: async () => [
        { namespace: "owner:owner" as const, domain: "owner" as const, type: "user_preference" as const, subject: "", value: "无效候选", confidence: 0.9, reason: "invalid", layer: "long_term" as const },
        { namespace: "owner:owner" as const, domain: "owner" as const, type: "user_preference" as const, subject: "answer_length", value: "主人明确希望回答更加简短直接", confidence: 0.92, reason: "主人抱怨回答过长", layer: "long_term" as const }
      ]
    });
    const result = await service.run(h.target, { now: new Date("2026-07-12T19:00:00.000Z") });
    assert.equal(result.createdCandidates, 1);
    assert.equal(h.candidates.list("pending").length, 1);
    assert.ok(h.state.get(h.targetId, "session-1"));
  } finally { h.cleanup(); }
});

test("candidate storage failures still abort reflection without advancing watermark", async () => {
  const h = harness();
  try {
    h.gateway.createCandidate = (() => { throw new Error("candidate database unavailable"); }) as typeof h.gateway.createCandidate;
    const service = new MemoryReflectionService(h.gateway, { read: async () => [h.projection] }, h.state, {
      extract: async () => [{ namespace: "owner:owner" as const, domain: "owner" as const, type: "user_preference" as const, subject: "answer_length", value: "主人明确希望回答更加简短直接", confidence: 0.92, reason: "主人抱怨回答过长", layer: "long_term" as const }]
    });
    await assert.rejects(service.run(h.target, { now: new Date("2026-07-12T19:00:00.000Z") }), /candidate database unavailable/);
    assert.equal(h.state.get(h.targetId, "session-1"), undefined);
  } finally { h.cleanup(); }
});

test("aborted reflection does not advance watermark or create candidates", async () => {
  const h = harness();
  try {
    const controller = new AbortController();
    const service = new MemoryReflectionService(h.gateway, { read: async () => [h.projection] }, h.state, {
      extract: async () => { controller.abort(new Error("stop")); return []; }
    });
    await assert.rejects(service.run(h.target, { now: new Date("2026-07-11T12:00:00.000Z"), signal: controller.signal }), /stop/);
    assert.equal(h.state.get(h.targetId, "session-1"), undefined);
    assert.equal(h.candidates.list("pending").length, 0);
  } finally { h.cleanup(); }
});
