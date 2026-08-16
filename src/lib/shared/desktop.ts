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
  /** Bot/project this grant covers. Absent on legacy install-wide grants. */
  scope?: { kind: "bot" | "project"; label: string };
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
export type DesktopTaskCategory = "user" | "project" | "system";

export interface DesktopTaskItem {
  id: string;
  taskId: string;
  category: DesktopTaskCategory;
  systemKind: "memory-reflection" | "daily-materials" | "";
  channel: string;
  botId: string;
  projectId: string;
  projectName: string;
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
  /**
   * Outcome of the most recent attempt. For periodic tasks the event file's
   * `status` is a run *lock* (it returns to `pending` on success), so it can
   * never answer "did the last run succeed" — that lives here, and this is what
   * the UI shows as the headline state.
   */
  lastRun?: {
    status: DesktopTaskExecutionStatus;
    startedAt: string;
    finishedAt?: string;
    lastError?: string;
  };
  /** True only while an attempt is genuinely held by a live run. */
  active: boolean;
}

export interface DesktopChannelTaskTarget {
  kind: "channel";
  channel: string;
  botId: string;
  chatId: string;
  scope: "workspace" | "chat-scratch";
  botDisplayName?: string;
}

export interface DesktopProjectTaskTarget {
  kind: "project";
  channel: "project";
  botId: "";
  chatId: string;
  scope: "workspace";
  projectId: string;
  projectName: string;
}

export type DesktopTaskTarget = DesktopChannelTaskTarget | DesktopProjectTaskTarget;

export type DesktopTaskExecutionStatus = "running" | "retry_wait" | "completed" | "failed" | "aborted" | "skipped" | "interrupted";

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

export type DesktopDurableExecutionStatus = "planned" | "queued" | "running" | "verifying" | "waiting_for_user" | "waiting_for_approval" | "paused" | "recovery_required" | "partial" | "completed" | "failed" | "cancelled";
export type DesktopDurableExecutionStepStatus = "pending" | "running" | "completed" | "uncertain" | "blocked" | "skipped" | "failed";

export interface DesktopDurableExecutionItem {
  execution: {
    id: string;
    shortHandle: string;
    ownerId: string;
    botId: string;
    sourceChannel: string;
    sourceChatId?: string;
    sourceUiSessionId?: string;
    sourceProjectId?: string;
    goal: string;
    constraints: string[];
    status: DesktopDurableExecutionStatus;
    version: number;
    currentPlanVersion: number;
    tokensUsed: number;
    attemptsUsed: number;
    createdAt: string;
    startedAt?: string;
    updatedAt: string;
    terminalAt?: string;
    waitingKind?: "user" | "approval" | "recovery";
    waitingReason?: string;
    nextRunAt?: string;
    lastError?: string;
    activationPath: "deterministic" | "lazy_promotion" | "forced";
    activationReason?: string;
  };
  projection: {
    displayStatus: DesktopDurableExecutionStatus;
    progress: { completed: number; total: number; currentIndex?: number };
    queuePosition?: number;
    nextStep?: { id: string; title: string; status: DesktopDurableExecutionStepStatus };
    requiredCriteria: { total: number; passed: number; unproven: number; failed: number };
    waiting?: { kind: "user" | "approval" | "recovery"; reason: string };
    active: boolean;
  };
}

export interface DesktopDurableExecutionInspection extends DesktopDurableExecutionItem {
  plans: DesktopDurableExecutionPlan[];
  steps: DesktopDurableExecutionStep[];
  acceptanceCriteria: DesktopDurableExecutionCriterion[];
  sideEffects: DesktopDurableExecutionSideEffect[];
  evidenceRefs: DesktopDurableExecutionEvidence[];
  decisions: DesktopDurableExecutionDecision[];
  approvals: DesktopDurableExecutionApproval[];
  attempts: DesktopDurableExecutionAttempt[];
}

export interface DesktopDurableExecutionPlan {
  executionId: string;
  version: number;
  reason: string;
  author: "model" | "user";
  createdAt: string;
}

export interface DesktopDurableExecutionStep {
    id: string;
    executionId: string;
    planVersion: number;
    index: number;
    title: string;
    description: string;
    status: DesktopDurableExecutionStepStatus;
    sideEffectClass: "pure" | "idempotent" | "queryable" | "non_idempotent";
    idempotencyKey?: string;
    inputSummary?: string;
    outputSummary?: string;
    outputRef?: string;
    evidenceSummary?: string;
    attemptCount: number;
    startedAt?: string;
    completedAt?: string;
    lastError?: string;
    createdAt: string;
    updatedAt: string;
}

export interface DesktopDurableExecutionCriterion {
  id: string;
  executionId: string;
  planVersion: number;
  description: string;
  required: boolean;
  checkerType: "deterministic" | "subjective";
  checkerKey?: string;
  author: "model" | "user";
  result: "unproven" | "passed" | "failed";
  evidenceRefId?: string;
  userEdited: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DesktopDurableExecutionSideEffect {
  id: string;
  executionId: string;
  stepId: string;
  attemptId?: string;
  phase: "intent" | "receipt";
  sideEffectClass: "pure" | "idempotent" | "queryable" | "non_idempotent";
  idempotencyKey: string;
  targetSummary: string;
  contentSummary: string;
  externalId?: string;
  payload?: unknown;
  createdAt: string;
}

export interface DesktopDurableExecutionEvidence {
  id: string;
  executionId: string;
  stepId?: string;
  attemptId?: string;
  referenceType: string;
  referenceId: string;
  summary: string;
  status: "available" | "unavailable";
  unavailableReason?: string;
  createdAt: string;
}

export interface DesktopDurableExecutionDecision {
  id: string;
  executionId: string;
  planVersion: number;
  question: string;
  options: string[];
  status: "open" | "answered" | "cancelled";
  answer?: string;
  answeredBy?: string;
  createdAt: string;
  answeredAt?: string;
}

export interface DesktopDurableExecutionApproval {
  id: string;
  executionId: string;
  attemptId?: string;
  requestId: string;
  backend: "approval_broker" | "host_bash";
  actionKey: string;
  toolId: string;
  title: string;
  summary: string;
  options: string[];
  status: "pending" | "approved" | "rejected" | "expired";
  repeatCount: number;
  requestedAt: string;
  resolvedAt?: string;
  selectedScope?: string;
}

export interface DesktopDurableExecutionAttempt {
  id: string;
  executionId: string;
  ownerId: string;
  runId: string;
  contextSessionId: string;
  planVersion: number;
  status: "running" | "completed" | "failed" | "interrupted" | "waiting";
  startedAt: string;
  finishedAt?: string;
  endReason?: string;
  tokensUsed: number;
}

export interface DesktopDurableExecutionResponse {
  ok: true;
  items: DesktopDurableExecutionItem[];
}

export interface DesktopDurableExecutionInspectionResponse {
  ok: true;
  item: DesktopDurableExecutionInspection;
}

export interface DesktopDurableExecutionEvidenceReadResponse {
  ok: true;
  evidence: DesktopDurableExecutionEvidenceRead;
}

export interface DesktopDurableExecutionEvidenceRead extends DesktopDurableExecutionEvidence {
  content?: string;
  truncated: boolean;
  untrusted: true;
}

export type DesktopDurableExecutionActionRequest =
  | {
      action: "create";
      ownerId?: string;
      botId: string;
      sourceChannel?: string;
      sourceChatId?: string;
      sourceUiSessionId?: string;
      sourceProjectId?: string;
      goal: string;
      constraints?: string[];
      steps: Array<{ title: string; description?: string; sideEffectClass?: "pure" | "idempotent" | "queryable" | "non_idempotent"; idempotencyKey?: string; inputSummary?: string }>;
      acceptanceCriteria: Array<{ description: string; required?: boolean; checkerType?: "deterministic" | "subjective"; checkerKey?: string; author?: "model" | "user" }>;
      activationPath?: "deterministic" | "lazy_promotion" | "forced";
      activationReason?: string;
      budget?: { tokenLimit?: number; attemptLimit?: number; lifetimeDays?: number };
    }
  | { action: "pause" | "resume" | "cancel"; ownerId?: string; executionId: string; expectedVersion: number; actionId: string; reason?: string }
  | { action: "answer_decision"; ownerId?: string; executionId: string; decisionId: string; answer: string; expectedVersion: number; actionId: string }
  | { action: "resolve_approval"; ownerId?: string; executionId: string; approvalId: string; status: "approved" | "rejected" | "expired"; selectedScope?: string; expectedVersion: number; actionId: string };

export interface DesktopDurableExecutionActionResponse {
  ok: true;
  item: DesktopDurableExecutionItem;
}

export interface DesktopModelOption {
  key: string;
  label: string;
  /** Optional human-friendly display name; UI prefers this over `label`. */
  alias?: string;
  contextWindow?: number;
  thinkingLevels?: DesktopThinkingLevel[];
}

export interface DesktopModelState {
  currentKey: string;
  options: DesktopModelOption[];
}

export type DesktopComposerSuggestionKind = "command" | "skill" | "miniapp";

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
  parentSessionId?: string;
  forkedFromMessageId?: string;
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
  stopReason?: string;
  errorMessage?: string;
  attachments?: DesktopMessageAttachment[];
  activities?: DesktopConversationActivity[];
  steps?: DesktopConversationStep[];
  usage?: DesktopConversationTokenUsage;
  plan?: DesktopConversationPlan;
  memoryTrace?: DesktopMessageMemoryTraceMeta;
}

export interface DesktopMessageMemoryTraceMeta {
  traceId: string;
  injectedCount: number;
  /** Memories the reply actually used (citations + mid-run tool retrieval). */
  referencedCount: number;
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

export type DesktopMemoryFeedbackValue = "helpful" | "irrelevant" | "incorrect" | "expired" | "too_private" | "do_not_inject";

export interface DesktopMemoryReferencedItem {
  memoryId: string;
  /** "cited" = the model cited it in the reply; "tool_retrieved" = fetched mid-run via the memory tool. */
  source: "cited" | "tool_retrieved";
  query?: string;
  snapshot: DesktopMemoryTraceItem["snapshot"];
}

export interface DesktopMemoryTraceResponse {
  ok: true;
  trace: {
    id: string;
    query: string;
    injectedItems: DesktopMemoryTraceItem[];
    referencedItems: DesktopMemoryReferencedItem[];
    writeReceipts: DesktopMemoryWriteReceipt[];
    createdAt: string;
  };
}

export interface DesktopConversationActivity {
  key: string;
  kind: "tool" | "subagent" | "note";
  /** Tool id, so the transcript can pick a renderer for `summary`/`diff`. */
  tool?: string;
  label: string;
  state: "running" | "success" | "error" | "info";
  summary?: string;
  /** Unified patch when the call changed a file (see `ConversationActivity`). */
  diff?: string;
  /** Project-relative paths the tool call touched (see `ConversationActivity`). */
  paths?: string[];
  /** True when the tool wrote to those paths rather than reading them. */
  mutates?: boolean;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  exitCode?: number;
  lineCount?: number;
  tokenUsage?: number;
}

export interface DesktopConversationTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
}

export type DesktopConversationStep =
  | { id: string; kind: "text"; content: string }
  | { id: string; kind: "thinking"; content: string }
  | { id: string; kind: "activity"; activity: DesktopConversationActivity }
  | { id: string; kind: "plan"; plan: DesktopConversationPlan };

export interface DesktopConversationPlan {
  id: string;
  title: string;
  summary: string;
  steps: Array<{ id: string; text: string; status: "pending" | "in_progress" | "completed" | "blocked" }>;
  status: "proposed" | "accepted" | "rejected" | "executing" | "completed" | "blocked";
  recommendedMode: "manual" | "accept_edits";
  artifactPath: string;
  durableExecutionId?: string;
}

export interface DesktopSessionDetail extends DesktopSessionSummary {
  messages: DesktopConversationMessage[];
}

/** Per-session text-model override (routing key). Empty string = follow global default. */
export interface DesktopSessionModelResponse {
  ok: true;
  modelKey: string;
}

export interface DesktopSessionModelUpdateRequest {
  conversationId: string;
  modelKey: string;
}

export interface DesktopSessionPermissionResponse {
  ok: true;
  mode: "plan" | "manual" | "accept_edits" | "auto";
}

export interface DesktopSessionPermissionUpdateRequest {
  profileId: string;
  conversationId: string;
  mode: "plan" | "manual" | "accept_edits" | "auto";
}

export interface DesktopPlanDecisionRequest {
  profileId: string;
  conversationId: string;
  planId: string;
  decision: "accept" | "reject" | "modify";
  mode?: "manual" | "accept_edits";
  title?: string;
  summary?: string;
  steps?: string[];
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

export type DesktopThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export const DESKTOP_THINKING_LEVELS: readonly DesktopThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max"
];

/** Mirrors pi's upward-first nearest-level clamp for UI state. */
export function clampDesktopThinkingLevel(
  requested: DesktopThinkingLevel,
  available: readonly DesktopThinkingLevel[]
): DesktopThinkingLevel {
  if (available.includes(requested)) return requested;
  const requestedIndex = DESKTOP_THINKING_LEVELS.indexOf(requested);
  for (let index = requestedIndex + 1; index < DESKTOP_THINKING_LEVELS.length; index += 1) {
    const candidate = DESKTOP_THINKING_LEVELS[index];
    if (candidate && available.includes(candidate)) return candidate;
  }
  for (let index = requestedIndex - 1; index >= 0; index -= 1) {
    const candidate = DESKTOP_THINKING_LEVELS[index];
    if (candidate && available.includes(candidate)) return candidate;
  }
  return "off";
}

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

/** Bot or project a "一直允许" grant would apply to. */
export interface DesktopApprovalOwner {
  kind: "bot" | "project";
  id: string;
  label: string;
}

export interface DesktopApprovalPrompt {
  requestId: string;
  command: string;
  reason?: string;
  displayName?: string;
  owner?: DesktopApprovalOwner;
  options: DesktopApprovalOption[];
  payload?: {
    path?: string;
    diff?: string;
    parameters?: Record<string, unknown>;
  };
}

/** Outcome the server reports back when a pending approval is resolved. */
export type DesktopApprovalOutcome = "executed" | "failed" | "rejected" | "approved" | "not_found";

export interface DesktopApprovalResult {
  response: string;
  status?: DesktopApprovalOutcome;
  error?: string;
}

export type DesktopProviderMode = "pi" | "custom";
export type DesktopProviderProtocol = "openai-compatible" | "anthropic";
export type DesktopProviderModelTag = "text" | "vision" | "audio_input" | "stt" | "tts" | "tool";
export type DesktopProviderModelRole = "system" | "user" | "assistant" | "tool" | "developer";
export type DesktopProviderThinkingFormat = "openai" | "openrouter" | "anthropic" | "deepseek" | "zai" | "qwen" | "qwen-chat-template";

export interface DesktopProviderModel {
  id: string;
  alias?: string;
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
  thinkingFormat: DesktopProviderThinkingFormat | null;
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
  thinkingFormat: DesktopProviderThinkingFormat | null;
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

export type DesktopProviderAuthState =
  | "pending"
  | "awaiting_input"
  | "waiting_external"
  | "done"
  | "failed"
  | "cancelled"
  | "expired";

export interface DesktopProviderAuthPromptOption {
  id: string;
  label: string;
  description?: string;
}

export interface DesktopProviderAuthPrompt {
  id: string;
  type: "text" | "secret" | "select" | "manual_code";
  message: string;
  placeholder?: string;
  options?: DesktopProviderAuthPromptOption[];
}

export interface DesktopProviderAuthMessage {
  id: number;
  type: "info" | "progress";
  message: string;
  links?: Array<{ url: string; label?: string }>;
}

export interface DesktopProviderAuthSession {
  id: string;
  providerId: string;
  state: DesktopProviderAuthState;
  revision: number;
  startedAt: number;
  updatedAt: number;
  expiresAt: number;
  prompt: DesktopProviderAuthPrompt | null;
  authUrl?: { url: string; instructions?: string };
  deviceCode?: {
    userCode: string;
    verificationUri: string;
    intervalSeconds?: number;
    expiresAt?: number;
  };
  messages: DesktopProviderAuthMessage[];
  error?: string;
}

export interface DesktopProviderAuthItem {
  id: string;
  name: string;
  loginLabel: string;
  credential?: {
    type: "api_key" | "oauth";
    expiresAt?: number;
  };
  effectiveAuth?: {
    type: "api_key" | "oauth";
    source?: string;
  };
  /**
   * A saved API-key override for this provider takes precedence over the stored
   * credential, so an OAuth login here has no effect until the key is cleared.
   */
  apiKeyOverride?: boolean;
}

export interface DesktopProviderAuthOverviewResponse {
  ok: true;
  providers: DesktopProviderAuthItem[];
}

export interface DesktopProviderAuthSessionResponse {
  ok: true;
  session: DesktopProviderAuthSession;
}

export interface DesktopProviderAuthStartRequest {
  providerId: string;
}

export interface DesktopProviderAuthAnswerRequest {
  promptId: string;
  value: string;
}

export interface DesktopProviderAuthVerifyRequest {
  providerId: string;
  /** Optional model to probe; defaults to the provider's first catalog entry. */
  model?: string;
}

/**
 * Result of a real request sent through the runner's own stream path, so a pass
 * means the credential works — not merely that one is stored.
 */
export interface DesktopProviderAuthVerifyResponse {
  ok: true;
  result: {
    ok: boolean;
    providerId: string;
    modelId: string;
    elapsedMs: number;
    reply?: string;
    error?: string;
  };
}

export interface DesktopProviderAuthLogoutResponse {
  ok: true;
  removed: boolean;
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
export type DesktopMcpConnectionState = "disabled" | "connecting" | "connected" | "disconnected" | "error";

export interface DesktopMcpItem {
  id: string;
  name: string;
  managed: boolean;
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
  connectionState: DesktopMcpConnectionState;
  toolCount: number;
  lastError: string;
  lastAttemptAt: string;
  connectedAt: string;
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

export interface DesktopMcpToggleRequest {
  id: string;
  enabled: boolean;
}

export type DesktopOpenConnectorState = "disabled" | "unconfigured" | "ready" | "error";

export interface DesktopOpenConnectorProvider {
  service: string;
  displayName: string;
  description: string;
  categories: string[];
  authTypes: string[];
  iconUrl: string;
  homepageUrl: string;
  actionCount: number;
  locallyExecutableActionCount: number;
}

export interface DesktopOpenConnectorConnection {
  service: string;
  connectionName: string;
  authType: string;
  displayName: string;
}

export interface DesktopOpenConnectorSummary {
  config: { enabled: boolean; baseUrl: string; consoleUrl: string; tokenConfigured: boolean };
  state: DesktopOpenConnectorState;
  providers: DesktopOpenConnectorProvider[];
  connections: DesktopOpenConnectorConnection[];
  error: string;
  refreshedAt: string;
}

export interface DesktopOpenConnectorResponse {
  ok: true;
  summary: DesktopOpenConnectorSummary;
}

export interface DesktopOpenConnectorTokenResponse {
  ok: boolean;
  runtimeToken?: string;
  error?: string;
}

export interface DesktopOpenConnectorSaveRequest {
  enabled: boolean;
  baseUrl: string;
  consoleUrl: string;
  runtimeToken?: string;
  clearRuntimeToken?: boolean;
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

/**
 * A Skill that ships with Molibot and was materialised into the workspace.
 *
 * The loader only ever reads the owner's workspace, so a bundled Skill exists
 * on disk as the owner's copy. This is what lets Settings say which version is
 * installed, and offer to write the shipped one over it.
 */
export interface DesktopBuiltinSkillState {
  id: string;
  version: string;
  installedVersion: string;
  installed: boolean;
  updateAvailable: boolean;
  /** True when the copy on disk no longer matches the files Molibot wrote. */
  modified: boolean;
}

export type DesktopSkillsUpdateRequest =
  | { kind: "skill"; id: string; enabled: boolean }
  | { kind: "search"; localEnabled: boolean; apiEnabled: boolean; apiProvider: string; apiModel: string; maxTokens: number; temperature: number; timeoutMs: number; minConfidence: number }
  | { kind: "builtin"; id: string };

export interface DesktopSkillsSummary {
  items: DesktopSkillItem[];
  counts: { total: number; enabled: number; global: number; bot: number; chat: number };
  search: DesktopSkillSearch;
  /** Built-in Skills and their installed-vs-shipped version state. */
  builtins: DesktopBuiltinSkillState[];
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

export type DesktopMiniAppStatus = "active" | "disabled" | "error" | "uninstalling";

/**
 * Where an installed Mini App came from. Display-only provenance: app server
 * code runs in-process without a sandbox regardless of source, so this informs
 * the owner rather than constraining the app.
 */
export type DesktopMiniAppSource =
  | { kind: "builtin" }
  | { kind: "directory"; label: string }
  | { kind: "zip"; label: string }
  | { kind: "github"; repo: string; ref: string };

export type DesktopMiniAppInstallRequest =
  | { source: "directory"; path: string }
  | { source: "zip"; path: string }
  | { source: "github"; repo: string; ref?: string };

export interface DesktopMiniAppInstallResponse {
  ok: true;
  items: DesktopMiniAppItem[];
  builtin: DesktopMiniAppBuiltinItem[];
  /** The app that was just installed, so the UI can point at it. */
  installedId: string;
  /** True when the install replaced an existing app rather than adding one. */
  replaced: boolean;
}

/**
 * A Mini App as the desktop sees it. Deliberately path-free: the WebView never
 * receives a manifest path, an entry path or a data directory.
 */
export interface DesktopMiniAppItem {
  id: string;
  name: string;
  version: string;
  description: string;
  status: DesktopMiniAppStatus;
  enabled: boolean;
  builtin: boolean;
  toolNames: string[];
  messageActions: Array<{
    tool: string;
    label: { zh: string; en: string };
    icon?: string;
    accepts: Array<"text" | "image" | "file">;
  }>;
  aiCapabilities: Array<"text" | "transcription">;
  hostCapabilities: Array<"audioCapture">;
  /**
   * Live sidebar badge the app set on itself, or null.
   *
   * Not persisted anywhere: it describes work in this service process, so it is
   * absent after a restart rather than resurrected (pitfall #23d).
   */
  badge: { kind: "count"; count: number } | { kind: "dot" } | null;
  /** Icon inlined as a `data:` URI, or empty when the app declares none. */
  iconDataUri: string;
  source: DesktopMiniAppSource;
  /** True when Molibot ships a newer copy of this built-in than the installed one. */
  updateAvailable: boolean;
  /** The version the current Molibot build carries, or empty when none. */
  availableVersion: string;
  error: string;
}

/**
 * A built-in app as the manager's built-in tab sees it: what this Molibot build
 * ships, plus whether the owner has it and whether a newer copy is on offer.
 *
 * Separate from {@link DesktopMiniAppItem} because it describes an app that may
 * not be installed at all — identity comes from the bundled copy.
 */
export interface DesktopMiniAppBuiltinItem {
  id: string;
  name: string;
  description: string;
  /** The version this Molibot build ships. */
  availableVersion: string;
  iconDataUri: string;
  toolNames: string[];
  installed: boolean;
  /** The version on disk; empty when not installed. */
  installedVersion: string;
  updateAvailable: boolean;
  enabled: boolean;
  status: DesktopMiniAppStatus | "not-installed";
  /** True when the owner uninstalled it, so it is not restored automatically. */
  removedByOwner: boolean;
  error: string;
}

export interface DesktopMiniAppsResponse {
  ok: true;
  items: DesktopMiniAppItem[];
  /** Every built-in this build ships, installed or not. */
  builtin: DesktopMiniAppBuiltinItem[];
}

/** Installs (or reinstalls) a built-in from the copy this build ships. */
export interface DesktopMiniAppBuiltinInstallRequest {
  appId: string;
}

export interface DesktopMiniAppBuiltinInstallResponse {
  ok: true;
  items: DesktopMiniAppItem[];
  builtin: DesktopMiniAppBuiltinItem[];
  /** The version now on disk. */
  version: string;
}

export interface DesktopMiniAppInvokeRequest {
  appId: string;
  tool: string;
  capture: {
    text: string;
    selection?: string;
    role: "assistant" | "user";
    source?: { sessionTitle?: string };
  };
  resources?: DesktopMiniAppResourceLocator[];
}

export interface DesktopMiniAppResourceLocator {
  profileId: string;
  sessionId: string;
  projectId?: string;
  fileId: string;
}

export interface DesktopMiniAppAiSettings {
  textModelKey: string;
  transcriptionModelKey: string;
}

export interface DesktopMiniAppAiSettingsResponse {
  ok: true;
  settings: DesktopMiniAppAiSettings;
  usage: DesktopMiniAppAiUsage[];
}

export interface DesktopMiniAppAiUsage {
  appId: string;
  requests: number;
  successes: number;
  failures: number;
  textRequests: number;
  transcriptionRequests: number;
  totalTokens: number;
  audioSeconds: number;
  durationMs: number;
}

export interface DesktopMiniAppInvokeResponse {
  ok: true;
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: unknown;
  /**
   * Optional summary card the App returned, already sanitized host-side.
   *
   * A presentation extra only: `content` remains the authoritative text, so a
   * surface that renders no cards loses nothing but polish.
   */
  card?: DesktopMiniAppResultCard;
}

/** Mirrors `MiniAppResultCard`; see `src/lib/shared/miniappCard.ts`. */
export interface DesktopMiniAppResultCard {
  title: string;
  subtitle?: string;
  fields: Array<{ label: string; value: string }>;
  icon?: string;
  /** Always a `molibot://miniapp/<appId>/...` link into the declaring app. */
  link?: string;
}

export interface DesktopMiniAppAttachRequest {
  appId: string;
  /** Path relative to the App's own data directory. */
  path: string;
}

export interface DesktopMiniAppAttachResponse {
  ok: true;
  name: string;
  /** File bytes; the desktop rebuilds a `File` from these. */
  base64: string;
}

export interface DesktopMiniAppBadgeClearRequest {
  appId: string;
}

export interface DesktopMiniAppToggleRequest {
  appId: string;
  enabled: boolean;
}

/**
 * Reinstalls a built-in Mini App from the copy this Molibot build ships.
 * Replaces the app's code wholesale; its data directory is never touched.
 */
export interface DesktopMiniAppUpdateRequest {
  appId: string;
}

export interface DesktopMiniAppUpdateResponse {
  ok: true;
  items: DesktopMiniAppItem[];
  builtin: DesktopMiniAppBuiltinItem[];
  /** The version now on disk. */
  version: string;
}

export interface DesktopMiniAppUninstallRequest {
  appId: string;
  /** True permanently removes the app's data directory. Not recoverable. */
  deleteData: boolean;
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
  /** Optional display name for custom engines. */
  name?: string;
  /** Protocol used by custom engines; built-in engines omit this. */
  protocol?: "images-generations" | "chat-completions";
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
  engines: Array<{ id: string; enabled: boolean; baseUrl: string; model: string; apiKey?: string; clearApiKey?: boolean; name?: string; protocol?: "images-generations" | "chat-completions" }>;
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
  steps?: DesktopConversationStep[];
  usage?: DesktopConversationTokenUsage;
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
  parentSessionId?: string;
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
