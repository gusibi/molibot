import type { AgentMessage } from "@earendil-works/pi-agent-core";

export const TOOL_BUDGET_RUNTIME_NOTICE = [
  "[runtime notice]",
  "Tool call budget is exhausted. Do not call tools.",
  "Produce the best final answer using only the evidence already available in this conversation.",
  "If the answer is partial, state the limitation briefly.",
  "[/runtime notice]"
].join("\n");

export const TOOL_FAILURE_BUDGET_RUNTIME_NOTICE = [
  "[runtime notice]",
  "Too many tool calls in this run have failed, so the tool list has been withdrawn for the rest of the turn.",
  "Do not call tools. Summarize what you did accomplish, state plainly which step failed and why, and give the user the next concrete action.",
  "[/runtime notice]"
].join("\n");

/**
 * Sent once, mid-run, when the same tool fails the same way several times over.
 * The model has no view of its own failure history and will otherwise keep
 * re-issuing a call that cannot work — which is how a run reaches the failure
 * budget without ever learning anything.
 */
export function buildRepeatedToolFailureNotice(input: {
  toolName: string;
  count: number;
  error: string;
}): string {
  return [
    "[runtime notice]",
    `\`${input.toolName}\` has now failed ${input.count} times in a row with the same error:`,
    input.error.replace(/\s+/g, " ").trim().slice(0, 400),
    "Repeating it will not change the result. Change the approach — a different tool, a different path form (the file tools take absolute paths; `~` is expanded, but a path must still sit inside an allowed root), or ask the user — or move on without it.",
    "[/runtime notice]"
  ].join("\n");
}

export const SUBAGENT_DELEGATION_RUNTIME_NOTICE = [
  "[runtime notice]",
  "This run has already used many parent-run tool calls.",
  "If the remaining work is file/shell-heavy — codebase work, multi-file changes, log/data analysis, long document processing, implementation, or review — delegate now with the `subagent` tool instead of continuing direct read/bash/edit loops.",
  "Use `scout` for further investigation, `planner` for planning, `worker` for implementation, and `reviewer` for review. If the task is already ready to answer, finish directly.",
  "[/runtime notice]"
].join("\n");

export const POST_TOOL_OVERFLOW_CONTINUATION_NOTICE = [
  "[runtime notice]",
  "The previous model response overflowed after tools had already completed.",
  "Continue from the preserved tool results. Do not repeat completed tool calls unless their results explicitly require a retry.",
  "[/runtime notice]"
].join("\n");

const LEGACY_SUBAGENT_DELEGATION_RUNTIME_NOTICE = [
  "[runtime notice]",
  "This run has already used many parent-run tool calls.",
  "If the remaining work is codebase-heavy, multi-file, implementation, or review work, delegate now with the `subagent` tool instead of continuing direct read/bash/edit loops.",
  "Use `scout` for further investigation, `planner` for planning, `worker` for implementation, and `reviewer` for review. If the task is already ready to answer, finish directly.",
  "[/runtime notice]"
].join("\n");

const TRANSIENT_RUNTIME_NOTICES = new Set([
  TOOL_BUDGET_RUNTIME_NOTICE,
  TOOL_FAILURE_BUDGET_RUNTIME_NOTICE,
  SUBAGENT_DELEGATION_RUNTIME_NOTICE,
  POST_TOOL_OVERFLOW_CONTINUATION_NOTICE,
  LEGACY_SUBAGENT_DELEGATION_RUNTIME_NOTICE
]);

// Notices whose body is built per run cannot be matched by value.
const TRANSIENT_RUNTIME_NOTICE_PATTERNS = [
  /^\[runtime notice\]\n`[^`]+` has now failed \d+ times in a row/
];

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
    const transient =
      TRANSIENT_RUNTIME_NOTICES.has(text) ||
      TRANSIENT_RUNTIME_NOTICE_PATTERNS.some((pattern) => pattern.test(text));
    if (!transient) return true;
    changed = true;
    return false;
  });

  return changed ? filtered : messages;
}
