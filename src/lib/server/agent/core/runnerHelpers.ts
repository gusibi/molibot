import { basename } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import { type RuntimeSettings } from "$lib/server/settings/index.js";
import { stripTransientRuntimeNoticesFromMessages } from "$lib/server/agent/core/runtimeNotices.js";
import { type HostBashApprovalPrompt } from "$lib/server/hostBash/index.js";
import {
  resolveModelSelection,
  getCustomProviderById,
  getCustomModelRoles
} from "$lib/server/agent/routing/modelRouting.js";
import { hasPiProviderAuth } from "$lib/server/providers/piRuntime.js";

export function envVarForProvider(provider: string): string | null {
  switch (provider) {
    case "anthropic":
      return "ANTHROPIC_API_KEY";
    case "openai":
    case "openai-codex":
      return "OPENAI_API_KEY";
    case "google":
    case "google-antigravity":
    case "google-gemini-cli":
      return "GOOGLE_API_KEY";
    case "xai":
      return "XAI_API_KEY";
    case "groq":
      return "GROQ_API_KEY";
    case "cerebras":
      return "CEREBRAS_API_KEY";
    case "openrouter":
      return "OPENROUTER_API_KEY";
    case "mistral":
      return "MISTRAL_API_KEY";
    case "zai":
      return "ZAI_API_KEY";
    case "minimax":
    case "minimax-cn":
      return "MINIMAX_API_KEY";
    case "huggingface":
      return "HUGGINGFACE_API_KEY";
    default:
      return null;
  }
}

export function rewritePromptUserMessage(
  messages: AgentMessage[],
  userMessageIndex: number,
  persistedText: string
): AgentMessage[] {
  const target = messages[userMessageIndex] as AgentMessage & {
    role?: string;
    content?: Array<{ type?: string; text?: string }>;
  };
  if (!target || target.role !== "user") return messages;

  const content = Array.isArray(target.content) ? target.content : [];
  let replaced = false;
  const nextContent = content.map((part) => {
    if (!replaced && part.type === "text") {
      replaced = true;
      return { ...part, text: persistedText };
    }
    return part;
  });
  if (!replaced) {
    nextContent.unshift({ type: "text", text: persistedText });
  }

  const nextMessages = [...messages];
  nextMessages[userMessageIndex] = {
    ...target,
    content: nextContent
  } as AgentMessage;
  return nextMessages;
}

export function getMessageText(message: AgentMessage): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type?: unknown; text?: unknown } =>
      Boolean(part && typeof part === "object" && !Array.isArray(part))
    )
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("\n");
}

export function rewritePromptUserMessageForPersistence(
  message: AgentMessage,
  modelMessage: string,
  persistedText: string
): AgentMessage {
  const row = message as AgentMessage & {
    role?: string;
    content?: string | Array<{ type?: unknown; text?: unknown }>;
  };
  if (row.role !== "user") return message;
  if (getMessageText(message).trim() !== modelMessage.trim()) return message;

  if (typeof row.content === "string") {
    return { ...row, content: persistedText } as AgentMessage;
  }

  const content = Array.isArray(row.content) ? row.content : [];
  let replaced = false;
  const nextContent = content.map((part) => {
    if (!replaced && part?.type === "text") {
      replaced = true;
      return { ...part, text: persistedText };
    }
    return part;
  });
  if (!replaced) {
    nextContent.unshift({ type: "text", text: persistedText });
  }
  return { ...row, content: nextContent } as AgentMessage;
}

export function createPersistedUserMessage(content: string, timestamp?: string | number): AgentMessage {
  const numericTimestamp = typeof timestamp === "number"
    ? timestamp
    : typeof timestamp === "string" && /^-?\d+(?:\.\d+)?$/.test(timestamp.trim())
      ? Number(timestamp)
      : Date.parse(String(timestamp ?? ""));
  const ms = Number.isFinite(numericTimestamp)
    ? Math.abs(numericTimestamp) < 1e12
      ? numericTimestamp * 1000
      : numericTimestamp
    : Date.now();
  return {
    role: "user",
    content: [{ type: "text", text: content }],
    timestamp: ms
  } as AgentMessage;
}

export function createAssistantErrorMessage(options: {
  text?: string;
  errorMessage: string;
  model: Model<any>;
}): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: options.text ?? "" }],
    api: options.model.api,
    provider: options.model.provider,
    model: options.model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0
    },
    stopReason: "error",
    errorMessage: options.errorMessage,
    timestamp: Date.now()
  } as AgentMessage;
}

export function shouldHideFromModelContext(message: AgentMessage): boolean {
  const row = message as AgentMessage & { role?: string; stopReason?: string };
  return row.role === "assistant" && row.stopReason === "error" && getMessageText(message).trim().length === 0;
}

export function prepareMessagesForModelContext(messages: AgentMessage[]): AgentMessage[] {
  return stripTransientRuntimeNoticesFromMessages(messages).filter((message) => !shouldHideFromModelContext(message));
}

export function formatPayloadReasoningSummary(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "reasoning: unavailable";

  const raw = payload as Record<string, unknown>;
  const reasoningEffort = typeof raw.reasoning_effort === "string"
    ? raw.reasoning_effort
    : undefined;
  const reasoningObject = raw.reasoning && typeof raw.reasoning === "object"
    ? raw.reasoning as Record<string, unknown>
    : undefined;
  const openRouterEffort = typeof reasoningObject?.effort === "string"
    ? reasoningObject.effort
    : undefined;
  const enableThinking = typeof raw.enable_thinking === "boolean"
    ? raw.enable_thinking
    : undefined;
  const chatTemplateKwargs = raw.chat_template_kwargs && typeof raw.chat_template_kwargs === "object"
    ? raw.chat_template_kwargs as Record<string, unknown>
    : undefined;
  const chatTemplateEnableThinking = typeof chatTemplateKwargs?.enable_thinking === "boolean"
    ? chatTemplateKwargs.enable_thinking
    : undefined;
  const thinkingObject = raw.thinking && typeof raw.thinking === "object"
    ? raw.thinking as Record<string, unknown>
    : undefined;
  const thinkingType = typeof thinkingObject?.type === "string"
    ? thinkingObject.type
    : undefined;
  const thinkingEnabled = typeof thinkingObject?.enabled === "boolean"
    ? thinkingObject.enabled
    : undefined;
  const thinkingLevel = typeof thinkingObject?.level === "string"
    ? thinkingObject.level
    : undefined;
  const thinkingBudget = typeof thinkingObject?.budgetTokens === "number"
    ? thinkingObject.budgetTokens
    : typeof thinkingObject?.budget_tokens === "number"
      ? thinkingObject.budget_tokens
      : undefined;

  const parts = [
    reasoningEffort ? `reasoning_effort=${reasoningEffort}` : null,
    openRouterEffort ? `reasoning.effort=${openRouterEffort}` : null,
    enableThinking !== undefined ? `enable_thinking=${String(enableThinking)}` : null,
    chatTemplateEnableThinking !== undefined
      ? `chat_template_kwargs.enable_thinking=${String(chatTemplateEnableThinking)}`
      : null,
    thinkingType ? `thinking.type=${thinkingType}` : null,
    thinkingEnabled !== undefined ? `thinking.enabled=${String(thinkingEnabled)}` : null,
    thinkingLevel ? `thinking.level=${thinkingLevel}` : null,
    thinkingBudget !== undefined ? `thinking.budget=${thinkingBudget}` : null
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(", ") : "reasoning: none";
}

export function removeOrphanToolResultsFromContext(context: any): any {
  if (!context || typeof context !== "object" || !Array.isArray(context.messages)) return context;

  const messages: unknown[] = [];
  let pendingToolCallIds = new Set<string>();

  for (const message of context.messages) {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      messages.push(message);
      pendingToolCallIds = new Set();
      continue;
    }

    const row = message as { role?: unknown; toolCallId?: unknown; content?: unknown };
    if (row.role === "toolResult") {
      const toolCallId = String(row.toolCallId ?? "");
      if (toolCallId && pendingToolCallIds.has(toolCallId)) {
        messages.push(message);
        pendingToolCallIds.delete(toolCallId);
      }
      continue;
    }

    messages.push(message);

    if (row.role === "assistant" && Array.isArray(row.content)) {
      pendingToolCallIds = new Set(
        row.content
          .filter((part): part is { type?: unknown; id?: unknown } =>
            Boolean(part && typeof part === "object" && !Array.isArray(part))
          )
          .filter((part) => part.type === "toolCall")
          .map((part) => String(part.id ?? ""))
          .filter(Boolean)
      );
    } else {
      pendingToolCallIds = new Set();
    }
  }

  return messages.length === context.messages.length
    ? context
    : { ...context, messages };
}

export function hasExplicitMcpInvocation(inputText: string): boolean {
  const text = String(inputText ?? "");
  if (!text.trim()) return false;

  const lower = text.toLowerCase();
  const directPatterns = [
    /\bloadMcp\b/i,
    /(?:^|\s)\/mcp(?:\s|$)/i
  ];
  if (directPatterns.some((pattern) => pattern.test(lower))) {
    return true;
  }

  // Language-agnostic fallback: standalone MCP token anywhere in the sentence.
  return /(?:^|[\s([{'"“‘])mcp(?=$|[\s)\]}'"”’，。,.!?;:：])/i.test(lower);
}

export function injectExplicitSkillInvocationContext(
  inputText: string,
  skills: Array<{ name: string; scope: string; filePath: string; baseDir?: string; aliases?: string[] }>
): string {
  if (skills.length === 0) return inputText;
  let rendered = inputText;
  const missingReferences: string[] = [];

  for (const skill of skills) {
    const reference = `[$${skill.name}](${skill.filePath})`;
    const selectors = [skill.name, ...(skill.aliases ?? [])]
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[-_]/g, "[-_]"));
    const selector = selectors.length > 0
      ? new RegExp(`(^|\\s)(?:\\/|\\$|skill:|技能:)(${selectors.join("|")})(?=\\s|$)`, "i")
      : null;
    if (selector?.test(rendered)) {
      rendered = rendered.replace(selector, (_match, prefix: string) => `${prefix}${reference}`);
    } else {
      missingReferences.push(reference);
    }
  }

  return missingReferences.length > 0
    ? `${missingReferences.join(" ")} ${rendered}`.trim()
    : rendered;
}

export function buildPromptRefreshKey(
  settings: RuntimeSettings,
  channel: string,
  workspaceDir: string
): string {
  const botId = basename(workspaceDir);
  const instances = settings.channels?.[channel]?.instances ?? [];
  const activeInstance = instances.find((instance) => instance.id === botId);
  return JSON.stringify({
    channel,
    botId,
    botAgentId: String(activeInstance?.agentId ?? "").trim(),
    botInstanceEnabled: activeInstance?.enabled !== false,
    timezone: settings.timezone,
    systemPrompt: settings.systemPrompt,
    disabledSkillPaths: settings.disabledSkillPaths,
    mcpServers: settings.mcpServers
  });
}

export async function validateRuntimeSettings(settings: RuntimeSettings): Promise<string | null> {
  const selection = resolveModelSelection(settings, "text");
  if (selection.source === "custom") {
    const selected = getCustomProviderById(settings, selection.providerId);
    if (!selected) {
      return `AI settings error: active custom model provider '${selection.providerId}' is missing from provider settings.`;
    }
    if (!selected.baseUrl?.trim() || !selected.apiKey?.trim() || !selection.modelId) {
      return "AI settings error: active custom model requires baseUrl, apiKey, and a valid model.";
    }
    return null;
  }

  const configuredBuiltInProvider = settings.customProviders.find((provider) => provider.id === selection.model.provider);
  if (!await hasPiProviderAuth(selection.model.provider, configuredBuiltInProvider?.apiKey)) {
    const envVar = envVarForProvider(selection.model.provider);
    const hint = envVar ? `${envVar} or auth.json` : "auth.json";
    return `AI settings error: missing credentials for provider '${selection.model.provider}'. Configure ${hint}.`;
  }
  return null;
}

export function isContextOverflowError(message: string): boolean {
  const text = message.toLowerCase();
  return [
    "context length",
    "context window",
    "maximum context length",
    "prompt is too long",
    "too many tokens",
    "token limit",
    "maximum tokens",
    "input is too long"
  ].some((needle) => text.includes(needle));
}

export function extractTextFromResult(result: unknown): string {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") return JSON.stringify(result);
  const obj = result as { content?: Array<{ type?: string; text?: string }> };
  if (!Array.isArray(obj.content)) return JSON.stringify(result);
  const parts = obj.content
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text as string);
  return parts.join("\n") || JSON.stringify(result);
}

export function extractHostBashApprovalPrompt(result: unknown): HostBashApprovalPrompt | undefined {
  if (!result || typeof result !== "object") return undefined;
  const details = (result as { details?: unknown }).details;
  if (!details || typeof details !== "object") return undefined;
  const prompt = (details as { hostBashApproval?: unknown }).hostBashApproval;
  if (!prompt || typeof prompt !== "object") return undefined;
  return prompt as HostBashApprovalPrompt;
}

export function mapUnsupportedDeveloperRole(
  settings: RuntimeSettings,
  context: any,
): any {
  const shouldCheckCustom = resolveModelSelection(settings, "text").source === "custom";
  if (!shouldCheckCustom) return context;
  const roles = getCustomModelRoles(settings);
  if (roles.includes("developer")) return context;

  if (
    !context ||
    typeof context !== "object" ||
    !Array.isArray(context.messages)
  )
    return context;
  const developerInstructions: string[] = [];
  const mappedMessages = context.messages.filter((msg: any) => {
    if (!msg || typeof msg !== "object" || msg.role !== "developer") return true;
    const instruction = extractPlainTextContent(msg.content);
    if (instruction) developerInstructions.push(instruction);
    return false;
  });
  if (developerInstructions.length === 0) return context;

  const systemPrompt = [
    typeof context.systemPrompt === "string" ? context.systemPrompt.trim() : "",
    ...developerInstructions
  ].filter(Boolean).join("\n\n");

  return { ...context, systemPrompt, messages: mappedMessages };
}

export function extractPlainTextContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const text = (part as { text?: unknown }).text;
      return typeof text === "string" ? text.trim() : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

export function moveAnthropicSystemMessagesToTopLevel(context: any): any {
  if (
    !context ||
    typeof context !== "object" ||
    !Array.isArray(context.messages)
  )
    return context;

  const systemBlocks: string[] = [];
  const messages: unknown[] = [];
  const existingSystemPrompt =
    typeof context.systemPrompt === "string" ? context.systemPrompt.trim() : "";
  if (existingSystemPrompt) systemBlocks.push(existingSystemPrompt);

  for (const msg of context.messages) {
    if (!msg || typeof msg !== "object") {
      messages.push(msg);
      continue;
    }
    const role = (msg as { role?: unknown }).role;
    if (role !== "system" && role !== "developer") {
      messages.push(msg);
      continue;
    }
    const text = extractPlainTextContent((msg as { content?: unknown }).content);
    if (text) systemBlocks.push(text);
  }

  return {
    ...context,
    systemPrompt: systemBlocks.join("\n\n"),
    messages
  };
}
