export type Channel = "telegram" | "cli" | "web" | "feishu" | "qq" | "weixin";
export type Role = "user" | "assistant" | "system";
export type TurnRetentionPolicy = "standard" | "no_memory" | "not_searchable" | "turn_only";

/**
 * External-channel session metadata (plan §7.2). Populated by channel adapters
 * when they map platform fields into the shared session layer; old records
 * without it use stable fallbacks. All fields optional for backward compatibility.
 */
export type ExternalChatType = "private" | "group" | "channel";

export interface ExternalSessionMetadata {
  botInstanceId?: string;
  botInstanceName?: string;
  senderId?: string;
  senderName?: string;
  senderAvatarUrl?: string;
  chatType?: ExternalChatType;
  threadId?: string;
  threadTitle?: string;
  platform?: string;
}

export interface ConversationAttachment {
  original: string;
  local: string;
  mediaType: "image" | "audio" | "video" | "file";
  mimeType?: string;
  size?: number;
}

export interface ConversationActivity {
  key: string;
  kind: "tool" | "subagent" | "note";
  /**
   * The tool's id (`read`, `bash`, `miniapp__x__y`). Recorded rather than
   * derived from `key`, whose `<tool>-<sequence>` shape exists only to pair a
   * start event with its end event; a renderer that dispatches on the tool must
   * not be coupled to that. Absent on activities written before this field.
   */
  tool?: string;
  label: string;
  state: "running" | "success" | "error" | "info";
  summary?: string;
  /**
   * Unified patch when the call changed a file. Distinct from `summary`, which
   * is the sentence the model was given ("Updated src/x.ts") — the patch is for
   * the person reading the transcript.
   */
  diff?: string;
  /**
   * Project-relative paths this tool call touched, recorded from the tool's own
   * arguments rather than parsed back out of `label`. Lets a surface answer
   * "which files did this session change?" without re-deriving it from prose.
   */
  paths?: string[];
  /** True when the tool writes to those paths (`write`/`edit`) rather than reading them. */
  mutates?: boolean;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  exitCode?: number;
  lineCount?: number;
  tokenUsage?: number;
}

export type ConversationPlanStepStatus = "pending" | "in_progress" | "completed" | "blocked";

export interface ConversationPlan {
  id: string;
  title: string;
  summary: string;
  steps: Array<{ id: string; text: string; status: ConversationPlanStepStatus }>;
  status: "proposed" | "accepted" | "rejected" | "executing" | "completed" | "blocked";
  recommendedMode: "manual" | "accept_edits";
  artifactPath: string;
  /** Durable Execution created from this accepted plan, if execution has started. */
  durableExecutionId?: string;
}

export type ConversationStep =
  | { id: string; kind: "text"; content: string }
  | { id: string; kind: "thinking"; content: string }
  | { id: string; kind: "activity"; activity: ConversationActivity }
  | { id: string; kind: "plan"; plan: ConversationPlan };

export interface InboundMessage {
  channel: Channel;
  externalUserId: string;
  content: string;
  conversationId?: string;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  role: Role;
  content: string;
  createdAt: string;
  model?: string;
  platformMessageId?: string;
  attachments?: ConversationAttachment[];
  activities?: ConversationActivity[];
  /** Ordered transcript primitives for assistant turns. */
  steps?: ConversationStep[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    totalTokens: number;
  };
  plan?: ConversationPlan;
  /** Durable handling policy for the whole user turn. Missing means standard. */
  retention?: TurnRetentionPolicy;
  memoryTrace?: {
    traceId: string;
    injectedCount: number;
    /** Memories the reply actually used (citations + mid-run tool retrieval). */
    referencedCount: number;
    writeCount: number;
  };
}

export interface Conversation {
  id: string;
  channel: Channel;
  externalUserId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  projectId?: string;
  origin?: string;
  external?: ExternalSessionMetadata;
  /** Per-session text-model override (routing key, e.g. `custom|CliProxyAPI|gpt-5.4-mini`).
   *  Empty/undefined means "follow the global default". Persisted with the session so
   *  each conversation keeps its own model across restarts. */
  modelKey?: string;
  /** Lineage for a non-destructive edit/resend fork. Parent deletion never
   * deletes the child; these ids are provenance, not ownership. */
  parentSessionId?: string;
  forkedFromMessageId?: string;
}
