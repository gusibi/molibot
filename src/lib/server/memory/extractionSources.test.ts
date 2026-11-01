import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memoryExtractionSources } from "./extractionSources.js";
import { encodeExternalSessionId } from "$lib/server/app/externalSessionsFromContexts.js";
import { MemoryExtractionService } from "./memoryExtraction.js";
import { MemoryExtractionStateStore } from "./memoryExtractionStore.js";
import type { ManagedSessionItem, ManagedSessionFilters } from "$lib/server/sessions/sessionQueryService.js";

function managed(id: string, state: "active" | "archived" = "active"): ManagedSessionItem {
  return {
    conversationId: id, source: "local", channel: "web", botId: "momo", agentId: "private",
    ownerExternalUserId: "web:momo:owner", state, updatedAt: "2026-10-31T00:00:01.000Z", lastActivityAt: "2026-10-31T00:00:01.000Z"
  } as ManagedSessionItem;
}

function query(items: ManagedSessionItem[]) {
  return (filters: ManagedSessionFilters) => {
    const selected = items.filter((item) => item.state === filters.state);
    return { items: selected.slice(filters.offset ?? 0, (filters.offset ?? 0) + (filters.limit ?? 100)), total: selected.length } as never;
  };
}

test("daily source pagination crosses active/archive boundaries without gaps, excluding trash", () => {
  const items = Array.from({ length: 121 }, (_, i) => managed(`a${i}`));
  items.push(...Array.from({ length: 103 }, (_, i) => managed(`b${i}`, "archived")));
  items.push({ ...managed("trash"), state: "trashed" });
  const sources = memoryExtractionSources(query(items), { listMessages: () => [] }, "unused", () => false);
  const daily = [0, 100, 200].flatMap((offset) => sources.listSessions({ offset, limit: 100, mode: "daily" }).items);
  assert.deepEqual(daily.map((s) => s.conversationId), items.slice(0, -1).map((s) => s.conversationId));
  assert.ok(daily.every((s) => s.shareOwner === false));
  assert.equal(sources.listSessions({ offset: 0, limit: 100 }).total, 121);
});

test("daily extraction traverses more than 500 sessions with one shared durable checkpoint each", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "molibot-all-extraction-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sources = memoryExtractionSources(query(Array.from({ length: 505 }, (_, i) => managed(`s${i}`))), {
    listMessages: (id) => [
      { id: `${id}-u`, conversationId: id, role: "user", content: "简短回答", createdAt: "2026-10-31T00:00:00.000Z" },
      { id: `${id}-a`, conversationId: id, role: "assistant", content: "好的", createdAt: "2026-10-31T00:00:01.000Z" }
    ]
  }, root);
  const makeService = () => new MemoryExtractionService({ ...sources,
    store: new MemoryExtractionStateStore(join(root, "state.json")),
    extractor: async () => ({ noUsefulInformation: true }),
    writer: { write: async () => { throw new Error("nothing to write"); } }
  });
  assert.equal((await makeService().runSweep({ mode: "daily" })).attempted, 505);
  assert.equal((await makeService().runSweep({ mode: "daily" })).attempted, 0);
});

test("external transcripts use their source chat identity and the same extraction pipeline", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "molibot-external-extraction-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const contexts = join(root, "sessions", "moli-t_momo_111", "contexts");
  mkdirSync(contexts, { recursive: true });
  const metadata = { agentId: "private", source: { channel: "telegram", botId: "momo", chatId: "111" } };
  writeFileSync(join(contexts, "default.meta.json"), JSON.stringify(metadata));
  writeFileSync(join(contexts, "default.jsonl"), [
    { type: "session", version: 1, id: "default", timestamp: "2026-10-31T00:00:00.000Z" },
    { type: "message", id: "u", parentId: null, timestamp: "2026-10-31T00:00:00.000Z", message: { role: "user", content: "我偏好简短回答" } },
    { type: "message", id: "a", parentId: "u", timestamp: "2026-10-31T00:00:01.000Z", message: { role: "assistant", content: "好的" } }
  ].map((row) => JSON.stringify(row)).join("\n") + "\n");
  const id = encodeExternalSessionId({ channel: "telegram", botId: "momo", chatId: "111", sessionId: "default" });
  const item = { ...managed(id), source: "external" as const, channel: "telegram", ownerExternalUserId: null };
  const sources = memoryExtractionSources(query([item]), { listMessages: () => { throw new Error("external must read its Context transcript"); } }, root, () => false);
  let calls = 0;
  const service = new MemoryExtractionService({ ...sources,
    store: new MemoryExtractionStateStore(join(root, "state.json")),
    extractor: async (input) => {
      calls++;
      assert.equal(input.messages[0].content, "我偏好简短回答");
      return { memories: [{ domain: "owner", type: "user_preference", subject: "length", value: "偏好简短回答" }] };
    },
    writer: { write: async (scope) => {
      assert.equal(scope.externalUserId, "111");
      assert.equal(scope.agentId, "private");
      assert.equal(scope.shareOwner, false);
      return { committed: ["saved"], proposals: [], skipped: 0, failures: [] };
    } },
    now: () => new Date("2026-11-01T00:00:00Z")
  });
  assert.equal((await service.runSweep({ conversationId: id })).committed, 1);
  assert.equal((await service.runSweep({ mode: "daily" })).attempted, 0);
  assert.equal(calls, 1);
});
