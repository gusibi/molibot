import type { ImageCostTotals } from "./usageCosts";
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
  permissionMode?: "plan" | "manual" | "accept_edits" | "auto" | null;
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

export interface DesktopProfileFilesResponse {
  ok: true;
  fileNames: readonly string[];
  files: Record<string, string>;
}

export interface DesktopWebProfileUpdateResponse {
  ok: true;
  profile: DesktopWebProfile;
}

export interface DesktopUsageTotals extends ImageCostTotals {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  /** Ledger-summed provider cost estimate; records without pricing contribute nothing, never zero-priced. */
  estimatedCostUsd?: number;
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
  agentId?: string;
  requestId?: string;
  ts: string;
  channel: string;
  botId: string;
  provider: string;
  model: string;
  api: string;
}

export type DesktopUsageScenario = "conversation" | "project" | "miniapp" | "image" | "transcription" | "other";

export interface DesktopUsageActivity {
  startDate: string;
  endDate: string;
  coverageStart: string | null;
  recordedTokens: number;
  peakDailyTokens: number;
  peakDate: string | null;
  activeDays: number;
  currentStreak: number;
  longestStreak: number;
  requests: number;
  averageRequestsPerActiveDay: number;
  days: Array<{ date: string; requests: number; totalTokens: number }>;
  scenarios: Array<{ id: DesktopUsageScenario; requests: number; totalTokens: number }>;
  agents: Array<{ id: string; requests: number; totalTokens: number }>;
  channels: Array<{ id: string; requests: number; totalTokens: number }>;
}

export interface DesktopUsageSummary {
  timezone: string;
  generatedAt: string;
  range: DesktopUsageRange;
  window: { startDate: string; endDate: string };
  filters: { modelId: string; agentId: string; botId: string; channel: string };
  options: {
    models: { id: string; label: string }[];
    agents: { id: string; label: string }[];
    bots: string[];
    channels: string[];
  };
  totals: DesktopUsageTotals;
  windows: DesktopUsageWindow[];
  daily: DesktopUsageDailyPoint[];
  activity: DesktopUsageActivity;
  trend: DesktopUsageTrendPoint[];
  rankings: {
    models: DesktopUsageModelRow[];
    agents: DesktopUsageDimensionRow[];
    apis: DesktopUsageDimensionRow[];
    bots: DesktopUsageDimensionRow[];
    channels: DesktopUsageDimensionRow[];
    /** Per-conversation totals; only calls that ran inside a session carry one. */
    sessions: DesktopUsageDimensionRow[];
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

export interface DesktopModelOutcomes {
  success: number;
  error: number;
  pending: number;
  aborted: number;
  blocked: number;
  other: number;
}

export interface DesktopTracePerformance {
  runOutcomes: DesktopModelOutcomes;
  estimatedCostUsd: number | null;
  pricedModelCalls: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface DesktopTraceTrendPoint {
  key: string;
  label: string;
  modelCalls: number;
  toolCalls: number;
  mcpCalls: number;
}

export interface DesktopTraceTotals extends DesktopTracePerformance {
  mcpCalls: number;
  modelOutcomes: DesktopModelOutcomes;
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
  outcomes: DesktopModelOutcomes;
  id: string;
  provider: string;
  model: string;
  api: string;
  avgDurationMs: number;
}

export interface DesktopTraceEntityRow extends DesktopTracePerformance {
  outcomes: DesktopModelOutcomes;
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
  agentId?: string;
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
    agentId: string;
    modelId: string;
    botId: string;
    channel: string;
    chatId: string;
    sessionId: string;
    runId: string;
  };
  options: { models: { value: string; label: string }[]; agents: { id: string; label: string }[]; bots: string[]; channels: string[] };
  totals: DesktopTraceTotals;
  trend: DesktopTraceTrendPoint[];
  rankings: {
    tools: DesktopTraceToolRow[];
    skills: DesktopTraceSkillRow[];
    models: DesktopTraceModelRow[];
    agents: DesktopTraceEntityRow[];
    channels: DesktopTraceEntityRow[];
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

export interface DesktopAgentActivityRunItem {
  status: Exclude<DesktopAgentActivityStatus, "idle">;
  runId: string;
  channel: string;
  botId: string;
  botName: string;
  taskPreview: string;
  startedAt: string;
  finishedAt: string;
  subagents: DesktopSubagentActivityItem[];
}

export interface DesktopAgentActivityItem {
  agentId: string;
  status: DesktopAgentActivityStatus;
  /** Empty when the Agent is idle and this record only carries recent run history. */
  runId: string;
  channel: string;
  botId: string;
  botName: string;
  taskPreview: string;
  startedAt: string;
  finishedAt: string;
  subagents: DesktopSubagentActivityItem[];
  /** Newest first; includes concurrent active runs and recent terminal runs. */
  runs: DesktopAgentActivityRunItem[];
}

export interface DesktopAgentActivityResponse {
  ok: true;
  generatedAt: string;
  items: DesktopAgentActivityItem[];
}

/**
 * Agent Handover (PA-HD1–13): the Default Agent's home is a projection of runtime
 * evidence, not a Session. The read model is the only place that decides what
 * counts as one item, how items are ordered and how they de-duplicate; the
 * client only renders this payload.
 */
export type DesktopHandoverState = "first-run" | "quiet" | "active";

export type DesktopHandoverItemKind =
  | "task-completed"
  | "task-recovered"
  | "task-failed"
  | "run-completed"
  | "run-failed";

/**
 * Why an entry failed, in machine terms. The page owns the wording so the same
 * fact reads correctly in Chinese and English; `detail` stays the diagnostic.
 */
export type DesktopHandoverDetailCode =
  | "model_auth"
  | "model_missing"
  | "account_balance"
  | "run_budget"
  | "other";

/**
 * What a delivery is for reading. The deliverer declares the type and its
 * bounded content; the runtime adds the period, run and time. `generic` is the
 * first-class fallback for an ordinary text result, never a guessed type.
 */
export type DesktopDeliveryDisplayType = "briefing" | "topic-proposals" | "document" | "generic";

export interface DesktopDeliverySourceReference {
  label: string;
  /** Only http(s) links survive projection; a source without one stays text. */
  url?: string;
}

export interface DesktopBriefingHighlight {
  title: string;
  takeaway: string;
  sources?: DesktopDeliverySourceReference[];
}

export interface DesktopBriefingDisplay {
  type: "briefing";
  title: string;
  introduction?: string;
  /** At most three; the page does not invent a fourth. */
  highlights: DesktopBriefingHighlight[];
  /** Optional body preview; the exact source document is opened from the item. */
  bodyPreview?: string;
  artifactPath?: string;
}

export interface DesktopTopicCandidate {
  id: string;
  title: string;
  angle: string;
  rationale?: string;
  outline?: string[];
  materials?: string[];
  sources?: DesktopDeliverySourceReference[];
}

export interface DesktopTopicProposalsDisplay {
  type: "topic-proposals";
  title: string;
  /** Only when the deliverer explicitly ranked one candidate. */
  recommendedCandidateId?: string;
  candidates: DesktopTopicCandidate[];
}

export interface DesktopDocumentDisplay {
  type: "document";
  title: string;
  summary?: string;
  artifactPath?: string;
}

export interface DesktopGenericDisplay {
  type: "generic";
  title?: string;
  summary?: string;
  artifactPath?: string;
}

export type DesktopDeliveryDisplay =
  | DesktopBriefingDisplay
  | DesktopTopicProposalsDisplay
  | DesktopDocumentDisplay
  | DesktopGenericDisplay;

/**
 * Delivery is reported separately from generation. Missing evidence stays
 * `unknown`; a completed run is not the same claim as a delivery receipt.
 */
export type DesktopDeliveryState = "delivered" | "failed" | "unknown" | "not_required";

export interface DesktopDeliveryReceipt {
  status: DesktopDeliveryState;
  channel?: string;
  at?: string;
  detail?: string;
}

export interface DesktopHandoverItem {
  executionId?: string;
  id: string;
  kind: DesktopHandoverItemKind;
  occurredAt: string;
  agentId: string;
  sessionId?: string;
  /** Source channel of the session, used to open a channel-only history. */
  channel?: string;
  runId?: string;
  taskId?: string;
  /** The planned trigger slot this result belongs to; retries share one period. */
  periodSlot?: string;
  /** User-authored task text or the run's message preview; never model prose. */
  title: string;
  /** Error summary for a failure, or the delivered result of a task. */
  detail?: string;
  /** Machine-readable reason behind a failure `detail`. */
  detailCode?: DesktopHandoverDetailCode;
  /** What the run actually delivered, when the session still has it. */
  resultPreview?: string;
  /** Typed reading surface declared by the deliverer, validated by the read model. */
  display?: DesktopDeliveryDisplay;
  delivery?: DesktopDeliveryReceipt;
  durationMs?: number;
  /** Attempts including retries; only set for task executions. */
  attempts?: number;
  /** The task's real next run, when the scheduler knows one. */
  nextRunAt?: string;
}

export type DesktopHandoverPendingKind = "approval" | "decision" | "plan" | "run";

export interface DesktopHandoverPending {
  id: string;
  kind: DesktopHandoverPendingKind;
  title: string;
  detail?: string;
  createdAt: string;
  agentId: string;
  sessionId?: string;
  channel?: string;
  runId?: string;
  /** Approval id shared with the source Session (PA-HD9). */
  requestId?: string;
  /** For a waiting run: which kind of wait keeps it here. */
  waitKind?: "approval" | "recovery";
  /**
   * The Durable/Plan approval row. It differs from `requestId` and is what the
   * tool-approval bridge needs to resolve the execution and its Broker or Host
   * Bash record together.
   */
  approvalId?: string;
  executionId?: string;
  decisionId?: string;
  expectedVersion?: number;
  planId?: string;
  /** Options for a decision or the two plan approval modes. */
  options?: string[];
  /** The relier's own goal, available from the plan execution when one exists. */
  goal?: string;
  /** What the action covers, e.g. an approval's summary. */
  scope?: string;
  /** The deliverer's recommendation, only when the source provides one. */
  recommendation?: string;
  /** A real deadline from the source; never inferred from age. */
  deadline?: string;
  /** False when this surface cannot resolve the item in place (e.g. channel-only approval). */
  actionable: boolean;
}

export interface DesktopHandoverCounts {
  completed: number;
  failed: number;
  pending: number;
  /** Completed after a retry; shown as one line, never as a separate failure. */
  recovered: number;
}

/**
 * Ad-hoc conversations that happened on another channel. The user already
 * answered them there, so they are not "work done while away" and must not be
 * listed as individual results; one summary keeps the page honest without
 * repeating the recent-conversation list.
 */
export interface DesktopHandoverCrossChannel {
  count: number;
  /** Unique source channels, in the order they first appear. */
  channels: string[];
  /** Newest reply in the group. */
  latestAt: string;
}

export interface DesktopHandoverNextScheduled {
  at: string;
  title: string;
  source: "task" | "durable";
  sessionId?: string;
  agentId?: string;
  taskId?: string;
}

/** Compact projection kept for one generation; bodies are dropped (PA-HD13). */
export interface DesktopHandoverSnapshot {
  capturedAt: string;
  itemCount: number;
  pendingCount: number;
  counts: DesktopHandoverCounts;
  items: Array<Omit<DesktopHandoverItem, "detail" | "display">>;
}

/**
 * One standardized home notification: a pointer to something the owner should
 * see or review, typed so the client can render the right card and resolve the
 * detail from the owning system. Read state is server-side and owner-level.
 */
export type DesktopHomeNotificationType =
  | "memory-review"
  | "materials"
  | "task-result"
  | "task-failed"
  | "action-required"
  | "plan-completed"
  | "cross-channel";

export interface DesktopHomeNotification {
  id: string;
  type: DesktopHomeNotificationType;
  /** The id of the entity this row points at (execution id, batch id…). */
  refId?: string;
  botId?: string;
  projectId?: string;
  /** Type-specific structured fields; the client renders per type. */
  payload: Record<string, unknown>;
  status: "unread" | "read" | "resolved";
  createdAt: string;
  readAt?: string;
  updatedAt: string;
}

export interface DesktopHomeNotificationsResponse {
  ok: boolean;
  notifications?: DesktopHomeNotification[];
  error?: string;
}

/** Pending personal/Agent candidates, independent of the handover event window. */
export interface DesktopHomeMemoryReview {
  /** Live pending count, capped at 100; drives the notification card. */
  pendingReviewCount?: number;
  skillDraftCount?: number;
  skillDraftHasMore?: boolean;
  items: DesktopMemoryCandidate[];
  hasMore: boolean;
  unavailable: boolean;
}

export interface DesktopHandover {
  state: DesktopHandoverState;
  generatedAt: string;
  lastAcknowledgedAt?: string;
  counts: DesktopHandoverCounts;
  items: DesktopHandoverItem[];
  pending: DesktopHandoverPending[];
  memoryReview?: DesktopHomeMemoryReview;
  nextScheduled?: DesktopHandoverNextScheduled;
  nextScheduledItems?: DesktopHandoverNextScheduled[];
  /** Replies the user already saw on another channel; one aggregate only. */
  crossChannel?: DesktopHandoverCrossChannel;
  /** The frozen previous generation, only while a quick return can still use it. */
  previous?: DesktopHandoverSnapshot;
}

export interface DesktopHandoverResponse {
  ok: true;
  handover: DesktopHandover;
}

export interface DesktopHandoverAckResponse {
  ok: true;
  lastAcknowledgedAt: string;
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
  /** The one sandbox backend; replaces the preset selector and enable switch. */
  backend: {
    id: string;
    name: string;
    supportedPlatform: boolean;
    dependenciesAvailable: boolean;
    supportsNetworkDomainRestrictions: boolean;
    supportsFilesystemRestrictions: boolean;
    supportsEnvInjection: boolean;
  };
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
    platform: string;
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

/** The installation-wide default execution mode ("Execution & permissions" settings). */
export interface DesktopExecutionDefaultResponse {
  ok: true;
  mode: "plan" | "manual" | "accept_edits" | "auto";
}

export interface DesktopExecutionDefaultPatchResponse {
  ok: true;
  mode: "plan" | "manual" | "accept_edits" | "auto";
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
  scope?: { kind: "bot" | "project" | "agent"; label: string };
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
  maintenance?: boolean;
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

export type DesktopTaskExecutionStatus = "running" | "retry_wait" | "completed" | "failed" | "aborted" | "skipped" | "interrupted" | "waiting_approval";

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
  /** The run's tool activity, so the transcript shows what the automation actually did. */
  activities?: DesktopConversationActivity[];
}

export type DesktopSystemTaskExecutionResult =
  | { kind: "memory-reflection"; completedTargets: number; scannedConversations: number; scannedMessages: number; createdCandidates: number; committedMemories?: number; pendingReviewCount?: number; skillDraftCount?: number }
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
    waiting?: { kind: "user" | "approval" | "recovery" | "review"; reason: string };
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
  | { action: "activate"; ownerId?: string; executionId: string; expectedVersion: number }
  | { action: "pause" | "resume" | "cancel"; ownerId?: string; executionId: string; expectedVersion: number; actionId: string; reason?: string }
  | { action: "answer_decision"; ownerId?: string; executionId: string; decisionId: string; answer: string; expectedVersion: number; actionId: string }
  | { action: "resolve_approval"; ownerId?: string; executionId: string; approvalId: string; status: "approved" | "rejected" | "expired"; selectedScope?: string; expectedVersion: number; actionId: string };

export interface DesktopDurableExecutionActionResponse {
  ok: true;
  item: DesktopDurableExecutionItem;
}

/** Plan Board: a plan is the same aggregate as a Durable Execution, viewed for editing. */
export type DesktopPlanStatus = "not_started" | "in_progress" | "needs_attention" | "finished" | "archived";

export interface DesktopPlanListItem {
  planId: string;
  shortHandle: string;
  title: string;
  summary: string;
  projectId?: string;
  status: DesktopDurableExecutionStatus;
  planStatus: DesktopPlanStatus;
  archived: boolean;
  version: number;
  currentPlanVersion: number;
  progress: { completed: number; total: number; currentStepTitle?: string };
  waitingReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DesktopPlanMeta {
  executionId: string;
  title: string;
  summary: string;
  updatedAt: string;
}

export interface DesktopPlanTask {
  id: string;
  executionId: string;
  planVersion: number;
  index: number;
  title: string;
  description: string;
  steps: DesktopDurableExecutionStep[];
}

export interface DesktopPlanDetail extends DesktopDurableExecutionInspection {
  agentId?: string;
  binding?: { sessionId: string; agentId: string; mode: "manual" | "accept_edits"; approvedVersion: number };
  controlRequest?: "pause" | "cancel";
  meta: DesktopPlanMeta;
  tasks: DesktopPlanTask[];
}

export interface DesktopPlanListResponse {
  ok: true;
  total: number;
  projectIds: string[];
  counts: Record<string, number>;
  items: DesktopPlanListItem[];
}

export interface DesktopPlanDetailResponse {
  ok: true;
  item: DesktopPlanDetail;
}

// ---- Kanban Task Board ------------------------------------------------------

export type DesktopKanbanStage = "todo" | "doing" | "done" | "cancelled";

export type DesktopKanbanDoingSubState =
  | "queued" | "running" | "verifying" | "waiting_user" | "waiting_approval"
  | "paused" | "recovery" | "stopped" | "pending_acceptance";

export interface DesktopKanbanBoardItem {
  executionId: string;
  shortHandle: string;
  kind: "kanban" | "legacy-plan";
  stage: DesktopKanbanStage;
  doingSubState?: DesktopKanbanDoingSubState;
  title: string;
  goal: string;
  projectId?: string;
  form?: "single" | "team";
  executorLabel?: string;
  currentAgentId?: string;
  waitingReason?: string;
  /** Legacy plans only: step progress. */
  progress?: { completed: number; total: number };
  /** Kanban tasks only: present when the task maintains a checklist. */
  checklist?: { doneChecked: number; checkedTotal: number };
  budgetTokensUsed?: number;
  budgetTokenLimit?: number;
  handoffCount?: number;
  handoffLimit?: number;
  autoStart?: boolean;
  humanAcceptance?: boolean;
  approvalPolicy?: "suspend" | "deny";
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface DesktopKanbanBoardPage {
  ok: true;
  total: number;
  projectIds: string[];
  counts: { all: number; todo: number; doing: number; done: number; cancelled: number };
  items: DesktopKanbanBoardItem[];
}

export interface DesktopKanbanReceipt {
  receiptId: string;
  round: number;
  actorAgentId: string;
  actions: {
    conclusion?: string;
    evidence?: string[];
    continueWork?: boolean;
    handoffTo?: { agentId: string; brief: string };
    question?: { text: string; options?: string[] };
    verifyAt?: string;
    requestCompletion?: boolean;
  };
  createdAt: string;
}

export interface DesktopKanbanChecklistItem {
  itemId: string;
  text: string;
  done: boolean;
  updatedRound: number;
}

export interface DesktopKanbanTaskBundle {
  ok: true;
  task: {
    executionId: string;
    form: "single" | "team";
    title: string;
    goal: string;
    coordinatorAgentId?: string;
    members: Array<{ agentId: string; name: string }>;
    projectId?: string;
    workDir?: string;
    completionSource: "user" | "generated" | "pending";
    budgetTokenLimit?: number;
    handoffLimit: number;
    approvalPolicy: "suspend" | "deny";
    humanAcceptance: boolean;
    autoStart: boolean;
    handoffCount: number;
    currentAgentId?: string;
    roundCount: number;
    retryCount: number;
    nextRetryAt?: string;
    usageGapCount: number;
    createdAt: string;
    updatedAt: string;
  };
  detail: DesktopPlanDetail;
  receipts: DesktopKanbanReceipt[];
  checklist: DesktopKanbanChecklistItem[];
  /** All recorded user inputs; `consumedRound` marks the round that consumed them. */
  inputs: Array<{ inputId: string; text: string; createdAt: string; consumedRound: number | null }>;
  handoffs: Array<{ id: string; round: number; fromAgentId: string | null; toAgentId: string; kind: "assign" | "dispatch" | "return"; brief: string; createdAt: string }>;
  /** Per-attempt conversation projection: tool activity and the final model reply, ordered by time. */
  attempts: Array<{ attemptId: string; runId: string; round: number | null; text: string; activities: DesktopConversationActivity[]; updatedAt: string }>;
  /** Member child sessions (team tasks): read-only views nested under the main conversation. */
  memberSessions: Array<{ agentId: string; sessionId: string }>;
}

export interface DesktopKanbanCreateRequest {
  action: "kanban_create";
  form: "single" | "team";
  title: string;
  goal: string;
  agentId?: string;
  coordinatorAgentId?: string;
  members?: Array<{ agentId: string; name: string }>;
  projectId?: string;
  workDir?: string;
  completionConditions?: Array<{ description: string; required?: boolean }>;
  completionSource?: "user" | "generated" | "pending";
  budgetTokenLimit?: number;
  handoffLimit?: number;
  approvalPolicy?: "suspend" | "deny";
  humanAcceptance?: boolean;
  autoStart?: boolean;
}

/**
 * Read-only executor diagnostics for the plan detail page: lease ownership and
 * remaining time, wakeup rows, the last confirmed tool boundary and a
 * human-readable blocked reason.
 */
export interface DesktopPlanDiagnostics {
  execution: DesktopPlanDetail["execution"];
  attempt?: DesktopPlanDetail["attempts"][number];
  lease?: { ownerId: string; expiresAt: string; remainingMs: number };
  wakeups: Array<{
    id: string;
    expectedVersion: number;
    reason: "advance" | "verify" | "capacity" | "resume" | "control" | "retry";
    runAt: string;
    status: "pending" | "claimed" | "done" | "discarded" | "failed";
    attempts: number;
    maxAttempts: number;
    claimedBy?: string;
    lastError?: string;
    createdAt: string;
    updatedAt: string;
  }>;
  uncertainSteps: Array<{ id: string; title: string; reason?: string }>;
  blockedReason?: string;
  queuePosition?: number;
  nextRunAt?: string;
  progress: {
    attemptId?: string;
    lastCompletedTool?: { toolCallId: string; toolId: string; status: "completed" | "failed"; summary?: string; createdAt: string };
    pendingTools: Array<{ toolCallId: string; toolId: string; status: "completed" | "failed"; summary?: string; createdAt: string }>;
  };
  scheduler: { ownerId: string; fatalError?: string };
  migration?: { scanned: number; enqueued: number; stale: number; discarded: number; failed: number };
}

export interface DesktopPlanDiagnosticsResponse {
  ok: true;
  diagnostics: DesktopPlanDiagnostics;
}

export interface DesktopPlanTaskInput {
  id?: string;
  title: string;
  description?: string;
  steps: Array<{
    id?: string;
    title: string;
    description?: string;
    sideEffectClass?: "pure" | "idempotent" | "queryable" | "non_idempotent";
    idempotencyKey?: string;
    inputSummary?: string;
  }>;
}

export type DesktopPlanActionRequest =
  | { action: "approve"; planId: string; expectedVersion: number; sessionId?: string; mode: "manual" | "accept_edits" }
  | { action: "edit"; executionId: string; expectedVersion: number; title: string; summary: string; tasks: DesktopPlanTaskInput[]; acceptanceCriteria: Array<{ description: string; required?: boolean }> }
  | { action: "answer"; planId: string; expectedVersion: number; actionId: string; decisionId: string; answer: string }
  | { action: "approval"; planId: string; expectedVersion: number; actionId: string; approvalId: string; status: "approved" | "rejected" }
  | { action: "propose"; planId: string; expectedVersion: number; instruction: string }
  | { action: "start" | "pause" | "resume" | "cancel"; ownerId?: string; planId: string; expectedVersion: number; actionId?: string; reason?: string }
  | { action: "delete"; ownerId?: string; planId: string; expectedVersion?: number }
  | { action: "complete"; ownerId?: string; planId: string; expectedVersion: number; actionId: string }
  | DesktopKanbanCreateRequest
  | { action: "kanban_start"; ownerId?: string; planId: string; expectedVersion: number; actionId: string }
  | { action: "kanban_answer"; ownerId?: string; planId: string; text: string }
  | { action: "kanban_steer"; ownerId?: string; planId: string; text: string }
  | { action: "kanban_budget"; ownerId?: string; planId: string; expectedVersion: number; addTokens: number }
  | { action: "kanban_conditions"; ownerId?: string; planId: string; expectedVersion: number; conditions: string[] }
  | {
      action: "revise";
      ownerId?: string;
      executionId: string;
      expectedVersion: number;
      reason: string;
      title?: string;
      summary?: string;
      addTasks: DesktopPlanTaskInput[];
      addCriteria?: Array<{ description: string; required?: boolean; checkerType?: "deterministic" | "subjective"; checkerKey?: string }>;
    };

export interface DesktopPlanActionResponse {
  ok: true;
  expectedVersion?: number;
  draft?: { title: string; summary: string; tasks: DesktopPlanTaskInput[]; acceptanceCriteria: Array<{ description: string; required?: boolean }> };
  item?: DesktopPlanDetail;
  deleted?: boolean;
  title?: string;
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
  agentId?: string;
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

/** Category split of a dispatched context, mirrored from `ConversationContextSnapshot`. */
export interface DesktopContextUsageBreakdown {
  messages: number;
  memory: number;
  files: number;
  toolResults: number;
  mcpTools: number;
  systemTools: number;
  systemPrompt: number;
  skills: number;
  other: number;
}

/**
 * Category split of the dispatched context joined with the real prompt usage
 * the provider reported for that same model call (see `SessionContextSnapshot`).
 * Present on assistant messages since the feature shipped; older rows simply
 * lack it. When `reportedPromptTokens` is set the breakdown is calibrated to
 * it and the categories are measured values, not estimates.
 */
export interface DesktopContextUsageSnapshot {
  contextWindow: number;
  estimatedTokens: number;
  breakdown: DesktopContextUsageBreakdown;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reportedPromptTokens?: number;
}

export interface DesktopConversationMessage {
  traceRunIds?: string[];
  /** Execution duration, excluding time spent waiting before this run started. */
  durationMs?: number;
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  /** Answer semantics of `content`; absent = legacy turn recorded before result semantics. */
  resultKind?: "final" | "partial" | "none" | "legacy";
  createdAt: string;
  model?: string;
  thinking?: string;
  stopReason?: string;
  errorMessage?: string;
  attachments?: DesktopMessageAttachment[];
  activities?: DesktopConversationActivity[];
  steps?: DesktopConversationStep[];
  usage?: DesktopConversationTokenUsage;
  contextBreakdown?: DesktopContextUsageSnapshot;
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
  kind: "tool" | "subagent" | "note" | "retry";
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
  /** Successful Project or Session scratch result shown in the completed-turn file list. */
  fileOutput?: {
    path: string;
    rootKind: "project" | "scratch";
    action: "created" | "modified";
  };
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
  /** The turn's deliverable text, marked by the runtime (never inferred on read). */
  | { id: string; kind: "result"; content: string }
  | { id: string; kind: "thinking"; content: string }
  | { id: string; kind: "activity"; activity: DesktopConversationActivity }
  | { id: string; kind: "plan"; plan: DesktopConversationPlan };

export interface DesktopConversationPlan {
  updatedAt?: string;
  progressSummary?: string;
  id: string;
  title: string;
  summary: string;
  steps: Array<{ id: string; text: string; status: "pending" | "in_progress" | "completed" | "blocked" }>;
  status: "proposed" | "accepted" | "rejected" | "executing" | "completed" | "blocked" | "waiting_review" | "paused" | "queued" | "verifying" | "waiting_for_approval" | "waiting_for_user" | "cancelled" | "failed";
  recommendedMode: "manual" | "accept_edits";
  artifactPath: string;
  durableExecutionId?: string;
  durableVersion?: number;
}

/**
 * Server-summed model usage attributed to one session (docs/requirements/
 * session-usage-summary.md). `available: false` means the ledger could not be
 * read — it must never render as zero usage. `coverageStart` marks the
 * earliest recorded call, the explicit boundary for sessions predating
 * per-session attribution.
 */
export interface DesktopSessionUsageSummary {
  available: boolean;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  coverageStart: string | null;
}

export interface DesktopSessionDetail extends DesktopSessionSummary {
  messages: DesktopConversationMessage[];
  usage: DesktopSessionUsageSummary;
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

/** Per-session Thinking strategy override. Null means inherit the defaults. */
export interface DesktopSessionThinkingResponse {
  ok: true;
  thinkingLevel: DesktopThinkingSelection | null;
}

export interface DesktopSessionThinkingUpdateRequest {
  profileId?: string;
  conversationId: string;
  thinkingLevel: DesktopThinkingSelection | null;
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
  expectedVersion?: number;
  profileId: string;
  conversationId: string;
  planId: string;
  decision: "accept" | "reject" | "modify" | "complete";
  mode?: "manual" | "accept_edits";
  title?: string;
  summary?: string;
  steps?: string[];
}

export interface DesktopSessionFile {
  origin: "generated" | "uploaded" | "unknown";
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
export type DesktopThinkingSelection = DesktopThinkingLevel | "auto";

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
  kind: "bot" | "project" | "agent";
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
  samplingParams?: Record<string, unknown>;
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
  /** Optional embedding model on this provider; auto-detected when empty. */
  embeddingModel?: string;
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

/** Explicit reveal only; provider summaries never include credentials. */
export interface DesktopProviderKeyRevealRequest {
  action: "reveal-api-key";
  id: string;
}

export interface DesktopProviderKeyRevealResponse {
  ok: true;
  apiKey: string;
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
  embeddingModel?: string;
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

export interface DesktopDiscoveredModelItem {
  id: string;
  alias?: string;
  tags?: DesktopProviderModelTag[];
  contextWindow?: number;
  thinking?: boolean;
}

export interface DesktopProviderModelsResponse {
  ok: true;
  models: string[];
  items?: DesktopDiscoveredModelItem[];
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
  visible?: boolean;
  avatar?: string;
  shareOwnerMemory?: boolean;
  disabledSkillPaths?: string[];
  disabledTools?: string[];
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  /** Server-resolved execution gate: enabled and not mid-deletion. */
  canExecute: boolean;
  /** null = inherit from the override chain; never "off". */
  permissionMode: "plan" | "manual" | "accept_edits" | "auto" | null;
  modelOverrides: number;
  modelRouting: { textModelKey: string; sttModelKey: string };
}

export interface DesktopAgentSaveRequest {
  visible?: boolean;
  avatar?: string;
  shareOwnerMemory?: boolean;
  disabledSkillPaths?: string[];
  disabledTools?: string[];
  previousId?: string;
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  /** null = inherit from the override chain; never "off". */
  permissionMode: "plan" | "manual" | "accept_edits" | "auto" | null;
  modelRouting: { textModelKey: string; sttModelKey: string };
}

export interface DesktopAgentsSummary {
  deletedAgentIds?: string[];
  defaultAgentId?: string;
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
  timeoutMs?: number;
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
  authMode: "headers" | "oauth";
  authState: "not_applicable" | "unauthorized" | "authorizing" | "authorized" | "expired" | "error";
  authError: string;
}

export interface DesktopMcpSaveRequest {
  timeoutMs?: number;
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
  authMode?: "headers" | "oauth";
  authServerMetadataUrl?: string;
  clientName?: string;
}

export interface DesktopMcpSummary {
  items: DesktopMcpItem[];
  counts: { total: number; enabled: number; stdio: number; http: number };
}

export interface DesktopMcpResponse {
  ok: true;
  summary: DesktopMcpSummary;
}

/** OAuth login/re-authorize response: the summary plus the browser redirect to open. */
export interface DesktopMcpOAuthResponse extends DesktopMcpResponse {
  loginId?: string;
  authorizationUrl?: string;
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

/**
 * Where a Skill lives. `agent` skills sit in one Agent's workspace `skills/`
 * directory (`sessions/<agentId>/skills` — sessions are stored per Agent) and
 * apply to that Agent only; `global` skills sit in the data root and apply to
 * every Agent; `chat` is the legacy per-chat layer; `project` is a project's
 * `.agents/skills`.
 */
export type DesktopSkillScope = "global" | "agent" | "chat" | "project";

export interface DesktopSkillItem {
  id: string;
  name: string;
  description: string;
  scope: DesktopSkillScope;
  enabled: boolean;
  mcpServerCount: number;
  /** The owning Agent's id when `scope` is `"agent"` (the `sessions/` directory name). */
  agentId: string;
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
 * on disk as the owner's copy. This is what lets the Skills workspace show which version is
 * installed, and offer to write the shipped one over it.
 */
export interface DesktopBuiltinSkillState {
  id: string;
  /** Opaque identity of the workspace copy, including when it is not installed. */
  skillId: string;
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
  counts: { total: number; enabled: number; global: number; agent: number; chat: number };
  search: DesktopSkillSearch;
  /** Built-in Skills and their installed-vs-shipped version state. */
  builtins: DesktopBuiltinSkillState[];
}

export interface DesktopSkillsResponse {
  ok: true;
  summary: DesktopSkillsSummary;
}

/** One entry in a Skill's on-disk directory, relative to the Skill directory. */
export interface DesktopSkillFileEntry {
  path: string;
  kind: "file" | "dir";
  size: number;
}

/**
 * Full detail for one Skill, fetched only when the owner opens it.
 *
 * The list projection ({@link DesktopSkillItem}) deliberately drops on-disk
 * paths because it is loaded for every Skill on every visit. This is the
 * narrow, on-demand exception: one Skill the owner explicitly selected, so it
 * may carry the path and directory listing the detail pane renders.
 */
export interface DesktopSkillDetail {
  id: string;
  name: string;
  description: string;
  scope: DesktopSkillScope;
  enabled: boolean;
  /** The owning Agent's id when `scope` is `"agent"`. */
  agentId: string;
  chatId: string;
  mcpServers: string[];
  /** Absolute path of the Skill's SKILL.md. */
  filePath: string;
  /** Absolute path of the Skill directory. */
  baseDir: string;
  /** Frontmatter as an ordered flat list; nested maps become dotted keys. */
  frontmatter: Array<{ key: string; value: string }>;
  /** SKILL.md last-modified time, ISO-8601. */
  updatedAt: string;
  /** Frontmatter `version` when the Skill declares one, else "". */
  version: string;
  builtin: DesktopBuiltinSkillState | null;
  files: DesktopSkillFileEntry[];
}

export interface DesktopSkillDetailResponse {
  ok: true;
  detail: DesktopSkillDetail;
}

export interface DesktopSkillFileResponse {
  ok: true;
  path: string;
  content: string;
  /** The file was larger than the preview cap and was truncated. */
  truncated: boolean;
  /** The file is not text and has no preview. */
  binary: boolean;
}

export interface DesktopSkillRevealRequest {
  id: string;
}

/* ── Skill Manager ─────────────────────────────────────────────────────────
 * The unified discovery, installation and distribution surface. Identity is
 * opaque: the client never sends a path, and the list projection carries no
 * filesystem locations — only the detail and preflight views do, and only for
 * a Skill the owner explicitly opened.
 */

export type DesktopSkillManagerScope = "global" | "agent" | "project";
export type DesktopSkillInstallMethod = "copy" | "link" | "external";
export type DesktopSkillHealth = "ok" | "disabled" | "missing" | "broken" | "invalid" | "unmanaged";
export type DesktopSkillSourceKind = "builtin" | "git" | "registry" | "local" | "unknown";

export interface DesktopSkillSourceView {
  kind: DesktopSkillSourceKind;
  label: string;
  commit: string;
  subdirectory: string;
  path: string;
}

export interface DesktopSkillInstallationState {
  id: string;
  managed: boolean;
  method: DesktopSkillInstallMethod;
  baselineHash: string;
  observedHash: string;
  /** The content changed after installation (an external edit or a link's source). */
  localChanges: boolean;
  fileCount: number;
  installedAt: string;
  /** The entry that owns the files; only present when the entry is a link. */
  linkTarget: string;
}

export interface DesktopSkillManagerEntry {
  id: string;
  name: string;
  description: string;
  scope: DesktopSkillManagerScope;
  /** Agent or project id; empty for global entries. */
  ownerId: string;
  ownerLabel: string;
  enabled: boolean;
  method: DesktopSkillInstallMethod;
  managed: boolean;
  health: DesktopSkillHealth;
  mcpServerCount: number;
  fileCount: number;
  updatedAt: string;
  /** Other Molibot entries that resolve to the same physical directory. */
  duplicateEntryCount: number;
  /** Platforms, other than Molibot, that also read this physical entry. */
  readBy: string[];
  activeDistributions: number;
  source: DesktopSkillSourceView | null;
  builtin: DesktopBuiltinSkillState | null;
}

export interface DesktopDiscoveredSkill {
  id: string;
  name: string;
  description: string;
  platformId: string;
  platformLabel: string;
  recommendedMethod: "copy" | "link";
  linkable: boolean;
  installed: boolean;
  sharedWith: string[];
  /** A Molibot entry with the same name already exists. */
  nameExists: boolean;
  conflict: boolean;
  /** The same name exists in more than one physical directory. */
  duplicate: boolean;
  /** Every entry pointing at this content is a symbolic link. */
  linked: boolean;
  /** The content lives inside the shared `~/.agents/skills` tree. */
  inSharedDir: boolean;
  entryCount: number;
  health: "ok" | "invalid" | "broken";
  updatedAt: string;
}

/** One filesystem entry that resolves to a Skill, wherever a tool reads it. */
export interface DesktopSkillLocation {
  platformLabel: string;
  path: string;
  isLink: boolean;
  status: "ok" | "broken";
}

export interface DesktopSkillPlatformRoot {
  path: string;
  scope: DesktopSkillManagerScope;
  ownerLabel: string;
  exists: boolean;
  skillCount: number;
}

export interface DesktopSkillPlatform {
  id: string;
  kind: "preset" | "custom";
  label: string;
  enabled: boolean;
  writable: boolean;
  verified: boolean;
  summary: string;
  roots: DesktopSkillPlatformRoot[];
  sharedWith: string[];
  errorCount: number;
}

export interface DesktopSkillDiagnostic {
  code: string;
  message: string;
  platformId: string;
}

export interface DesktopSkillOperationView {
  id: string;
  kind: "install" | "replace" | "distribute" | "uninstall" | "restore" | "toggle" | "platform" | "consolidate" | "maintenance";
  status: "pending" | "committed" | "failed" | "recovered";
  targetPath: string;
  error: string;
  createdAt: string;
  updatedAt: string;
}

export interface DesktopSkillManagerDevice {
  label: string;
  execution: "server";
  platform: string;
  scannedAt: string;
  note: string;
}

export interface DesktopSkillManagerSummary {
  device: DesktopSkillManagerDevice;
  counts: {
    installed: number;
    enabled: number;
    global: number;
    agent: number;
    project: number;
    discovered: number;
    anomalies: number;
    distributed: number;
  };
  installed: DesktopSkillManagerEntry[];
  discovered: DesktopDiscoveredSkill[];
  platforms: DesktopSkillPlatform[];
  diagnostics: DesktopSkillDiagnostic[];
  recentOperation: DesktopSkillOperationView | null;
  capabilities: {
    gitInstall: boolean;
    localInstall: boolean;
    distribute: boolean;
    uninstall: boolean;
    /** Skills installed from a Git repository can check the source for updates. */
    gitUpdate: boolean;
  };
  /** Project targets the distribution step may write to. */
  targets: Array<{ id: string; label: string; kind: "platform" | "project"; writable: boolean; reason: string }>;
  /** Registered Agents, so a fresh install can target one before it owns a Skill. */
  agents: Array<{ id: string; label: string }>;
}

export interface DesktopSkillManagerResponse {
  ok: true;
  summary: DesktopSkillManagerSummary;
}

export interface DesktopSkillManagerDetail {
  kind: "installed" | "discovered";
  id: string;
  name: string;
  description: string;
  scope: DesktopSkillManagerScope | "external";
  ownerId: string;
  ownerLabel: string;
  enabled: boolean;
  method: DesktopSkillInstallMethod;
  managed: boolean;
  health: DesktopSkillHealth | "ok";
  filePath: string;
  baseDir: string;
  realDir: string;
  /** True when the entry itself is a link (the path differs from its target). */
  linked: boolean;
  frontmatter: Array<{ key: string; value: string }>;
  files: DesktopSkillFileEntry[];
  mcpServers: string[];
  version: string;
  updatedAt: string;
  liveContent: boolean;
  source: DesktopSkillSourceView | null;
  installation: DesktopSkillInstallationState | null;
  distributions: Array<{
    id: string;
    targetPath: string;
    targetLabel: string;
    method: DesktopSkillInstallMethod;
    status: "active" | "removed" | "failed";
  }>;
  builtin: DesktopBuiltinSkillState | null;
  treeProblems: Array<{ code: string; message: string; path: string }>;
  readBy: string[];
  /** Every filesystem entry that resolves to this Skill, across all tools. */
  locations: DesktopSkillLocation[];
  /** What the real Runtime loader does with this entry in its own context. */
  runtime: {
    loaded: boolean;
    reason: "loaded" | "disabled" | "duplicate_name" | "invalid" | "missing" | "not_loaded" | "no_workspace";
    message: string;
  };
}

export interface DesktopSkillManagerDetailResponse {
  ok: true;
  detail: DesktopSkillManagerDetail;
}

export type DesktopSkillInstallSourceRequest =
  | { kind: "discovered"; id: string }
  | { kind: "local"; path: string }
  | { kind: "git"; repository: string; ref?: string; subdirectory: string };

export interface DesktopSkillPreflightRequest {
  source: DesktopSkillInstallSourceRequest;
  method: "copy" | "link";
  scope: DesktopSkillManagerScope;
  ownerId?: string;
  /** Applies to a standalone copy only; links keep the source name. */
  rename?: string;
}

export interface DesktopSkillPreflightResult {
  ok: true;
  token: string;
  source: {
    kind: DesktopSkillInstallSourceRequest["kind"];
    label: string;
    name: string;
    description: string;
    path: string;
    realDir: string;
    commit: string;
    subdirectory: string;
    hash: string;
    fileCount: number;
    totalBytes: number;
    linkable: boolean;
  };
  target: {
    path: string;
    dirName: string;
    scope: DesktopSkillManagerScope;
    ownerLabel: string;
    root: string;
  };
  method: "copy" | "link";
  plan: {
    files: number;
    directories: number;
    links: number;
    executables: number;
    bytes: number;
  };
  conflicts: Array<{ code: string; message: string; path: string }>;
  requiresReplace: boolean;
  backup: { required: boolean; description: string };
  sharedConsumers: Array<{ platformId: string; label: string }>;
  warnings: string[];
  installable: boolean;
}

export interface DesktopSkillPreflightResponse {
  ok: true;
  preflight: DesktopSkillPreflightResult;
}

export interface DesktopSkillInstallRequest extends DesktopSkillPreflightRequest {
  token: string;
  replace: boolean;
}

export interface DesktopSkillInstallResult {
  ok: boolean;
  status: "installed" | "replaced" | "failed" | "stale";
  message: string;
  id: string;
  targetPath: string;
  method: "copy" | "link";
  backupPath: string;
}

export interface DesktopSkillDistributeRequest {
  installationId: string;
  targets: Array<{ kind: "platform" | "project"; id: string }>;
  method: "copy" | "link";
}

export interface DesktopSkillDistributeResult {
  ok: boolean;
  results: Array<{
    targetLabel: string;
    targetPath: string;
    status: "installed" | "skipped" | "failed";
    message: string;
  }>;
}

export interface DesktopSkillUninstallRequest {
  id: string;
}

export interface DesktopSkillUnlinkDistributionResult {
  ok: boolean;
  message: string;
}

export interface DesktopSkillUninstallResult {
  ok: boolean;
  status: "removed" | "blocked" | "failed";
  message: string;
  blockedBy: Array<{ targetPath: string; label: string }>;
}

export interface DesktopSkillManagerToggleRequest {
  id: string;
  enabled: boolean;
}

export interface DesktopSkillPlatformSaveRequest {
  /** Entity-level patch: only the platforms listed here are written. */
  platforms: Array<{
    id: string;
    kind: "preset" | "custom";
    label?: string;
    enabled: boolean;
    extraRoots: string[];
    removedRoots: string[];
  }>;
  /** Custom platform ids to remove, with their configuration only. */
  removed?: string[];
}

export type DesktopSkillConsolidateSourceKind = "discovered";
export type DesktopSkillConsolidateSourceAction = "link" | "remove" | "keep";

export interface DesktopSkillConsolidateRequest {
  sourceKind: DesktopSkillConsolidateSourceKind;
  id: string;
  /** What happens to the original entry after the canonical copy is written. */
  sourceAction: DesktopSkillConsolidateSourceAction;
  replaceDestination: boolean;
}

export interface DesktopSkillConsolidatePreflight {
  ok: true;
  alreadyShared: boolean;
  parentLink: { path: string; target: string } | null;
  token: string;
  source: {
    name: string;
    path: string;
    realDir: string;
    platformId: string;
    platformLabel: string;
    hash: string;
    fileCount: number;
    totalBytes: number;
  };
  destination: {
    label: string;
    root: string;
    path: string;
    exists: boolean;
  };
  backLink: { path: string; label: string } | null;
  conflicts: Array<{ code: string; message: string; path: string }>;
  plan: { files: number; directories: number; executables: number; bytes: number };
  installable: boolean;
}

export interface DesktopSkillConsolidateResponse {
  ok: true;
  preflight: DesktopSkillConsolidatePreflight;
}

export interface DesktopSkillConsolidateResult {
  ok: boolean;
  status: "consolidated" | "already_shared" | "failed" | "stale";
  message: string;
  destinationPath: string;
  backupPath: string;
}

export interface DesktopSkillRemoveDiscoveredRequest {
  id: string;
  /** Remove one entry only; omit to remove every entry of the group. */
  entryDir?: string;
}

export interface DesktopSkillRemoveDiscoveredResult {
  ok: boolean;
  message: string;
  removed: Array<{ path: string; kind: "link" | "copy" }>;
  backups: string[];
  /** Links left behind that no longer resolve after this removal. */
  brokenLinks: string[];
}

export interface DesktopSkillCheckUpdateRequest {
  id: string;
}

export interface DesktopSkillCheckUpdateResult {
  ok: boolean;
  message: string;
  repository: string;
  subdirectory: string;
  currentCommit: string;
  latestCommit: string;
  hasUpdate: boolean;
  localChanges: boolean;
}

export interface DesktopSkillMaintenanceEntry {
  id: string;
  name: string;
  path: string;
  realPath: string;
  platforms: string[];
  scope: string;
  isLink: boolean;
  writable: boolean;
  hash: string;
  bytes: number;
  problems: string[];
}

export interface DesktopSkillMaintenanceGroup {
  id: string;
  name: string;
  scope: string;
  relation: "identical" | "different" | "linked" | "single";
  entries: DesktopSkillMaintenanceEntry[];
  destination: string;
  writable: boolean;
}

export interface DesktopSkillMaintenanceBackup {
  id: string;
  path: string;
  originalPath: string;
  createdAt: string;
  bytes: number;
  isLink: boolean;
  references: string[];
  writable: boolean;
}

export interface DesktopSkillMaintenanceScan {
  groups: DesktopSkillMaintenanceGroup[];
  backups: DesktopSkillMaintenanceBackup[];
  brokenLinks: Array<{ id: string; path: string; target: string; platforms: string[]; writable: boolean }>;
  warnings: string[];
  scannedAt: string;
}

export interface DesktopSkillMaintenanceSelection { groupId: string; sourceId: string }
export type DesktopSkillMaintenanceRequest = (
  | { kind: "consolidate"; selections: DesktopSkillMaintenanceSelection[] }
  | { kind: "restore" | "delete-backup" | "remove-link"; id: string }
) & { /** Server-generated preview time; apply must echo the plan request. */ preparedAt?: string };

export interface DesktopSkillMaintenancePlan {
  token: string;
  request: DesktopSkillMaintenanceRequest;
  changes: Array<{ path: string; action: "canonical" | "link" | "restore" | "delete" | "unlink"; target: string; backupPath: string }>;
  conflicts: Array<{ code: "invalid_selection" | "unsafe" | "invalid_name" | "unknown_destination" | "backup_readonly" | "backup_referenced" | "incomplete_scan" | "invalid_backup" | "link_readonly" | "overlap" | "nested"; path: string }>;
  executable: boolean;
}

export interface DesktopSkillMaintenanceResult {
  ok: boolean;
  status: "completed" | "stale" | "failed";
  error: string;
}

export interface DesktopSkillMaintenanceComparison {
  left: DesktopSkillMaintenanceEntry;
  right: DesktopSkillMaintenanceEntry;
  files: Array<{ path: string; status: "added" | "removed" | "changed"; left: string | null; right: string | null; preview: "text" | "binary" | "too-large" | "metadata" }>;
}

export type DesktopSkillManagerAction =
  | { action: "maintenance-scan" }
  | { action: "maintenance-compare"; request: { leftId: string; rightId: string } }
  | { action: "maintenance-preflight"; request: DesktopSkillMaintenanceRequest }
  | { action: "maintenance-apply"; request: { operation: DesktopSkillMaintenanceRequest; token: string } }
  | { action: "preflight"; request: DesktopSkillPreflightRequest }
  | { action: "install"; request: DesktopSkillInstallRequest }
  | { action: "distribute"; request: DesktopSkillDistributeRequest }
  | { action: "uninstall"; request: DesktopSkillUninstallRequest }
  | { action: "unlink-distribution"; request: { id: string; deleteFiles: boolean } }
  | { action: "toggle"; request: DesktopSkillManagerToggleRequest }
  | { action: "save-platforms"; request: DesktopSkillPlatformSaveRequest }
  | { action: "consolidate-preflight"; request: DesktopSkillConsolidateRequest }
  | { action: "consolidate"; request: DesktopSkillConsolidateRequest & { token: string } }
  | { action: "remove-discovered"; request: DesktopSkillRemoveDiscoveredRequest }
  | { action: "check-update"; request: DesktopSkillCheckUpdateRequest }
  | { action: "update-builtin"; request: { id: string } }
  | { action: "reveal"; request: { id: string } };

export interface DesktopSkillSearchConfig {
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

export interface DesktopSkillSearchConfigResponse {
  ok: true;
  search: DesktopSkillSearchConfig;
}

export type DesktopSkillSearchConfigUpdate = Omit<DesktopSkillSearchConfig, "providers">;


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
  /** Resolved embedding target; null means lexical retrieval. */
  embedding: { providerId: string; providerName: string; model: string } | null;
  capabilities: DesktopMemoryCapabilities;
}

export interface DesktopMemoryResponse {
  ok: true;
  summary: DesktopMemorySummary;
}

export interface DesktopMemoryItem {
  id: string;
  hasEmbedding?: boolean;
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
  supersedesMemoryId?: string;
  disputesMemoryId?: string;
  id: string;
  confirmedMemoryId?: string;
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

export interface DesktopMemoryComparison {
  candidateId: string;
  candidateUpdatedAt: string;
  originals: Array<{ relation: "replaces" | "disputes"; available: boolean; content?: string; updatedAt?: string }>;
}
export type DesktopMemoryAction = "compare-candidate" | "profile" | "restore-state" | "list" | "search" | "sync" | "flush" | "compact" | "backfill-embeddings" | "migrate-json-file" | "source" | "update" | "delete" | "forget" | "versions" | "list-candidates" | "confirm-candidate" | "ignore-candidate";
export interface DesktopMemoryActionRequest { action: DesktopMemoryAction; expectedUpdatedAt?: string; agentId?: string; channel?: string; userId?: string; botId?: string; ownerId?: string; conversationId?: string; projectId?: string; includeOwner?: boolean; includeAgentSelf?: boolean; allScopes?: boolean; query?: string; limit?: number; id?: string; sessionId?: string; messageId?: string; content?: string; tags?: string[]; expiresAt?: string | null; namespace?: string; domain?: "owner" | "project" | "agent_self" | "content"; type?: string; subject?: string; confidence?: number; reason?: string; pinned?: boolean; allowInjection?: boolean }
export interface DesktopMemoryActionResponse { ok: true; comparison?: DesktopMemoryComparison; profile?: DesktopMemoryProfile; items?: DesktopMemoryItem[]; item?: DesktopMemoryItem; versions?: DesktopMemoryItem[]; sourceMessages?: Array<{ id: string; role: string; content: string; createdAt: string; selected: boolean }>; candidates?: DesktopMemoryCandidate[]; candidate?: DesktopMemoryCandidate | null; deleted?: boolean; result?: Record<string, number>; sync?: Record<string, number> }
export interface DesktopMemoryRejection { createdAt: string; action: "add" | "update"; channel: string; externalUserId: string; reason: string; content: string; layer?: string; tags: string[] }
export interface DesktopMemoryRejectionsResponse { ok: true; items: DesktopMemoryRejection[]; counts: { total: number; add: number; update: number } }

/** Per-bot display overrides; absent fields follow the global display settings. */
export interface DesktopChannelDisplaySettings {
  toolProgress?: "off" | "new" | "all" | "verbose";
  showReasoning?: "off" | "on" | "stream" | "new";
  gatewayNotifyInterval?: number;
  runLogNotice?: boolean;
}

export interface DesktopChannelInstance {
  id: string;
  name: string;
  enabled: boolean;
  agentId: string;
  allowedChatCount: number;
  allowedChatIds: string[];
  /** null = inherit from the override chain; never "off". */
  permissionMode: "plan" | "manual" | "accept_edits" | "auto" | null;
  fields: Record<string, string>;
  configuredSecrets: string[];
  /** null = every display field follows the global settings. */
  display: DesktopChannelDisplaySettings | null;
}

/** Web is a channel too — the app's own, with a reduced settings form. */
export type DesktopExternalChannel = "telegram" | "feishu" | "qq" | "weixin" | "web";

export interface DesktopChannelSaveRequest {
  channel: DesktopExternalChannel;
  previousId?: string;
  id: string;
  name: string;
  enabled: boolean;
  agentId: string;
  /** null = inherit from the override chain; never "off". */
  permissionMode: "plan" | "manual" | "accept_edits" | "auto" | null;
  allowedChatIds: string[];
  fields: Record<string, string>;
  secretValues?: Record<string, string>;
  clearSecrets?: string[];
  /** null/absent clears per-bot display overrides so every field follows global. */
  display?: DesktopChannelDisplaySettings | null;
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
  /** Global display settings, so inherit options in editors can show the effective value. */
  defaults: DesktopChannelDisplaySettings;
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
  memory: { enabled: boolean; backend: string; backends: Array<{ value: string; label: string }>; embedding: { providerId: string; providerName: string; model: string } | null; reflectionTime: string; reflectionNotifications: boolean; reflectionNotificationTarget: string; reflectionNotificationTargets: Array<{ value: string; label: string }>; dailyMaterials: { enabled: boolean; time: string; projectId: string; dir: string; promptPath: string; notifications: boolean; scanTokenBudget: number; scanModelKey: string }; projects: Array<{ value: string; label: string }>; scanModels: Array<{ value: string; label: string }> };
  featureSettings: Array<{ pluginKey: string; name: string; description: string; fields: DesktopPluginSettingField[] }>;
}

export interface DesktopPluginsUpdateRequest {
  memoryEnabled: boolean;
  memoryBackend: string;
  memoryReflectionTime: string;
  memoryReflectionNotifications: boolean;
  memoryReflectionNotificationTarget: string;
  memoryDailyMaterials: { enabled: boolean; time: string; projectId: string; dir: string; promptPath: string; notifications: boolean; scanTokenBudget?: number; scanModelKey?: string };
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
  hostCapabilities: Array<"audioCapture" | "fileSave">;
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
  credentialSource?: "api-key" | "provider";
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

export interface DesktopPiImageModel {
  key: string;
  provider: string;
  model: string;
  name: string;
  supportsReferenceImages: boolean;
}

export interface DesktopImageRecognitionModel {
  key: string;
  label: string;
  providerId: string;
  modelId: string;
  verification: "passed" | "failed" | "untested";
}

export interface DesktopImageRecognitionEngine {
  id: string;
  enabled: boolean;
  name: string;
  modelKey: string;
}

export interface DesktopImageRecognitionSummary {
  enabled: boolean;
  defaultEngine: string;
  /** Engines are returned in failover order. */
  engines: DesktopImageRecognitionEngine[];
  models: DesktopImageRecognitionModel[];
  adapterTypes: ["api"];
  plannedAdapterTypes: ["cli"];
}

export interface DesktopImageRecognitionResponse {
  ok: true;
  summary: DesktopImageRecognitionSummary;
}

export interface DesktopImageRecognitionUpdateRequest {
  enabled: boolean;
  defaultEngine: string;
  /** Array order is the auto-routing failover order. */
  engines: DesktopImageRecognitionEngine[];
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
  status: "processing" | "completed" | "failed" | "cancelled";
  progress?: number;
  prompt: string;
  resultUrl?: string;
  /** Sanitized primitive display params only — never secrets or host paths. */
  requestParams?: Record<string, unknown>;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  imageOutputs?: Array<{ index: number; mimeType: string; byteLength: number }>;
  textOutput?: string;
  costUsd?: number;
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
 * A read-only external-channel message with display status and workspace-relative attachments.
 */
export interface DesktopExternalTranscriptMessage {
  stopReason?: string;
  errorMessage?: string;
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  attachments?: { original: string; local?: string; mediaType: DesktopFileMediaType; mimeType?: string; size?: number }[];
  activities?: DesktopConversationActivity[];
  steps?: DesktopConversationStep[];
  usage?: DesktopConversationTokenUsage;
  /** Context-usage snapshot of the model call that produced this assistant row. */
  contextBreakdown?: DesktopContextUsageSnapshot;
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
  agentId?: string;
  roomId?: string;
  sessionId: string;
  title: string;
  updatedAt: string;
  botId: string;
  botName: string;
  botDeleted: boolean;
  channel: DesktopConversationChannel;
  purpose: DesktopConversationPurpose;
  readOnly: boolean;
  /** Set for kanban task conversations so lists can render a task tag. */
  taskSession?: boolean;
  latestMessagePreview?: string;
  parentSessionId?: string;
}

export interface DesktopConversationsResponse {
  /** Present for Agent-scoped queries; computed before pagination. */
  latestConversationAtByAgent?: Record<string, number>;
  ok: true;
  channel: DesktopConversationChannel;
  items: DesktopConversationItem[];
  /** Opaque base64url cursor for stable `updatedAt + sessionId` pagination. */
  nextCursor: string | null;
  hasMore: boolean;
}

export type DesktopConversationSearchSource = DesktopConversationChannel | "project";
export type DesktopConversationSearchScope = "all" | DesktopConversationSearchSource | "channels";

/** One owner-visible result from the Desktop's cross-source conversation search. */
export interface DesktopConversationSearchItem {
  agentId?: string;
  source: DesktopConversationSearchSource;
  sessionId: string;
  title: string;
  updatedAt: string;
  channel: DesktopConversationChannel;
  contextId: string;
  contextName: string;
  contextDeleted: boolean;
  readOnly: boolean;
  latestMessagePreview?: string;
  botId?: string;
  projectId?: string;
}

export interface DesktopConversationSearchGroup {
  source: DesktopConversationSearchSource;
  total: number;
  items: DesktopConversationSearchItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface DesktopConversationSearchResponse {
  ok: true;
  scope: DesktopConversationSearchScope;
  groups: DesktopConversationSearchGroup[];
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
  | "recovery_review"
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

/** Global runtime controls exposed by Desktop System settings; excludes credentials and execution policy. */
export interface DesktopSystemConfig {
  serverPort: number;
  timezone: string;
  budget: { maxToolCalls: number; maxToolFailures: number; maxModelAttempts: number };
  subagentRuntime: {
    maxToolCalls: number; maxToolFailures: number; maxModelRetries: number; deadlineMs: number;
    maxTasks: number; maxConcurrency: number; compactionEnabled: boolean; persistSessions: boolean;
  };
  browserAutomation: { defaultTimeoutMs: number };
  display: {
    toolProgress: "off" | "new" | "all" | "verbose";
    showReasoning: "off" | "on" | "stream" | "new";
    gatewayNotifyInterval: number;
    runLogNotice: boolean;
  };
}

export type DesktopSystemUpdate = {
  [K in keyof DesktopSystemConfig]?: DesktopSystemConfig[K] extends object ? Partial<DesktopSystemConfig[K]> : DesktopSystemConfig[K];
};
