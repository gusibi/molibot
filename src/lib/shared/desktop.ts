export interface DesktopProfileSummary {
  id: string;
  name: string;
  agentId?: string;
  agentName?: string;
}

export interface DesktopBootstrapResponse {
  ok: true;
  profiles: DesktopProfileSummary[];
}

export interface DesktopWebProfile {
  id: string;
  name: string;
  enabled: boolean;
  agentId: string;
  agentName: string;
  sandboxEnabled?: boolean;
}

export interface DesktopWebProfilesResponse {
  ok: true;
  profiles: DesktopWebProfile[];
}

export interface DesktopWebProfilePatch {
  name?: string;
  enabled?: boolean;
  agentId?: string;
}

export interface DesktopWebProfileSaveRequest {
  previousId?: string;
  id: string;
  name: string;
  enabled: boolean;
  agentId: string;
  sandboxEnabled?: boolean;
}

export interface DesktopProfileFilesResponse {
  ok: true;
  fileNames: readonly string[];
  files: Record<string, string>;
}

export interface DesktopWebProfileUpdateResponse {
  ok: true;
  profile: DesktopWebProfile;
}

export interface DesktopUsageTotals {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
}

export type DesktopUsageRange = "today" | "yesterday" | "last7Days" | "last30Days";

export interface DesktopUsageWindow extends DesktopUsageTotals {
  label: DesktopUsageRange;
  startDate: string;
  endDate: string;
}

export interface DesktopUsageDailyPoint extends DesktopUsageTotals {
  date: string;
}

export interface DesktopUsageTrendPoint extends DesktopUsageTotals {
  key: string;
  label: string;
}

export interface DesktopUsageModelRow extends DesktopUsageTotals {
  id: string;
  provider: string;
  model: string;
  api: string;
}

export interface DesktopUsageDimensionRow extends DesktopUsageTotals {
  id: string;
  label: string;
}

export interface DesktopUsageRecord extends DesktopUsageTotals {
  ts: string;
  channel: string;
  botId: string;
  provider: string;
  model: string;
  api: string;
}

export interface DesktopUsageSummary {
  timezone: string;
  generatedAt: string;
  range: DesktopUsageRange;
  window: { startDate: string; endDate: string };
  filters: { modelId: string; botId: string; channel: string };
  options: {
    models: { id: string; label: string }[];
    bots: string[];
    channels: string[];
  };
  totals: DesktopUsageTotals;
  windows: DesktopUsageWindow[];
  daily: DesktopUsageDailyPoint[];
  trend: DesktopUsageTrendPoint[];
  rankings: {
    models: DesktopUsageModelRow[];
    apis: DesktopUsageDimensionRow[];
    bots: DesktopUsageDimensionRow[];
    channels: DesktopUsageDimensionRow[];
  };
  records: { items: DesktopUsageRecord[]; total: number; page: number; pageSize: number };
}

export interface DesktopUsageResponse {
  ok: true;
  summary: DesktopUsageSummary;
}

export type DesktopRunOutcome = "success" | "partial" | "failed";

export interface DesktopRunHistoryItem {
  runId: string;
  createdAt: string;
  botId: string;
  chatId: string;
  stopReason: string;
  durationMs: number;
  toolNames: string[];
  failedToolNames: string[];
  reflectionOutcome: DesktopRunOutcome;
  reflectionSummary: string;
  nextAction: string;
  memorySelectedCount: number;
  usedFallbackModel: boolean;
}

export interface DesktopRunHistoryResponse {
  ok: true;
  items: DesktopRunHistoryItem[];
  counts: {
    total: number;
    success: number;
    partial: number;
    failed: number;
  };
}

export type DesktopTraceRange = "today" | "yesterday" | "last7Days" | "last30Days";
export type DesktopTraceFactType = "all" | "run" | "model_call" | "tool_call" | "skill_usage" | "subagent_task" | "runtime_notice" | "approval" | "input_enrichment";
export type DesktopTraceStatus = "started" | "success" | "error" | "blocked" | "waiting" | "aborted" | "info" | "warning";

export interface DesktopTraceTotals {
  facts: number;
  toolCalls: number;
  executedToolCalls: number;
  modelCalls: number;
  distinctTools: number;
  skillUsages: number;
  executedSkills: number;
  distinctSkills: number;
  bots: number;
  channels: number;
  chats: number;
  sessions: number;
  runs: number;
  failedTools: number;
  blockedTools: number;
  totalTokens: number;
  avgToolDurationMs: number;
  avgModelDurationMs: number;
}

export interface DesktopTraceToolRow {
  name: string;
  calls: number;
  executedCalls: number;
  success: number;
  error: number;
  blocked: number;
  avgDurationMs: number;
}

export interface DesktopTraceSkillRow {
  name: string;
  scope: string;
  calls: number;
  triggered: number;
  loaded: number;
  executed: number;
  runs: number;
  avgDurationMs: number;
  lastAt: string;
}

export interface DesktopTraceModelRow extends DesktopUsageTotals {
  id: string;
  provider: string;
  model: string;
  api: string;
  avgDurationMs: number;
}

export interface DesktopTraceEntityRow {
  id: string;
  label: string;
  secondary: string;
  runs: number;
  toolCalls: number;
  modelCalls: number;
  distinctTools: number;
  totalTokens: number;
  lastAt: string;
}

export interface DesktopTraceFact {
  id: string;
  factType: Exclude<DesktopTraceFactType, "all">;
  runId: string;
  channel: string;
  botId: string;
  chatId: string;
  sessionId: string;
  name: string;
  provider: string;
  model: string;
  api: string;
  status: DesktopTraceStatus;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  updatedAt: string;
}

export interface DesktopTraceSummary {
  timezone: string;
  generatedAt: string;
  range: DesktopTraceRange;
  window: { startDate: string; endDate: string };
  filters: {
    factType: DesktopTraceFactType;
    botId: string;
    channel: string;
    chatId: string;
    sessionId: string;
    runId: string;
    sourceLimit: number;
  };
  options: { bots: string[]; channels: string[] };
  totals: DesktopTraceTotals;
  rankings: {
    tools: DesktopTraceToolRow[];
    skills: DesktopTraceSkillRow[];
    models: DesktopTraceModelRow[];
    bots: DesktopTraceEntityRow[];
    chats: DesktopTraceEntityRow[];
    sessions: DesktopTraceEntityRow[];
    runs: DesktopTraceEntityRow[];
  };
  facts: { items: DesktopTraceFact[]; total: number; page: number; pageSize: number };
}

export interface DesktopTraceResponse {
  ok: true;
  summary: DesktopTraceSummary;
}

export type DesktopAgentActivityStatus = "idle" | "working" | "completed" | "error";

export interface DesktopSubagentActivityItem {
  id: string;
  name: string;
  status: Exclude<DesktopAgentActivityStatus, "idle">;
  startedAt: string;
  finishedAt: string;
}

export interface DesktopAgentActivityItem {
  agentId: string;
  status: DesktopAgentActivityStatus;
  runId: string;
  channel: string;
  botId: string;
  botName: string;
  taskPreview: string;
  startedAt: string;
  finishedAt: string;
  subagents: DesktopSubagentActivityItem[];
}

export interface DesktopAgentActivityResponse {
  ok: true;
  generatedAt: string;
  items: DesktopAgentActivityItem[];
}

export type DesktopActiveRunStatus = "running" | "stuck" | "orphan";

export interface DesktopActiveRunItem {
  runId: string;
  agentId: string;
  agentName: string;
  channel: string;
  botId: string;
  botName: string;
  chatId: string;
  sessionId: string;
  status: DesktopActiveRunStatus;
  startedAt: string;
  durationMs: number;
  taskPreview: string;
}

export interface DesktopActiveRunsResponse { ok: true; generatedAt: string; items: DesktopActiveRunItem[]; }
export interface DesktopActiveRunActionResponse { ok: true; result: "stopped" | "cleared"; }

export interface DesktopSandboxSummary {
  enabled: boolean;
  initFailureMode: "warn-disable" | "block";
  envFilePath: string | null;
  envFilePathConfiguredExternally: boolean;
  env: {
    inheritMode: "minimal" | "allowlist" | "full";
    allow: string[];
    deny: string[];
  };
  network: { allowedDomains: string[]; deniedDomains: string[] };
  filesystem: { denyRead: string[]; allowWrite: string[]; denyWrite: string[] };
  diagnostics: {
    supportedPlatform: boolean;
    dependenciesAvailable: boolean;
    envFileExists: boolean;
    envFileReadable: boolean;
    sandboxInitialized: boolean;
    sandboxError: string | null;
    envKeysAvailable: number;
    envKeysInjected: number;
    envKeysDenied: number;
    envKeysMissing: number;
  };
}

export interface DesktopSandboxUpdateRequest {
  enabled?: boolean;
  initFailureMode?: "warn-disable" | "block";
  envFilePath?: string;
  env?: {
    inheritMode?: "minimal" | "allowlist" | "full";
    allow?: string[];
    deny?: string[];
  };
  network?: { allowedDomains?: string[]; deniedDomains?: string[] };
  filesystem?: { denyRead?: string[]; allowWrite?: string[]; denyWrite?: string[] };
}

export interface DesktopSandboxResponse {
  ok: true;
  sandbox: DesktopSandboxSummary;
}

export interface DesktopSandboxPatchResponse {
  ok: true;
  sandbox: DesktopSandboxSummary;
}

export interface DesktopHostBashWhitelistItem {
  id: string;
  toolId: string;
  displayName: string;
  reason: string;
  approvalMode: "persistent" | "ephemeral" | "session";
  enabled: boolean;
  approvedAt: string;
  permissions: {
    envAllowlist: number;
    filesystem: string;
    network: string;
  };
}

export interface DesktopHostBashSummary {
  counts: {
    pending: number;
    whitelist: number;
    whitelistEnabled: number;
    history: number;
  };
  whitelist: DesktopHostBashWhitelistItem[];
}

export interface DesktopHostBashResponse {
  ok: true;
  summary: DesktopHostBashSummary;
}

export interface DesktopHostBashToggleResponse {
  ok: true;
  entry: DesktopHostBashWhitelistItem;
}

export type DesktopTaskType = "one-shot" | "periodic" | "immediate";
export type DesktopTaskState = "pending" | "running" | "completed" | "skipped" | "error";
export type DesktopTaskCategory = "user" | "system";

export interface DesktopTaskItem {
  id: string;
  taskId: string;
  category: DesktopTaskCategory;
  systemKind: "memory-reflection" | "daily-materials" | "";
  channel: string;
  botId: string;
  chatId: string;
  scope: "workspace" | "chat-scratch";
  type: DesktopTaskType;
  enabled: boolean;
  text: string;
  delivery: string;
  scheduleText: string;
  timezone: string;
  status: DesktopTaskState;
  statusReason: string;
  lastError: string;
  runCount: number;
  completedAt: string;
  lastTriggeredAt: string;
  reminderUnread: boolean;
  sessionMode: string;
  updatedAt: string;
  createdAt: string;
  executions: DesktopTaskExecution[];
  executionCount: number;
}

export interface DesktopTaskTarget {
  channel: string;
  botId: string;
  chatId: string;
  scope: "workspace" | "chat-scratch";
  botDisplayName?: string;
}

export type DesktopTaskExecutionStatus = "running" | "retry_wait" | "completed" | "failed" | "aborted" | "skipped";

export interface DesktopTaskExecution {
  id: string;
  status: DesktopTaskExecutionStatus;
  sessionId: string;
  runId: string;
  attempt: number;
  maxAttempts: number;
  startedAt: string;
  finishedAt?: string;
  stopReason?: string;
  lastError?: string;
}

export interface DesktopTaskSessionMessage {
  role: string;
  content: string;
  createdAt: string;
}

export type DesktopSystemTaskExecutionResult =
  | { kind: "memory-reflection"; completedTargets: number; scannedConversations: number; scannedMessages: number; createdCandidates: number }
  | { kind: "daily-materials"; completedTargets: number; scannedConversations: number; scannedMessages: number; createdFiles: string[] };

export interface DesktopSystemTaskExecution {
  status: DesktopTaskExecutionStatus;
  startedAt: string;
  finishedAt?: string;
  attempt: number;
  maxAttempts: number;
  lastError?: string;
  result?: DesktopSystemTaskExecutionResult;
  detailAvailable: boolean;
}

export interface DesktopTaskSession {
  taskId: string;
  sessionId: string;
  messages: DesktopTaskSessionMessage[];
  execution?: DesktopSystemTaskExecution;
}

export interface DesktopTaskSummary {
  items: DesktopTaskItem[];
  targets: DesktopTaskTarget[];
  counts: {
    total: number;
    byType: Record<DesktopTaskType, number>;
    byStatus: Record<DesktopTaskState, number>;
    byScope: { workspace: number; chatScratch: number };
    byChannel: Record<string, number>;
    unreadOneShot: number;
    executions?: { total: number; completed: number; failed: number };
  };
}

export interface DesktopTaskResponse {
  ok: true;
  summary: DesktopTaskSummary;
}

export type DesktopTaskActionRequest =
  | { action: "create"; task: DesktopTaskTarget & { text: string; delivery: string; schedule: string; timezone: string; sessionMode: string } }
  | { action: "update"; id: string; patch: { enabled?: boolean; text?: string; delivery?: string; at?: string; schedule?: string; timezone?: string; sessionMode?: string } }
  | { action: "delete" | "trigger"; ids: string[] }
  | { action: "mark_one_shot_read"; ids: string[] }
  | { action: "session"; id: string; executionId: string }
  | { action: "history"; id: string; page: number; pageSize: number };

export interface DesktopTaskExecutionPage {
  items: DesktopTaskExecution[];
  page: number;
  pageSize: number;
  total: number;
}

export interface DesktopTaskActionResponse extends DesktopTaskResponse {
  affected: string[];
  failed: Array<{ id: string; reason: string }>;
  session?: DesktopTaskSession;
  history?: DesktopTaskExecutionPage;
}

export interface DesktopModelOption {
  key: string;
  label: string;
  contextWindow?: number;
}

export interface DesktopModelState {
  currentKey: string;
  options: DesktopModelOption[];
}

export type DesktopComposerSuggestionKind = "command" | "skill";

export interface DesktopComposerSuggestion {
  id: string;
  kind: DesktopComposerSuggestionKind;
  label: string;
  insertText: string;
  description: string;
  aliases: string[];
  argumentHint?: string;
  submitOnSelect: boolean;
  scope?: DesktopSkillScope;
}

export interface DesktopComposerSuggestionsResponse {
  ok: true;
  suggestions: DesktopComposerSuggestion[];
}

export type DesktopModelFallbackMode = "off" | "same-provider" | "any-enabled";

export interface DesktopModelRoutingSettings {
  compactionModelKey: string;
  subagentHaikuModelKey: string;
  subagentSonnetModelKey: string;
  subagentOpusModelKey: string;
  subagentThinkingModelKey: string;
  modelFallback: { mode: DesktopModelFallbackMode; firstTokenTimeoutMs: number };
  defaultThinkingLevel: DesktopThinkingLevel;
  compaction: {
    enabled: boolean;
    thresholdPercent: number;
    reserveTokens: number;
    keepRecentTokens: number;
    defaultContextWindow: number;
  };
  timezone: string;
  textOptions: DesktopModelOption[];
}

export type DesktopModelRoutingUpdateRequest = Omit<DesktopModelRoutingSettings, "textOptions">;

export interface DesktopModelRoutingResponse {
  ok: true;
  routing: DesktopModelRoutingSettings;
}

export interface DesktopSessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export type DesktopFileMediaType = "image" | "audio" | "video" | "file";

export interface DesktopMessageAttachment {
  original: string;
  local: string;
  mediaType: DesktopFileMediaType;
  mimeType?: string;
  size?: number;
}

export interface DesktopConversationMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  model?: string;
  thinking?: string;
  attachments?: DesktopMessageAttachment[];
  activities?: DesktopConversationActivity[];
  memoryTrace?: DesktopMessageMemoryTraceMeta;
}

export interface DesktopMessageMemoryTraceMeta {
  traceId: string;
  injectedCount: number;
  writeCount: number;
}

export interface DesktopMemoryTraceItem {
  memoryId: string;
  order: number;
  promptText: string;
  snapshot: {
    displayText: string;
    content: string;
    layer: string;
    type?: string;
    confidence?: number;
    reason?: string;
    tags: string[];
    updatedAt: string;
  };
}

export interface DesktopMemoryWriteReceipt {
  memoryId: string;
  operation: "added" | "updated";
  snapshot: DesktopMemoryTraceItem["snapshot"];
}

export interface DesktopMemoryTraceResponse {
  ok: true;
  trace: {
    id: string;
    query: string;
    injectedItems: DesktopMemoryTraceItem[];
    writeReceipts: DesktopMemoryWriteReceipt[];
    createdAt: string;
  };
}

export interface DesktopConversationActivity {
  key: string;
  kind: "tool" | "subagent" | "note";
  label: string;
  state: "running" | "success" | "error" | "info";
  summary?: string;
}

export interface DesktopSessionDetail extends DesktopSessionSummary {
  messages: DesktopConversationMessage[];
}

export interface DesktopSessionFile {
  id: string;
  original: string;
  local: string;
  mediaType: DesktopFileMediaType;
  mimeType?: string;
  size: number;
  createdAt: string;
}

export interface DesktopSessionFilesResponse {
  ok: true;
  files: DesktopSessionFile[];
}

export type DesktopThinkingLevel = "off" | "low" | "medium" | "high";

export type DesktopApprovalDecision =
  | "approve_once"
  | "approve_session"
  | "approve_persistent"
  | "reject";

export interface DesktopApprovalOption {
  id: string;
  label: string;
  style?: string;
}

export interface DesktopApprovalPrompt {
  requestId: string;
  command: string;
  reason?: string;
  displayName?: string;
  options: DesktopApprovalOption[];
}

export type DesktopProviderMode = "pi" | "custom";
export type DesktopProviderProtocol = "openai-compatible" | "anthropic";
export type DesktopProviderModelTag = "text" | "vision" | "audio_input" | "stt" | "tts" | "tool";
export type DesktopProviderModelRole = "system" | "user" | "assistant" | "tool" | "developer";
export type DesktopProviderThinkingFormat = "openai" | "openrouter" | "anthropic" | "deepseek" | "zai" | "qwen" | "qwen-chat-template";

export interface DesktopProviderModel {
  id: string;
  tags: DesktopProviderModelTag[];
  supportedRoles: DesktopProviderModelRole[];
  contextWindow?: number;
  enabled: boolean;
  verification: Partial<Record<DesktopProviderModelTag, "untested" | "passed" | "failed">>;
}

export interface DesktopProviderItem {
  id: string;
  name: string;
  enabled: boolean;
  isDefault: boolean;
  protocol: DesktopProviderProtocol;
  baseUrl: string;
  hasApiKey: boolean;
  modelCount: number;
  defaultModel: string;
  path: string;
  supportsThinking: boolean | null;
  thinkingFormat: DesktopProviderThinkingFormat | null;
  reasoningEffortMap: Partial<Record<"low" | "medium" | "high", string>>;
  models: DesktopProviderModel[];
}

export interface DesktopProvidersSummary {
  providerMode: DesktopProviderMode;
  piProvider: string;
  piModel: string;
  defaultCustomProviderId: string;
  customProviders: DesktopProviderItem[];
  builtinProviders: Array<{ id: string; name: string; models: string[] }>;
}

export interface DesktopProvidersResponse {
  ok: true;
  summary: DesktopProvidersSummary;
}

/** Creates a persisted provider config; custom IDs activate custom mode while built-in IDs remain on Pi routing. */
export interface DesktopProviderCreateRequest extends DesktopProviderUpdateRequest {
  apiKey: string;
}

export interface DesktopProviderSubmitResponse {
  ok: boolean;
  error?: string;
  providerId?: string;
}

export interface DesktopProviderUpdateRequest {
  id: string;
  name: string;
  enabled: boolean;
  protocol: DesktopProviderProtocol;
  baseUrl: string;
  apiKey?: string;
  clearApiKey?: boolean;
  models: DesktopProviderModel[];
  defaultModel: string;
  path: string;
  supportsThinking: boolean | null;
  thinkingFormat: DesktopProviderThinkingFormat | null;
  reasoningEffortMap: Partial<Record<"low" | "medium" | "high", string>>;
}

export interface DesktopProviderGlobalsRequest {
  providerMode: DesktopProviderMode;
  piProvider: string;
  piModel: string;
  defaultCustomProviderId: string;
}

export interface DesktopProviderMutationResponse {
  ok: true;
  summary: DesktopProvidersSummary;
}

export interface DesktopProviderModelsResponse {
  ok: true;
  models: string[];
}

/** Onboarding provider test — verifies a saved provider can answer. Key stays server-side. */
export interface DesktopProviderTestRequest {
  providerId: string;
  model?: string;
}

export interface DesktopProviderTestResponse {
  ok: boolean;
  error?: string;
  message?: string;
  status?: number | null;
  supportedRoles?: DesktopProviderModelRole[];
  verification?: Partial<Record<DesktopProviderModelTag, "untested" | "passed" | "failed">>;
}

export interface DesktopAgentItem {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  sandboxEnabled: boolean | null;
  modelOverrides: number;
  modelRouting: { textModelKey: string; visionModelKey: string; sttModelKey: string };
}

export interface DesktopAgentSaveRequest {
  previousId?: string;
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  sandboxEnabled: boolean | null;
  modelRouting: { textModelKey: string; visionModelKey: string; sttModelKey: string };
}

export interface DesktopAgentsSummary {
  items: DesktopAgentItem[];
  counts: { total: number; enabled: number };
}

export interface DesktopAgentsResponse {
  ok: true;
  summary: DesktopAgentsSummary;
}

export type DesktopMcpTransport = "stdio" | "http";

export interface DesktopMcpItem {
  id: string;
  name: string;
  enabled: boolean;
  transport: DesktopMcpTransport;
  toolNamePrefix: string;
  command: string;
  argCount: number;
  envKeyCount: number;
  envKeys: string[];
  cwdConfigured: boolean;
  url: string;
  headerCount: number;
  headerKeys: string[];
}

export interface DesktopMcpSaveRequest {
  previousId?: string;
  id: string;
  name: string;
  enabled: boolean;
  transport: DesktopMcpTransport;
  toolNamePrefix: string;
  command: string;
  url: string;
  args?: string[];
  clearArgs?: boolean;
  envValues?: Record<string, string>;
  clearEnvKeys?: string[];
  cwdValue?: string;
  clearCwd?: boolean;
  headerValues?: Record<string, string>;
  clearHeaderKeys?: string[];
}

export interface DesktopMcpSummary {
  items: DesktopMcpItem[];
  counts: { total: number; enabled: number; stdio: number; http: number };
}

export interface DesktopMcpResponse {
  ok: true;
  summary: DesktopMcpSummary;
}

export type DesktopSkillScope = "global" | "bot" | "chat" | "project";

export interface DesktopSkillItem {
  id: string;
  name: string;
  description: string;
  scope: DesktopSkillScope;
  enabled: boolean;
  mcpServerCount: number;
  botId: string;
  chatId: string;
}

export interface DesktopSkillSearch {
  localEnabled: boolean;
  apiEnabled: boolean;
  apiProvider: string;
  apiModel: string;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
  minConfidence: number;
  providers: Array<{ id: string; name: string; defaultModel: string; models: string[] }>;
}

export type DesktopSkillsUpdateRequest =
  | { kind: "skill"; id: string; enabled: boolean }
  | { kind: "search"; localEnabled: boolean; apiEnabled: boolean; apiProvider: string; apiModel: string; maxTokens: number; temperature: number; timeoutMs: number; minConfidence: number };

export interface DesktopSkillsSummary {
  items: DesktopSkillItem[];
  counts: { total: number; enabled: number; global: number; bot: number; chat: number };
  search: DesktopSkillSearch;
}

export interface DesktopSkillsResponse {
  ok: true;
  summary: DesktopSkillsSummary;
}

export interface DesktopMemoryCapabilities {
  hybridSearch: boolean;
  vectorSearch: boolean;
  incrementalFlush: boolean;
  layeredMemory: boolean;
  domains: boolean;
  versioning: boolean;
  candidates: boolean;
}

export interface DesktopMemorySummary {
  enabled: boolean;
  configEnabled: boolean;
  backend: string;
  embeddingProviderId: string;
  embeddingModel: string;
  capabilities: DesktopMemoryCapabilities;
}

export interface DesktopMemoryResponse {
  ok: true;
  summary: DesktopMemorySummary;
}

export interface DesktopMemoryItem {
  id: string;
  channel: string;
  externalUserId: string;
  content: string;
  tags: string[];
  layer: "long_term" | "daily";
  hasConflict?: boolean;
  expiresAt?: string;
  sourceSessionId?: string;
  namespace?: string;
  domain?: "owner" | "project" | "agent_self" | "content";
  type?: string;
  subject?: string;
  path?: string;
  reason?: string;
  confidence?: number;
  sources?: Array<{ channel: string; sessionId: string; conversationMessageId: string; platformMessageId?: string }>;
  pinned?: boolean;
  allowInjection?: boolean;
  state?: "active" | "disputed" | "dormant" | "archived";
  utility?: number;
  injectionCount?: number;
  privacySuppressed?: boolean;
  createdAt?: string;
  updatedAt: string;
}

export interface DesktopMemoryProfileSectionMeta {
  selectedCount: number;
  scannedCount: number;
  excludedCount: number;
  truncated: boolean;
  rule: string;
}

export interface DesktopMemoryProfile {
  summary: string;
  stablePreferences: DesktopMemoryItem[];
  profileFacts: DesktopMemoryItem[];
  currentFocus: DesktopMemoryItem[];
  recentItems: DesktopMemoryItem[];
  attentionItems: DesktopMemoryItem[];
  meta: {
    scope: { ownerId: string; botId: string; channel: string; externalUserId: string; includeOwner: boolean; includeAgentSelf: boolean; authorizedNamespaces: string[]; conversationId?: string; projectId?: string };
    fingerprint: string;
    stablePreferences: DesktopMemoryProfileSectionMeta;
    profileFacts: DesktopMemoryProfileSectionMeta;
    currentFocus: DesktopMemoryProfileSectionMeta;
    recentItems: DesktopMemoryProfileSectionMeta;
    attentionItems: DesktopMemoryProfileSectionMeta;
  };
}

export interface DesktopMemoryCandidate {
  id: string;
  status: "pending" | "confirmed" | "ignored" | "edited-then-confirmed";
  namespace: string;
  domain: "owner" | "project" | "agent_self" | "content";
  type: string;
  subject: string;
  value: string;
  confidence: number;
  reason: string;
  sources: Array<{ channel: string; sessionId: string; conversationMessageId: string; platformMessageId?: string }>;
  occurrenceCount?: number;
  evidenceDates?: string[];
  skillDraftSuggestion?: {
    description: string;
    inputs: string[];
    outputs: string[];
    boundaries: string[];
    successfulExecutionCount: number;
  };
  createdAt: string;
  updatedAt: string;
}

export type DesktopMemoryAction = "profile" | "restore-state" | "list" | "search" | "sync" | "flush" | "compact" | "backfill-embeddings" | "migrate-json-file" | "source" | "update" | "delete" | "versions" | "list-candidates" | "confirm-candidate" | "ignore-candidate";
export interface DesktopMemoryActionRequest { action: DesktopMemoryAction; channel?: string; userId?: string; botId?: string; ownerId?: string; conversationId?: string; projectId?: string; includeOwner?: boolean; includeAgentSelf?: boolean; allScopes?: boolean; query?: string; limit?: number; id?: string; sessionId?: string; messageId?: string; content?: string; tags?: string[]; expiresAt?: string | null; namespace?: string; domain?: "owner" | "project" | "agent_self" | "content"; type?: string; subject?: string; confidence?: number; reason?: string; pinned?: boolean; allowInjection?: boolean }
export interface DesktopMemoryActionResponse { ok: true; profile?: DesktopMemoryProfile; items?: DesktopMemoryItem[]; item?: DesktopMemoryItem; versions?: DesktopMemoryItem[]; sourceMessages?: Array<{ id: string; role: string; content: string; createdAt: string; selected: boolean }>; candidates?: DesktopMemoryCandidate[]; candidate?: DesktopMemoryCandidate | null; deleted?: boolean; result?: Record<string, number>; sync?: Record<string, number> }
export interface DesktopMemoryRejection { createdAt: string; action: "add" | "update"; channel: string; externalUserId: string; reason: string; content: string; layer?: string; tags: string[] }
export interface DesktopMemoryRejectionsResponse { ok: true; items: DesktopMemoryRejection[]; counts: { total: number; add: number; update: number } }

export interface DesktopChannelInstance {
  id: string;
  name: string;
  enabled: boolean;
  agentId: string;
  allowedChatCount: number;
  allowedChatIds: string[];
  sandboxEnabled: boolean | null;
  fields: Record<string, string>;
  configuredSecrets: string[];
}

export type DesktopExternalChannel = "telegram" | "feishu" | "qq" | "weixin";

export interface DesktopChannelSaveRequest {
  channel: DesktopExternalChannel;
  previousId?: string;
  id: string;
  name: string;
  enabled: boolean;
  agentId: string;
  sandboxEnabled: boolean | null;
  allowedChatIds: string[];
  fields: Record<string, string>;
  secretValues?: Record<string, string>;
  clearSecrets?: string[];
}

export interface DesktopChannelTestRequest {
  channel: DesktopExternalChannel;
  instanceId: string;
  fields?: Record<string, string>;
  secretValues?: Record<string, string>;
}

export interface DesktopChannelTestResponse {
  ok: boolean;
  error?: string;
  label?: string;
}

export interface DesktopChannelGroup {
  channel: string;
  total: number;
  enabled: number;
  instances: DesktopChannelInstance[];
}

export interface DesktopChannelsSummary {
  groups: DesktopChannelGroup[];
  counts: { totalInstances: number; enabledInstances: number };
}

export interface DesktopChannelsResponse {
  ok: true;
  summary: DesktopChannelsSummary;
}

export type DesktopPluginKind = "channel" | "provider" | "feature" | "memory-backend";
export type DesktopPluginSource = "built-in" | "external";
export type DesktopPluginStatus = "active" | "error" | "discovered";

export interface DesktopPluginItem {
  kind: DesktopPluginKind;
  key: string;
  name: string;
  version: string;
  description: string;
  source: DesktopPluginSource;
  status: DesktopPluginStatus;
  enabled: boolean;
  error: string;
}

export type DesktopPluginFieldType = "boolean" | "text" | "password" | "select";

export interface DesktopPluginSettingField {
  pluginKey: string;
  key: string;
  label: string;
  type: DesktopPluginFieldType;
  description: string;
  placeholder: string;
  required: boolean;
  options: Array<{ value: string; label: string }>;
  value: string | boolean;
  configured: boolean;
}

export interface DesktopPluginsSummary {
  items: DesktopPluginItem[];
  counts: { total: number; active: number; external: number };
  memory: { enabled: boolean; backend: string; backends: Array<{ value: string; label: string }>; embeddingProviderId: string; embeddingModel: string; embeddingProviders: Array<{ value: string; label: string }>; reflectionTime: string; reflectionNotifications: boolean; reflectionNotificationTarget: string; reflectionNotificationTargets: Array<{ value: string; label: string }>; dailyMaterials: { enabled: boolean; time: string; projectId: string; dir: string; promptPath: string; notifications: boolean; scanTokenBudget: number; scanModelKey: string }; projects: Array<{ value: string; label: string }>; scanModels: Array<{ value: string; label: string }> };
  featureSettings: Array<{ pluginKey: string; name: string; description: string; fields: DesktopPluginSettingField[] }>;
}

export interface DesktopPluginsUpdateRequest {
  memoryEnabled: boolean;
  memoryBackend: string;
  memoryEmbeddingProviderId: string;
  memoryEmbeddingModel: string;
  memoryReflectionTime: string;
  memoryReflectionNotifications: boolean;
  memoryReflectionNotificationTarget: string;
  memoryDailyMaterials: { enabled: boolean; time: string; projectId: string; dir: string; promptPath: string; notifications: boolean };
  values: Record<string, Record<string, string | boolean>>;
  secretValues?: Record<string, Record<string, string>>;
  clearSecrets?: Record<string, string[]>;
}

export interface DesktopPluginsResponse {
  ok: true;
  summary: DesktopPluginsSummary;
}

// One-off "backfill all history" job for daily materials. Progress is polled.
export interface DailyMaterialsBackfillStatus {
  status: "idle" | "running" | "done" | "error";
  startedAt?: string;
  finishedAt?: string;
  from?: string;
  to?: string;
  total: number;
  processed: number;
  daysWithData: number;
  createdFiles: number;
  scannedMessages: number;
  currentDate?: string;
  error?: string;
}

export interface DailyMaterialsBackfillResponse {
  ok: true;
  status: DailyMaterialsBackfillStatus;
}

export interface DesktopWebSearchEngine {
  id: string;
  enabled: boolean;
  /** True when an API key is configured — the key itself never reaches the WebView. */
  hasApiKey: boolean;
  baseUrl: string;
}

export interface DesktopWebSearchSummary {
  enabled: boolean;
  defaultRoute: string;
  defaultEngine: string;
  engineSelectionStrategy: string;
  maxResults: number;
  timeoutMs: number;
  retryTimeoutMs: number;
  engines: DesktopWebSearchEngine[];
  counts: { totalEngines: number; enabledEngines: number; configuredEngines: number };
}

export interface DesktopWebSearchResponse {
  ok: true;
  summary: DesktopWebSearchSummary;
}

export interface DesktopWebSearchUpdateRequest {
  enabled: boolean;
  defaultRoute: string;
  defaultEngine: string;
  engineSelectionStrategy: string;
  maxResults: number;
  timeoutMs: number;
  retryTimeoutMs: number;
  engines: Array<{ id: string; enabled: boolean; baseUrl: string; apiKey?: string; clearApiKey?: boolean }>;
}

export interface DesktopMediaEngine {
  id: string;
  enabled: boolean;
  /** True when an API key is configured — the key itself never reaches the WebView. */
  hasApiKey: boolean;
  baseUrl: string;
  model: string;
}

export interface DesktopMediaGenerateSummary {
  enabled: boolean;
  defaultEngine: string;
  engines: DesktopMediaEngine[];
  counts: { totalEngines: number; enabledEngines: number; configuredEngines: number };
}

export interface DesktopImageGenerateResponse {
  ok: true;
  summary: DesktopMediaGenerateSummary;
}

export interface DesktopVideoGenerateResponse {
  ok: true;
  summary: DesktopMediaGenerateSummary;
}

export interface DesktopMediaGenerateUpdateRequest {
  enabled: boolean;
  defaultEngine: string;
  engines: Array<{ id: string; enabled: boolean; baseUrl: string; model: string; apiKey?: string; clearApiKey?: boolean }>;
}

export interface DesktopTtsProvider {
  id: string;
  enabled: boolean;
  voice: string;
  format: string;
  /** True when this provider needs and has an API key — macOS (system voices) has none. */
  hasApiKey: boolean;
  /** Present only for key-based providers; "" for the macOS system provider. */
  model: string;
  baseUrl: string;
}

export interface DesktopTtsSummary {
  enabled: boolean;
  defaultProvider: string;
  providers: DesktopTtsProvider[];
}

export interface DesktopTtsResponse {
  ok: true;
  summary: DesktopTtsSummary;
}

export interface DesktopTtsUpdateRequest {
  enabled: boolean;
  defaultProvider: string;
  providers: Array<{ id: string; enabled: boolean; voice: string; format: string; baseUrl: string; model: string; apiKey?: string; clearApiKey?: boolean }>;
}

export interface DesktopSettingsTestResponse {
  ok: boolean;
  error?: string;
  result?: unknown;
}

export type DesktopMediaTaskKind = "image" | "video";

export interface DesktopMediaTask {
  id: string;
  kind: DesktopMediaTaskKind;
  engine: string;
  status: "processing" | "completed" | "failed";
  progress?: number;
  prompt: string;
  resultUrl?: string;
  /** Sanitized primitive display params only — never secrets or host paths. */
  requestParams?: Record<string, unknown>;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DesktopMediaTasksResponse {
  ok: true;
  tasks: DesktopMediaTask[];
}

export type DesktopExternalChatType = "private" | "group" | "channel";

/**
 * Read-only external-channel session summary (plan §7.2 / Phase 3). Carries
 * only display fields — no message content and no raw platform credentials.
 */
export interface DesktopExternalSession {
  id: string;
  title: string;
  updatedAt: string;
  chatType: DesktopExternalChatType;
  senderName: string;
  senderAvatarUrl?: string;
  threadTitle?: string;
  botInstanceId?: string;
  botInstanceName?: string;
  platform: string;
}

export interface DesktopExternalChannelGroup {
  channel: string;
  total: number;
  sessions: DesktopExternalSession[];
}

export interface DesktopExternalSessionsSummary {
  groups: DesktopExternalChannelGroup[];
  counts: { totalSessions: number };
}

export interface DesktopExternalSessionsResponse {
  ok: true;
  summary: DesktopExternalSessionsSummary;
}

/**
 * A read-only external-channel transcript message (plan §7.2). External
 * attachments cannot be previewed through the Web file endpoint, so only the
 * display-safe attachment fields are kept — the on-disk `local` path is dropped.
 */
export interface DesktopExternalTranscriptMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  attachments?: { original: string; local?: string; mediaType: DesktopFileMediaType; mimeType?: string; size?: number }[];
  activities?: DesktopConversationActivity[];
}

export interface DesktopExternalTranscript {
  id: string;
  channel: string;
  title: string;
  updatedAt: string;
  chatType: DesktopExternalChatType;
  senderName: string;
  messages: DesktopExternalTranscriptMessage[];
}

export interface DesktopExternalTranscriptResponse {
  ok: true;
  transcript: DesktopExternalTranscript;
}

/**
 * Channels surfaced by the unified desktop conversation navigator (plan §2.2).
 * `web` aggregates every Web Profile; the four external channels aggregate
 * their configured Bot instances.
 */
export type DesktopConversationChannel = "web" | "telegram" | "feishu" | "qq" | "weixin";

/**
 * Session purpose classification (plan §12.4). The sidebar only lists
 * `conversation`; project / automation / diagnostic / test sessions are
 * excluded. The shared query layer derives this from existing storage signals
 * (web index vs project index vs automation origin) so the classification is
 * not duplicated into channels or UI components.
 */
export type DesktopConversationPurpose =
  | "conversation"
  | "project"
  | "automation"
  | "diagnostic"
  | "test";

/**
 * One conversation in the unified navigator view (plan §12.2). `botId` is the
 * Web profile id for `web`, or the external Bot instance id for external
 * channels; `botDeleted` marks a Bot whose configuration no longer exists so
 * the UI can surface its history under a "deleted Bot" group. `readOnly` is
 * true for external channels (plan §3.3).
 */
export interface DesktopConversationItem {
  sessionId: string;
  title: string;
  updatedAt: string;
  botId: string;
  botName: string;
  botDeleted: boolean;
  channel: DesktopConversationChannel;
  purpose: DesktopConversationPurpose;
  readOnly: boolean;
  latestMessagePreview?: string;
}

export interface DesktopConversationsResponse {
  ok: true;
  channel: DesktopConversationChannel;
  items: DesktopConversationItem[];
  /** Opaque base64url cursor for stable `updatedAt + sessionId` pagination. */
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * One Bot group inside the "more conversations" browser (plan §5.2). Each
 * group carries its own cursor so a single Bot can be paged independently
 * without re-fetching the other groups.
 */
export interface DesktopConversationBotGroup {
  botId: string;
  botName: string;
  botDeleted: boolean;
  readOnly: boolean;
  total: number;
  items: DesktopConversationItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface DesktopConversationsGroupsResponse {
  ok: true;
  channel: DesktopConversationChannel;
  groups: DesktopConversationBotGroup[];
}

/**
 * Live run status for a session (plan §11.3). Used by the Desktop to restore
 * running / waiting-for-approval / failed state after a reconnect instead of
 * trusting its own process memory. Status comes from the runtime `runs` table
 * and the approval broker's pending requests, never from Desktop memory.
 */
export type DesktopSessionRunStatus =
  | "running"
  | "waiting_for_approval"
  | "completed"
  | "failed"
  | "aborted";

export interface DesktopSessionRun {
  /** Resolved Web profile id; empty for runs not attributable to a Web profile. */
  profileId: string;
  sessionId: string;
  runId: string;
  status: DesktopSessionRunStatus;
  startedAt: string;
  waitingApproval: boolean;
  errorCode: string | null;
}

export interface DesktopSessionRunsResponse {
  ok: true;
  runs: DesktopSessionRun[];
}

/**
 * Read-only runtime-environment dependency summary (plan §10). The Desktop
 * Runtime environment page shows what optional tools are present and how they
 * would be installed; actual installation is a separate, per-item authorized
 * action and is not part of this read-only contract. No absolute on-disk paths
 * or credentials reach the WebView — only display fields.
 */
export type DesktopRuntimeDepStatus = "installed" | "missing" | "unknown";

export interface DesktopRuntimeDependency {
  id: string;
  name: string;
  purpose: string;
  status: DesktopRuntimeDepStatus;
  version: string;
  source: string;
  estimatedSize: string;
  installCommand: string;
  installSource: "homebrew" | "tooling" | "system";
}

export interface DesktopRuntimeEnvSummary {
  dependencies: DesktopRuntimeDependency[];
  counts: { total: number; installed: number; missing: number };
}

export interface DesktopRuntimeEnvResponse {
  ok: true;
  summary: DesktopRuntimeEnvSummary;
}
