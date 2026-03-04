import type { KnownProvider } from "@mariozechner/pi-ai";
import {
  type AgentSettings,
  isKnownProvider,
  type ChannelInstanceSettings,
  type CustomProviderConfig,
  type FeishuBotConfig,
  type ProviderMode,
  type RuntimeSettings,
  type TelegramBotConfig
} from "./schema.js";

function listFromEnv(name: string): string[] {
  const raw = process.env[name] ?? "";
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function providerFromEnv(name: string, fallback: KnownProvider): KnownProvider {
  const raw = (process.env[name] ?? "").trim();
  if (!raw) return fallback;
  if (isKnownProvider(raw)) return raw;
  console.warn(`[config] Unknown provider '${raw}' in ${name}; fallback to '${fallback}'.`);
  return fallback;
}

function mapTelegramBotsToChannelSettings(bots: TelegramBotConfig[]): ChannelInstanceSettings[] {
  return bots.map((bot) => ({
    id: bot.id,
    name: bot.name,
    enabled: true,
    agentId: "",
    credentials: {
      token: bot.token
    },
    allowedChatIds: bot.allowedChatIds
  }));
}

function mapFeishuBotsToChannelSettings(bots: FeishuBotConfig[]): ChannelInstanceSettings[] {
  return bots.map((bot) => ({
    id: bot.id,
    name: bot.name,
    enabled: true,
    agentId: "",
    credentials: {
      appId: bot.appId,
      appSecret: bot.appSecret
    },
    allowedChatIds: bot.allowedChatIds
  }));
}

const modeRaw = (process.env.AI_PROVIDER_MODE ?? "pi").toLowerCase();
const providerMode: ProviderMode = modeRaw === "custom" ? "custom" : "pi";

const envCustomProvider: CustomProviderConfig = {
  id: "custom-env",
  name: "Custom (env)",
  enabled: true,
  baseUrl: process.env.CUSTOM_AI_BASE_URL ?? "",
  apiKey: process.env.CUSTOM_AI_API_KEY ?? "",
  models: (process.env.CUSTOM_AI_MODEL ?? "").trim()
    ? [{
      id: String(process.env.CUSTOM_AI_MODEL).trim(),
      tags: ["text", "vision", "stt", "tts"],
      supportedRoles: ["system", "user", "assistant", "tool", "developer"]
    }]
    : [],
  defaultModel: process.env.CUSTOM_AI_MODEL ?? "",
  path: process.env.CUSTOM_AI_PATH ?? "/v1/chat/completions"
};

const defaultCustomProviders =
  envCustomProvider.baseUrl || envCustomProvider.apiKey || envCustomProvider.models.length > 0
    ? [envCustomProvider]
    : [];

const defaultTelegramBotToken = (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
const defaultTelegramAllowedChatIds = listFromEnv("TELEGRAM_ALLOWED_CHAT_IDS");
const defaultTelegramBots: TelegramBotConfig[] = defaultTelegramBotToken
  ? [{
    id: "default",
    name: "Default Bot",
    token: defaultTelegramBotToken,
    allowedChatIds: defaultTelegramAllowedChatIds
  }]
  : [];

const defaultFeishuAppId = (process.env.FEISHU_APP_ID ?? "").trim();
const defaultFeishuAppSecret = (process.env.FEISHU_APP_SECRET ?? "").trim();
const defaultFeishuAllowedChatIds = listFromEnv("FEISHU_ALLOWED_CHAT_IDS");
const defaultFeishuBots: FeishuBotConfig[] = defaultFeishuAppId && defaultFeishuAppSecret
  ? [{
    id: "default",
    name: "Default Feishu Bot",
    appId: defaultFeishuAppId,
    appSecret: defaultFeishuAppSecret,
    allowedChatIds: defaultFeishuAllowedChatIds
  }]
  : [];

const defaultAgents: AgentSettings[] = [];

export const defaultRuntimeSettings: RuntimeSettings = {
  providerMode,
  piModelProvider: providerFromEnv("PI_MODEL_PROVIDER", "anthropic"),
  piModelName: process.env.PI_MODEL_NAME ?? "claude-sonnet-4-20250514",
  customProviders: defaultCustomProviders,
  defaultCustomProviderId: defaultCustomProviders[0]?.id ?? "",
  modelRouting: {
    textModelKey: "",
    visionModelKey: "",
    sttModelKey: "",
    ttsModelKey: ""
  },
  systemPrompt:
    process.env.MOLIBOT_SYSTEM_PROMPT ??
    "You are Molibot, a concise and helpful assistant.",
  timezone:
    (process.env.MOLIBOT_TIMEZONE ?? Intl.DateTimeFormat().resolvedOptions().timeZone).trim() ||
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  agents: defaultAgents,
  channels: {
    telegram: {
      instances: mapTelegramBotsToChannelSettings(defaultTelegramBots)
    },
    feishu: {
      instances: mapFeishuBotsToChannelSettings(defaultFeishuBots)
    }
  },
  telegramBots: defaultTelegramBots,
  plugins: {
    memory: {
      enabled: String(process.env.MEMORY_ENABLED ?? "false").toLowerCase() === "true",
      backend: (process.env.MEMORY_BACKEND ?? process.env.MEMORY_CORE ?? "json-file").trim() || "json-file"
    }
  },
  telegramBotToken: defaultTelegramBotToken,
  telegramAllowedChatIds: defaultTelegramAllowedChatIds,
  feishuBots: defaultFeishuBots
};
