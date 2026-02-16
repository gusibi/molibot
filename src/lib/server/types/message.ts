export type Channel = "telegram" | "cli" | "web";
export type Role = "user" | "assistant" | "system";

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
}

export interface Conversation {
  id: string;
  channel: Channel;
  externalUserId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}
