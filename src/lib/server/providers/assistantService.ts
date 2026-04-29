import { Agent } from "@mariozechner/pi-agent-core";
import { getModels } from "@mariozechner/pi-ai";
import { isKnownProvider, type CustomProviderConfig, type RuntimeSettings } from "../settings/index.js";
import type { ConversationMessage } from "../../shared/types/message.js";
import type { AiUsageTracker } from "../usage/tracker.js";
import type { ModelErrorTracker } from "../usage/modelErrorTracker.js";
import {
  DEFAULT_AGENT_MAX_RETRY_DELAY_MS,
  resolvePreferredTransport
} from "../agent/runtimeOptions.js";
import {
  callDirectCustomProvider
} from "./customProtocol.js";

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

interface ProviderAttemptFailure {
  provider: string;
  providerName: string;
  model: string;
  status?: number;
  message: string;
  baseUrl?: string;
}

function redactBaseUrl(baseUrl: string): string {
  if (!baseUrl) return baseUrl;
  return baseUrl.replace(/\/\/([^/@]+)@/, "//***@");
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

function getProviderModel(provider: CustomProviderConfig): string {
  const modelIds = provider.models
    .filter((m) => Array.isArray(m.tags) ? m.tags.includes("text") : true)
    .map((m) => m.id)
    .filter(Boolean);
  const selected = provider.defaultModel?.trim();
  if (selected && modelIds.includes(selected)) return selected;
  return modelIds[0]?.trim() || "";
}

function buildProviderFailure(
  provider: CustomProviderConfig,
  model: string,
  message: string,
  status?: number
): ProviderAttemptFailure {
  return {
    provider: provider.id,
    providerName: provider.name || provider.id,
    model,
    status,
    message,
    baseUrl: provider.baseUrl?.trim() || undefined
  };
}

function formatProviderFailure(failure: ProviderAttemptFailure): string {
  const parts = [
    `provider=${failure.providerName} (${failure.provider})`,
    `model=${failure.model}`,
    failure.status ? `status=${failure.status}` : null,
    failure.baseUrl ? `baseUrl=${failure.baseUrl}` : null,
    `error=${failure.message}`
  ].filter(Boolean);
  return parts.join(", ");
}

function buildCustomProviderCandidates(settings: RuntimeSettings): CustomProviderConfig[] {
  const enabled = settings.customProviders.filter((provider) =>
    provider.enabled !== false &&
    !isKnownProvider(provider.id) &&
    provider.models.some((model) => Array.isArray(model.tags) ? model.tags.includes("text") : true)
  );
  const selected = enabled.find((provider) => provider.id === settings.defaultCustomProviderId);
  const primary = selected ?? enabled[0];
  if (!primary) return [];

  return [
    primary,
    ...enabled.filter((provider) => provider.id !== primary.id),
  ];
}

async function callCustomProviderTarget(
  provider: CustomProviderConfig,
  history: ConversationMessage[],
  settings: RuntimeSettings,
  memoryContext: string
): Promise<ProviderReply> {
  const model = getProviderModel(provider);
  if (!provider.baseUrl || !provider.apiKey || !model) {
    const message = `Custom provider '${provider.name}' requires baseUrl, apiKey and at least one model`;
    throw Object.assign(new Error(message), {
      providerFailure: buildProviderFailure(provider, model || "(missing)", message)
    });
  }

  try {
    return await callDirectCustomProvider(provider, model, history, settings, memoryContext);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw Object.assign(new Error(message), {
      providerFailure: buildProviderFailure(
        provider,
        model,
        message,
        typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : undefined
      )
    });
  }
}

async function callCustomProvider(
  history: ConversationMessage[],
  settings: RuntimeSettings,
  memoryContext: string
): Promise<ProviderReply> {
  const providers = buildCustomProviderCandidates(settings);
  if (providers.length === 0) {
    throw new Error("No custom provider configured");
  }

  const failures: ProviderAttemptFailure[] = [];
  for (const provider of providers) {
    try {
      return await callCustomProviderTarget(provider, history, settings, memoryContext);
    } catch (error) {
      const failure = (error as { providerFailure?: ProviderAttemptFailure }).providerFailure;
      failures.push(
        failure ??
          buildProviderFailure(
            provider,
            getProviderModel(provider) || "(unknown)",
            error instanceof Error ? error.message : String(error)
          )
      );
    }
  }

  throw new Error(
    `All custom provider attempts failed. ${failures.map(formatProviderFailure).join(" | ")}`
  );
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
    },
    transport: resolvePreferredTransport(model),
    maxRetryDelayMs: DEFAULT_AGENT_MAX_RETRY_DELAY_MS
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
    private readonly usageTracker?: AiUsageTracker,
    private readonly modelErrorTracker?: ModelErrorTracker
  ) {}

  async reply(history: ConversationMessage[], input: string, memoryContext = ""): Promise<string> {
    const settings = this.getSettings();
    let reply: ProviderReply;
    try {
      if (settings.providerMode === "custom") {
        reply = await callCustomProvider(history, settings, memoryContext);
      } else {
        reply = await callPiMono(history, input, settings, memoryContext);
      }
    } catch (error) {
      const failure = (error as { providerFailure?: ProviderAttemptFailure }).providerFailure;
      this.modelErrorTracker?.record({
        source: "assistant",
        channel: "web",
        botId: "web",
        chatId: "web",
        provider: failure?.provider ?? (settings.providerMode === "custom" ? "custom" : settings.piModelProvider),
        model: failure?.model ?? (settings.providerMode === "custom" ? "(unknown)" : settings.piModelName),
        api: settings.providerMode === "custom" ? "openai-completions" : "pi-mono",
        route: "text",
        kind: "request_error",
        message: error instanceof Error ? error.message : String(error),
        baseUrl: failure?.baseUrl ? redactBaseUrl(failure.baseUrl) : undefined,
        recovered: false,
        fallbackUsed: false
      });
      throw error;
    }

    if (this.usageTracker && reply.usage) {
      this.usageTracker.record({
        channel: "web",
        botId: "web",
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
