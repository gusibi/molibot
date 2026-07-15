import fs from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { readJsonFile, storagePaths, writeJsonFile } from "$lib/server/infra/db/storage.js";
import type {
  Channel,
  Conversation,
  ConversationAttachment,
  ConversationActivity,
  ConversationMessage,
  Role
} from "$lib/shared/types/message.js";

interface SessionsIndex {
  byUserKey: Record<string, string[]>;
  byConversationId: Record<string, { channel: Channel; externalUserId: string }>;
}

interface WebSessionsIndex {
  byUserId: Record<string, string[]>;
  byConversationId: Record<string, { externalUserId: string }>;
}

interface ProjectSessionsIndex {
  order: string[];
  byConversationId: Record<string, { origin: string }>;
}

export interface UiMessageMetadata extends Omit<ConversationMessage, "content"> {
  /** Normal chat content comes from Agent entries; only display-only messages keep content here. */
  content?: string;
  contextBacked: boolean;
  /** Stable id of the Agent session entry this row renders, so projection pairs by id, not list position. */
  sourceEntryId?: string;
}

interface SessionFile {
  conversation: Conversation;
  messageMetadata: UiMessageMetadata[];
  messageCount: number;
}

const DEFAULT_SESSION_TITLE = "New Session";

function summarizeTitle(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return DEFAULT_SESSION_TITLE;
  return clean.length > 40 ? `${clean.slice(0, 40)}...` : clean;
}

function inferHistoricalInternalOrigin(conversation: Conversation): "internal:approval" | "internal:event" | undefined {
  if (conversation.projectId || conversation.origin) return undefined;
  const title = String(conversation.title ?? "").trim();
  if (/^\/hosttools(?:\s|$)/i.test(title)) return "internal:approval";
  if (/^\[EVENT:/i.test(title)) return "internal:event";
  return undefined;
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

function webUiSessionsDir(): string {
  return path.join(storagePaths.webWorkspaceDir, "ui-sessions");
}

function webIndexFilePath(): string {
  return path.join(webUiSessionsDir(), "index.json");
}

function webUiSessionScopeDir(externalUserId: string): string {
  return path.join(webUiSessionsDir(), sanitizeUserDirPart(externalUserId));
}

function webSessionFilePath(externalUserId: string, conversationId: string): string {
  return path.join(webUiSessionScopeDir(externalUserId), `${conversationId}.json`);
}

function legacyWebIndexFilePath(): string {
  return path.join(storagePaths.webWorkspaceDir, "sessions-index.json");
}

function legacyWebUserSessionsDir(externalUserId: string): string {
  return path.join(storagePaths.webWorkspaceDir, "users", sanitizeUserDirPart(externalUserId), "sessions");
}

function legacyWebSessionFilePath(externalUserId: string, conversationId: string): string {
  return path.join(legacyWebUserSessionsDir(externalUserId), `${conversationId}.json`);
}

function projectDir(projectId: string): string {
  return path.join(storagePaths.projectsDir, sanitizeUserDirPart(projectId));
}

function projectIndexFilePath(projectId: string): string {
  return path.join(projectDir(projectId), "sessions-index.json");
}

function projectSessionFilePath(projectId: string, conversationId: string): string {
  return path.join(projectDir(projectId), "sessions", `${sanitizeUserDirPart(conversationId)}.json`);
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

function readWebIndexFile(filePath: string): WebSessionsIndex {
  const raw = readJsonFile<Record<string, unknown>>(filePath, {});
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

function removeDirectoryIfEmpty(dir: string): void {
  try {
    fs.rmdirSync(dir);
  } catch {
    // Keep non-empty or inaccessible legacy directories for a later retry.
  }
}

function migrateLegacyWebUiSessionsLayout(): void {
  const legacyIndexPath = legacyWebIndexFilePath();
  if (!fs.existsSync(legacyIndexPath)) return;

  const legacyIndex = readWebIndexFile(legacyIndexPath);
  const nextIndex = readWebIndexFile(webIndexFilePath());
  const migrated: Array<{ externalUserId: string; conversationId: string }> = [];
  let changed = false;

  for (const [conversationId, owner] of Object.entries(legacyIndex.byConversationId)) {
    const externalUserId = owner.externalUserId;
    if (!externalUserId) continue;
    const from = legacyWebSessionFilePath(externalUserId, conversationId);
    const to = webSessionFilePath(externalUserId, conversationId);
    if (!fs.existsSync(from) && !fs.existsSync(to)) continue;

    if (!fs.existsSync(to)) {
      const file = readSessionFromFile(from);
      if (!file) continue;
      writeJsonFile(to, file);
    }
    ensureWebIndexEntry(nextIndex, externalUserId, conversationId);
    migrated.push({ externalUserId, conversationId });
    changed = true;
  }

  for (const [externalUserId, legacyOrder] of Object.entries(legacyIndex.byUserId)) {
    const migratedOrder = legacyOrder.filter((conversationId) =>
      nextIndex.byConversationId[conversationId]?.externalUserId === externalUserId
      && fs.existsSync(webSessionFilePath(externalUserId, conversationId))
    );
    if (migratedOrder.length === 0) continue;
    const migratedIds = new Set(migratedOrder);
    nextIndex.byUserId[externalUserId] = [
      ...migratedOrder,
      ...(nextIndex.byUserId[externalUserId] ?? []).filter((id) => !migratedIds.has(id))
    ];
  }

  if (changed) writeJsonFile(webIndexFilePath(), nextIndex);

  for (const item of migrated) {
    const from = legacyWebSessionFilePath(item.externalUserId, item.conversationId);
    if (fs.existsSync(from) && fs.existsSync(webSessionFilePath(item.externalUserId, item.conversationId))) {
      try {
        fs.unlinkSync(from);
      } catch {
        // Keep the legacy index so cleanup can retry after the new copy is in use.
      }
    }
    removeDirectoryIfEmpty(legacyWebUserSessionsDir(item.externalUserId));
    removeDirectoryIfEmpty(path.dirname(legacyWebUserSessionsDir(item.externalUserId)));
  }

  const fullyMigrated = Object.entries(legacyIndex.byConversationId).every(([conversationId, owner]) =>
    Boolean(
      owner.externalUserId
      && fs.existsSync(webSessionFilePath(owner.externalUserId, conversationId))
      && !fs.existsSync(legacyWebSessionFilePath(owner.externalUserId, conversationId))
    )
  );
  if (fullyMigrated) {
    try {
      fs.unlinkSync(legacyIndexPath);
    } catch {
      return;
    }
    removeDirectoryIfEmpty(path.join(storagePaths.webWorkspaceDir, "users"));
  }
}

function readWebIndex(): WebSessionsIndex {
  migrateLegacyWebUiSessionsLayout();
  return readWebIndexFile(webIndexFilePath());
}

function writeWebIndex(index: WebSessionsIndex): void {
  writeJsonFile(webIndexFilePath(), index);
}

function readProjectIndex(projectId: string): ProjectSessionsIndex {
  const raw = readJsonFile<Partial<ProjectSessionsIndex>>(projectIndexFilePath(projectId), {});
  const order = Array.isArray(raw.order) ? raw.order.map(String) : [];
  const byConversationId: ProjectSessionsIndex["byConversationId"] = {};
  if (raw.byConversationId && typeof raw.byConversationId === "object") {
    for (const [id, value] of Object.entries(raw.byConversationId)) {
      if (!value || typeof value !== "object") continue;
      byConversationId[id] = { origin: String((value as { origin?: unknown }).origin ?? "") };
    }
  }
  return { order, byConversationId };
}

function writeProjectIndex(projectId: string, index: ProjectSessionsIndex): void {
  writeJsonFile(projectIndexFilePath(projectId), index);
}

function readProjectSession(projectId: string, conversationId: string): SessionFile | null {
  return readSessionFromFile(projectSessionFilePath(projectId, conversationId));
}

function writeProjectSession(projectId: string, data: SessionFile): void {
  writeJsonFile(projectSessionFilePath(projectId, data.conversation.id), data);
}

function readSessionFromFile(filePath: string): SessionFile | null {
  const data = readJsonFile<(Partial<SessionFile> & { conversation?: Conversation; messages?: ConversationMessage[] }) | null>(filePath, null);
  if (!data || !data.conversation) return null;
  if (!data.conversation.title) {
    data.conversation.title = DEFAULT_SESSION_TITLE;
  }
  const legacyMessages = Array.isArray(data.messages) ? data.messages : [];
  const messageMetadata = Array.isArray(data.messageMetadata)
    ? data.messageMetadata.map((item) => ({ ...item, contextBacked: item.contextBacked === true }))
    : legacyMessages.map((message) => ({ ...message, contextBacked: false }));
  return {
    conversation: data.conversation,
    messageMetadata,
    messageCount: Number.isFinite(data.messageCount) ? Math.max(0, Number(data.messageCount)) : messageMetadata.length
  };
}

function readLegacySession(conversationId: string): SessionFile | null {
  return readSessionFromFile(legacySessionFilePath(conversationId));
}

function writeLegacySession(_data: SessionFile): void {
  // Intentionally inert: external-channel conversations are no longer persisted
  // to the legacy `~/.molibot/sessions` flat store. The Desktop viewer now reads
  // them from the Agent `contexts/` store (see externalSessionsFromContexts.ts).
  // Web and Project conversations use their own writers and are unaffected.
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
  private messageProjector?: (conversationId: string) => ConversationMessage[];

  setMessageProjector(projector: (conversationId: string) => ConversationMessage[]): void {
    this.messageProjector = projector;
  }

  private createConversation(channel: Channel, externalUserId: string, projectId?: string, origin?: string): Conversation {
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
    if (origin) conversation.origin = origin;

    if (projectId) {
      conversation.projectId = projectId;
      conversation.origin = externalUserId;
      const index = readProjectIndex(projectId);
      index.order = [...index.order.filter((item) => item !== id), id];
      index.byConversationId[id] = { origin: externalUserId };
      writeProjectSession(projectId, { conversation, messageMetadata: [], messageCount: 0 });
      writeProjectIndex(projectId, index);
      return conversation;
    }

    if (channel === "web") {
      const webIndex = readWebIndex();
      writeWebSession(externalUserId, { conversation, messageMetadata: [], messageCount: 0 });
      ensureWebIndexEntry(webIndex, externalUserId, id);
      writeWebIndex(webIndex);
      return conversation;
    }

    // External channels no longer persist a separate legacy `sessions/` copy.
    // The Desktop external viewer derives transcripts from the Agent `contexts/`
    // store; return an in-memory conversation so channel callers still get a
    // stable id without writing a redundant file/index entry.
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

  /**
   * Migrates every legacy Web user's sessions into the Web workspace index.
   * Used by the cross-profile desktop conversation list (plan §12.2), which has
   * no single `externalUserId` to pass to the lazy per-user migration. Safe to
   * call repeatedly - already-migrated users have no legacy entries left.
   */
  migrateAllLegacyWebUsers(): void {
    const legacy = readLegacyIndex();
    const keys = Object.keys(legacy.byUserKey);
    for (const key of keys) {
      if (!key.startsWith("web:")) continue;
      const externalUserId = key.slice("web:".length);
      if (externalUserId) this.migrateLegacyWebUser(externalUserId);
    }
  }

  private resolveSessionStorage(conversationId: string):
    | { type: "web"; externalUserId: string; file: SessionFile }
    | { type: "legacy"; file: SessionFile }
    | { type: "project"; projectId: string; file: SessionFile }
    | null {
    if (fs.existsSync(storagePaths.projectsDir)) {
      for (const entry of fs.readdirSync(storagePaths.projectsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const index = readProjectIndex(entry.name);
        if (!index.byConversationId[conversationId]) continue;
        const file = readProjectSession(entry.name, conversationId);
        if (file) return { type: "project", projectId: entry.name, file };
      }
    }
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
    conversationId?: string,
    opts?: { projectId?: string; origin?: string }
  ): Conversation {
    const now = new Date().toISOString();

    if (opts?.projectId) {
      if (conversationId) {
        // Project sessions are owner-scoped: any surface (Desktop, channel bot)
        // may continue any conversation of the project by id, so a chat started
        // on Feishu can be picked up on the Mac app and vice versa.
        const file = readProjectSession(opts.projectId, conversationId);
        if (file) {
          file.conversation.updatedAt = now;
          writeProjectSession(opts.projectId, file);
          return file.conversation;
        }
      }
      const list = this.listProjectConversations(opts.projectId);
      const latest = list.find((item) => item.externalUserId === externalUserId);
      if (latest) {
        const file = readProjectSession(opts.projectId, latest.id);
        if (file) {
          file.conversation.updatedAt = now;
          writeProjectSession(opts.projectId, file);
          return file.conversation;
        }
      }
      return this.createConversation(channel, externalUserId, opts.projectId, opts.origin);
    }

    if (conversationId) {
      const found = this.getConversationById(conversationId, channel, externalUserId);
      if (found) {
        const located = this.resolveSessionStorage(found.id);
        if (located) {
          located.file.conversation.updatedAt = now;
          if (opts?.origin && !located.file.conversation.origin) {
            located.file.conversation.origin = opts.origin;
          }
          if (located.type === "web") {
            writeWebSession(located.externalUserId, located.file);
          } else if (located.type === "project") {
            writeProjectSession(located.projectId, located.file);
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
        if (opts?.origin && !located.file.conversation.origin) {
          located.file.conversation.origin = opts.origin;
        }
        if (located.type === "web") {
          writeWebSession(located.externalUserId, located.file);
        } else if (located.type === "project") {
          writeProjectSession(located.projectId, located.file);
        } else {
          writeLegacySession(located.file);
        }
        return located.file.conversation;
      }
    }

    return this.createConversation(channel, externalUserId, undefined, opts?.origin);
  }

  appendMessage(
    conversationId: string,
    role: Role,
    content: string,
    options?: { attachments?: ConversationAttachment[]; activities?: ConversationActivity[]; platformMessageId?: string; model?: string; contextBacked?: boolean; sourceEntryId?: string }
  ): ConversationMessage {
    const createdAt = new Date().toISOString();
    const message: ConversationMessage = {
      id: uuidv4(),
      conversationId,
      role,
      content,
      createdAt,
      model: options?.model,
      platformMessageId: options?.platformMessageId,
      attachments: options?.attachments?.length ? options.attachments : undefined,
      activities: options?.activities?.length ? options.activities : undefined
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
        messageMetadata: [],
        messageCount: 0
      } satisfies SessionFile);

    file.messageMetadata.push({
      id: message.id,
      conversationId,
      role,
      createdAt,
      model: message.model,
      platformMessageId: message.platformMessageId,
      attachments: message.attachments,
      activities: message.activities,
      contextBacked: options?.contextBacked === true,
      sourceEntryId: options?.sourceEntryId,
      content: options?.contextBacked === true ? undefined : content
    });
    file.messageCount = file.messageMetadata.length;
    if (role === "user" && file.conversation.title === DEFAULT_SESSION_TITLE) {
      file.conversation.title = summarizeTitle(content);
    }
    file.conversation.updatedAt = createdAt;

    if (located?.type === "web") {
      writeWebSession(located.externalUserId, file);
      return message;
    }

    if (located?.type === "project") {
      writeProjectSession(located.projectId, file);
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
    } else if (located.type === "project") {
      writeProjectSession(located.projectId, located.file);
    } else {
      writeLegacySession(located.file);
    }

    return located.file.conversation;
  }

  deleteConversation(
    conversationId: string,
    channel: Channel,
    externalUserId: string
  ): boolean {
    const conversation = this.getConversationById(conversationId, channel, externalUserId);
    if (!conversation) return false;

    if (channel === "web") {
      const index = readWebIndex();
      const owner = index.byConversationId[conversationId];
      if (!owner || owner.externalUserId !== externalUserId) return false;

      fs.unlinkSync(webSessionFilePath(externalUserId, conversationId));
      index.byUserId[externalUserId] = (index.byUserId[externalUserId] ?? [])
        .filter((id) => id !== conversationId);
      delete index.byConversationId[conversationId];
      writeWebIndex(index);
      return true;
    }

    const index = readLegacyIndex();
    const owner = index.byConversationId[conversationId];
    if (!owner || owner.channel !== channel || owner.externalUserId !== externalUserId) return false;

    fs.unlinkSync(legacySessionFilePath(conversationId));
    const key = userKey(channel, externalUserId);
    index.byUserKey[key] = (index.byUserKey[key] ?? []).filter((id) => id !== conversationId);
    delete index.byConversationId[conversationId];
    writeLegacyIndex(index);
    return true;
  }

  /**
   * Edit-and-resend support: drop the message identified by `fromMessageId`
   * together with every message that follows it in the conversation. Used by
   * the desktop composer when the user edits a prior turn and resends - the
   * caller will then append a fresh user message and let the agent run again.
   * Returns the number of messages removed; throws `SessionNotFound` when the
   * conversation file can't be located and `MessageNotFound` when the message
   * id isn't part of the transcript, so the API layer can map them to distinct
   * HTTP statuses instead of a generic 404.
   */
  truncateMessagesFrom(conversationId: string, fromMessageId: string): number {
    const located = this.resolveSessionStorage(conversationId);
    if (!located) {
      const err = new Error("Session not found");
      (err as Error & { code?: string }).code = "SESSION_NOT_FOUND";
      throw err;
    }
    const messages = located.file.messageMetadata;
    const index = messages.findIndex((message) => message.id === fromMessageId);
    if (index < 0) {
      const err = new Error(`Message not found (session has ${messages.length} message${messages.length === 1 ? "" : "s"})`);
      (err as Error & { code?: string }).code = "MESSAGE_NOT_FOUND";
      throw err;
    }
    const removed = messages.length - index;
    messages.length = index;
    located.file.messageCount = messages.length;
    located.file.conversation.updatedAt = new Date().toISOString();
    if (located.type === "web") writeWebSession(located.externalUserId, located.file);
    else if (located.type === "project") writeProjectSession(located.projectId, located.file);
    else writeLegacySession(located.file);
    return removed;
  }

  listMessages(conversationId: string, limit?: number): ConversationMessage[] {
    if (this.messageProjector) {
      const projected = this.messageProjector(conversationId);
      if (limit == null) return projected;
      if (limit <= 0) return [];
      return projected.slice(-limit);
    }
    return this.listMessageMetadata(conversationId, limit).map((item) => ({
      ...item,
      content: item.content ?? ""
    }));
  }

  listMessageMetadata(conversationId: string, limit?: number): UiMessageMetadata[] {
    const located = this.resolveSessionStorage(conversationId);
    if (!located) return [];
    const messages = located.file.messageMetadata.map((item) => ({ ...item }));
    if (limit == null) return messages;
    if (limit <= 0) return [];
    return messages.slice(-limit);
  }

  markMessagesContextBacked(conversationId: string, messageIds: string[]): void {
    if (messageIds.length === 0) return;
    const located = this.resolveSessionStorage(conversationId);
    if (!located) return;
    const ids = new Set(messageIds);
    let changed = false;
    for (const message of located.file.messageMetadata) {
      if (!ids.has(message.id) || message.contextBacked) continue;
      message.contextBacked = true;
      delete message.content;
      changed = true;
    }
    if (!changed) return;
    if (located.type === "web") writeWebSession(located.externalUserId, located.file);
    else if (located.type === "project") writeProjectSession(located.projectId, located.file);
    else writeLegacySession(located.file);
  }

  /**
   * Persist the Agent `sourceEntryId` the projection resolved for each metadata
   * row, so subsequent loads pair by id instead of list position. Idempotent:
   * only writes when at least one row's stored id actually changes.
   */
  recordMessageSourceEntries(conversationId: string, entries: ReadonlyArray<{ id: string; sourceEntryId: string }>): void {
    if (entries.length === 0) return;
    const located = this.resolveSessionStorage(conversationId);
    if (!located) return;
    const byId = new Map(entries.map((entry) => [entry.id, entry.sourceEntryId]));
    let changed = false;
    for (const message of located.file.messageMetadata) {
      const next = byId.get(message.id);
      if (!next || message.sourceEntryId === next) continue;
      message.sourceEntryId = next;
      changed = true;
    }
    if (!changed) return;
    if (located.type === "web") writeWebSession(located.externalUserId, located.file);
    else if (located.type === "project") writeProjectSession(located.projectId, located.file);
    else writeLegacySession(located.file);
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

  /**
   * Returns the newest empty Web conversation for this profile, or creates one.
   * Keeping this decision in the shared store makes repeated new-chat requests
   * idempotent without teaching desktop/channel callers about storage files.
   */
  getOrCreateEmptyWebConversation(externalUserId: string): { conversation: Conversation; reused: boolean } {
    const existing = this.listConversations("web", externalUserId)
      .find((conversation) => this.listMessages(conversation.id).length === 0);
    if (existing) return { conversation: existing, reused: true };
    return { conversation: this.createWebConversation(externalUserId), reused: false };
  }

  /**
   * Lists every Web conversation across all profiles (plan §12.2 cross-Bot
   * aggregation). Returns the conversation metadata, the owning externalUserId
   * (so the caller can recover the profile id) and a short last-message preview
   * for the sidebar's "latest message" line and title/preview search. Used only
   * by the shared desktop conversation query layer — never by channel runtimes.
   */
  listAllWebConversations(): Array<{
    conversation: Conversation;
    externalUserId: string;
    lastMessageText: string;
  }> {
    // Migrate any not-yet-migrated legacy Web sessions into the Web workspace
    // index before reading it. The per-profile `listConversations` migrates a
    // single user lazily; this cross-profile list must migrate every legacy Web
    // user, otherwise conversations created before the Web-workspace migration
    // would be invisible to the desktop sidebar (plan §12.2 cross-Bot aggregation).
    this.migrateAllLegacyWebUsers();
    const webIndex = readWebIndex();
    const out: Array<{ conversation: Conversation; externalUserId: string; lastMessageText: string }> = [];
    for (const [id, owner] of Object.entries(webIndex.byConversationId)) {
      const file = readWebSession(owner.externalUserId, id);
      if (!file) continue;
      const internalOrigin = inferHistoricalInternalOrigin(file.conversation);
      if (internalOrigin) {
        file.conversation.origin = internalOrigin;
        writeWebSession(owner.externalUserId, file);
      }
      const messages = this.listMessages(id);
      const lastMessageText = String(messages[messages.length - 1]?.content ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
      out.push({ conversation: file.conversation, externalUserId: owner.externalUserId, lastMessageText });
    }
    return out;
  }

  /**
   * Returns the Web externalUserId that owns a conversation id, or null. Used
   * by the desktop session-run query (plan §11.3) to resolve a run's
   * `session_id` back to its Web profile id without exposing the index shape.
   */
  getWebConversationOwner(conversationId: string): string | null {
    const webIndex = readWebIndex();
    return webIndex.byConversationId[conversationId]?.externalUserId ?? null;
  }

  /**
   * Returns the owning project id for a conversation, or null for plain Web
   * conversations. Used by the runtime router so a project conversation's
   * agent execution (context/transcript) lands in the project workspace rather
   * than the shared bot workspace.
   */
  getConversationProjectId(conversationId: string): string | null {
    const id = String(conversationId ?? "").trim();
    if (!id) return null;
    const located = this.resolveSessionStorage(id);
    return located?.type === "project" ? located.projectId : null;
  }

  createProjectConversation(projectId: string, externalUserId: string): Conversation {
    return this.createConversation("web", externalUserId, projectId);
  }

  /** Same empty-session contract as Web, scoped to one project workspace. */
  getOrCreateEmptyProjectConversation(projectId: string, externalUserId: string): { conversation: Conversation; reused: boolean } {
    const existing = this.listProjectConversations(projectId)
      .find((conversation) =>
        conversation.externalUserId === externalUserId && this.listMessages(conversation.id).length === 0
      );
    if (existing) return { conversation: existing, reused: true };
    return { conversation: this.createProjectConversation(projectId, externalUserId), reused: false };
  }

  listProjectConversations(projectId: string): Conversation[] {
    const index = readProjectIndex(projectId);
    const conversations = index.order
      .map((id) => readProjectSession(projectId, id)?.conversation)
      .filter((item): item is Conversation => Boolean(item));
    conversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return conversations;
  }

  getProjectConversation(projectId: string, conversationId: string): Conversation | null {
    const index = readProjectIndex(projectId);
    if (!index.byConversationId[conversationId]) return null;
    return readProjectSession(projectId, conversationId)?.conversation ?? null;
  }

  renameProjectConversation(projectId: string, conversationId: string, title: string): Conversation | null {
    const index = readProjectIndex(projectId);
    if (!index.byConversationId[conversationId]) return null;
    const file = readProjectSession(projectId, conversationId);
    if (!file) return null;
    file.conversation.title = sanitizeConversationTitle(title);
    file.conversation.updatedAt = new Date().toISOString();
    writeProjectSession(projectId, file);
    return file.conversation;
  }

  deleteProjectConversation(projectId: string, conversationId: string): boolean {
    const index = readProjectIndex(projectId);
    if (!index.byConversationId[conversationId]) return false;
    fs.rmSync(projectSessionFilePath(projectId, conversationId), { force: true });
    index.order = index.order.filter((id) => id !== conversationId);
    delete index.byConversationId[conversationId];
    writeProjectIndex(projectId, index);
    return true;
  }

}
