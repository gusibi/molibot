import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryCandidateStore } from "./candidateStore.js";
import { MemoryGateway } from "./gateway.js";
import type { MemoryBackend, MemoryCandidateCreateInput, MemoryRecord } from "./types.js";

function candidate(value = "主人明确偏好简短直接的回答方式"): MemoryCandidateCreateInput {
  return {
    runKey: "target-1:2026-07-11",
    namespace: "owner:owner",
    domain: "owner",
    type: "user_preference",
    subject: "answer_length",
    path: "mory://user_preference/answer_length",
    value,
    confidence: 0.9,
    reason: "主人明确抱怨回答太长",
    sources: [{ channel: "web", sessionId: "session-1", conversationMessageId: "message-1" }],
    layer: "long_term"
  };
}

function withStore(run: (store: MemoryCandidateStore) => Promise<void> | void): Promise<void> | void {
  const dir = mkdtempSync(join(tmpdir(), "molibot-memory-candidates-"));
  const store = new MemoryCandidateStore(join(dir, "candidates.sqlite"));
  const finish = (): void => { store.close(); rmSync(dir, { recursive: true, force: true }); };
  try {
    const result = run(store);
    if (result instanceof Promise) return result.finally(finish);
    finish();
  } catch (cause) {
    finish();
    throw cause;
  }
}

test("candidate store deduplicates retries and suppression blocks ignored content", () => withStore((store) => {
  const first = store.create(candidate());
  assert.ok(first);
  assert.equal(store.create(candidate()), null);
  assert.equal(store.ignore(first.id)?.status, "ignored");
  assert.equal(store.create({ ...candidate(), runKey: "target-1:2026-07-12" }), null);
}));

test("privacy suppression survives candidate recreation until explicit audited restore", () => withStore((store) => {
  const input = candidate();
  const first = store.suppressForPrivacy(input, {
    memoryId: "memory-private",
    idempotencyKey: "privacy-1",
    reason: "too_private"
  });
  assert.equal(first.duplicate, false);
  assert.equal(store.create(input), null);
  assert.equal(store.isPrivacySuppressed(input), true);
  assert.equal(store.suppressForPrivacy(input, {
    memoryId: "memory-private",
    idempotencyKey: "privacy-1",
    reason: "too_private"
  }).duplicate, true);
  assert.equal(store.restorePrivacySuppression(input, {
    idempotencyKey: "privacy-restore-1",
    reason: "user_confirmed_scope"
  }).restored, true);
  assert.ok(store.create(input));
}));

test("candidate evidence aggregates across dates and sessions without same-day session inflation", () => withStore((store) => {
  const first = store.create({ ...candidate(), sources: [{ channel: "web", sessionId: "session-1", conversationMessageId: "message-1", observedAt: "2026-07-10T08:00:00.000Z" }] });
  assert.ok(first);
  assert.equal(store.create({ ...candidate(), runKey: "target-2", sources: [{ channel: "web", sessionId: "session-1", conversationMessageId: "message-2", observedAt: "2026-07-10T10:00:00.000Z" }] }), null);
  assert.ok(store.create({ ...candidate(), runKey: "target-3", sources: [{ channel: "web", sessionId: "session-2", conversationMessageId: "message-3", observedAt: "2026-07-11T08:00:00.000Z" }] }));
  assert.ok(store.create({ ...candidate(), runKey: "target-4", sources: [{ channel: "telegram", sessionId: "session-3", conversationMessageId: "message-4", observedAt: "2026-07-12T08:00:00.000Z" }] }));
  const aggregated = store.list("pending");
  assert.equal(aggregated.length, 1);
  assert.equal(aggregated[0]?.occurrenceCount, 3);
  assert.equal(aggregated[0]?.sources.length, 4);
  assert.deepEqual(aggregated[0]?.evidenceDates, ["2026-07-10", "2026-07-11", "2026-07-12"]);
  assert.ok((aggregated[0]?.confidence ?? 0) > 0.9);
}));

test("opposite proposition polarity creates a conflict relation instead of aggregating evidence", () => withStore((store) => {
  const positive = store.create({ ...candidate("主人喜欢较长且完整的回答"), sources: [{ channel: "web", sessionId: "session-1", conversationMessageId: "positive", observedAt: "2026-07-10T08:00:00.000Z" }] });
  const negative = store.create({ ...candidate("主人不喜欢较长的回答"), runKey: "negative-run", sources: [{ channel: "web", sessionId: "session-2", conversationMessageId: "negative", observedAt: "2026-07-11T08:00:00.000Z" }] });
  assert.ok(positive && negative);
  const rows = store.list("pending");
  assert.equal(rows.length, 2);
  assert.equal(rows.every((row) => row.occurrenceCount === 1), true);
  assert.equal(rows.every((row) => row.possibleRelations?.some((relation) => relation.kind === "possible_conflict")), true);
}));

test("gateway confirmation is the only transition that writes the backend", () => withStore(async (store) => {
  const writes: MemoryRecord[] = [];
  const backend: MemoryBackend = {
    capabilities: () => ({ supportsHybridSearch: true, supportsVectorSearch: false, supportsIncrementalFlush: true, supportsLayeredMemory: true, supportsCandidates: true }),
    add: async (_scope, input) => {
      const row = { id: "memory-1", channel: "web", externalUserId: "session-1", content: input.content, tags: [], layer: input.layer ?? "long_term", state: "active", version: 1, accessCount: 0, injectionCount: 0, createdAt: "2026-07-11T00:00:00.000Z", updatedAt: "2026-07-11T00:00:00.000Z" } satisfies MemoryRecord;
      writes.push(row);
      return row;
    },
    get: async () => null,
    search: async () => [],
    searchAll: async () => [],
    delete: async () => false,
    update: async () => null,
    flush: async () => ({ scannedMessages: 0, addedCount: 0, memories: [], updatedCursorConversations: 0 }),
    compact: async () => ({ scannedCount: 0, removedCount: 0, scopesAffected: 0 })
  };
  const gateway = new MemoryGateway(
    () => ({ plugins: { memory: { enabled: true, backend: "mory" } } }) as any,
    {} as any,
    undefined,
    { candidateStore: store, backends: { mory: backend }, backendDefinitions: [{ key: "mory", name: "mory", description: "test", create: () => backend }], importers: [] }
  );
  const pending = gateway.createCandidate(candidate());
  assert.ok(pending);
  assert.equal(writes.length, 0);
  const confirmed = await gateway.confirmCandidate(pending.id, { value: "主人现在明确偏好极其简短的回答方式" });
  assert.equal(confirmed?.status, "edited-then-confirmed");
  assert.equal(confirmed?.confirmedMemoryId, "memory-1");
  assert.equal(writes.length, 1);
  await gateway.confirmCandidate(pending.id);
  assert.equal(writes.length, 1);
}));

test("auto-confirm is default-off and only accepts repeated low-sensitivity preferences", () => withStore(async (store) => {
  const writes: MemoryRecord[] = [];
  const backend: MemoryBackend = {
    capabilities: () => ({ supportsHybridSearch: true, supportsVectorSearch: false, supportsIncrementalFlush: true, supportsLayeredMemory: true, supportsCandidates: true }),
    add: async (_scope, input) => {
      const row = { id: `memory-${writes.length + 1}`, channel: "web", externalUserId: "session", content: input.content, tags: [], layer: input.layer ?? "long_term", state: "active", version: 1, accessCount: 0, injectionCount: 0, reason: input.reason, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } satisfies MemoryRecord;
      writes.push(row);
      return row;
    },
    get: async () => null, search: async () => [], searchAll: async () => [], delete: async () => false,
    update: async () => null, flush: async () => ({ scannedMessages: 0, addedCount: 0, memories: [], updatedCursorConversations: 0 }),
    compact: async () => ({ scannedCount: 0, removedCount: 0, scopesAffected: 0 })
  };
  let enabled = false;
  const gateway = new MemoryGateway(
    () => ({ plugins: { memory: { enabled: true, backend: "mory", autoConfirm: { enabled, occurrenceThreshold: 3, confidenceThreshold: 0.85, allowProjectTasks: false } } } }) as any,
    {} as any, undefined,
    { candidateStore: store, backends: { mory: backend }, backendDefinitions: [{ key: "mory", name: "mory", description: "test", create: () => backend }], importers: [] }
  );
  const first = gateway.createCandidate({ ...candidate(), sources: [{ channel: "web", sessionId: "s1", conversationMessageId: "m1", observedAt: "2026-07-10T00:00:00Z" }] });
  assert.ok(first);
  await gateway.maybeAutoConfirmCandidate(first.id);
  assert.equal(writes.length, 0);
  enabled = true;
  gateway.createCandidate({ ...candidate(), runKey: "r2", sources: [{ channel: "web", sessionId: "s2", conversationMessageId: "m2", observedAt: "2026-07-11T00:00:00Z" }] });
  const third = gateway.createCandidate({ ...candidate(), runKey: "r3", sources: [{ channel: "web", sessionId: "s3", conversationMessageId: "m3", observedAt: "2026-07-12T00:00:00Z" }] });
  assert.ok(third);
  const confirmed = await gateway.maybeAutoConfirmCandidate(third.id);
  assert.equal(writes.length, 1);
  assert.equal(confirmed?.reason.includes("audit:auto-confirm"), true);
  const sensitive = gateway.createCandidate({ ...candidate("用户明确表示目前长期居住在上海市中心区域"), runKey: "fact", type: "user_fact", subject: "location", path: "mory://user_fact/location", sources: [
    { channel: "web", sessionId: "f1", conversationMessageId: "f1", observedAt: "2026-07-10T00:00:00Z" },
    { channel: "web", sessionId: "f2", conversationMessageId: "f2", observedAt: "2026-07-11T00:00:00Z" },
    { channel: "web", sessionId: "f3", conversationMessageId: "f3", observedAt: "2026-07-12T00:00:00Z" }
  ], occurrenceCount: 3, evidenceDates: ["2026-07-10", "2026-07-11", "2026-07-12"] });
  assert.ok(sensitive);
  await gateway.maybeAutoConfirmCandidate(sensitive.id);
  assert.equal(writes.length, 1);
  const healthPreference = gateway.createCandidate({ ...candidate("用户明确偏好每天记录健康状况和服药后的身体反应"), runKey: "health", subject: "health_lifestyle", sources: [
    { channel: "web", sessionId: "h1", conversationMessageId: "h1", observedAt: "2026-07-10T00:00:00Z" },
    { channel: "web", sessionId: "h2", conversationMessageId: "h2", observedAt: "2026-07-11T00:00:00Z" },
    { channel: "web", sessionId: "h3", conversationMessageId: "h3", observedAt: "2026-07-12T00:00:00Z" }
  ], occurrenceCount: 3, evidenceDates: ["2026-07-10", "2026-07-11", "2026-07-12"] });
  assert.ok(healthPreference);
  await gateway.maybeAutoConfirmCandidate(healthPreference.id);
  assert.equal(writes.length, 1);
}));

test("repeated successful skill evidence becomes review-only draft suggestion", () => withStore(async (store) => {
  let backendWrites = 0;
  const backend: MemoryBackend = {
    capabilities: () => ({ supportsHybridSearch: true, supportsVectorSearch: false, supportsIncrementalFlush: true, supportsLayeredMemory: true, supportsCandidates: true }),
    add: async () => { backendWrites += 1; throw new Error("skill suggestion must not ingest memory"); },
    get: async () => null, search: async () => [], searchAll: async () => [], delete: async () => false,
    update: async () => null, flush: async () => ({ scannedMessages: 0, addedCount: 0, memories: [], updatedCursorConversations: 0 }),
    compact: async () => ({ scannedCount: 0, removedCount: 0, scopesAffected: 0 })
  };
  const gateway = new MemoryGateway(
    () => ({ plugins: { memory: { enabled: true, backend: "mory", autoConfirm: { enabled: false } } } }) as any,
    {} as any, undefined,
    { candidateStore: store, backends: { mory: backend }, backendDefinitions: [{ key: "mory", name: "mory", description: "test", create: () => backend }], importers: [] }
  );
  const skill = (runKey: string, sessionId: string, messageId: string, observedAt: string) => gateway.createCandidate({
    runKey, namespace: "owner:owner", domain: "owner", type: "skill", subject: "weekly_release_check",
    path: "mory://skill/weekly_release_check", value: "每周发布前先运行完整测试并核对版本与变更摘要",
    confidence: 0.9, reason: "repeated successful workflow", layer: "long_term",
    sources: [{ channel: "web", sessionId, conversationMessageId: messageId, observedAt }]
  });
  const first = skill("s1", "session-1", "success-1", "2026-07-10T00:00:00Z");
  skill("s2", "session-2", "success-2", "2026-07-11T00:00:00Z");
  const third = skill("s3", "session-3", "statement-only", "2026-07-12T00:00:00Z");
  assert.ok(first && third);
  const suggestions = gateway.prepareSkillDraftSuggestions((id) => id.startsWith("success-"));
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0]?.skillDraftSuggestion?.successfulExecutionCount, 2);
  assert.deepEqual(suggestions[0]?.skillDraftSuggestion?.inputs.length, 1);
  let draftReference = "";
  const confirmed = await gateway.confirmSkillDraftSuggestion(third.id, (candidate) => {
    assert.ok(candidate.skillDraftSuggestion?.boundaries.length);
    draftReference = "skill-drafts/weekly-release-check.md";
    return draftReference;
  });
  assert.equal(confirmed?.confirmedMemoryId, `draft:${draftReference}`);
  assert.equal(backendWrites, 0);

  const ignored = skill("ignored-1", "i1", "ok-i1", "2026-07-13T00:00:00Z");
  assert.ok(ignored);
  gateway.ignoreCandidate(ignored.id);
  assert.equal(skill("ignored-2", "i2", "ok-i2", "2026-07-14T00:00:00Z"), null);
}));
