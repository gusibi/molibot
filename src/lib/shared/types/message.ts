export type Channel = "telegram" | "cli" | "web" | "feishu" | "qq" | "weixin";
export type Role = "user" | "assistant" | "system";

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
  attachments?: ConversationAttachment[];
  activities?: ConversationActivity[];
}

export interface Conversation {
  id: string;
  channel: Channel;
  externalUserId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  external?: ExternalSessionMetadata;
}
