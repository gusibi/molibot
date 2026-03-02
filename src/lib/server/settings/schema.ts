import type { KnownProvider } from "@mariozechner/pi-ai";

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

export function isKnownProvider(value: string): value is KnownProvider {
  return KNOWN_PROVIDERS.has(value as KnownProvider);
}
