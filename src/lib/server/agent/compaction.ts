import { completeSimple, type AssistantMessage, type Model } from "@mariozechner/pi-ai";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { CompactionSettings } from "../settings/index.js";

const SUMMARY_PREFIX = "[context summary]";
const MAX_SERIALIZED_CHARS = 120000;
const MAX_SUMMARY_TOKENS = 1600;

export interface ContextCompactionResult {
  changed: boolean;
  reason: "threshold" | "manual";
  summary: string;
  beforeTokens: number;
  afterTokens: number;
  summarizedMessages: number;
  keptMessages: number;
  messages: AgentMessage[];
}

function textFromBlocks(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const item = part as Record<string, unknown>;
      if (item.type === "text") return String(item.text ?? "");
      if (item.type === "thinking") return String(item.thinking ?? "");
      if (item.type === "toolCall") {
        const name = String(item.name ?? "");
        const args = JSON.stringify(item.arguments ?? {});
        return `${name}(${args})`;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function estimateMessageTokens(message: AgentMessage): number {
  if (!message || typeof message !== "object") return 0;
  const msg = message as unknown as Record<string, unknown>;
  const role = String(msg.role ?? "");

  if (role === "user") {
    return Math.ceil(textFromBlocks(msg.content).length / 4);
  }
  if (role === "assistant") {
    return Math.ceil(textFromBlocks(msg.content).length / 4);
  }
  if (role === "toolResult") {
    return Math.ceil(textFromBlocks(msg.content).length / 4);
  }

  return Math.ceil(JSON.stringify(message).length / 4);
}

export function estimateContextTokens(messages: AgentMessage[]): number {
  return messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
}

export function shouldCompactContext(
  messages: AgentMessage[],
  contextWindow: number,
  settings: CompactionSettings
): boolean {
  if (!settings.enabled) return false;
  return estimateContextTokens(messages) > Math.max(0, contextWindow - settings.reserveTokens);
}

function findFirstKeptIndex(messages: AgentMessage[], keepRecentTokens: number): number {
  if (messages.length <= 1) return 0;

  let keptTokens = estimateMessageTokens(messages[messages.length - 1] as AgentMessage);
  let firstKeptIndex = messages.length - 1;

  for (let i = messages.length - 2; i >= 0; i -= 1) {
    const nextTokens = keptTokens + estimateMessageTokens(messages[i] as AgentMessage);
    if (nextTokens > keepRecentTokens) break;
    keptTokens = nextTokens;
    firstKeptIndex = i;
  }

  return firstKeptIndex;
}

function serializeMessage(message: AgentMessage, index: number): string {
  const msg = message as unknown as Record<string, unknown>;
  const role = String(msg.role ?? "unknown");
  if (role === "toolResult") {
    return [
      `[#${index + 1}] [tool:${String(msg.toolName ?? "")}]`,
      textFromBlocks(msg.content)
    ].join("\n");
  }
  return [
    `[#${index + 1}] [${role}]`,
    textFromBlocks(msg.content)
  ].join("\n");
}

function buildFallbackSummary(serialized: string): string {
  const trimmed = serialized.trim();
  if (!trimmed) {
    return [
      "## Summary",
      "- Earlier conversation was compacted.",
      "- No detailed summary could be generated."
    ].join("\n");
  }

  const snippet = trimmed.slice(-2000);
  return [
    "## Summary",
    "- Earlier conversation was compacted.",
    "- Automatic summarization fallback was used.",
    "",
    "## Recent summarized excerpt",
    snippet
  ].join("\n");
}

function extractAssistantText(message: AssistantMessage): string {
  return message.content
    .filter((part): part is Extract<AssistantMessage["content"][number], { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

export async function compactContextMessages(options: {
  messages: AgentMessage[];
  model: Model<any>;
  apiKey?: string;
  settings: CompactionSettings;
  reason: "threshold" | "manual";
  customInstructions?: string;
  signal?: AbortSignal;
}): Promise<ContextCompactionResult> {
  const beforeTokens = estimateContextTokens(options.messages);
  const firstKeptIndex = findFirstKeptIndex(options.messages, options.settings.keepRecentTokens);
  const messagesToSummarize = options.messages.slice(0, firstKeptIndex);
  const keptMessages = options.messages.slice(firstKeptIndex);

  if (messagesToSummarize.length === 0 || keptMessages.length === 0) {
    return {
      changed: false,
      reason: options.reason,
      summary: "",
      beforeTokens,
      afterTokens: beforeTokens,
      summarizedMessages: 0,
      keptMessages: options.messages.length,
      messages: options.messages
    };
  }

  let serialized = messagesToSummarize.map(serializeMessage).join("\n\n");
  if (serialized.length > MAX_SERIALIZED_CHARS) {
    serialized = [
      "[truncated summarized history]",
      serialized.slice(-MAX_SERIALIZED_CHARS)
    ].join("\n\n");
  }

  const instructionBlock = options.customInstructions?.trim()
    ? `\nAdditional focus instructions:\n${options.customInstructions.trim()}\n`
    : "";

  const prompt = [
    "Summarize the older part of this conversation for future continuation.",
    "Return concise markdown with these sections when relevant: Goal, Progress, Decisions, Open items, Important context.",
    "Preserve concrete technical facts, file paths, commands, bugs, constraints, and pending work.",
    "Do not invent details.",
    instructionBlock,
    "Conversation to summarize:",
    serialized
  ].join("\n\n");

  let summary = "";
  try {
    const response = await completeSimple(
      options.model,
      {
        messages: [
          {
            role: "user",
            content: prompt,
            timestamp: Date.now()
          }
        ]
      },
      {
        apiKey: options.apiKey,
        maxTokens: MAX_SUMMARY_TOKENS,
        signal: options.signal
      }
    );
    summary = extractAssistantText(response);
  } catch {
    summary = "";
  }

  if (!summary) {
    summary = buildFallbackSummary(serialized);
  }

  const summaryMessage: AgentMessage = {
    role: "user",
    content: `${SUMMARY_PREFIX}\n${summary}`,
    timestamp: Date.now()
  };
  const compactedMessages = [summaryMessage, ...keptMessages];
  return {
    changed: true,
    reason: options.reason,
    summary,
    beforeTokens,
    afterTokens: estimateContextTokens(compactedMessages),
    summarizedMessages: messagesToSummarize.length,
    keptMessages: keptMessages.length,
    messages: compactedMessages
  };
}
