import type { KnownProvider } from "@mariozechner/pi-ai";
import type {
  CustomProviderThinkingFormat,
  ReasoningEffortMap,
  RuntimeThinkingLevel
} from "./thinking.js";

export type ProviderMode = "pi" | "custom";

export type ModelRole = "system" | "user" | "assistant" | "tool" | "developer";
export type ModelCapabilityTag = "text" | "vision" | "audio_input" | "stt" | "tts" | "tool";
export type ModelCapabilityVerification = "untested" | "passed" | "failed";

export interface ProviderModelConfig {
  id: string;
  tags: ModelCapabilityTag[];
  supportedRoles: ModelRole[];
  verification?: Partial<Record<ModelCapabilityTag, ModelCapabilityVerification>>;
}

export interface ModelRoutingConfig {
  textModelKey: string;
  visionModelKey: string;
  sttModelKey: string;
  ttsModelKey: string;
}

export interface CompactionSettings {
  enabled: boolean;
  reserveTokens: number;
  keepRecentTokens: number;
}

export type ModelFallbackMode = "off" | "same-provider" | "any-enabled";

export interface ModelFallbackSettings {
  mode: ModelFallbackMode;
}

export interface CustomProviderConfig {
  id: string;
  name: string;
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  models: ProviderModelConfig[];
  defaultModel: string;
  path: string;
  supportsThinking?: boolean;
  thinkingFormat?: CustomProviderThinkingFormat;
  reasoningEffortMap?: ReasoningEffortMap;
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
  verificationToken?: string;
  encryptKey?: string;
  allowedChatIds: string[];
}

export interface QQBotConfig {
  id: string;
  name: string;
  appId: string;
  clientSecret: string;
  allowedChatIds: string[];
}

export interface AgentSettings {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
}

export interface ChannelInstanceSettings {
  id: string;
  name: string;
  enabled: boolean;
  agentId?: string;
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

export interface CloudflareHtmlPluginSettings {
  enabled: boolean;
  accessMode: "worker" | "direct";
  workerBaseHost: string;
  publicBaseHost: string;
  routePrefix: string;
  bucketName: string;
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  objectPrefix: string;
}

export interface PluginSettings {
  memory: MemoryBackendSettings;
  cloudflareHtml: CloudflareHtmlPluginSettings;
}

export type AcpApprovalMode = "manual" | "auto-safe" | "auto-all";
export type AcpAdapterKind = "codex" | "claude-code" | "custom";

export interface AcpTargetConfig {
  id: string;
  name: string;
  adapter: AcpAdapterKind;
  enabled: boolean;
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
}

export interface AcpProjectConfig {
  id: string;
  name: string;
  enabled: boolean;
  path: string;
  allowedTargetIds: string[];
  defaultApprovalMode: AcpApprovalMode;
}

export interface AcpSettings {
  enabled: boolean;
  targets: AcpTargetConfig[];
  projects: AcpProjectConfig[];
}

export type McpTransport = "stdio" | "http";

export interface McpStdioConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
}

export interface McpHttpConfig {
  url: string;
  headers: Record<string, string>;
}

export interface McpServerConfig {
  id: string;
  name: string;
  enabled: boolean;
  transport: McpTransport;
  stdio: McpStdioConfig;
  http: McpHttpConfig;
  toolNamePrefix: string;
}

export interface SkillSearchLocalSettings {
  enabled: boolean;
}

export interface SkillSearchApiSettings {
  enabled: boolean;
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  path: string;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
  minConfidence: number;
}

export interface SkillSearchSettings {
  local: SkillSearchLocalSettings;
  api: SkillSearchApiSettings;
}

export interface SkillDraftAutoSaveSettings {
  enabled: boolean;
  minToolCalls: number;
  allowRecoveredToolFailures: boolean;
  allowModelRetries: boolean;
}

export interface SkillDraftTemplateSettings {
  skillPath: string;
}

export interface SkillDraftSettings {
  autoSave: SkillDraftAutoSaveSettings;
  template: SkillDraftTemplateSettings;
}

export interface RuntimeSettings {
  providerMode: ProviderMode;
  piModelProvider: KnownProvider;
  piModelName: string;
  defaultThinkingLevel: RuntimeThinkingLevel;
  customProviders: CustomProviderConfig[];
  defaultCustomProviderId: string;
  modelRouting: ModelRoutingConfig;
  modelFallback: ModelFallbackSettings;
  compaction: CompactionSettings;
  systemPrompt: string;
  timezone: string;
  acp: AcpSettings;
  agents: AgentSettings[];
  channels: ChannelSettingsMap;
  mcpServers: McpServerConfig[];
  skillSearch: SkillSearchSettings;
  skillDrafts: SkillDraftSettings;
  disabledSkillPaths: string[];
  telegramBots: TelegramBotConfig[];
  feishuBots: FeishuBotConfig[];
  qqBots: QQBotConfig[];
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
  "deepseek",
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
