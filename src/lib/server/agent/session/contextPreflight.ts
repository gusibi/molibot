import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { capOversizedMessages, estimateContextTokens } from "$lib/server/agent/session/compaction.js";

const CJK_CHAR_PATTERN = /[\u1100-\u11ff\u2e80-\u9fff\ua960-\ua97f\uac00-\ud7ff\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]/g;

function estimateTextTokens(text: string): number {
  if (!text) return 0;
  const cjkCount = (text.match(CJK_CHAR_PATTERN) ?? []).length;
  return cjkCount + Math.ceil((text.length - cjkCount) / 4);
}

function serializedToolTokens(tools: unknown[]): number {
  if (tools.length === 0) return 0;
  try {
    return estimateTextTokens(JSON.stringify(tools));
  } catch {
    return tools.reduce((sum, tool) => sum + estimateTextTokens(String(tool)), 0);
  }
}

export interface ModelContextPreflightAssessment {
  fits: boolean;
  estimatedTokens: number;
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
  const fixedTokens = estimateTextTokens(input.systemPrompt) + serializedToolTokens(input.tools);
  const messageTokens = estimateContextTokens(input.messages);
  const estimatedTokens = fixedTokens + messageTokens;
  const contextWindow = Math.max(1, Math.floor(input.contextWindow));
  return {
    fits: estimatedTokens <= contextWindow,
    estimatedTokens,
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
