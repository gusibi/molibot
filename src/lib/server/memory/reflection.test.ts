import test from "node:test";
import assert from "node:assert/strict";
import { ReflectionStateStore, SessionReflectionSourceReader, runMemoryReflection, pendingMemoryReviewCandidates, MemoryReflectionError, type ReflectionTarget } from "./reflection.js";
import { MemoryExtractionService } from "./memoryExtraction.js";
import { MemoryExtractionStateStore } from "./memoryExtractionStore.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("reflection source excludes every policy that is not memory-eligible", async () => {
  const state = new ReflectionStateStore(":memory:");
  try {
    const base = { conversationId: "session-retention", role: "user" as const, createdAt: "2026-08-09T02:00:00.000Z" };
    const sessions = {
      listConversations: () => [{ id: "session-retention" }],
      listMessages: () => [
        { ...base, id: "standard", content: "可以记忆", retention: "standard" },
        { ...base, id: "no-memory", content: "不要记忆", retention: "no_memory" },
        { ...base, id: "no-search", content: "不可搜索", retention: "not_searchable" },
        { ...base, id: "turn-only", content: "仅本轮", retention: "turn_only" }
      ]
    };
    const target: ReflectionTarget = {
      ownerId: "owner",
      botId: "momo",
      timezone: "Asia/Shanghai",
      sourceScopes: [{ channel: "web", externalUserId: "profile-1", botId: "momo" }]
    };
    const projections = await new SessionReflectionSourceReader(sessions as any, state).read(target, "2026-08-09");
    assert.deepEqual(projections.flatMap((projection) => projection.messages.map((message) => message.id)), ["standard"]);
  } finally {
    state.close();
  }
});


function fixture(t: import("node:test").TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "molibot-shared-reflection-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const statePath = join(dir, "extraction-state.json");
  let calls = 0;
  let fail = false;
  let sensitive = false;
  const messages = [
    { id: "u", conversationId: "s", role: "user" as const, content: "我喜欢简短回答", createdAt: "2026-10-31T12:00:00Z" },
    { id: "a", conversationId: "s", role: "assistant" as const, content: "好的", createdAt: "2026-10-31T12:00:01Z" }
  ];
  const makeService = () => new MemoryExtractionService({
    listSessions: () => ({ total: 1, items: [{ conversationId: "s", source: "local", channel: "web", botId: "momo", agentId: "a", ownerExternalUserId: "profile", updatedAt: "2026-10-31T12:00:01Z", lastActivityAt: "2026-10-31T12:00:01Z" }] }),
    listMessages: () => messages,
    store: new MemoryExtractionStateStore(statePath),
    extractor: async () => { calls++; if (fail) throw new Error("model unavailable"); return { memories: [{ domain: "owner", type: "user_preference", subject: "answer_length", value: "偏好简短回答" }] }; },
    writer: { write: async () => ({ committed: sensitive ? [] : ["memory"], proposals: sensitive ? ["pending"] : [], skipped: 0, failures: [] }) },
    now: () => new Date("2026-11-01T00:00:00Z")
  });
  return { makeService, calls: () => calls, fail: () => { fail = true; }, sensitive: () => { sensitive = true; } };
}

test("idle then daily reflection reopens the same durable checkpoint without another model call", async (t) => {
  const h = fixture(t);
  await h.makeService().runSweep({ conversationId: "s" });
  const result = await runMemoryReflection(h.makeService(), { timezone: "Asia/Shanghai", now: new Date("2026-11-01T00:00:00Z") });
  assert.equal(result.localDate, "2026-11-01");
  assert.equal(result.scannedMessages, 0);
  assert.equal(result.createdCandidates, 0);
  assert.equal(h.calls(), 1);
});

test("daily then idle uses the same checkpoint and returns pending proposals for review", async (t) => {
  const h = fixture(t);
  h.sensitive();
  const service = h.makeService();
  const result = await runMemoryReflection(service, { timezone: "Asia/Shanghai" });
  assert.equal(result.scannedMessages, 2);
  assert.equal(result.createdCandidates, 1);
  assert.deepEqual(result.pendingReviewCandidateIds, ["pending"]);
  assert.equal((await service.runSweep({ conversationId: "s" })).attempted, 0);
  assert.equal(h.calls(), 1);
});

test("daily extraction failure and retry backoff cannot report completion", async (t) => {
  const h = fixture(t);
  h.fail();
  const service = h.makeService();
  await assert.rejects(runMemoryReflection(service, { timezone: "Asia/Shanghai" }), MemoryReflectionError);
  await assert.rejects(runMemoryReflection(service, { timezone: "Asia/Shanghai" }), /backing off/);
  assert.equal(h.calls(), 1);
});


test("daily review paginates all pending proposals and restricts them to selected Sessions", () => {
  const candidates = Array.from({ length: 1005 }, (_, i) => ({ id: `c${i}`, sources: [{ sessionId: i === 1 ? "foreign" : "selected" }] }));
  const offsets: number[] = [];
  const memory = { listCandidates: (_status: unknown, limit = 1000, offset = 0) => {
    offsets.push(offset);
    return candidates.slice(offset, offset + limit) as never;
  } };
  const ids = pendingMemoryReviewCandidates(memory, new Set(["selected"]));
  assert.equal(ids.length, 1004);
  assert.equal(ids.includes("c1"), false);
  assert.equal(ids.includes("c1004"), true);
  assert.deepEqual(offsets, [0, 1000]);
});
