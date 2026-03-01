import path from "node:path";
import os from "node:os";
import dotenv from "dotenv";
import type { KnownProvider } from "@mariozechner/pi-ai";

dotenv.config();

export type ProviderMode = "pi" | "custom";

export type ModelRole = "system" | "user" | "assistant" | "tool" | "developer";
export type ModelCapabilityTag = "text" | "vision" | "stt" | "tts" | "tool";

export interface ProviderModelConfig {
  id: string;
  tags: ModelCapabilityTag[];
  supportedRoles: ModelRole[];
}

export interface ModelRoutingConfig {
  textModelKey: string;
  visionModelKey: string;
  sttModelKey: string;
  ttsModelKey: string;
}

export interface CustomProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: ProviderModelConfig[];
  defaultModel: string;
  path: string;
}

export interface TelegramBotConfig {
  id: string;
  name: string;
  token: string;
  allowedChatIds: string[];
}

export interface FeishuBotConfig {
  id: string;
  name: string;
  appId: string;
  appSecret: string;
  allowedChatIds: string[];
}

export interface ChannelInstanceSettings {
  id: string;
  name: string;
  enabled: boolean;
  credentials: Record<string, string>;
  allowedChatIds: string[];
}

export interface ChannelPluginSettings {
  instances: ChannelInstanceSettings[];
}

export type ChannelSettingsMap = Record<string, ChannelPluginSettings>;

export interface MemoryBackendSettings {
  enabled: boolean;
  backend: string;
}

export interface PluginSettings {
  memory: MemoryBackendSettings;
}

export interface RuntimeSettings {
  providerMode: ProviderMode;
  piModelProvider: KnownProvider;
  piModelName: string;
  customProviders: CustomProviderConfig[];
  defaultCustomProviderId: string;
  modelRouting: ModelRoutingConfig;
  systemPrompt: string;
  timezone: string;
  channels: ChannelSettingsMap;
  telegramBots: TelegramBotConfig[];
  feishuBots: FeishuBotConfig[];
  plugins: PluginSettings;
  // Legacy single-bot fields kept for backward compatibility with old settings files/API payloads.
  telegramBotToken: string;
  telegramAllowedChatIds: string[];
}

export const KNOWN_PROVIDER_LIST: KnownProvider[] = [
  "amazon-bedrock",
  "anthropic",
  "google",
  "google-gemini-cli",
  "google-antigravity",
  "google-vertex",
  "openai",
  "azure-openai-responses",
  "openai-codex",
  "github-copilot",
  "xai",
  "groq",
  "cerebras",
  "openrouter",
  "vercel-ai-gateway",
  "zai",
  "mistral",
  "minimax",
  "minimax-cn",
  "huggingface",
  "opencode",
  "kimi-coding"
];

const KNOWN_PROVIDERS: ReadonlySet<KnownProvider> = new Set(KNOWN_PROVIDER_LIST);

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number.parseInt(raw, 10) : fallback;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function listFromEnv(name: string): string[] {
  const raw = process.env[name] ?? "";
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function providerFromEnv(name: string, fallback: KnownProvider): KnownProvider {
  const raw = (process.env[name] ?? "").trim();
  if (!raw) {
    return fallback;
  }

  if (KNOWN_PROVIDERS.has(raw as KnownProvider)) {
    return raw as KnownProvider;
  }

  console.warn(`[config] Unknown provider '${raw}' in ${name}; fallback to '${fallback}'.`);
  return fallback;
}

export function isKnownProvider(value: string): value is KnownProvider {
  return KNOWN_PROVIDERS.has(value as KnownProvider);
}

function expandHomePath(input: string): string {
  if (!input.startsWith("~")) return input;
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  return input;
}

const defaultDataDir = path.join(os.homedir(), ".molibot");
const resolvedDataDir = expandHomePath(process.env.DATA_DIR ?? defaultDataDir);

export const config = {
  port: intFromEnv("PORT", 3000),
  dataDir: resolvedDataDir,
  settingsFile: expandHomePath(process.env.SETTINGS_FILE ?? path.join(resolvedDataDir, "settings.json")),
  sessionsDir: expandHomePath(process.env.SESSIONS_DIR ?? path.join(resolvedDataDir, "sessions")),
  sessionsIndexFile: expandHomePath(
    process.env.SESSIONS_INDEX_FILE ?? path.join(resolvedDataDir, "sessions", "index.json")
  ),
  telegramSttBaseUrl:
    (process.env.TELEGRAM_STT_BASE_URL ??
      process.env.CUSTOM_AI_BASE_URL ??
      "https://api.openai.com/v1").trim(),
  telegramSttApiKey:
    (process.env.TELEGRAM_STT_API_KEY ??
      process.env.OPENAI_API_KEY ??
      process.env.CUSTOM_AI_API_KEY ??
      "").trim(),
  telegramSttModel: (process.env.TELEGRAM_STT_MODEL ?? "whisper-1").trim(),
  telegramSttLanguage: (process.env.TELEGRAM_STT_LANGUAGE ?? "").trim(),
  telegramSttPrompt: (process.env.TELEGRAM_STT_PROMPT ?? "").trim(),
  rateLimitPerMinute: intFromEnv("RATE_LIMIT_PER_MINUTE", 30),
  maxMessageChars: intFromEnv("MAX_MESSAGE_CHARS", 4000)
};

const modeRaw = (process.env.AI_PROVIDER_MODE ?? "pi").toLowerCase();
const providerMode: ProviderMode = modeRaw === "custom" ? "custom" : "pi";

const envCustomProvider: CustomProviderConfig = {
  id: "custom-env",
  name: "Custom (env)",
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

function mapTelegramBotsToChannelSettings(bots: TelegramBotConfig[]): ChannelInstanceSettings[] {
  return bots.map((bot) => ({
    id: bot.id,
    name: bot.name,
    enabled: true,
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
    credentials: {
      appId: bot.appId,
      appSecret: bot.appSecret
    },
    allowedChatIds: bot.allowedChatIds
  }));
}

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
  timezone: (process.env.MOLIBOT_TIMEZONE ?? Intl.DateTimeFormat().resolvedOptions().timeZone).trim() || Intl.DateTimeFormat().resolvedOptions().timeZone,
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
