import assert from "node:assert/strict";
import test from "node:test";
import { buildReferencedItems, memoryToolHitsFromToolCall } from "$lib/server/memory/referenced.js";
import type { MemoryInjectionItem } from "$lib/server/memory/types.js";

const snapshot = {
  displayText: "User tracks weight weekly",
  content: "User tracks weight weekly",
  layer: "long_term",
  tags: ["health"],
  updatedAt: "2026-07-15T00:00:00.000Z"
} as const;

function injected(memoryId: string, shortId: string): MemoryInjectionItem {
  return {
    memoryId,
    order: 0,
    shortId,
    promptText: `1. [${shortId}] ${snapshot.content}`,
    source: "retrieved",
    snapshot: { ...snapshot, tags: [...snapshot.tags] }
  };
}

test("memoryToolHitsFromToolCall extracts search hits with the query", () => {
  const hits = memoryToolHitsFromToolCall(
    { action: "search", query: "减肥 周期" },
    { details: { rows: [{ id: "mem-1", content: "week 20 target 66.80~67.00kg", layer: "long_term", tags: [], updatedAt: "2026-07-15T00:00:00.000Z" }] } }
  );
  assert.equal(hits.length, 1);
  assert.equal(hits[0].memoryId, "mem-1");
  assert.equal(hits[0].source, "tool_retrieved");
  assert.equal(hits[0].query, "减肥 周期");
});

test("memoryToolHitsFromToolCall ignores list and write actions", () => {
  const rows = [{ id: "mem-1", content: "x", layer: "daily", tags: [], updatedAt: "2026-07-15T00:00:00.000Z" }];
  assert.deepEqual(memoryToolHitsFromToolCall({ action: "list" }, { details: { rows } }), []);
  assert.deepEqual(memoryToolHitsFromToolCall({ action: "add", content: "x" }, { details: { rows } }), []);
});

test("buildReferencedItems resolves citations and dedupes against tool hits", () => {
  const items = buildReferencedItems({
    injectedItems: [injected("mem-a", "M1"), injected("mem-b", "M2")],
    citedShortIds: ["m2"],
    toolHits: [
      { memoryId: "mem-b", source: "tool_retrieved", snapshot: { ...snapshot, tags: [] } },
      { memoryId: "mem-c", source: "tool_retrieved", snapshot: { ...snapshot, tags: [] } }
    ]
  });
  assert.deepEqual(items.map((item) => [item.memoryId, item.source]), [
    ["mem-b", "cited"],
    ["mem-c", "tool_retrieved"]
  ]);
});

test("buildReferencedItems returns empty when nothing was cited or fetched", () => {
  assert.deepEqual(buildReferencedItems({ injectedItems: [injected("mem-a", "M1")], citedShortIds: [], toolHits: [] }), []);
});
