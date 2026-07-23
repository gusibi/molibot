import type { AssistantMessage, Model } from "@earendil-works/pi-ai";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { completeWithPiRuntime } from "$lib/server/providers/piRuntime.js";
import type { CompactionSettings } from "$lib/server/settings/index.js";

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

// CJK scripts (Han, kana, hangul, CJK punctuation, fullwidth forms) tokenize
// to roughly one token per character; the chars/4 heuristic only holds for
// ASCII-ish text and undercounts CJK-heavy contexts by 3-4x, which made the
// threshold trigger far too late for Chinese conversations.
const CJK_CHAR_PATTERN = /[\u1100-\u11ff\u2e80-\u9fff\ua960-\ua97f\uac00-\ud7ff\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]/g;

function countTextTokens(text: string): number {
  if (!text) return 0;
  const cjkCount = (text.match(CJK_CHAR_PATTERN) ?? []).length;
  const otherCount = text.length - cjkCount;
  return cjkCount + Math.ceil(otherCount / 4);
}

export function estimateMessageTokens(message: AgentMessage): number {
  if (!message || typeof message !== "object") return 0;
  const msg = message as unknown as Record<string, unknown>;
  const role = String(msg.role ?? "");

  if (role === "user" || role === "assistant" || role === "toolResult") {
    return countTextTokens(textFromBlocks(msg.content));
  }

  return countTextTokens(JSON.stringify(message));
}

export function estimateContextTokens(messages: AgentMessage[]): number {
  return messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
}

function extractUsageContextTokens(message: AgentMessage): number | null {
  const msg = message as unknown as {
    role?: unknown;
    usage?: { input?: unknown; output?: unknown; cacheRead?: unknown; cacheWrite?: unknown; totalTokens?: unknown };
  };
  if (msg.role !== "assistant" || !msg.usage || typeof msg.usage !== "object") return null;
  const asCount = (value: unknown): number =>
    typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
  // Prompt tokens at that call = input + cacheRead + cacheWrite (providers
  // report cached segments separately); the response itself stays in context.
  const total = asCount(msg.usage.input) + asCount(msg.usage.cacheRead) + asCount(msg.usage.cacheWrite) + asCount(msg.usage.output);
  if (total > 0) return total;
  const totalTokens = asCount(msg.usage.totalTokens);
  return totalTokens > 0 ? totalTokens : null;
}

function isCompactionSummaryMessage(message: AgentMessage): boolean {
  const msg = message as unknown as { role?: unknown; content?: unknown };
  return msg.role === "user" && textFromBlocks(msg.content).startsWith(SUMMARY_PREFIX);
}

function newestCompactionBarrierTimestamp(messages: AgentMessage[]): number {
  let barrier = 0;
  for (const message of messages) {
    if (!isCompactionSummaryMessage(message)) continue;
    const ts = (message as unknown as { timestamp?: unknown }).timestamp;
    barrier = Math.max(
      barrier,
      typeof ts === "number" && Number.isFinite(ts) ? ts : Number.MAX_SAFE_INTEGER
    );
  }
  return barrier;
}

/**
 * Resolve the current context size, preferring the exact token usage reported
 * by the provider on the most recent assistant response over the char-based
 * estimate. Usage on assistant messages created BEFORE the latest compaction
 * measured the pre-compaction context, so anything at or older than the newest
 * summary-message timestamp is ignored (otherwise compaction would re-trigger
 * in a loop right after compacting).
 */
export function resolveContextTokens(messages: AgentMessage[]): { tokens: number; source: "usage" | "estimate" } {
  const barrier = newestCompactionBarrierTimestamp(messages);
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i] as AgentMessage & { role?: unknown; timestamp?: unknown };
    if (message?.role !== "assistant") continue;
    const usageTokens = extractUsageContextTokens(message);
    if (usageTokens === null) continue;
    if (barrier > 0) {
      const ts = typeof message.timestamp === "number" && Number.isFinite(message.timestamp) ? message.timestamp : 0;
      if (ts <= barrier) break;
    }
    return {
      tokens: usageTokens + estimateContextTokens(messages.slice(i + 1)),
      source: "usage"
    };
  }
  return { tokens: estimateContextTokens(messages), source: "estimate" };
}

export function shouldCompactContext(
  messages: AgentMessage[],
  contextWindow: number,
  settings: CompactionSettings
): boolean {
  if (!settings.enabled) return false;
  const percentLimit = Math.max(0, Math.floor(contextWindow * settings.thresholdPercent / 100));
  const reserveLimit = Math.max(0, contextWindow - settings.reserveTokens);
  const threshold = Math.min(percentLimit, reserveLimit);
  return resolveContextTokens(messages).tokens >= threshold;
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

function findManualFirstKeptIndex(messages: AgentMessage[], keepRecentTokens: number): number {
  const firstKeptIndex = findFirstKeptIndex(messages, keepRecentTokens);
  if (firstKeptIndex > 0 || messages.length <= 1) return firstKeptIndex;

  const totalTokens = estimateContextTokens(messages);
  if (totalTokens <= 0) return 0;

  return findFirstKeptIndex(messages, Math.max(1, Math.floor(totalTokens / 2)));
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
  const firstKeptIndex = options.reason === "manual"
    ? findManualFirstKeptIndex(options.messages, options.settings.keepRecentTokens)
    : findFirstKeptIndex(options.messages, options.settings.keepRecentTokens);
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
    const response = await completeWithPiRuntime(
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
