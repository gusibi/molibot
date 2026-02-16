import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { readJsonFile, storagePaths, writeJsonFile } from "../db/sqlite.js";
import type { Channel, Conversation, ConversationMessage, Role } from "../types/message.js";

interface SessionsIndex {
  byUserKey: Record<string, string[]>;
  byConversationId: Record<string, { channel: Channel; externalUserId: string }>;
}

interface SessionFile {
  conversation: Conversation;
  messages: ConversationMessage[];
}

const DEFAULT_SESSION_TITLE = "New Session";

function summarizeTitle(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return DEFAULT_SESSION_TITLE;
  return clean.length > 40 ? `${clean.slice(0, 40)}...` : clean;
}

function userKey(channel: Channel, externalUserId: string): string {
  return `${channel}:${externalUserId}`;
}

function sessionFilePath(conversationId: string): string {
  return path.join(storagePaths.sessionsDir, `${conversationId}.json`);
}

function readIndex(): SessionsIndex {
  const raw = readJsonFile<Record<string, unknown>>(storagePaths.sessionsIndexFile, {});
  const byUserKeyRaw =
    raw && typeof raw.byUserKey === "object" && raw.byUserKey
      ? (raw.byUserKey as Record<string, unknown>)
      : {};
  const byUserKey: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(byUserKeyRaw)) {
    byUserKey[k] = Array.isArray(v) ? v.map((x) => String(x)) : [];
  }

  const byConversationIdRaw =
    raw && typeof raw.byConversationId === "object" && raw.byConversationId
      ? (raw.byConversationId as Record<string, unknown>)
      : {};
  const byConversationId: SessionsIndex["byConversationId"] = {};
  for (const [k, v] of Object.entries(byConversationIdRaw)) {
    if (!v || typeof v !== "object") continue;
    const item = v as Record<string, unknown>;
    byConversationId[k] = {
      channel: String(item.channel ?? "web") as Channel,
      externalUserId: String(item.externalUserId ?? "")
    };
  }

  return { byUserKey, byConversationId };
}

function writeIndex(index: SessionsIndex): void {
  writeJsonFile(storagePaths.sessionsIndexFile, index);
}

function readSession(conversationId: string): SessionFile | null {
  const fp = sessionFilePath(conversationId);
  const data = readJsonFile<SessionFile | null>(fp, null);
  if (!data || !data.conversation || !Array.isArray(data.messages)) return null;
  if (!data.conversation.title) {
    data.conversation.title = DEFAULT_SESSION_TITLE;
  }
  return data;
}

function writeSession(data: SessionFile): void {
  writeJsonFile(sessionFilePath(data.conversation.id), data);
}

export class SessionStore {
  private createConversation(channel: Channel, externalUserId: string): Conversation {
    const now = new Date().toISOString();
    const index = readIndex();
    const key = userKey(channel, externalUserId);

    const id = uuidv4();
    const conversation: Conversation = {
      id,
      channel,
      externalUserId,
      title: DEFAULT_SESSION_TITLE,
      createdAt: now,
      updatedAt: now
    };

    writeSession({ conversation, messages: [] });
    index.byUserKey[key] = [...(index.byUserKey[key] ?? []), id];
    index.byConversationId[id] = { channel, externalUserId };
    writeIndex(index);
    return conversation;
  }

  getConversationById(
    conversationId: string,
    channel: Channel,
    externalUserId: string
  ): Conversation | null {
    const index = readIndex();
    const owner = index.byConversationId[conversationId];
    if (!owner) return null;
    if (owner.channel !== channel || owner.externalUserId !== externalUserId) return null;
    const file = readSession(conversationId);
    return file?.conversation ?? null;
  }

  getOrCreateConversation(
    channel: Channel,
    externalUserId: string,
    conversationId?: string
  ): Conversation {
    const now = new Date().toISOString();

    if (conversationId) {
      const found = this.getConversationById(conversationId, channel, externalUserId);
      if (found) {
        const file = readSession(found.id);
        if (file) {
          file.conversation.updatedAt = now;
          writeSession(file);
          return file.conversation;
        }
      }
    }

    const list = this.listConversations(channel, externalUserId);
    if (list.length > 0) {
      const latest = list[0];
      const file = readSession(latest.id);
      if (file) {
        file.conversation.updatedAt = now;
        writeSession(file);
        return file.conversation;
      }
    }

    return this.createConversation(channel, externalUserId);
  }

  appendMessage(conversationId: string, role: Role, content: string): ConversationMessage {
    const createdAt = new Date().toISOString();
    const message: ConversationMessage = {
      id: uuidv4(),
      conversationId,
      role,
      content,
      createdAt
    };

    const file =
      readSession(conversationId) ??
      ({
        conversation: {
          id: conversationId,
          channel: "web",
          externalUserId: "unknown",
          title: DEFAULT_SESSION_TITLE,
          createdAt,
          updatedAt: createdAt
        },
        messages: []
      } satisfies SessionFile);

    file.messages.push(message);
    if (role === "user" && file.conversation.title === DEFAULT_SESSION_TITLE) {
      file.conversation.title = summarizeTitle(content);
    }
    file.conversation.updatedAt = createdAt;
    writeSession(file);

    return message;
  }

  listMessages(conversationId: string, limit = 20): ConversationMessage[] {
    const file = readSession(conversationId);
    if (!file) return [];
    if (limit <= 0) return [];
    return file.messages.slice(-limit);
  }

  listConversations(channel: Channel, externalUserId: string): Conversation[] {
    const index = readIndex();
    const ids = index.byUserKey[userKey(channel, externalUserId)] ?? [];
    const conversations: Conversation[] = [];

    for (const id of ids) {
      const file = readSession(id);
      if (!file) continue;
      conversations.push(file.conversation);
    }

    conversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return conversations;
  }

  createWebConversation(externalUserId: string): Conversation {
    return this.createConversation("web", externalUserId);
  }
}
