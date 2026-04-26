import type { AgentMessage } from "@mariozechner/pi-agent-core";

export const TOOL_BUDGET_RUNTIME_NOTICE = [
  "[runtime notice]",
  "Tool call budget is exhausted. Do not call tools.",
  "Produce the best final answer using only the evidence already available in this conversation.",
  "If the answer is partial, state the limitation briefly.",
  "[/runtime notice]"
].join("\n");

function extractTextParts(message: AgentMessage): string[] {
  if (!message || typeof message !== "object") return [];
  const row = message as { content?: unknown };
  if (!Array.isArray(row.content)) return [];
  return row.content
    .filter(
      (part): part is { type?: unknown; text?: unknown } =>
        Boolean(part && typeof part === "object" && !Array.isArray(part))
    )
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string);
}

export function stripTransientRuntimeNoticesFromMessages(messages: AgentMessage[]): AgentMessage[] {
  let changed = false;
  const filtered = messages.filter((message) => {
    if (!message || typeof message !== "object") return true;
    const row = message as { role?: unknown };
    if (row.role !== "user") return true;
    const text = extractTextParts(message).join("\n").trim();
    if (text !== TOOL_BUDGET_RUNTIME_NOTICE) return true;
    changed = true;
    return false;
  });

  return changed ? filtered : messages;
}
