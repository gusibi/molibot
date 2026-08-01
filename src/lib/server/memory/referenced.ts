import type { MemoryRecord } from "$lib/server/memory/types.js";
import type { MemoryInjectionItem } from "$lib/server/memory/types.js";
import type { MemoryReferencedItem } from "$lib/server/memory/traceStore.js";

function asRecord(value: unknown): MemoryRecord | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<MemoryRecord>;
  if (typeof row.id !== "string" || typeof row.content !== "string") return null;
  return row as MemoryRecord;
}

function toReferenced(record: MemoryRecord, query: string): MemoryReferencedItem {
  return {
    memoryId: record.id,
    source: "tool_retrieved",
    query: query || undefined,
    snapshot: {
      displayText: record.content,
      content: record.content,
      layer: record.layer,
      type: record.type,
      confidence: record.confidence,
      tags: [...(record.tags ?? [])],
      updatedAt: record.updatedAt
    }
  };
}

/**
 * Mirror of `memoryWriteReceiptsFromToolCall`: extracts the memories an agent
 * actively fetched via the memory tool's `search` action mid-run. `list` is
 * browsing, not referencing, and is deliberately excluded.
 */
export function memoryToolHitsFromToolCall(args: unknown, result: unknown): MemoryReferencedItem[] {
  if (!args || typeof args !== "object" || !result || typeof result !== "object") return [];
  const action = String((args as { action?: unknown }).action ?? "");
  if (action !== "search") return [];
  const query = String((args as { query?: unknown }).query ?? "").trim();
  const details = (result as { details?: unknown }).details;
  if (!details || typeof details !== "object") return [];
  const rows = (details as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) return [];
  return rows
    .map(asRecord)
    .filter((item): item is MemoryRecord => Boolean(item))
    .map((item) => toReferenced(item, query));
}

/**
 * Combine citation short-ids (resolved against the injected items) with
 * tool-retrieved hits into the final referenced list, de-duplicated by
 * memoryId with `cited` winning over `tool_retrieved`.
 */
export function buildReferencedItems(input: {
  injectedItems: MemoryInjectionItem[];
  citedShortIds: string[];
  toolHits: MemoryReferencedItem[];
}): MemoryReferencedItem[] {
  const byId = new Map<string, MemoryReferencedItem>();
  const shortIdSet = new Set(input.citedShortIds.map((id) => id.toUpperCase()));
  for (const item of input.injectedItems) {
    if (!item.shortId || !shortIdSet.has(item.shortId.toUpperCase())) continue;
    byId.set(item.memoryId, {
      memoryId: item.memoryId,
      source: "cited",
      snapshot: { ...item.snapshot, tags: [...item.snapshot.tags] }
    });
  }
  for (const hit of input.toolHits) {
    if (byId.has(hit.memoryId)) continue;
    byId.set(hit.memoryId, hit);
  }
  return [...byId.values()];
}
