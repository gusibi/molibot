import { Agent } from "@mariozechner/pi-agent-core";
import { getModels } from "@mariozechner/pi-ai";
import type { CustomProviderConfig, RuntimeSettings } from "../config.js";
import type { ConversationMessage } from "../types/message.js";

type OpenAIRole = "system" | "user" | "assistant";

interface OpenAIMessage {
  role: OpenAIRole;
  content: string;
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
  const messages: OpenAIMessage[] = [
    {
      role: "system",
      content: settings.systemPrompt
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
  const selected = provider.defaultModel?.trim();
  if (selected && provider.models.includes(selected)) return selected;
  return provider.models[0]?.trim() || "";
}

async function callCustomProvider(
  history: ConversationMessage[],
  settings: RuntimeSettings
): Promise<string> {
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
      messages: toOpenAIMessages(history, settings),
      temperature: 0.2
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Custom provider request failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new Error("Custom provider returned empty content");
  }

  return text;
}

function pickDefaultCustomProvider(settings: RuntimeSettings): CustomProviderConfig | null {
  if (settings.customProviders.length === 0) return null;
  const selected = settings.customProviders.find((p) => p.id === settings.defaultCustomProviderId);
  return selected ?? settings.customProviders[0] ?? null;
}

async function callPiMono(
  history: ConversationMessage[],
  input: string,
  settings: RuntimeSettings
): Promise<string> {
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
    "Conversation history:",
    transcript || "(empty)",
    "",
    "Latest user message:",
    input
  ].join("\n");

  const result = await agent.prompt(prompt);

  const direct = extractText(result);
  if (direct && direct.trim().length > 0) {
    return direct.trim();
  }

  if (streamed.trim().length > 0) {
    return streamed.trim();
  }

  throw new Error("pi-mono returned empty assistant response");
}

export class AssistantService {
  constructor(private readonly getSettings: () => RuntimeSettings) {}

  async reply(history: ConversationMessage[], input: string): Promise<string> {
    const settings = this.getSettings();
    if (settings.providerMode === "custom") {
      return callCustomProvider(history, settings);
    }

    return callPiMono(history, input, settings);
  }
}
