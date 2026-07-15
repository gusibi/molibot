import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { ConversationMessage } from "$lib/shared/types/message.js";

type ContextTurn = { userText: string; thinking: string[] };

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((part) => {
    if (!part || typeof part !== "object") return [];
    const item = part as { type?: unknown; text?: unknown };
    return item.type === "text" && typeof item.text === "string" ? [item.text] : [];
  }).join("\n");
}

function thinkingParts(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  return content.flatMap((part) => {
    if (!part || typeof part !== "object") return [];
    const item = part as { type?: unknown; thinking?: unknown };
    const thinking = item.type === "thinking" && typeof item.thinking === "string"
      ? item.thinking.trim()
      : "";
    return thinking ? [thinking] : [];
  });
}

function contextTurns(context: AgentMessage[]): ContextTurn[] {
  const turns: ContextTurn[] = [];
  let current: ContextTurn | null = null;

  for (const message of context) {
    if (message.role === "user") {
      if (current) turns.push(current);
      current = { userText: normalizeText(contentText(message.content)), thinking: [] };
      continue;
    }
    if (message.role === "assistant" && current) {
      current.thinking.push(...thinkingParts(message.content));
    }
  }
  if (current) turns.push(current);
  return turns;
}

/**
 * Enriches the display transcript from the Agent context, which is the source
 * of truth for structured reasoning/tool messages. One visible assistant reply
 * may correspond to several Agent assistant messages separated by tool results,
 * so reasoning is aggregated by the preceding user turn instead of array index.
 */
export function attachContextThinking(
  messages: ConversationMessage[],
  context: AgentMessage[]
): Array<ConversationMessage & { thinking?: string }> {
  const turns = contextTurns(context);
  let turnCursor = 0;
  let pendingUserText = "";

  return messages.map((message) => {
    if (message.role === "user") {
      pendingUserText = normalizeText(message.content);
      return message;
    }
    if (message.role !== "assistant" || !pendingUserText) return message;

    const matchingIndex = turns.findIndex((turn, index) => (
      index >= turnCursor && turn.userText === pendingUserText
    ));
    pendingUserText = "";
    if (matchingIndex < 0) return message;

    turnCursor = matchingIndex + 1;
    const thinking = turns[matchingIndex]?.thinking.join("\n\n").trim();
    return thinking ? { ...message, thinking } : message;
  });
}
