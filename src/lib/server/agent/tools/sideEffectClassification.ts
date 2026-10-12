import { createHash } from "node:crypto";
import type { SideEffectClass } from "$lib/server/agent/durable/types.js";
import type { ToolSideEffect } from "$lib/server/agent/tools/toolTypes.js";

// Composite tools delegate effects to their nested tool tasks; they must not hold the shared effect lock.
const PURE_TOOLS = new Set([
  "codemode",
  "mcpInvoke",
  "subagent",
  "read",
  "fileSearch",
  "conversationSearch",
  "profileFiles",
  "skillSearch",
  "webSearch",
  "webFetch",
  "docExtract",
  "switchModel"
]);

const IDEMPOTENT_TOOLS = new Set(["write", "edit", "documentExport"]);

/**
 * Tool ids whose interrupted execution is safe to replay after a crash: pure
 * reads. Includes the file/conversation search tools, whose runtime tool names
 * (`grep`, `find`, `ls`, `conversation_search`) differ from the classifier ids.
 * Idempotent writes are deliberately excluded — replaying a write would also
 * re-fire its intent/receipt hooks and could double-count usage. Composite
 * orchestrators (`codemode`, `subagent`, `mcpInvoke`) are excluded too: their nested calls
 * carry their own replay policy, and a suspended Codemode script is explicitly
 * not replayable.
 */
const REPLAY_SAFE_TOOLS = new Set(
  [...PURE_TOOLS, "grep", "find", "ls", "conversation_search"].filter((id) => id !== "codemode" && id !== "subagent" && id !== "mcpInvoke")
);

/**
 * Whether Pi may re-run this tool after an interrupted execution. A declared
 * pure class wins; otherwise only a known pure read is replay-safe. Anything
 * that writes, calls an external service, or is undeclared stays blocking.
 */
export function isReplaySafeTool(toolId: string, declared?: SideEffectClass): boolean {
  if (declared === "pure") return true;
  if (declared) return false;
  return REPLAY_SAFE_TOOLS.has(toolId);
}

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
