import { Agent } from "@mariozechner/pi-agent-core";
import { getModels } from "@mariozechner/pi-ai";
import type { CustomProviderConfig, RuntimeSettings } from "../settings/index.js";
import type { ConversationMessage } from "../../shared/types/message.js";
import type { AiUsageTracker } from "../usage/tracker.js";

type OpenAIRole = "system" | "user" | "assistant";

interface OpenAIMessage {
  role: OpenAIRole;
  content: string;
}

interface ProviderReply {
  text: string;
  usage?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    totalTokens?: number;
  };
  provider: string;
  model: string;
  api: string;
}

function stringifyHistory(history: ConversationMessage[]): string {
  return history.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n");
}

function extractText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return null;

  const v = value as Record<string, unknown>;
  if (typeof v.text === "string") return v.text;
  if (typeof v.content === "string") return v.content;

  if (Array.isArray(v.content)) {
    const parts = v.content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string") {
          return String((item as { text: unknown }).text);
        }
        return "";
      })
      .filter(Boolean);

    return parts.length > 0 ? parts.join("\n") : null;
  }

  return null;
}

function toOpenAIMessages(history: ConversationMessage[], settings: RuntimeSettings): OpenAIMessage[] {
  return toOpenAIMessagesWithMemory(history, settings, "");
}

function toOpenAIMessagesWithMemory(
  history: ConversationMessage[],
  settings: RuntimeSettings,
  memoryContext: string
): OpenAIMessage[] {
  const systemPrompt = memoryContext.trim()
    ? `${settings.systemPrompt}\n\nRelevant memory:\n${memoryContext.trim()}`
    : settings.systemPrompt;

  const messages: OpenAIMessage[] = [
    {
      role: "system",
      content: systemPrompt
    }
  ];

  for (const msg of history) {
    if (msg.role === "user" || msg.role === "assistant" || msg.role === "system") {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  return messages;
}

function getProviderModel(provider: CustomProviderConfig): string {
  const modelIds = provider.models.map((m) => m.id).filter(Boolean);
  const selected = provider.defaultModel?.trim();
  if (selected && modelIds.includes(selected)) return selected;
  return modelIds[0]?.trim() || "";
}

async function callCustomProvider(
  history: ConversationMessage[],
  settings: RuntimeSettings,
  memoryContext: string
): Promise<ProviderReply> {
  const provider = pickDefaultCustomProvider(settings);
  if (!provider) {
    throw new Error("No custom provider configured");
  }

  const model = getProviderModel(provider);
  if (!provider.baseUrl || !provider.apiKey || !model) {
    throw new Error(
      `Custom provider '${provider.name}' requires baseUrl, apiKey and at least one model`
    );
  }

  const baseUrl = provider.baseUrl.replace(/\/$/, "");
  const path = provider.path.startsWith("/") ? provider.path : `/${provider.path}`;
  const url = `${baseUrl}${path}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: toOpenAIMessagesWithMemory(history, settings, memoryContext),
      temperature: 0.2
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Custom provider request failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
      prompt_tokens_details?: { cached_tokens?: number };
      completion_tokens_details?: { reasoning_tokens?: number };
    };
  };

  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new Error("Custom provider returned empty content");
  }

  return {
    text,
    provider: provider.id,
    model,
    api: "openai-completions",
    usage: {
      input: data.usage?.prompt_tokens ?? 0,
      output: data.usage?.completion_tokens ?? 0,
      cacheRead: data.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      cacheWrite: 0,
      totalTokens: data.usage?.total_tokens ?? 0
    }
  };
}

function pickDefaultCustomProvider(settings: RuntimeSettings): CustomProviderConfig | null {
  if (settings.customProviders.length === 0) return null;
  const selected = settings.customProviders.find((p) => p.id === settings.defaultCustomProviderId);
  return selected ?? settings.customProviders[0] ?? null;
}

async function callPiMono(
  history: ConversationMessage[],
  input: string,
  settings: RuntimeSettings,
  memoryContext: string
): Promise<ProviderReply> {
  const models = getModels(settings.piModelProvider);
  const model = models.find((m) => m.id === settings.piModelName) ?? models[0];
  if (!model) {
    throw new Error(`No models available for provider '${settings.piModelProvider}'`);
  }

  const agent = new Agent({
    initialState: {
      systemPrompt: settings.systemPrompt,
      model
    }
  });

  let streamed = "";
  agent.subscribe((event: unknown) => {
    if (!event || typeof event !== "object") return;
    const obj = event as Record<string, unknown>;
    if (obj.type !== "message_update") return;

    const maybeAssistant = obj.assistantMessageEvent;
    if (!maybeAssistant || typeof maybeAssistant !== "object") return;
    const delta = (maybeAssistant as { delta?: unknown }).delta;
    if (typeof delta === "string") streamed += delta;
  });

  const transcript = stringifyHistory(history);
  const prompt = [
    memoryContext.trim() ? `Relevant memory:\n${memoryContext.trim()}\n` : "",
    "Conversation history:",
    transcript || "(empty)",
    "",
    "Latest user message:",
    input
  ].join("\n");

  const result = await agent.prompt(prompt);
  const stateMessages = agent.state.messages as Array<{
    role?: string;
    api?: string;
    provider?: string;
    model?: string;
    usage?: {
      input?: number;
      output?: number;
      cacheRead?: number;
      cacheWrite?: number;
      totalTokens?: number;
    };
    content?: Array<{ type?: string; text?: string }>;
  }>;
  const lastAssistant = [...stateMessages].reverse().find((msg) => msg.role === "assistant");

  const direct = extractText(result);
  if (direct && direct.trim().length > 0) {
    return {
      text: direct.trim(),
      provider: lastAssistant?.provider ?? model.provider,
      model: lastAssistant?.model ?? model.id,
      api: lastAssistant?.api ?? model.api,
      usage: lastAssistant?.usage
    };
  }

  if (streamed.trim().length > 0) {
    return {
      text: streamed.trim(),
      provider: lastAssistant?.provider ?? model.provider,
      model: lastAssistant?.model ?? model.id,
      api: lastAssistant?.api ?? model.api,
      usage: lastAssistant?.usage
    };
  }

  throw new Error("pi-mono returned empty assistant response");
}

export class AssistantService {
  constructor(
    private readonly getSettings: () => RuntimeSettings,
    private readonly usageTracker?: AiUsageTracker
  ) {}

  async reply(history: ConversationMessage[], input: string, memoryContext = ""): Promise<string> {
    const settings = this.getSettings();
    let reply: ProviderReply;
    if (settings.providerMode === "custom") {
      reply = await callCustomProvider(history, settings, memoryContext);
    } else {
      reply = await callPiMono(history, input, settings, memoryContext);
    }

    if (this.usageTracker && reply.usage) {
      this.usageTracker.record({
        channel: "web",
        provider: reply.provider,
        model: reply.model,
        api: reply.api,
        inputTokens: reply.usage.input,
        outputTokens: reply.usage.output,
        cacheReadTokens: reply.usage.cacheRead,
        cacheWriteTokens: reply.usage.cacheWrite,
        totalTokens: reply.usage.totalTokens
      });
    }

    return reply.text;
  }
}
