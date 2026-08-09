import { createHash } from "node:crypto";
import type { SideEffectClass } from "$lib/server/agent/durable/types.js";
import type { ToolSideEffect } from "$lib/server/agent/tools/toolTypes.js";

const PURE_TOOLS = new Set([
  "read",
  "fileSearch",
  "conversationSearch",
  "profileFiles",
  "skillSearch",
  "webSearch",
  "webFetch",
  "docExtract",
  "imageAnalyze",
  "switchModel"
]);

const IDEMPOTENT_TOOLS = new Set(["write", "edit", "documentExport"]);

function inputRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" ? input as Record<string, unknown> : {};
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function targetSummary(toolId: string, input: unknown): string {
  const params = inputRecord(input);
  for (const key of ["file_path", "path", "target", "url", "command", "name", "id"]) {
    if (typeof params[key] === "string" && params[key].trim()) {
      return `${toolId}:${params[key].trim().slice(0, 400)}`;
    }
  }
  return toolId;
}

function classify(toolId: string, input: unknown): SideEffectClass {
  if (toolId === "memory") {
    const action = inputRecord(input).action;
    return ["search", "list", "get", "read", "inspect"].includes(String(action)) ? "pure" : "non_idempotent";
  }
  if (PURE_TOOLS.has(toolId)) return "pure";
  if (IDEMPOTENT_TOOLS.has(toolId)) return "idempotent";
  if (toolId === "runtimeTask") {
    const action = String(inputRecord(input).action ?? "");
    if (action === "list" || action === "get") return "pure";
    if (action === "update" || action === "delete") return "idempotent";
    return "non_idempotent";
  }
  return "non_idempotent";
}

/**
 * Classify only when the tool boundary is reached. Ordinary turns do not run
 * a durable planner or a model classifier; a durable attempt can instead use
 * this stable description to write its intent/receipt around the handler.
 */
export function classifyToolSideEffect(toolId: string, input: unknown, toolCallId?: string, declaredClass?: SideEffectClass): ToolSideEffect {
  const normalized = stableSerialize(input);
  const idempotencyKey = createHash("sha256")
    .update(`${toolId}\n${normalized}`)
    .digest("hex");
  return {
    toolId,
    toolCallId,
    sideEffectClass: declaredClass ?? classify(toolId, input),
    idempotencyKey,
    targetSummary: targetSummary(toolId, input),
    contentSummary: normalized.slice(0, 1000)
  };
}
