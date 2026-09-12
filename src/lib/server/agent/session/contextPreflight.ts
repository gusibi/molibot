import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { capOversizedMessages, estimateContextTokens } from "$lib/server/agent/session/compaction.js";

const CJK_CHAR_PATTERN = /[\u1100-\u11ff\u2e80-\u9fff\ua960-\ua97f\uac00-\ud7ff\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]/g;

function estimateTextTokens(text: string): number {
  if (!text) return 0;
  const cjkCount = (text.match(CJK_CHAR_PATTERN) ?? []).length;
  return cjkCount + Math.ceil((text.length - cjkCount) / 4);
}

export interface ContextUsageBreakdown {
  /** Estimated tokens of the conversation history sent to the model. */
  messages: number;
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

export interface ContextUsageEstimate {
  breakdown: ContextUsageBreakdown;
  estimatedTokens: number;
}

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
  const breakdown: ContextUsageBreakdown = {
    messages: estimateContextTokens(input.messages),
    mcpTools: toolSplit.mcpTools,
    systemTools: toolSplit.systemTools,
    systemPrompt: estimateTextTokens(input.systemPrompt) - skills,
    skills,
    other: toolSplit.other
  };
  return {
    breakdown,
    estimatedTokens: breakdown.messages + breakdown.mcpTools + breakdown.systemTools
      + breakdown.systemPrompt + breakdown.skills + breakdown.other
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
 * user/tool-result message. Binary image bytes are intentionally absent because
 * `estimateContextTokens` counts only textual message blocks.
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
  const messageTokens = estimate.breakdown.messages;
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
