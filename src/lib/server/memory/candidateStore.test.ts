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

test("gateway confirmation is the only transition that writes the backend", () => withStore(async (store) => {
  const writes: MemoryRecord[] = [];
  const backend: MemoryBackend = {
    capabilities: () => ({ supportsHybridSearch: true, supportsVectorSearch: false, supportsIncrementalFlush: true, supportsLayeredMemory: true, supportsCandidates: true }),
    add: async (_scope, input) => {
      const row = { id: "memory-1", channel: "web", externalUserId: "session-1", content: input.content, tags: [], layer: input.layer ?? "long_term", createdAt: "2026-07-11T00:00:00.000Z", updatedAt: "2026-07-11T00:00:00.000Z" } satisfies MemoryRecord;
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
