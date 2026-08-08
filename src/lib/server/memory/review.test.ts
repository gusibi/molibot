import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { MemoryCandidateStore } from "./candidateStore.js";
import { MemoryGateway } from "./gateway.js";
import { MemoryCandidateReview, MemoryReviewStore } from "./review.js";
import type { MemoryBackend, MemoryCandidateCreateInput, MemoryRecord } from "./types.js";

function input(subject: string, value: string, messageId: string): MemoryCandidateCreateInput {
  return {
    runKey: "target:2026-08-07",
    namespace: "owner:owner",
    domain: "owner",
    type: "user_preference",
    subject,
    path: `mory://user_preference/${subject}`,
    value,
    confidence: 0.9,
    reason: "daily reflection",
    sources: [{ channel: "telegram", sessionId: "chat-1", conversationMessageId: messageId }],
    layer: "long_term"
  };
}

function harness() {
  const dir = mkdtempSync(join(tmpdir(), "molibot-memory-review-"));
  const dbPath = join(dir, "mory.sqlite");
  const candidates = new MemoryCandidateStore(dbPath);
  const writes: MemoryRecord[] = [];
  const backend: MemoryBackend = {
    capabilities: () => ({ supportsHybridSearch: true, supportsVectorSearch: false, supportsIncrementalFlush: true, supportsLayeredMemory: true, supportsCandidates: true }),
    add: async (_scope, addInput) => {
      const row = { id: `memory-${writes.length + 1}`, channel: "telegram", externalUserId: "chat-1", content: addInput.content, tags: [], layer: addInput.layer ?? "long_term", state: "active", version: 1, accessCount: 0, injectionCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } satisfies MemoryRecord;
      writes.push(row);
      return row;
    },
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
  const store = new MemoryReviewStore(dbPath);
  const review = new MemoryCandidateReview(gateway, store);
  return {
    candidates, gateway, store, review, writes, dbPath,
    cleanup: () => { store.close(); candidates.close(); rmSync(dir, { recursive: true, force: true }); }
  };
}

test("daily review batch deduplicates candidates and preserves ordinals across restart", () => {
  const h = harness();
  try {
    const first = h.gateway.createCandidate(input("answer_length", "主人希望回答简短直接", "m1"));
    const second = h.gateway.createCandidate(input("format", "主人偏好先给结论", "m2"));
    assert.ok(first && second);
    const target = { channel: "telegram" as const, botId: "momo", chatId: "chat-1" };
    const batch = h.review.createDailyBatch({ ownerId: "owner", localDate: "2026-08-07", target, candidateIds: [first.id, first.id, second.id] });
    assert.deepEqual(batch.items.map((item) => [item.candidateId, item.ordinal]), [[first.id, 1], [second.id, 2]]);
    h.store.close();
    const restartedStore = new MemoryReviewStore(h.dbPath);
    const restarted = new MemoryCandidateReview(h.gateway, restartedStore);
    const same = restarted.createDailyBatch({ ownerId: "owner", localDate: "2026-08-07", target, candidateIds: [second.id, first.id] });
    assert.deepEqual(same.items.map((item) => [item.candidateId, item.ordinal]), [[first.id, 1], [second.id, 2]]);
    restartedStore.close();
  } finally { h.cleanup(); }
});

test("review decision requires the recorded delivery identity and remains idempotent", async () => {
  const h = harness();
  try {
    const candidate = h.gateway.createCandidate(input("answer_length", "主人希望回答简短直接", "m1"));
    assert.ok(candidate);
    const target = { channel: "telegram" as const, botId: "momo", chatId: "chat-1" };
    const batch = h.review.createDailyBatch({ ownerId: "owner", localDate: "2026-08-07", target, candidateIds: [candidate.id] });
    h.review.recordDelivery({ batchId: batch.id, candidateId: candidate.id, messageId: "42" });
    assert.equal(h.review.getDeliveredItem({ channel: "telegram", botId: "momo", chatId: "chat-1", messageId: "42", candidateId: candidate.id })?.ordinal, 1);
    assert.equal(h.review.getDeliveredItem({ channel: "telegram", botId: "momo", chatId: "forged", messageId: "42", candidateId: candidate.id }), null);
    assert.equal((await h.review.decide({ channel: "telegram", botId: "momo", chatId: "forged", messageId: "42", candidateId: candidate.id, action: "keep" })).status, "forbidden");
    assert.equal((await h.review.decide({ channel: "telegram", botId: "momo", chatId: "chat-1", messageId: "42", candidateId: candidate.id, action: "keep" })).status, "kept");
    assert.equal(h.writes.length, 1);
    assert.equal((await h.review.decide({ channel: "telegram", botId: "momo", chatId: "chat-1", messageId: "42", candidateId: candidate.id, action: "keep" })).status, "already_kept");
    assert.equal((await h.review.decide({ channel: "telegram", botId: "momo", chatId: "chat-1", messageId: "42", candidateId: candidate.id, action: "ignore" })).status, "already_kept");
    assert.equal(h.writes.length, 1);
  } finally { h.cleanup(); }
});

test("skill draft suggestions are excluded from quick review", () => {
  const h = harness();
  try {
    const skill = h.gateway.createCandidate({ ...input("release", "发布前运行完整验证", "s1"), type: "skill", path: "mory://skill/release" });
    assert.ok(skill);
    h.candidates.setSkillDraftSuggestion(skill.id, { description: skill.value, inputs: [], outputs: [], boundaries: [], successfulExecutionCount: 2 });
    const batch = h.review.createDailyBatch({
      ownerId: "owner",
      localDate: "2026-08-07",
      target: { channel: "feishu", botId: "momo", chatId: "oc_chat" },
      candidateIds: [skill.id]
    });
    assert.equal(batch.items.length, 0);
    assert.equal(batch.skillDraftCount, 1);
  } finally { h.cleanup(); }
});
