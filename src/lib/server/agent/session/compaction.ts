import type { AssistantMessage, Model } from "@earendil-works/pi-ai";
import type { AgentMessage, StreamFn } from "@earendil-works/pi-agent-core";
import { convertToLlm, generateSummaryWithUsage, serializeConversation } from "@earendil-works/pi-coding-agent";
import { streamWithPiRuntime } from "$lib/server/providers/piRuntime.js";
import { isRetryableModelError } from "$lib/server/agent/core/runnerRetryState.js";
import type { CompactionSettings } from "$lib/server/settings/index.js";
import { formatSize, sliceToBytes, truncateHead } from "$lib/server/agent/tools/truncate.js";
import {
  appendFileOperations,
  createFileOps,
  extractFileOps,
  extractFileOpsFromSummary,
  mergeFileOps
} from "$lib/server/agent/session/compactionFileOps.js";

const SUMMARY_PREFIX = "[context summary]";
const MAX_SERIALIZED_CHARS = 120000;
const MAX_SUMMARY_TOKENS = 1600;

/**
 * pi derives the summary's `maxTokens` as `0.8 * reserveTokens`. Pass a budget
 * that reproduces the summary length this project has always used, rather than
 * the (much larger) compaction reserve, which is a threshold setting and not a
 * statement about how long a summary should be.
 */
const SUMMARY_RESERVE_TOKENS = Math.ceil(MAX_SUMMARY_TOKENS / 0.8);

const SUMMARY_RETRY_DELAYS_MS = [500, 2000];

/** Half the summary budget: the prefix bridges into the suffix, it is not a history. */
const TURN_PREFIX_MAX_TOKENS = Math.ceil(MAX_SUMMARY_TOKENS / 2);
/** pi's summarization system prompt, so the model does not continue the conversation. */
const SUMMARIZATION_SYSTEM_PROMPT =
  "You are a context summarization assistant. Your task is to read a conversation between a user and an AI assistant, then produce a structured summary following the exact format specified.\n\nDo NOT continue the conversation. Do NOT respond to any questions in the conversation. ONLY output the structured summary.";

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

/**
 * Whether the kept slice may start at this message.
 *
 * Mirrors pi's cut-point rule (`findCutPoint` in
 * `pi-coding-agent/src/core/compaction/compaction.ts`): a `toolResult` must stay
 * with the assistant `toolCall` that produced it. Cutting between the two leaves
 * an orphan tool result at the head of the context, which Anthropic rejects
 * outright ("tool_result without tool_use") and OpenAI-compatible endpoints
 * handle inconsistently.
 *
 * pi's `findCutPoint` is not called directly because it walks the budget with
 * pi's chars/4 estimator, which undercounts CJK by 3-4x — the exact regression
 * `countTextTokens` above exists to avoid. Only the role rule is shared.
 */
function isValidCutPoint(message: AgentMessage): boolean {
  const role = String((message as unknown as { role?: unknown }).role ?? "");
  return role !== "toolResult";
}

/**
 * Move a token-budget index forward to the nearest legal cut point.
 *
 * Forward, not backward, so the kept slice never grows past the budget. When no
 * legal cut point exists at or after the index (a trailing run of tool results),
 * fall back to the earliest legal one, which keeps everything and makes this
 * compaction a no-op rather than corrupting the context — the same conservative
 * default pi uses.
 */
function snapToCutPoint(messages: AgentMessage[], index: number): number {
  for (let i = index; i < messages.length; i += 1) {
    if (isValidCutPoint(messages[i] as AgentMessage)) return i;
  }
  for (let i = 0; i < messages.length; i += 1) {
    if (isValidCutPoint(messages[i] as AgentMessage)) return i;
  }
  return 0;
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

  return snapToCutPoint(messages, firstKeptIndex);
}

function findManualFirstKeptIndex(messages: AgentMessage[], keepRecentTokens: number): number {
  const firstKeptIndex = findFirstKeptIndex(messages, keepRecentTokens);
  if (firstKeptIndex > 0 || messages.length <= 1) return firstKeptIndex;

  const totalTokens = estimateContextTokens(messages);
  if (totalTokens <= 0) return 0;

  return findFirstKeptIndex(messages, Math.max(1, Math.floor(totalTokens / 2)));
}

/**
 * A byte budget that stays under `maxTokens` for any script.
 *
 * `countTextTokens` charges 1 token per CJK character (3 bytes in UTF-8) and 1
 * per 4 ASCII characters, so 2 bytes per token is below the real cost either
 * way — deliberately conservative, because the whole point of this cap is that
 * the result must fit on the next request, not merely be smaller.
 */
function tokenBudgetToBytes(maxTokens: number): number {
  return Math.max(1, Math.floor(maxTokens * 2));
}

function capText(text: string, maxBytes: number): string | null {
  if (Buffer.byteLength(text, "utf-8") <= maxBytes) return null;
  const truncation = truncateHead(text, { maxBytes, maxLines: Number.MAX_SAFE_INTEGER });
  const kept = truncation.firstLineExceedsLimit ? sliceToBytes(text, maxBytes) : truncation.content;
  return `${kept}\n[... truncated by compaction: original was ${formatSize(truncation.totalBytes)} ...]`;
}

/**
 * Shrink any single message that is larger than the whole keep-recent budget.
 *
 * Without this, compaction has a hole it can never climb out of: the kept slice
 * always starts from the newest message (`findFirstKeptIndex` seeds with it
 * unconditionally, since dropping the message the model just produced or
 * consumed would corrupt the turn). So when *one* message is itself bigger than
 * the context window — a third-party MCP result, a giant paste — every
 * compaction reports `changed: false` or shrinks to something still oversized,
 * the overflow retry gives up, and the session is permanently unable to run:
 * the offending message is inherited by every later turn.
 *
 * Rewriting the content is what makes it terminal. The compacted message list is
 * persisted by `appendCompaction`, so the blob leaves the live context for good
 * rather than being re-truncated on every turn.
 */
export function capOversizedMessages(
  messages: AgentMessage[],
  maxTokensPerMessage: number
): { messages: AgentMessage[]; cappedCount: number } {
  const maxBytes = tokenBudgetToBytes(maxTokensPerMessage);
  let cappedCount = 0;

  const capped = messages.map((message) => {
    if (estimateMessageTokens(message) <= maxTokensPerMessage) return message;
    const content = (message as unknown as { content?: unknown }).content;

    if (typeof content === "string") {
      const next = capText(content, maxBytes);
      if (next === null) return message;
      cappedCount += 1;
      return { ...message, content: next } as AgentMessage;
    }

    if (!Array.isArray(content)) return message;

    let changedBlock = false;
    const nextContent = content.map((part) => {
      if (!part || typeof part !== "object") return part;
      const item = part as Record<string, unknown>;
      // Only free-form text is capped. A `toolCall` block carries the arguments
      // a later `toolResult` is matched against, and an image block is not text
      // at all — mangling either breaks the transcript rather than shrinking it.
      const field = item.type === "text" ? "text" : item.type === "thinking" ? "thinking" : null;
      if (!field || typeof item[field] !== "string") return part;
      const next = capText(item[field] as string, maxBytes);
      if (next === null) return part;
      changedBlock = true;
      return { ...item, [field]: next };
    });

    if (!changedBlock) return message;
    cappedCount += 1;
    return { ...message, content: nextContent } as AgentMessage;
  });

  return { messages: cappedCount > 0 ? capped : messages, cappedCount };
}

function serializedLength(messages: AgentMessage[]): number {
  return serializeConversation(convertToLlm(messages)).length;
}

/**
 * Bound the summarization request.
 *
 * pi serializes the conversation itself, so the input is capped by dropping the
 * oldest messages until pi's own serialization fits — otherwise a very long
 * history could produce a summarization request larger than the model's context.
 */
function limitMessagesToSummarize(messages: AgentMessage[]): { messages: AgentMessage[]; truncated: boolean } {
  if (messages.length === 0 || serializedLength(messages) <= MAX_SERIALIZED_CHARS) {
    return { messages, truncated: false };
  }

  let low = 0;
  let high = messages.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (serializedLength(messages.slice(middle)) <= MAX_SERIALIZED_CHARS) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }

  return { messages: messages.slice(low), truncated: low > 0 };
}

/** The newest prior summary, so pi can merge into it instead of re-summarizing its text. */
function extractPreviousSummary(messages: AgentMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i] as AgentMessage;
    if (!isCompactionSummaryMessage(message)) continue;
    const text = textFromBlocks((message as unknown as { content?: unknown }).content);
    return text.slice(SUMMARY_PREFIX.length).trim() || undefined;
  }
  return undefined;
}

function oversizedCapSummary(cappedCount: number): string {
  return [
    "## Summary",
    `- ${cappedCount} oversized message(s) in this conversation were truncated to fit the model context window.`,
    "- No earlier history was summarized; only the oversized content was shortened."
  ].join("\n");
}

function buildFallbackSummary(messages: AgentMessage[]): string {
  const trimmed = serializeConversation(convertToLlm(messages)).trim();
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

const delay = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });

/**
 * Summarize with pi, retrying transient provider failures.
 *
 * Compaction is the worst place to give up on a flaky network: failing here
 * leaves the context oversized, so the next turn overflows. Returns an empty
 * string once the retries are exhausted, and the caller falls back to a
 * mechanical summary.
 */
async function generateSummaryWithRetry(options: {
  messages: AgentMessage[];
  model: Model<any>;
  apiKey?: string;
  customInstructions?: string;
  previousSummary?: string;
  signal?: AbortSignal;
  streamFn?: StreamFn;
}): Promise<string> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const { text } = await generateSummaryWithUsage(
        options.messages,
        options.model,
        SUMMARY_RESERVE_TOKENS,
        options.apiKey,
        undefined,
        options.signal,
        options.customInstructions,
        options.previousSummary,
        undefined,
        // Custom providers are not in pi's builtin registry, so pi's default
        // completion path would fail on them; route through the shared runtime.
        options.streamFn ?? streamWithPiRuntime
      );
      return text.trim();
    } catch (error) {
      if (options.signal?.aborted) return "";
      const message = error instanceof Error ? error.message : String(error);
      const retryDelay = SUMMARY_RETRY_DELAYS_MS[attempt];
      if (retryDelay === undefined || !isRetryableModelError(message)) return "";
      await delay(retryDelay, options.signal);
      if (options.signal?.aborted) return "";
    }
  }
}

/**
 * Index of the message that opens the turn containing `index`.
 *
 * A turn starts at a user-visible message; every assistant reply and tool result
 * after it belongs to that turn. Returns -1 when no turn start precedes the
 * index (the history begins mid-turn, e.g. right after an earlier compaction).
 */
export function findTurnStartIndex(messages: AgentMessage[], index: number): number {
  for (let i = Math.min(index, messages.length - 1); i >= 0; i -= 1) {
    if (String((messages[i] as unknown as { role?: unknown }).role ?? "") === "user") return i;
  }
  return -1;
}

/**
 * Split the history at the cut point, separating a partially-kept turn.
 *
 * Normally compaction cuts on a turn boundary and there is nothing special to
 * do. But when one turn is larger than the whole keep-recent budget — a long
 * tool-heavy turn — the cut lands inside it, and the retained suffix then
 * references work whose beginning was summarized away together with dozens of
 * unrelated older turns. pi calls this a split turn and summarizes the turn's
 * prefix separately, with a prompt aimed at "what does the kept suffix need to
 * make sense", so that context is not diluted by the rest of the history.
 */
export function planCompactionSpan(
  messages: AgentMessage[],
  firstKeptIndex: number
): { historyEnd: number; turnStartIndex: number; isSplitTurn: boolean } {
  const turnStartIndex = findTurnStartIndex(messages, firstKeptIndex);
  const startsTurn = String((messages[firstKeptIndex] as unknown as { role?: unknown })?.role ?? "") === "user";
  const isSplitTurn = !startsTurn && turnStartIndex >= 0 && turnStartIndex < firstKeptIndex;
  return {
    historyEnd: isSplitTurn ? turnStartIndex : firstKeptIndex,
    turnStartIndex,
    isSplitTurn
  };
}

/**
 * pi's turn-prefix prompt, kept verbatim so summaries read the same whichever
 * harness produced them. Sent with half the summary budget: the prefix only has
 * to bridge into the retained suffix, not stand alone as a history.
 */
const TURN_PREFIX_PROMPT = `This is the PREFIX of a turn that was too large to keep. The SUFFIX (recent work) is retained.

Summarize the prefix to provide context for the retained suffix:

## Original Request
[What did the user ask for in this turn?]

## Early Progress
- [Key decisions and work done in the prefix]

## Context for Suffix
- [Information needed to understand the retained recent work]

Be concise. Focus on what's needed to understand the kept suffix.`;


/**
 * Summarize a split turn's prefix.
 *
 * Uses the shared runtime stream directly rather than pi's
 * `generateTurnPrefixSummary`, which the package does not export. Failure is
 * not fatal: the caller falls back to the history summary alone, which is
 * strictly better than losing the compaction entirely.
 */
async function generateTurnPrefixSummary(options: {
  messages: AgentMessage[];
  model: Model<any>;
  apiKey?: string;
  signal?: AbortSignal;
  streamFn?: StreamFn;
}): Promise<string> {
  if (options.messages.length === 0) return "";
  const conversation = serializeConversation(convertToLlm(options.messages));
  const context = {
    systemPrompt: SUMMARIZATION_SYSTEM_PROMPT,
    messages: [{
      role: "user",
      content: [{ type: "text", text: `<conversation>\n${conversation}\n</conversation>\n\n${TURN_PREFIX_PROMPT}` }]
    }],
    tools: []
  };

  try {
    // `await` covers both shapes: the real runtime returns an event stream
    // synchronously, while injected stubs may hand back a promise for one.
    const stream = await (options.streamFn ?? streamWithPiRuntime)(
      options.model,
      context as never,
      { maxTokens: TURN_PREFIX_MAX_TOKENS, apiKey: options.apiKey, signal: options.signal } as never
    );
    // Same accessor pi's own summarization uses: take the settled assistant
    // message rather than reassembling deltas.
    const message = await (stream as unknown as { result: () => Promise<AssistantMessage> }).result();
    if (message?.stopReason === "error") return "";
    const text = (Array.isArray(message?.content) ? message.content : [])
      .filter((part): part is { type: "text"; text: string } =>
        Boolean(part) && (part as { type?: unknown }).type === "text"
      )
      .map((part) => part.text)
      .join("");
    return text.trim();
  } catch {
    return "";
  }
}

export async function compactContextMessages(options: {
  messages: AgentMessage[];
  model: Model<any>;
  apiKey?: string;
  settings: CompactionSettings;
  reason: "threshold" | "manual";
  customInstructions?: string;
  signal?: AbortSignal;
  /** Overrides the shared pi runtime stream; used by tests. */
  streamFn?: StreamFn;
}): Promise<ContextCompactionResult> {
  const beforeTokens = estimateContextTokens(options.messages);
  const firstKeptIndex = options.reason === "manual"
    ? findManualFirstKeptIndex(options.messages, options.settings.keepRecentTokens)
    : findFirstKeptIndex(options.messages, options.settings.keepRecentTokens);
  const span = planCompactionSpan(options.messages, firstKeptIndex);
  const messagesToSummarize = options.messages.slice(0, span.historyEnd);
  const turnPrefixMessages = span.isSplitTurn
    ? options.messages.slice(span.turnStartIndex, firstKeptIndex)
    : [];
  const capped = capOversizedMessages(
    options.messages.slice(firstKeptIndex),
    options.settings.keepRecentTokens
  );
  const keptMessages = capped.messages;

  if ((messagesToSummarize.length === 0 && turnPrefixMessages.length === 0) || keptMessages.length === 0) {
    if (capped.cappedCount === 0) {
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

    // There was no history to summarize, but a kept message was over the
    // per-message cap and has been shrunk. That still has to be reported as a
    // real compaction: the caller persists `messages[0]` as the summary and
    // `slice(1)` as the new context, so returning the capped list without a
    // summary message here would silently drop its first message.
    const note = oversizedCapSummary(capped.cappedCount);
    const compacted = [
      { role: "user", content: `${SUMMARY_PREFIX}\n${note}`, timestamp: Date.now() } as AgentMessage,
      ...keptMessages
    ];
    return {
      changed: true,
      reason: options.reason,
      summary: note,
      beforeTokens,
      afterTokens: estimateContextTokens(compacted),
      summarizedMessages: 0,
      keptMessages: keptMessages.length,
      messages: compacted
    };
  }

  // A prior summary is merged by pi rather than being re-summarized as raw
  // text, so successive compactions no longer degrade what earlier ones kept.
  const previousSummary = extractPreviousSummary(messagesToSummarize);

  // Carry the file list forward. The prose is what the model should update; the
  // blocks are rebuilt from tool calls so the list stays exact instead of
  // depending on the model to copy paths across every compaction.
  const fileOps = createFileOps();
  if (previousSummary) mergeFileOps(fileOps, extractFileOpsFromSummary(previousSummary).ops);
  extractFileOps(messagesToSummarize, fileOps);
  extractFileOps(turnPrefixMessages, fileOps);
  const previousSummaryText = previousSummary
    ? extractFileOpsFromSummary(previousSummary).text || undefined
    : undefined;
  const summarizable = messagesToSummarize.filter((message) => !isCompactionSummaryMessage(message));
  const limited = limitMessagesToSummarize(summarizable);

  let summary = limited.messages.length > 0
    ? await generateSummaryWithRetry({
        messages: limited.messages,
        model: options.model,
        apiKey: options.apiKey,
        customInstructions: options.customInstructions,
        previousSummary: previousSummaryText,
        signal: options.signal,
        streamFn: options.streamFn
      })
    : "";

  if (!summary && limited.messages.length > 0) {
    summary = buildFallbackSummary(limited.messages);
  }

  if (span.isSplitTurn && turnPrefixMessages.length > 0) {
    const prefixSummary = await generateTurnPrefixSummary({
      messages: turnPrefixMessages,
      model: options.model,
      apiKey: options.apiKey,
      signal: options.signal,
      streamFn: options.streamFn
    });
    if (prefixSummary) {
      // Same shape pi produces, so a split summary reads identically in either
      // harness. "No prior history." matters: the kept suffix must not be left
      // to infer whether earlier turns existed at all.
      summary = `${summary || "No prior history."}\n\n---\n\n**Turn Context (split turn):**\n\n${prefixSummary}`;
    } else if (!summary) {
      summary = buildFallbackSummary(turnPrefixMessages);
    }
  }

  if (!summary) {
    summary = buildFallbackSummary(limited.messages);
  }

  // The model may also have emitted its own file blocks; `appendFileOperations`
  // strips those and writes one authoritative set.
  summary = appendFileOperations(summary, fileOps);

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
    summarizedMessages: messagesToSummarize.length + turnPrefixMessages.length,
    keptMessages: keptMessages.length,
    messages: compactedMessages
  };
}
