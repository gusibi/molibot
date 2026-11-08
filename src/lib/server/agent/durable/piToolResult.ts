import type { JsonValue } from "@earendil-works/chord";
import type { JsonValue as ModelJsonValue } from "@earendil-works/pi-ai";
import type { HostToolResult } from "$lib/server/agent/tools/preparedTool.js";

/** Private execution metadata travels with the canonical receipt, separately from model content. */
export function encodePiToolDetails(result: HostToolResult): JsonValue | undefined {
  return JSON.parse(JSON.stringify({ molibotExecution: { version: 1, details: result.details,
    metadata: result.metadata, error: result.error, terminate: result.terminate } }));
}

/**
 * Native command turns make no model call of their own; the host records the
 * run's inner model usage on the tool result (details.molibotUsage), so the
 * synthetic reply surfaces that aggregate instead of zeros.
 */
export function syntheticCommandUsage(details: unknown): import("@earendil-works/pi-ai").Usage {
  const num = (value: unknown): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  };
  const usage = (decodePiToolDetails(details as ModelJsonValue | undefined).details as
    { molibotUsage?: { input?: unknown; output?: unknown; cacheRead?: unknown; cacheWrite?: unknown; totalTokens?: unknown; cost?: { total?: unknown } } } | undefined)?.molibotUsage;
  return {
    input: num(usage?.input), output: num(usage?.output), cacheRead: num(usage?.cacheRead), cacheWrite: num(usage?.cacheWrite), totalTokens: num(usage?.totalTokens),
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: num(usage?.cost?.total) }
  };
}

export function decodePiToolDetails(details: ModelJsonValue | undefined): Pick<HostToolResult, "details" | "metadata" | "error" | "terminate"> {
  const envelope = details && typeof details === "object" && !Array.isArray(details) && "molibotExecution" in details ? details.molibotExecution : undefined;
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope) || !("version" in envelope) || envelope.version !== 1) return { details };
  return { details: envelope.details,
    metadata: envelope.metadata && typeof envelope.metadata === "object" && !Array.isArray(envelope.metadata) ? Object.fromEntries(Object.entries(envelope.metadata)) : undefined,
    error: typeof envelope.error === "string" ? envelope.error : undefined,
    terminate: typeof envelope.terminate === "boolean" ? envelope.terminate : undefined };
}

function isContentBlock(value: unknown): value is HostToolResult["content"][number] {
  if (!value || typeof value !== "object") return false;
  if (!("type" in value)) return false;
  return value.type === "text" ? "text" in value && typeof value.text === "string"
    : value.type === "image" && "data" in value && typeof value.data === "string" && "mimeType" in value && typeof value.mimeType === "string";
}

function isContentArray(value: unknown): value is HostToolResult["content"] {
  return Array.isArray(value) && value.every(isContentBlock);
}

/** Native nested results contain the program value and diagnostics instead of a transcript entry. */
export function decodePiNestedResult(result: import("@earendil-works/pi-durable").NestedToolExecutionResult): HostToolResult {
  const value = result.structuredOutput;
  const content: HostToolResult["content"] = typeof value === "string" ? [{ type: "text", text: value }]
    : isContentArray(value) ? value
    : isContentBlock(value) ? [value]
    : value !== undefined ? [{ type: "text", text: JSON.stringify(value) }]
    : result.diagnostics.map(diagnostic => ({ type: "text", text: diagnostic.message }));
  return { content, ...decodePiToolDetails(result.details), usage: result.usage, isError: result.isError };
}
