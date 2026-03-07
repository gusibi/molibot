import fs from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { readJsonFile, storagePaths, writeJsonFile } from "../infra/db/storage.js";
import type { Channel, Conversation, ConversationMessage, Role } from "../../shared/types/message.js";

interface SessionsIndex {
  byUserKey: Record<string, string[]>;
  byConversationId: Record<string, { channel: Channel; externalUserId: string }>;
}

interface WebSessionsIndex {
  byUserId: Record<string, string[]>;
  byConversationId: Record<string, { externalUserId: string }>;
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

function sanitizeConversationTitle(input: string): string {
  const normalized = String(input ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return DEFAULT_SESSION_TITLE;
  return normalized.length > 120 ? normalized.slice(0, 120) : normalized;
}

function userKey(channel: Channel, externalUserId: string): string {
  return `${channel}:${externalUserId}`;
}

function sanitizeUserDirPart(value: string): string {
  const safe = String(value ?? "").trim().replace(/[^a-zA-Z0-9._-]/g, "_");
  return safe || "anonymous";
}

function legacySessionFilePath(conversationId: string): string {
  return path.join(storagePaths.sessionsDir, `${conversationId}.json`);
}

function webIndexFilePath(): string {
  return path.join(storagePaths.webWorkspaceDir, "sessions-index.json");
}

function webUserSessionsDir(externalUserId: string): string {
  return path.join(storagePaths.webWorkspaceDir, "users", sanitizeUserDirPart(externalUserId), "sessions");
}

function webSessionFilePath(externalUserId: string, conversationId: string): string {
  return path.join(webUserSessionsDir(externalUserId), `${conversationId}.json`);
}

function readLegacyIndex(): SessionsIndex {
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

function writeLegacyIndex(index: SessionsIndex): void {
  writeJsonFile(storagePaths.sessionsIndexFile, index);
}

function readWebIndex(): WebSessionsIndex {
  const raw = readJsonFile<Record<string, unknown>>(webIndexFilePath(), {});
  const byUserIdRaw =
    raw && typeof raw.byUserId === "object" && raw.byUserId
      ? (raw.byUserId as Record<string, unknown>)
      : {};
  const byUserId: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(byUserIdRaw)) {
    byUserId[k] = Array.isArray(v) ? v.map((x) => String(x)) : [];
  }

  const byConversationIdRaw =
    raw && typeof raw.byConversationId === "object" && raw.byConversationId
      ? (raw.byConversationId as Record<string, unknown>)
      : {};
  const byConversationId: WebSessionsIndex["byConversationId"] = {};
  for (const [k, v] of Object.entries(byConversationIdRaw)) {
    if (!v || typeof v !== "object") continue;
    const item = v as Record<string, unknown>;
    byConversationId[k] = {
      externalUserId: String(item.externalUserId ?? "")
    };
  }

  return { byUserId, byConversationId };
}

function writeWebIndex(index: WebSessionsIndex): void {
  writeJsonFile(webIndexFilePath(), index);
}

function readSessionFromFile(filePath: string): SessionFile | null {
  const data = readJsonFile<SessionFile | null>(filePath, null);
  if (!data || !data.conversation || !Array.isArray(data.messages)) return null;
  if (!data.conversation.title) {
    data.conversation.title = DEFAULT_SESSION_TITLE;
  }
  return data;
}

function readLegacySession(conversationId: string): SessionFile | null {
  return readSessionFromFile(legacySessionFilePath(conversationId));
}

function writeLegacySession(data: SessionFile): void {
  writeJsonFile(legacySessionFilePath(data.conversation.id), data);
}

function readWebSession(externalUserId: string, conversationId: string): SessionFile | null {
  return readSessionFromFile(webSessionFilePath(externalUserId, conversationId));
}

function writeWebSession(externalUserId: string, data: SessionFile): void {
  writeJsonFile(webSessionFilePath(externalUserId, data.conversation.id), data);
}

function ensureWebIndexEntry(index: WebSessionsIndex, externalUserId: string, conversationId: string): void {
  const list = index.byUserId[externalUserId] ?? [];
  if (!list.includes(conversationId)) {
    index.byUserId[externalUserId] = [...list, conversationId];
  }
  index.byConversationId[conversationId] = { externalUserId };
}

export class SessionStore {
  private createConversation(channel: Channel, externalUserId: string): Conversation {
    const now = new Date().toISOString();
    const id = uuidv4();
    const conversation: Conversation = {
      id,
      channel,
      externalUserId,
      title: DEFAULT_SESSION_TITLE,
      createdAt: now,
      updatedAt: now
    };

    if (channel === "web") {
      const webIndex = readWebIndex();
      writeWebSession(externalUserId, { conversation, messages: [] });
      ensureWebIndexEntry(webIndex, externalUserId, id);
      writeWebIndex(webIndex);
      return conversation;
    }

    const index = readLegacyIndex();
    const key = userKey(channel, externalUserId);
    writeLegacySession({ conversation, messages: [] });
    index.byUserKey[key] = [...(index.byUserKey[key] ?? []), id];
    index.byConversationId[id] = { channel, externalUserId };
    writeLegacyIndex(index);
    return conversation;
  }

  private migrateLegacyWebUser(externalUserId: string): void {
    const legacy = readLegacyIndex();
    const key = userKey("web", externalUserId);
    const ids = legacy.byUserKey[key] ?? [];
    if (ids.length === 0) return;

    const webIndex = readWebIndex();
    let webChanged = false;
    let legacyChanged = false;

    for (const id of ids) {
      const file = readLegacySession(id);
      if (file && file.conversation.channel === "web" && file.conversation.externalUserId === externalUserId) {
        writeWebSession(externalUserId, file);
        ensureWebIndexEntry(webIndex, externalUserId, id);
        webChanged = true;
      }

      const legacyPath = legacySessionFilePath(id);
      if (fs.existsSync(legacyPath)) {
        try {
          fs.unlinkSync(legacyPath);
        } catch {
          // keep legacy file on cleanup failure
        }
      }
      if (legacy.byConversationId[id]) {
        delete legacy.byConversationId[id];
        legacyChanged = true;
      }
    }

    if (legacy.byUserKey[key]) {
      delete legacy.byUserKey[key];
      legacyChanged = true;
    }

    if (webChanged) {
      writeWebIndex(webIndex);
    }
    if (legacyChanged) {
      writeLegacyIndex(legacy);
    }
  }

  private resolveSessionStorage(conversationId: string):
    | { type: "web"; externalUserId: string; file: SessionFile }
    | { type: "legacy"; file: SessionFile }
    | null {
    const webIndex = readWebIndex();
    const webOwner = webIndex.byConversationId[conversationId];
    if (webOwner?.externalUserId) {
      const file = readWebSession(webOwner.externalUserId, conversationId);
      if (file) {
        return { type: "web", externalUserId: webOwner.externalUserId, file };
      }

      delete webIndex.byConversationId[conversationId];
      const list = webIndex.byUserId[webOwner.externalUserId] ?? [];
      webIndex.byUserId[webOwner.externalUserId] = list.filter((id) => id !== conversationId);
      writeWebIndex(webIndex);
    }

    const legacyFile = readLegacySession(conversationId);
    if (!legacyFile) return null;

    if (legacyFile.conversation.channel === "web") {
      this.migrateLegacyWebUser(legacyFile.conversation.externalUserId);
      const migratedIndex = readWebIndex();
      const owner = migratedIndex.byConversationId[conversationId];
      if (owner?.externalUserId) {
        const migrated = readWebSession(owner.externalUserId, conversationId);
        if (migrated) {
          return { type: "web", externalUserId: owner.externalUserId, file: migrated };
        }
      }
    }

    return { type: "legacy", file: legacyFile };
  }

  getConversationById(
    conversationId: string,
    channel: Channel,
    externalUserId: string
  ): Conversation | null {
    if (channel === "web") {
      this.migrateLegacyWebUser(externalUserId);
      const webIndex = readWebIndex();
      const owner = webIndex.byConversationId[conversationId];
      if (!owner || owner.externalUserId !== externalUserId) return null;
      const file = readWebSession(externalUserId, conversationId);
      if (!file) return null;
      return file.conversation;
    }

    const index = readLegacyIndex();
    const owner = index.byConversationId[conversationId];
    if (!owner) return null;
    if (owner.channel !== channel || owner.externalUserId !== externalUserId) return null;
    const file = readLegacySession(conversationId);
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
        const located = this.resolveSessionStorage(found.id);
        if (located) {
          located.file.conversation.updatedAt = now;
          if (located.type === "web") {
            writeWebSession(located.externalUserId, located.file);
          } else {
            writeLegacySession(located.file);
          }
          return located.file.conversation;
        }
      }
    }

    const list = this.listConversations(channel, externalUserId);
    if (list.length > 0) {
      const latest = list[0];
      const located = this.resolveSessionStorage(latest.id);
      if (located) {
        located.file.conversation.updatedAt = now;
        if (located.type === "web") {
          writeWebSession(located.externalUserId, located.file);
        } else {
          writeLegacySession(located.file);
        }
        return located.file.conversation;
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

    const located = this.resolveSessionStorage(conversationId);
    const file =
      located?.file ??
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

    if (located?.type === "web") {
      writeWebSession(located.externalUserId, file);
      return message;
    }

    if (located?.type === "legacy") {
      writeLegacySession(file);
      return message;
    }

    writeLegacySession(file);
    return message;
  }

  renameConversation(
    conversationId: string,
    channel: Channel,
    externalUserId: string,
    title: string
  ): Conversation | null {
    const conversation = this.getConversationById(conversationId, channel, externalUserId);
    if (!conversation) return null;

    const located = this.resolveSessionStorage(conversationId);
    if (!located) return null;

    located.file.conversation.title = sanitizeConversationTitle(title);
    located.file.conversation.updatedAt = new Date().toISOString();

    if (located.type === "web") {
      writeWebSession(located.externalUserId, located.file);
    } else {
      writeLegacySession(located.file);
    }

    return located.file.conversation;
  }

  listMessages(conversationId: string, limit = 20): ConversationMessage[] {
    const located = this.resolveSessionStorage(conversationId);
    if (!located) return [];
    if (limit <= 0) return [];
    return located.file.messages.slice(-limit);
  }

  listConversations(channel: Channel, externalUserId: string): Conversation[] {
    if (channel === "web") {
      this.migrateLegacyWebUser(externalUserId);
      const webIndex = readWebIndex();
      const ids = webIndex.byUserId[externalUserId] ?? [];
      const conversations: Conversation[] = [];

      for (const id of ids) {
        const file = readWebSession(externalUserId, id);
        if (!file) continue;
        conversations.push(file.conversation);
      }

      conversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return conversations;
    }

    const index = readLegacyIndex();
    const ids = index.byUserKey[userKey(channel, externalUserId)] ?? [];
    const conversations: Conversation[] = [];

    for (const id of ids) {
      const file = readLegacySession(id);
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
