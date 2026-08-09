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
  label: string;
  state: "running" | "success" | "error" | "info";
  summary?: string;
  /**
   * Project-relative paths this tool call touched, recorded from the tool's own
   * arguments rather than parsed back out of `label`. Lets a surface answer
   * "which files did this session change?" without re-deriving it from prose.
   */
  paths?: string[];
  /** True when the tool writes to those paths (`write`/`edit`) rather than reading them. */
  mutates?: boolean;
}

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
