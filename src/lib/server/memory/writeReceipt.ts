import type { MemoryRecord } from "$lib/server/memory/types.js";
import type { MemoryWriteReceipt, MemoryWriteOperation } from "$lib/server/memory/traceStore.js";

function asRecord(value: unknown): MemoryRecord | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<MemoryRecord>;
  if (typeof row.id !== "string" || typeof row.content !== "string") return null;
  return row as MemoryRecord;
}

function toReceipt(record: MemoryRecord, operation: MemoryWriteOperation): MemoryWriteReceipt {
  return {
    memoryId: record.id,
    operation,
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

export function memoryWriteReceiptsFromToolCall(args: unknown, result: unknown): MemoryWriteReceipt[] {
  if (!args || typeof args !== "object" || !result || typeof result !== "object") return [];
  const action = String((args as { action?: unknown }).action ?? "");
  const details = (result as { details?: unknown }).details;
  if (!details || typeof details !== "object") return [];

  if (["add", "add_content", "set_agent_self", "update"].includes(action)) {
    const item = asRecord((details as { item?: unknown }).item);
    if (!item) return [];
    return [toReceipt(item, action === "update" ? "updated" : "added")];
  }

  if (action === "flush") {
    const flushResult = (details as { result?: unknown }).result;
    if (!flushResult || typeof flushResult !== "object") return [];
    const memories = (flushResult as { memories?: unknown }).memories;
    return Array.isArray(memories)
      ? memories.map(asRecord).filter((item): item is MemoryRecord => Boolean(item)).map((item) => toReceipt(item, "added"))
      : [];
  }
  return [];
}
