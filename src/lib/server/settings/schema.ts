import type { KnownProvider } from "@mariozechner/pi-ai";
import type {
  CustomProviderThinkingFormat,
  ReasoningEffortMap,
  RuntimeThinkingLevel
} from "$lib/server/settings/thinking.js";

export type ProviderMode = "pi" | "custom";
export type CustomProviderProtocol = "openai-compatible" | "anthropic";

export type ModelRole = "system" | "user" | "assistant" | "tool" | "developer";
export type ModelCapabilityTag = "text" | "vision" | "audio_input" | "stt" | "tts" | "tool";
export type ModelCapabilityVerification = "untested" | "passed" | "failed";

export interface ProviderModelConfig {
  id: string;
  tags: ModelCapabilityTag[];
  supportedRoles: ModelRole[];
  contextWindow?: number;
  enabled: boolean;
  verification?: Partial<Record<ModelCapabilityTag, ModelCapabilityVerification>>;
}

export interface ModelRoutingConfig {
  textModelKey: string;
  visionModelKey: string;
  sttModelKey: string;
  ttsModelKey: string;
  /**
   * Dedicated model for session context compaction (summarization). Empty means
   * reuse the primary text model. Lets a cheaper/faster model do summaries while
   * the conversation runs on a stronger text model.
   */
  compactionModelKey: string;
  subagentModelKey: string;
  subagentHaikuModelKey: string;
  subagentSonnetModelKey: string;
  subagentOpusModelKey: string;
  subagentThinkingModelKey: string;
}

export interface CompactionSettings {
  enabled: boolean;
  thresholdPercent: number;
  reserveTokens: number;
  keepRecentTokens: number;
  defaultContextWindow: number;
}

export type ModelFallbackMode = "off" | "same-provider" | "any-enabled";

export interface ModelFallbackSettings {
  mode: ModelFallbackMode;
  /**
   * Maximum time (ms) to wait for the FIRST streamed token from a model before
   * giving up on it and falling back to the next candidate. Guards against an
   * upstream that accepts the request but never starts responding. 0 disables
   * the guard. Only the first token is bounded — a model that has started
   * responding is never interrupted.
   */
  firstTokenTimeoutMs: number;
}

export interface CustomProviderConfig {
  id: string;
  name: string;
  enabled: boolean;
  protocol?: CustomProviderProtocol;
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

/**
 * Per-agent model overrides. Only the text/vision/stt routes can be overridden;
 * every other route (tts, compaction, subagent levels) always follows the global
 * `modelRouting`. An empty/absent key means "follow global" for that route.
 */
export interface AgentModelRouting {
  textModelKey?: string;
  visionModelKey?: string;
  sttModelKey?: string;
}

export const AGENT_MODEL_ROUTING_KEYS = [
  "textModelKey",
  "visionModelKey",
  "sttModelKey"
] as const;

/**
 * Trim and keep only the supported override keys. Returns `undefined` when no
 * non-empty override remains so the agent transparently follows global routing.
 */
export function sanitizeAgentModelRouting(input: unknown): AgentModelRouting | undefined {
  if (!input || typeof input !== "object") return undefined;
  const obj = input as Record<string, unknown>;
  const out: AgentModelRouting = {};
  for (const key of AGENT_MODEL_ROUTING_KEYS) {
    const value = String(obj[key] ?? "").trim();
    if (value) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export interface AgentSettings {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  sandboxEnabled?: boolean;
  modelRouting?: AgentModelRouting;
}

export const DEFAULT_AGENT_ID = "default";

export function defaultAgentSettings(): AgentSettings {
  return {
    id: DEFAULT_AGENT_ID,
    name: "Default",
    description: "Default assistant used by Web and new channel profiles.",
    enabled: true
  };
}

export interface ChannelInstanceDisplaySettings {
  toolProgress?: "off" | "new" | "all" | "verbose";
  showReasoning?: "off" | "on" | "stream" | "new";
  gatewayNotifyInterval?: number;
  runLogNotice?: boolean;
}

export interface ChannelInstanceSettings {
  id: string;
  name: string;
  enabled: boolean;
  agentId?: string;
  credentials: Record<string, string>;
  allowedChatIds: string[];
  sandboxEnabled?: boolean;
  display?: ChannelInstanceDisplaySettings;
}

export interface ChannelPluginSettings {
  instances: ChannelInstanceSettings[];
}

export type ChannelSettingsMap = Record<string, ChannelPluginSettings>;

export interface MemoryBackendSettings {
  enabled: boolean;
  backend: string;
  embeddingProviderId: string;
  embeddingModel: string;
  reflectionTime: string;
  reflectionNotifications: boolean;
  dailyMaterials: {
    enabled: boolean;
    time: string;
    projectId: string;
    dir: string;
    promptPath: string;
    notifications: boolean;
    scanTokenBudget: number;
    // Model key (`pi|provider|model` / `custom|id|model`) for the scan+synthesis
    // calls. Empty = follow the main text model. Lets a cheaper model do the scan.
    scanModelKey: string;
  };
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

export interface HookPluginEntry {
  id: string;
  enabled: boolean;
  options?: Record<string, unknown>;
}

export interface PluginSettings {
  memory: MemoryBackendSettings;
  cloudflareHtml: CloudflareHtmlPluginSettings;
  hooks: HookPluginEntry[];
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
  /**
   * Path to a draft *structure skeleton* SKILL.md. Only its section headings
   * (When To Use / Goal / Suggested Steps / Verification / Pitfalls / Example
   * Outcome) are reused to shape generated drafts — the file's body is never
   * copied into drafts. Do NOT point this at a real skill (e.g. skill-creator);
   * if no heading matches a standard section the template is ignored and a
   * built-in default skeleton is used. Empty string disables auto draft generation.
   */
  skillPath: string;
}

export interface SkillDraftSettings {
  autoSave: SkillDraftAutoSaveSettings;
  template: SkillDraftTemplateSettings;
}

export type WebSearchEngineId =
  | "duckduckgo"
  | "brave"
  | "tavily"
  | "exa"
  | "serper"
  | "baidu"
  | "baidu_fast"
  | "baidu_web"
  | "ark"
  | "grok"
  | "bocha";

export type WebSearchRoute = "auto" | "china" | "global" | "official_docs" | "research";
export type WebSearchEngineSelectionStrategy = "priority" | "random" | "round_robin";

export interface WebSearchEngineSettings {
  enabled: boolean;
  apiKey: string;
  baseUrl?: string;
}

export interface WebSearchSettings {
  enabled: boolean;
  defaultRoute: WebSearchRoute;
  defaultEngine: WebSearchEngineId | "auto";
  engineSelectionStrategy: WebSearchEngineSelectionStrategy;
  maxResults: number;
  timeoutMs: number;
  retryTimeoutMs: number;
  engines: Record<WebSearchEngineId, WebSearchEngineSettings>;
}

export type ImageGenerateEngineId = "agnes" | "openai" | "openai-chat" | "modelscope" | "google" | "volcengine";

export interface ImageGenerateEngineSettings {
  enabled: boolean;
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

export interface ImageGenerateSettings {
  enabled: boolean;
  defaultEngine: ImageGenerateEngineId | "auto";
  engines: Record<ImageGenerateEngineId, ImageGenerateEngineSettings>;
}

export type VideoGenerateEngineId = "agnes" | "volcengine";

export interface VideoGenerateEngineSettings {
  enabled: boolean;
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

export interface VideoGenerateSettings {
  enabled: boolean;
  defaultEngine: VideoGenerateEngineId | "auto";
  engines: Record<VideoGenerateEngineId, VideoGenerateEngineSettings>;
}

export type TtsGenerateProviderId = "macos" | "xiaomi";

export type TtsGenerateAudioFormat = "wav" | "mp3" | "aiff" | "m4a" | "caf";

export interface TtsGenerateMacosProviderSettings {
  enabled: boolean;
  voice: string;
  format: TtsGenerateAudioFormat;
}

export interface TtsGenerateXiaomiProviderSettings {
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
  model: string;
  voice: string;
  format: TtsGenerateAudioFormat;
}

export interface TtsGenerateProviderSettingsMap {
  macos: TtsGenerateMacosProviderSettings;
  xiaomi: TtsGenerateXiaomiProviderSettings;
}

export interface TtsGenerateSettings {
  enabled: boolean;
  defaultProvider: TtsGenerateProviderId;
  providers: TtsGenerateProviderSettingsMap;
}


export type ToolSandboxInitFailureMode = "warn-disable" | "block";
export type ToolSandboxEnvInheritMode = "minimal" | "allowlist" | "full";

export interface ToolSandboxEnvSettings {
  inheritMode: ToolSandboxEnvInheritMode;
  allow: string[];
  deny: string[];
}

export interface ToolSandboxNetworkSettings {
  allowedDomains: string[];
  deniedDomains: string[];
}

export interface ToolSandboxFilesystemSettings {
  denyRead: string[];
  allowWrite: string[];
  denyWrite: string[];
}

export interface ToolSandboxSettings {
  enabled: boolean;
  initFailureMode: ToolSandboxInitFailureMode;
  envFilePath: string;
  env: ToolSandboxEnvSettings;
  network: ToolSandboxNetworkSettings;
  filesystem: ToolSandboxFilesystemSettings;
}

export type HostToolApprovalStatus = "pending" | "approved" | "rejected";
export type HostToolApprovalMode = "persistent" | "ephemeral";
export type HostToolNetworkAccess = "none" | "loopback" | "internet";
export type HostToolFilesystemAccess = "none" | "scratch-only" | "workspace-read" | "workspace-write";

export interface HostToolPermissions {
  envAllowlist: string[];
  filesystem: HostToolFilesystemAccess;
  network: HostToolNetworkAccess;
}

export interface HostToolPendingAction {
  kind: "run_approved_host_tool" | "run_one_time_host_script";
  originalCommand: string;
  args?: string[];
  stdin?: string;
  timeout?: number;
}

export interface HostToolApprovalRequest {
  id: string;
  toolId: string;
  displayName: string;
  command: string;
  reason: string;
  permissions: HostToolPermissions;
  channel: string;
  chatId: string;
  scopeId: string;
  requestedAt: string;
  approvalMode: HostToolApprovalMode;
  status: HostToolApprovalStatus;
  resolvedAt?: string;
  pendingAction?: HostToolPendingAction;
}

export interface ApprovedHostTool {
  toolId: string;
  displayName: string;
  command: string;
  reason: string;
  permissions: HostToolPermissions;
  approvedAt: string;
  approvedFromRequestId: string;
  channel: string;
  chatId: string;
  scopeId: string;
  enabled: boolean;
}

export interface HostToolSettings {
  pendingApprovals: HostToolApprovalRequest[];
  approvalHistory: HostToolApprovalRequest[];
  approvedTools: ApprovedHostTool[];
}

export interface BrowserAutomationSettings {
  /** Playwright navigation/action default timeout in ms */
  defaultTimeoutMs: number;
}

export interface EventExecutionSettings {
  executionTimeoutMs: number;
  maxAttempts: number;
  retryDelayMs: number;
  /** Days to keep fresh task sessions before pruning; 0 disables cleanup. */
  taskSessionRetentionDays: number;
}

export interface RunBudgetLimits {
  maxToolCalls: number;
  maxToolFailures: number;
  maxModelAttempts: number;
}

export type RuntimeLocale = "zh-CN" | "en-US";

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
  locale: RuntimeLocale;
  serverPort: number;
  timezone: string;
  agents: AgentSettings[];
  channels: ChannelSettingsMap;
  mcpServers: McpServerConfig[];
  skillSearch: SkillSearchSettings;
  skillDrafts: SkillDraftSettings;
  webSearch: WebSearchSettings;
  imageGenerate: ImageGenerateSettings;
  videoGenerate: VideoGenerateSettings;
  ttsGenerate: TtsGenerateSettings;
  toolSandbox: ToolSandboxSettings;
  hostTools: HostToolSettings;
  disabledSkillPaths: string[];
  telegramBots: TelegramBotConfig[];
  feishuBots: FeishuBotConfig[];
  qqBots: QQBotConfig[];
  plugins: PluginSettings;
  telegramBotToken: string;
  telegramAllowedChatIds: string[];
  budget: RunBudgetLimits;
  events: EventExecutionSettings;
  browserAutomation: BrowserAutomationSettings;
  display?: GlobalDisplaySettings;
}

export interface GlobalDisplaySettings {
  toolProgress: "off" | "new" | "all" | "verbose";
  showReasoning: "off" | "on" | "stream" | "new";
  gatewayNotifyInterval: number;
  runLogNotice: boolean;
}

export const KNOWN_PROVIDER_LIST: KnownProvider[] = [
  "amazon-bedrock",
  "anthropic",
  "google",
  "google-gemini-cli" as KnownProvider,
  "google-antigravity" as KnownProvider,
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
