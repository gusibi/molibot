import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { capOversizedMessages } from "$lib/server/agent/session/compaction.js";

const CJK_CHAR_PATTERN = /[\u1100-\u11ff\u2e80-\u9fff\ua960-\ua97f\uac00-\ud7ff\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]/g;

function estimateTextTokens(text: string): number {
  if (!text) return 0;
  const cjkCount = (text.match(CJK_CHAR_PATTERN) ?? []).length;
  return cjkCount + Math.ceil((text.length - cjkCount) / 4);
}

export interface ContextUsageBreakdown {
  /** Estimated tokens of user/assistant conversation text sent to the model. */
  messages: number;
  /** Estimated tokens of `<current-memory>` working-memory blocks inside user messages. */
  memory: number;
  /** Estimated tokens of tool results that carry file contents (read-style tools). */
  files: number;
  /** Estimated tokens of remaining tool results (command output, tool payloads). */
  toolResults: number;
  /** Estimated tokens of third-party MCP tool schemas (`mcp__` prefix). */
  mcpTools: number;
  /** Estimated tokens of built-in tool schemas. */
  systemTools: number;
  /** Estimated tokens of the system prompt, excluding the skills catalogue. */
  systemPrompt: number;
  /** Estimated tokens of the `<available-skills>` catalogue inside the system prompt. */
  skills: number;
  /** Plugin/extension tool schemas and anything not covered by the buckets above. */
  other: number;
}

export type ContextUsageBreakdownKey = keyof ContextUsageBreakdown;

export interface ContextUsageEstimate {
  breakdown: ContextUsageBreakdown;
  estimatedTokens: number;
}

/** Rough per-image context cost (~1.1MP image); image bytes never count as text. */
const IMAGE_TOKEN_ESTIMATE = 1600;
/** The working-memory snapshot rides the user envelope between these tags (see `promptInput.ts`). */
const MEMORY_BLOCK_PATTERN = /<current-memory>[\s\S]*?<\/current-memory>/g;
/** Tools whose results are file contents; everything else lands in `toolResults`. */
const FILE_RESULT_TOOLS = new Set(["read", "docExtract", "attach"]);

/** The skills catalogue is one self-contained XML block in the assembled prompt (see `buildSkillsCatalogue`). */
const SKILLS_BLOCK_PATTERN = /<available-skills>[\s\S]*?<\/available-skills>/;

function estimateToolsByKind(tools: unknown[]): Pick<ContextUsageBreakdown, "mcpTools" | "systemTools" | "other"> {
  const result = { mcpTools: 0, systemTools: 0, other: 0 };
  for (const tool of tools) {
    const name = typeof (tool as { name?: unknown } | null | undefined)?.name === "string"
      ? (tool as { name: string }).name
      : "";
    const tokens = estimateTextTokens(
      (() => {
        try {
          return JSON.stringify(tool) ?? String(tool);
        } catch {
          return String(tool);
        }
      })()
    );
    if (name.startsWith("mcp__")) result.mcpTools += tokens;
    else if (name) result.systemTools += tokens;
    else result.other += tokens;
  }
  return result;
}

interface MessageSplit {
  messages: number;
  memory: number;
  files: number;
  toolResults: number;
}

function textContentOf(content: unknown): { text: string; images: number } {
  if (!Array.isArray(content)) return { text: "", images: 0 };
  let text = "";
  let images = 0;
  for (const block of content as Array<{ type?: unknown; text?: unknown }>) {
    if (block?.type === "text" && typeof block.text === "string") text += block.text;
    else if (block?.type === "image") images += 1;
  }
  return { text, images };
}

/**
 * Split one dispatched message into the display buckets: user/assistant text
 * stays in `messages` (memory blocks carved out of user envelopes), tool
 * results split into `files` vs `toolResults` by tool, images estimate to
 * `files`. Mirrors the roles the estimator actually sees — system messages are
 * removed by the caller and counted in `systemPrompt`.
 */
function classifyMessageTokens(message: AgentMessage): MessageSplit {
  const empty: MessageSplit = { messages: 0, memory: 0, files: 0, toolResults: 0 };
  if (!message || typeof message !== "object") return empty;
  const msg = message as Record<string, unknown>;
  const role = String(msg.role ?? "");
  const { text, images } = textContentOf(msg.content);
  const imageTokens = images * IMAGE_TOKEN_ESTIMATE;

  if (role === "toolResult") {
    const tokens = estimateTextTokens(text) + imageTokens;
    if (tokens === 0) return empty;
    return FILE_RESULT_TOOLS.has(String(msg.toolName ?? ""))
      ? { ...empty, files: tokens }
      : { ...empty, toolResults: tokens };
  }
  if (role === "user") {
    const memoryBlocks = text.match(MEMORY_BLOCK_PATTERN) ?? [];
    let memory = 0;
    let conversation = text;
    for (const block of memoryBlocks) {
      memory += estimateTextTokens(block);
      conversation = conversation.replace(block, "");
    }
    const messages = estimateTextTokens(conversation);
    if (messages === 0 && memory === 0 && imageTokens === 0) return empty;
    return { messages, memory, files: imageTokens, toolResults: 0 };
  }
  if (role === "assistant") {
    return { ...empty, messages: estimateTextTokens(text) };
  }
  return { ...empty, messages: estimateTextTokens(JSON.stringify(message)) };
}

/** Sum of every bucket — the headline estimate the panels display. */
export function contextBreakdownTotal(breakdown: ContextUsageBreakdown): number {
  return Object.values(breakdown).reduce((total, tokens) => total + tokens, 0);
}

/**
 * Scale an estimated breakdown to the provider-reported prompt total
 * (`input + cacheRead + cacheWrite`). Buckets keep their proportions;
 * cumulative rounding makes the parts sum to the reported total exactly, with
 * the remainder landing in the last bucket. Returns the input untouched when
 * either side is unavailable.
 */
export function calibrateContextBreakdown(
  breakdown: ContextUsageBreakdown,
  reportedPromptTokens: number
): ContextUsageBreakdown {
  const estimated = contextBreakdownTotal(breakdown);
  if (!(reportedPromptTokens > 0) || estimated <= 0) return breakdown;
  const keys = Object.keys(breakdown) as ContextUsageBreakdownKey[];
  let estimatedCursor = 0;
  let reportedCursor = 0;
  const calibrated = {} as ContextUsageBreakdown;
  for (const key of keys) {
    estimatedCursor += breakdown[key];
    const next = Math.round((estimatedCursor * reportedPromptTokens) / estimated);
    calibrated[key] = next - reportedCursor;
    reportedCursor = next;
  }
  return calibrated;
}

/**
 * Split the dispatch context into the display categories the composer's
 * context-usage panel renders. Estimates share the preflight estimator so the
 * parts always sum to `estimatedTokens`; the real prompt size still comes from
 * the provider's usage report.
 */
export function estimateContextBreakdown(input: {
  systemPrompt: string;
  messages: AgentMessage[];
  tools: unknown[];
}): ContextUsageEstimate {
  const skillsBlock = input.systemPrompt.match(SKILLS_BLOCK_PATTERN)?.[0] ?? "";
  const skills = estimateTextTokens(skillsBlock);
  const toolSplit = estimateToolsByKind(input.tools);
  const split: MessageSplit = { messages: 0, memory: 0, files: 0, toolResults: 0 };
  for (const message of input.messages) {
    const part = classifyMessageTokens(message);
    split.messages += part.messages;
    split.memory += part.memory;
    split.files += part.files;
    split.toolResults += part.toolResults;
  }
  const breakdown: ContextUsageBreakdown = {
    messages: split.messages,
    memory: split.memory,
    files: split.files,
    toolResults: split.toolResults,
    mcpTools: toolSplit.mcpTools,
    systemTools: toolSplit.systemTools,
    systemPrompt: estimateTextTokens(input.systemPrompt) - skills,
    skills,
    other: toolSplit.other
  };
  return {
    breakdown,
    estimatedTokens: contextBreakdownTotal(breakdown)
  };
}

export interface ModelContextPreflightAssessment extends ContextUsageEstimate {
  fits: boolean;
  fixedTokens: number;
  messageTokens: number;
  contextWindow: number;
}

/**
 * Estimate the complete text context presented to the model immediately before
 * dispatch: stable system prompt, current tool schemas, history, and the newest
 * user/tool-result message. Image blocks count as a fixed per-image estimate
 * (`IMAGE_TOKEN_ESTIMATE`) instead of their raw bytes.
 */
export function assessModelContextPreflight(input: {
  systemPrompt: string;
  messages: AgentMessage[];
  tools: unknown[];
  contextWindow: number;
}): ModelContextPreflightAssessment {
  const estimate = estimateContextBreakdown(input);
  const fixedTokens = estimate.breakdown.systemPrompt + estimate.breakdown.skills
    + estimate.breakdown.mcpTools + estimate.breakdown.systemTools + estimate.breakdown.other;
  const messageTokens = estimate.breakdown.messages + estimate.breakdown.memory
    + estimate.breakdown.files + estimate.breakdown.toolResults;
  const contextWindow = Math.max(1, Math.floor(input.contextWindow));
  return {
    fits: estimate.estimatedTokens <= contextWindow,
    estimatedTokens: estimate.estimatedTokens,
    breakdown: estimate.breakdown,
    fixedTokens,
    messageTokens,
    contextWindow
  };
}

export function contextMessageBudget(contextWindow: number, fixedTokens: number): number {
  return Math.max(0, Math.floor(contextWindow) - Math.max(0, Math.floor(fixedTokens)));
}

export function capModelPromptToTokens(text: string, maxTokens: number): string {
  const message = {
    role: "user",
    content: [{ type: "text", text }],
    timestamp: 0
  } as AgentMessage;
  const result = capOversizedMessages([message], Math.max(1, Math.floor(maxTokens)));
  const content = (result.messages[0] as { content?: Array<{ type?: string; text?: string }> } | undefined)?.content;
  return content?.find((part) => part.type === "text")?.text ?? text;
}

export function assertModelContextFits(input: {
  systemPrompt: string;
  messages: AgentMessage[];
  tools: unknown[];
  contextWindow: number;
}): ModelContextPreflightAssessment {
  const assessment = assessModelContextPreflight(input);
  if (!assessment.fits) {
    throw new Error(
      `Context length exceeded before provider request: estimated ${assessment.estimatedTokens} tokens ` +
        `for a ${assessment.contextWindow}-token model window.`
    );
  }
  return assessment;
}
