import path from "node:path";
import dotenv from "dotenv";
import type { KnownProvider } from "@mariozechner/pi-ai";

dotenv.config();

export type ProviderMode = "pi" | "custom";

export type ModelRole = "system" | "user" | "assistant" | "tool" | "developer";

export interface CustomProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  defaultModel: string;
  supportedRoles: ModelRole[];
  path: string;
}

export interface RuntimeSettings {
  providerMode: ProviderMode;
  piModelProvider: KnownProvider;
  piModelName: string;
  customProviders: CustomProviderConfig[];
  defaultCustomProviderId: string;
  systemPrompt: string;
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

export const config = {
  port: intFromEnv("PORT", 3000),
  dataDir: process.env.DATA_DIR ?? path.join(".", "data"),
  settingsFile: process.env.SETTINGS_FILE ?? path.join(".", "data", "settings.json"),
  sessionsDir: process.env.SESSIONS_DIR ?? path.join(".", "data", "sessions"),
  sessionsIndexFile: process.env.SESSIONS_INDEX_FILE ?? path.join(".", "data", "sessions", "index.json"),
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
  models: (process.env.CUSTOM_AI_MODEL ?? "").trim() ? [String(process.env.CUSTOM_AI_MODEL).trim()] : [],
  defaultModel: process.env.CUSTOM_AI_MODEL ?? "",
  supportedRoles: ["system", "user", "assistant", "tool", "developer"],
  path: process.env.CUSTOM_AI_PATH ?? "/v1/chat/completions"
};

const defaultCustomProviders =
  envCustomProvider.baseUrl || envCustomProvider.apiKey || envCustomProvider.models.length > 0
    ? [envCustomProvider]
    : [];

export const defaultRuntimeSettings: RuntimeSettings = {
  providerMode,
  piModelProvider: providerFromEnv("PI_MODEL_PROVIDER", "anthropic"),
  piModelName: process.env.PI_MODEL_NAME ?? "claude-sonnet-4-20250514",
  customProviders: defaultCustomProviders,
  defaultCustomProviderId: defaultCustomProviders[0]?.id ?? "",
  systemPrompt:
    process.env.MOLIBOT_SYSTEM_PROMPT ??
    "You are Molibot, a concise and helpful assistant.",
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  telegramAllowedChatIds: listFromEnv("TELEGRAM_ALLOWED_CHAT_IDS")
};
