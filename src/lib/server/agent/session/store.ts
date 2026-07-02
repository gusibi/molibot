import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { randomInt } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { RuntimeThinkingLevel } from "$lib/server/settings/index.js";
import { RUNTIME_THINKING_LEVELS, sanitizeRuntimeThinkingLevel } from "$lib/server/settings/index.js";
import type { FileAttachment, LoggedMessage } from "$lib/server/agent/core/types.js";
import { parseRunDetailEntries, type RunDetailEntry } from "$lib/server/agent/session/runDetail.js";
import {
  buildMessagesFromSessionEntries,
  createCompactionSummaryMessage,
  createEntryId,
  createSessionHeader,
  isSameMessage,
  parseSessionEntries,
  serializeSessionEntries,
  type SessionHeaderEntry,
  type SessionEntry,
  type SessionFileEntry,
  type SessionMessageEntry,
  type SessionRuntimeEventEntry
} from "$lib/server/agent/session/session.js";
import {
  resolveDataRootFromWorkspacePath,
  resolveGlobalSkillsDirFromWorkspacePath,
  resolveMemoryRootFromWorkspacePath,
  resolveWorkspaceRelativeFromWorkspacePath
} from "$lib/server/agent/session/workspace.js";
import { estimateContextTokens } from "$lib/server/agent/session/compaction.js";

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export interface SessionUsageSnapshot {
  runCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
}

export interface SessionStatusSnapshot {
  messageCount: number;
  estimatedContextTokens: number;
  compactionCount: number;
  latestCompaction?: {
    timestamp: string;
    tokensBefore: number;
    tokensAfter: number;
    summarizedMessages: number;
    reason: "threshold" | "manual";
  };
  usage: SessionUsageSnapshot;
}

export interface SessionOriginMetadata {
  origin?: "automation" | "chat";
  taskId?: string;
  runId?: string;
  createdAt?: string;
}

export class MomRuntimeStore {
  private readonly dedupe = new Map<string, number>();
  private readonly defaultSessionId = "default";
  private readonly thinkingLevels = new Set<string>(RUNTIME_THINKING_LEVELS);

  constructor(private readonly workspaceDir: string) {
    ensureDir(this.workspaceDir);
    ensureDir(this.getGlobalSkillsDir());
    // Keep bot-scoped skills in place for channel bot workspaces.
    if (!this.isBotWorkspace()) {
      this.migrateLegacyWorkspaceSkills();
    }
  }

  private isBotWorkspace(): boolean {
    const normalized = resolve(this.workspaceDir).replace(/\\/g, "/");
    return /\/moli-[^/]+\/bots\/[^/]+$/.test(normalized);
  }

  private getDataRoot(): string {
    return resolveDataRootFromWorkspacePath(this.workspaceDir);
  }

  private getGlobalSkillsDir(): string {
    return resolveGlobalSkillsDirFromWorkspacePath(this.workspaceDir);
  }

  private migrateLegacyWorkspaceSkills(): void {
    const legacyDir = join(this.workspaceDir, "skills");
    const globalDir = this.getGlobalSkillsDir();
    if (!existsSync(legacyDir) || resolve(legacyDir) === resolve(globalDir)) return;

    try {
      const entries = readdirSync(legacyDir);
      for (const name of entries) {
        const from = join(legacyDir, name);
        const to = join(globalDir, name);
        if (existsSync(to)) continue;
        try {
          renameSync(from, to);
        } catch {
          // keep legacy entry if move fails
        }
      }
    } catch {
      // ignore migration failures to avoid blocking runtime start
    }
  }

  private getWorkspaceMemoryRoot(): string {
    return resolveMemoryRootFromWorkspacePath(this.workspaceDir);
  }

  private getWorkspaceMemoryRelative(): string {
    return resolveWorkspaceRelativeFromWorkspacePath(this.workspaceDir);
  }

  private getGlobalMemoryFile(): string {
    return join(this.getWorkspaceMemoryRoot(), "MEMORY.md");
  }

  private getChatMemoryFile(chatId: string): string {
    return join(this.getWorkspaceMemoryRoot(), this.getWorkspaceMemoryRelative(), chatId, "MEMORY.md");
  }

  private getLegacyGlobalMemoryFile(): string {
    return join(this.workspaceDir, "MEMORY.md");
  }

  private getLegacyChatMemoryFile(chatId: string): string {
    return join(this.getChatDir(chatId), "MEMORY.md");
  }

  private moveMemoryFileIfNeeded(from: string, to: string): void {
    if (!existsSync(from)) return;
    ensureDir(dirname(to));
    if (!existsSync(to)) {
      try {
        renameSync(from, to);
        return;
      } catch {
        // fallback below
      }
    }
    try {
      const oldContent = readFileSync(from, "utf8").trim();
      if (!oldContent) {
        unlinkSync(from);
        return;
      }
      const current = existsSync(to) ? readFileSync(to, "utf8").trim() : "";
      if (!current.includes(oldContent)) {
        const merged = [current, oldContent].filter(Boolean).join("\n\n").trim();
        writeFileSync(to, `${merged}\n`, "utf8");
      }
      unlinkSync(from);
    } catch {
      // keep original file if migration fails
    }
  }

  private migrateLegacyMemory(chatId: string): void {
    this.moveMemoryFileIfNeeded(this.getLegacyGlobalMemoryFile(), this.getGlobalMemoryFile());
    this.moveMemoryFileIfNeeded(this.getLegacyChatMemoryFile(chatId), this.getChatMemoryFile(chatId));
  }

  getWorkspaceDir(): string {
    return this.workspaceDir;
  }

  getChatDir(chatId: string): string {
    const dir = join(this.workspaceDir, chatId);
    ensureDir(dir);
    ensureDir(join(dir, "attachments"));
    ensureDir(join(dir, "scratch"));
    return dir;
  }

  getScratchDir(chatId: string): string {
    const dir = join(this.getChatDir(chatId), "scratch");
    ensureDir(dir);
    return dir;
  }

  getRunSummaryLogPath(chatId: string): string {
    const file = join(this.getChatDir(chatId), "run-summaries.jsonl");
    if (!existsSync(file)) {
      writeFileSync(file, "", "utf8");
    }
    return file;
  }

  getSessionEntriesPath(chatId: string, sessionId?: string): string {
    const id = sessionId ? this.sanitizeSessionId(sessionId) : this.getActiveSession(chatId);
    return this.ensureSessionEntriesFile(chatId, id);
  }

  private getContextsDir(chatId: string): string {
    const dir = join(this.getChatDir(chatId), "contexts");
    ensureDir(dir);
    return dir;
  }

  private getActiveSessionFile(chatId: string): string {
    return join(this.getChatDir(chatId), "active_session.txt");
  }

  private getSessionContextFile(chatId: string, sessionId: string): string {
    return join(this.getContextsDir(chatId), `${sessionId}.json`);
  }

  private getSessionEntriesFile(chatId: string, sessionId: string): string {
    return join(this.getContextsDir(chatId), `${sessionId}.jsonl`);
  }

  private getSessionMetadataFile(chatId: string, sessionId: string): string {
    return join(this.getContextsDir(chatId), `${sessionId}.meta.json`);
  }

  private sanitizeSessionId(sessionId: string): string {
    const raw = String(sessionId ?? "").trim();
    const safe = raw.replace(/[^a-zA-Z0-9._-]/g, "");
    return safe || this.defaultSessionId;
  }

  private formatSessionDate(date = new Date()): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}${month}${day}`;
  }

  private randomSessionSuffix(length = 4): string {
    const alphabet = "abcdefghijklmnopqrstuvwxyz";
    let out = "";
    for (let i = 0; i < length; i += 1) {
      out += alphabet[randomInt(alphabet.length)];
    }
    return out;
  }

  private nextRandomSessionId(chatId: string, prefix: "s" | "task"): string {
    const day = this.formatSessionDate();
    const marker = `${prefix}-${day}-`;
    let candidate = `${marker}${this.randomSessionSuffix()}`;
    while (
      existsSync(this.getSessionContextFile(chatId, candidate)) ||
      existsSync(this.getSessionEntriesFile(chatId, candidate))
    ) {
      candidate = `${marker}${this.randomSessionSuffix()}`;
    }
    return candidate;
  }

  private ensureSessionContextFile(chatId: string, sessionId: string): string {
    const id = this.sanitizeSessionId(sessionId);
    const file = this.getSessionContextFile(chatId, id);
    if (!existsSync(file)) {
      writeFileSync(file, "[]\n", "utf8");
    }
    return file;
  }

  private ensureSessionEntriesFile(chatId: string, sessionId: string): string {
    const id = this.sanitizeSessionId(sessionId);
    const file = this.getSessionEntriesFile(chatId, id);
    if (!existsSync(file)) {
      const header = createSessionHeader(id);
      writeFileSync(file, serializeSessionEntries([header]), "utf8");
    }
    return file;
  }

  private migrateLegacyContext(chatId: string): void {
    const legacy = join(this.getChatDir(chatId), "context.json");
    if (!existsSync(legacy)) return;

    const target = this.getSessionContextFile(chatId, this.defaultSessionId);
    if (!existsSync(target)) {
      try {
        const raw = readFileSync(legacy, "utf8");
        writeFileSync(target, raw, "utf8");
      } catch {
        writeFileSync(target, "[]\n", "utf8");
      }
    }

    try {
      unlinkSync(legacy);
    } catch {
      // ignore migration cleanup failures
    }
  }

  private migrateLegacySessionContext(chatId: string, sessionId: string): void {
    const id = this.sanitizeSessionId(sessionId);
    const entriesFile = this.ensureSessionEntriesFile(chatId, id);
    const rawContextFile = this.ensureSessionContextFile(chatId, id);
    if (!existsSync(rawContextFile)) return;

    try {
      const raw = readFileSync(rawContextFile, "utf8");
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length === 0) return;

      const existing = parseSessionEntries(readFileSync(entriesFile, "utf8"));
      const bodyEntries = existing.filter((entry): entry is SessionEntry => entry.type !== "session");
      if (bodyEntries.length > 0) return;

      const header = existing.find((entry) => entry.type === "session") ?? createSessionHeader(id);
      const migratedEntries: SessionFileEntry[] = [
        header,
        ...parsed.map((message: AgentMessage, index: number) => ({
          type: "message" as const,
          id: createEntryId(),
          parentId: index === 0 ? null : null,
          timestamp: new Date().toISOString(),
          message
        }))
      ];
      let prevId: string | null = null;
      for (const entry of migratedEntries) {
        if (entry.type === "session") continue;
        entry.parentId = prevId;
        prevId = entry.id;
      }
      writeFileSync(entriesFile, serializeSessionEntries(migratedEntries), "utf8");
    } catch {
      // ignore migration failures and keep legacy context fallback
    }
  }

  private readSessionFileEntries(chatId: string, sessionId: string): SessionFileEntry[] {
    const id = this.sanitizeSessionId(sessionId);
    this.migrateLegacySessionContext(chatId, id);
    const file = this.ensureSessionEntriesFile(chatId, id);
    try {
      const raw = readFileSync(file, "utf8");
      const parsed = parseSessionEntries(raw);
      if (parsed.length > 0) return parsed;
    } catch {
      // fall back below
    }
    const header = createSessionHeader(id);
    writeFileSync(file, serializeSessionEntries([header]), "utf8");
    return [header];
  }

  private writeSessionFileEntries(chatId: string, sessionId: string, entries: SessionFileEntry[]): void {
    const id = this.sanitizeSessionId(sessionId);
    const file = this.ensureSessionEntriesFile(chatId, id);
    writeFileSync(file, serializeSessionEntries(entries), "utf8");
  }

  private readSessionHeader(chatId: string, sessionId: string): SessionHeaderEntry {
    const id = this.sanitizeSessionId(sessionId);
    const entries = this.readSessionFileEntries(chatId, id);
    return entries.find((entry): entry is SessionHeaderEntry => entry.type === "session") ?? createSessionHeader(id);
  }

  private updateSessionHeader(
    chatId: string,
    sessionId: string,
    updater: (current: SessionHeaderEntry) => SessionHeaderEntry
  ): SessionHeaderEntry {
    const id = this.sanitizeSessionId(sessionId);
    const entries = this.readSessionFileEntries(chatId, id);
    const index = entries.findIndex((entry) => entry.type === "session");
    const current = index >= 0
      ? entries[index] as SessionHeaderEntry
      : createSessionHeader(id);
    const next = updater(current);
    const rewritten = index >= 0
      ? [...entries.slice(0, index), next, ...entries.slice(index + 1)]
      : [next, ...entries];
    this.writeSessionFileEntries(chatId, id, rewritten);
    return next;
  }

  private appendSessionEntry(chatId: string, sessionId: string, entry: SessionEntry): void {
    const id = this.sanitizeSessionId(sessionId);
    const entries = this.readSessionFileEntries(chatId, id);
    const body = entries.filter((item): item is SessionEntry => item.type !== "session");
    const previous = body[body.length - 1];
    const next: SessionEntry = {
      ...entry,
      id: entry.id || createEntryId(),
      parentId: entry.parentId === undefined ? previous?.id ?? null : entry.parentId,
      timestamp: entry.timestamp || new Date().toISOString()
    };
    appendFileSync(this.ensureSessionEntriesFile(chatId, id), `${JSON.stringify(next)}\n`, "utf8");
  }

  listSessions(chatId: string): string[] {
    this.migrateLegacyContext(chatId);
    const dir = this.getContextsDir(chatId);
    const out = [...new Set(
      readdirSync(dir)
        .filter((name) => name.endsWith(".json") || name.endsWith(".jsonl"))
        .map((name) => name.replace(/\.(json|jsonl)$/, ""))
    )]
      .filter((id) => !id.endsWith(".meta"))
      .filter(Boolean)
      .sort();

    if (out.length === 0) {
      this.ensureSessionContextFile(chatId, this.defaultSessionId);
      return [this.defaultSessionId];
    }
    return out;
  }

  readSessionOrigin(chatId: string, sessionId: string): SessionOriginMetadata | null {
    const id = this.sanitizeSessionId(sessionId);
    const file = this.getSessionMetadataFile(chatId, id);
    if (!existsSync(file)) return null;
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as SessionOriginMetadata;
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }

  markSessionOrigin(chatId: string, sessionId: string, metadata: SessionOriginMetadata): void {
    const id = this.sanitizeSessionId(sessionId);
    this.ensureSessionEntriesFile(chatId, id);
    writeFileSync(this.getSessionMetadataFile(chatId, id), `${JSON.stringify({
      ...metadata,
      createdAt: metadata.createdAt ?? new Date().toISOString()
    }, null, 2)}\n`, "utf8");
  }

  listVisibleSessions(chatId: string): string[] {
    return this.listSessions(chatId).filter((id) => this.readSessionOrigin(chatId, id)?.origin !== "automation");
  }

  getActiveSession(chatId: string): string {
    this.migrateLegacyContext(chatId);
    const file = this.getActiveSessionFile(chatId);
    const sessions = this.listSessions(chatId);

    if (existsSync(file)) {
      try {
        const current = this.sanitizeSessionId(readFileSync(file, "utf8"));
        if (sessions.includes(current)) {
          return current;
        }
      } catch {
        // ignore and recreate below
      }
    }

    const fallback = sessions[0] ?? this.defaultSessionId;
    writeFileSync(file, fallback, "utf8");
    return fallback;
  }

  setActiveSession(chatId: string, sessionId: string): string {
    const id = this.sanitizeSessionId(sessionId);
    const sessions = this.listSessions(chatId);
    if (!sessions.includes(id)) {
      throw new Error(`Session '${id}' does not exist.`);
    }
    writeFileSync(this.getActiveSessionFile(chatId), id, "utf8");
    return id;
  }

  createSession(chatId: string): string {
    const id = this.nextRandomSessionId(chatId, "s");
    this.ensureSessionContextFile(chatId, id);
    this.ensureSessionEntriesFile(chatId, id);
    this.setActiveSession(chatId, id);
    return id;
  }

  /**
   * Creates a fresh session for a scheduled task run and makes it active so
   * follow-up replies in the chat land in the task's context. Old task
   * sessions past the retention window are pruned in the same call.
   */
  beginTaskSession(
    chatId: string,
    retentionMs?: number,
    metadata?: Omit<SessionOriginMetadata, "origin" | "createdAt">
  ): string {
    const id = this.nextRandomSessionId(chatId, "task");
    this.ensureSessionContextFile(chatId, id);
    this.ensureSessionEntriesFile(chatId, id);
    this.markSessionOrigin(chatId, id, { origin: "automation", ...(metadata ?? {}) });
    this.setActiveSession(chatId, id);
    if (retentionMs !== undefined && retentionMs > 0) {
      this.pruneTaskSessions(chatId, retentionMs);
    }
    return id;
  }

  /**
   * Deletes `task-` sessions whose latest activity (entries-file mtime) is
   * older than retentionMs. The active session and non-task sessions are
   * never touched.
   */
  pruneTaskSessions(chatId: string, retentionMs: number): string[] {
    const cutoff = Date.now() - Math.max(0, retentionMs);
    const active = this.getActiveSession(chatId);
    const pruned: string[] = [];

    for (const id of this.listSessions(chatId)) {
      if (!id.startsWith("task-") || id === active) continue;
      let lastActivityMs = 0;
      for (const file of [this.getSessionEntriesFile(chatId, id), this.getSessionContextFile(chatId, id)]) {
        try {
          lastActivityMs = Math.max(lastActivityMs, statSync(file).mtimeMs);
        } catch {
          // missing variant file; rely on the other one
        }
      }
      if (lastActivityMs === 0 || lastActivityMs >= cutoff) continue;
      try {
        this.deleteSession(chatId, id);
        pruned.push(id);
      } catch {
        // e.g. last remaining session; leave it in place
      }
    }
    return pruned;
  }

  clearSessionContext(chatId: string, sessionId: string): void {
    const id = this.sanitizeSessionId(sessionId);
    this.ensureSessionContextFile(chatId, id);
    writeFileSync(this.getSessionContextFile(chatId, id), "[]\n", "utf8");
    const header = this.readSessionHeader(chatId, id);
    this.writeSessionFileEntries(chatId, id, [header]);
  }

  deleteSession(chatId: string, sessionId: string): { deleted: string; active: string; remaining: string[] } {
    const id = this.sanitizeSessionId(sessionId);
    const sessions = this.listSessions(chatId);
    if (!sessions.includes(id)) {
      throw new Error(`Session '${id}' does not exist.`);
    }
    if (sessions.length <= 1) {
      throw new Error("Cannot delete the last session.");
    }

    unlinkSync(this.getSessionContextFile(chatId, id));
    try {
      unlinkSync(this.getSessionEntriesFile(chatId, id));
    } catch {
      // ignore
    }
    try {
      unlinkSync(this.getSessionMetadataFile(chatId, id));
    } catch {
      // ignore
    }
    const remaining = this.listSessions(chatId);
    const current = this.getActiveSession(chatId);
    const active = current === id ? this.setActiveSession(chatId, remaining[0]) : current;
    return { deleted: id, active, remaining };
  }

  saveAttachment(
    chatId: string,
    filename: string,
    ts: string,
    content: Buffer,
    meta?: { mediaType?: FileAttachment["mediaType"]; mimeType?: string }
  ): FileAttachment {
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_") || "file.bin";
    const millis = Math.floor(parseFloat(ts) * 1000);
    const local = `${chatId}/attachments/${millis}_${safeName}`;
    const fullPath = join(this.workspaceDir, local);
    ensureDir(dirname(fullPath));
    writeFileSync(fullPath, content);

    const lower = safeName.toLowerCase();
    const isImage = lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".gif") || lower.endsWith(".webp");
    const isAudio =
      lower.endsWith(".ogg") ||
      lower.endsWith(".oga") ||
      lower.endsWith(".amr") ||
      lower.endsWith(".silk") ||
      lower.endsWith(".mp3") ||
      lower.endsWith(".wav") ||
      lower.endsWith(".m4a") ||
      lower.endsWith(".aac") ||
      lower.endsWith(".opus") ||
      lower.endsWith(".webm") ||
      lower.endsWith(".flac");
    const isVideo =
      lower.endsWith(".mp4") ||
      lower.endsWith(".mov") ||
      lower.endsWith(".mkv") ||
      lower.endsWith(".avi") ||
      lower.endsWith(".m4v");
    const inferredMediaType = isImage ? "image" : isAudio ? "audio" : isVideo ? "video" : "file";
    const mediaType = meta?.mediaType ?? inferredMediaType;
    const inferredMimeType =
      inferredMediaType === "image"
        ? lower.endsWith(".png")
          ? "image/png"
          : lower.endsWith(".gif")
            ? "image/gif"
            : lower.endsWith(".webp")
              ? "image/webp"
              : "image/jpeg"
        : inferredMediaType === "audio"
          ? lower.endsWith(".mp3")
            ? "audio/mpeg"
            : lower.endsWith(".wav")
              ? "audio/wav"
              : lower.endsWith(".amr")
                ? "audio/amr"
                : lower.endsWith(".silk")
                  ? "audio/silk"
                : lower.endsWith(".m4a")
                  ? "audio/mp4"
                : lower.endsWith(".aac")
                  ? "audio/aac"
                  : lower.endsWith(".webm")
                    ? "audio/webm"
                    : lower.endsWith(".flac")
                      ? "audio/flac"
                      : "audio/ogg"
          : undefined;
    const mimeType = meta?.mimeType ?? inferredMimeType;

    return {
      original: filename,
      local,
      mediaType,
      mimeType,
      size: content.byteLength,
      isImage: mediaType === "image",
      isAudio: mediaType === "audio",
      isVideo: mediaType === "video"
    };
  }

  logMessage(chatId: string, message: LoggedMessage): boolean {
    const key = `${chatId}:${message.messageId}`;
    if (this.dedupe.has(key)) {
      return false;
    }

    this.dedupe.set(key, Date.now());
    setTimeout(() => this.dedupe.delete(key), 60000);

    const file = join(this.getChatDir(chatId), "log.jsonl");
    appendFileSync(file, `${JSON.stringify(message)}\n`, "utf8");
    return true;
  }

  logBotResponse(chatId: string, text: string, messageId: number): void {
    this.logMessage(chatId, {
      date: new Date().toISOString(),
      ts: (Date.now() / 1000).toFixed(6),
      messageId,
      user: "bot",
      text,
      attachments: [],
      isBot: true
    });
  }

  loadContext(chatId: string, sessionId?: string): AgentMessage[] {
    const id = sessionId ? this.sanitizeSessionId(sessionId) : this.getActiveSession(chatId);
    const built = buildMessagesFromSessionEntries(this.readSessionFileEntries(chatId, id));
    if (built.messages.length > 0) {
      return built.messages;
    }

    const file = this.ensureSessionContextFile(chatId, id);
    try {
      const raw = readFileSync(file, "utf8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as AgentMessage[]) : [];
    } catch {
      return [];
    }
  }

  saveContext(chatId: string, messages: AgentMessage[], sessionId?: string): void {
    const id = sessionId ? this.sanitizeSessionId(sessionId) : this.getActiveSession(chatId);
    const current = this.loadContext(chatId, id);
    const file = this.ensureSessionContextFile(chatId, id);
    writeFileSync(file, JSON.stringify(messages, null, 2), "utf8");

    let prefixMatches = true;
    const prefixLength = Math.min(current.length, messages.length);
    for (let i = 0; i < prefixLength; i += 1) {
      if (!isSameMessage(current[i] as AgentMessage, messages[i] as AgentMessage)) {
        prefixMatches = false;
        break;
      }
    }

    if (prefixMatches && messages.length >= current.length) {
      const newMessages = messages.slice(current.length);
      for (const message of newMessages) {
        this.appendSessionEntry(chatId, id, {
          type: "message",
          id: createEntryId(),
          parentId: null,
          timestamp: new Date(
            typeof (message as { timestamp?: number }).timestamp === "number"
              ? (message as { timestamp: number }).timestamp
              : Date.now()
          ).toISOString(),
          message
        });
      }
      return;
    }

    const header = this.readSessionHeader(chatId, id);
    const entries: SessionFileEntry[] = [header];
    let prevId: string | null = null;
    for (const message of messages) {
      const entry: SessionMessageEntry = {
        type: "message",
        id: createEntryId(),
        parentId: prevId,
        timestamp: new Date(
          typeof (message as { timestamp?: number }).timestamp === "number"
            ? (message as { timestamp: number }).timestamp
            : Date.now()
        ).toISOString(),
        message
      };
      entries.push(entry);
      prevId = entry.id;
    }
    this.writeSessionFileEntries(chatId, id, entries);
  }

  appendContextMessage(chatId: string, message: AgentMessage, sessionId?: string): void {
    const id = sessionId ? this.sanitizeSessionId(sessionId) : this.getActiveSession(chatId);
    this.appendSessionEntry(chatId, id, {
      type: "message",
      id: createEntryId(),
      parentId: null,
      timestamp: new Date(
        typeof (message as { timestamp?: number }).timestamp === "number"
          ? (message as { timestamp: number }).timestamp
          : Date.now()
      ).toISOString(),
      message
    });
    const snapshot = this.loadContext(chatId, id);
    writeFileSync(this.getSessionContextFile(chatId, id), JSON.stringify(snapshot, null, 2), "utf8");
  }

  getSessionThinkingLevelOverride(chatId: string, sessionId?: string): RuntimeThinkingLevel | null {
    const id = sessionId ? this.sanitizeSessionId(sessionId) : this.getActiveSession(chatId);
    const raw = this.readSessionHeader(chatId, id).preferences?.thinkingLevelOverride;
    const normalized = String(raw ?? "").trim().toLowerCase();
    if (!normalized) return null;
    if (!this.thinkingLevels.has(normalized)) return null;
    return sanitizeRuntimeThinkingLevel(normalized, "off");
  }

  setSessionThinkingLevelOverride(
    chatId: string,
    sessionId: string,
    value: RuntimeThinkingLevel | null
  ): RuntimeThinkingLevel | null {
    const id = this.sanitizeSessionId(sessionId);
    const normalized = value == null ? null : sanitizeRuntimeThinkingLevel(value, "off");
    this.updateSessionHeader(chatId, id, (current) => {
      const nextPreferences = { ...(current.preferences ?? {}) };
      if (normalized == null) {
        delete nextPreferences.thinkingLevelOverride;
      } else {
        nextPreferences.thinkingLevelOverride = normalized;
      }
      return {
        ...current,
        preferences: Object.keys(nextPreferences).length > 0 ? nextPreferences : undefined
      };
    });
    return normalized;
  }

  getSessionHostApprovalMode(chatId: string, sessionId?: string): "default" | "session" {
    const id = sessionId ? this.sanitizeSessionId(sessionId) : this.getActiveSession(chatId);
    return this.readSessionHeader(chatId, id).preferences?.hostApprovalMode === "session"
      ? "session"
      : "default";
  }

  setSessionHostApprovalMode(
    chatId: string,
    sessionId: string,
    value: "default" | "session"
  ): "default" | "session" {
    const id = this.sanitizeSessionId(sessionId);
    this.updateSessionHeader(chatId, id, (current) => {
      const nextPreferences = { ...(current.preferences ?? {}) };
      if (value === "session") {
        nextPreferences.hostApprovalMode = "session";
      } else {
        delete nextPreferences.hostApprovalMode;
      }
      return {
        ...current,
        preferences: Object.keys(nextPreferences).length > 0 ? nextPreferences : undefined
      };
    });
    return value;
  }

  getSessionSandboxOverride(chatId: string, sessionId?: string): boolean | null {
    const id = sessionId ? this.sanitizeSessionId(sessionId) : this.getActiveSession(chatId);
    const val = this.readSessionHeader(chatId, id).preferences?.sandboxOverride;
    if (val === true) return true;
    if (val === false) return false;
    return null;
  }

  setSessionSandboxOverride(
    chatId: string,
    sessionId: string,
    value: boolean | null
  ): boolean | null {
    const id = this.sanitizeSessionId(sessionId);
    this.updateSessionHeader(chatId, id, (current) => {
      const nextPreferences = { ...(current.preferences ?? {}) };
      if (value === null) {
        delete nextPreferences.sandboxOverride;
      } else {
        nextPreferences.sandboxOverride = value;
      }
      return {
        ...current,
        preferences: Object.keys(nextPreferences).length > 0 ? nextPreferences : undefined
      };
    });
    return value;
  }

  getSessionRunLogNoticeOverride(chatId: string, sessionId?: string): boolean | null {
    const id = sessionId ? this.sanitizeSessionId(sessionId) : this.getActiveSession(chatId);
    const val = this.readSessionHeader(chatId, id).preferences?.runLogNoticeOverride;
    if (val === true) return true;
    if (val === false) return false;
    return null;
  }

  setSessionRunLogNoticeOverride(
    chatId: string,
    sessionId: string,
    value: boolean | null
  ): boolean | null {
    const id = this.sanitizeSessionId(sessionId);
    this.updateSessionHeader(chatId, id, (current) => {
      const nextPreferences = { ...(current.preferences ?? {}) };
      if (value === null) {
        delete nextPreferences.runLogNoticeOverride;
      } else {
        nextPreferences.runLogNoticeOverride = value;
      }
      return {
        ...current,
        preferences: Object.keys(nextPreferences).length > 0 ? nextPreferences : undefined
      };
    });
    return value;
  }

  appendCompaction(
    chatId: string,
    summary: string,
    keptMessages: AgentMessage[],
    tokensBefore: number,
    tokensAfter: number,
    summarizedMessages: number,
    reason: "threshold" | "manual",
    sessionId?: string
  ): void {
    const id = sessionId ? this.sanitizeSessionId(sessionId) : this.getActiveSession(chatId);
    this.appendSessionEntry(chatId, id, {
      type: "compaction",
      id: createEntryId(),
      parentId: null,
      timestamp: new Date().toISOString(),
      summary,
      keptMessages,
      tokensBefore,
      tokensAfter,
      summarizedMessages,
      reason
    });
    const snapshot = [createCompactionSummaryMessage(summary), ...keptMessages];
    writeFileSync(this.getSessionContextFile(chatId, id), JSON.stringify(snapshot, null, 2), "utf8");
  }

  appendRuntimeEvent(
    chatId: string,
    event: Omit<SessionRuntimeEventEntry, "type" | "id" | "parentId" | "timestamp">,
    sessionId?: string
  ): void {
    const id = sessionId ? this.sanitizeSessionId(sessionId) : this.getActiveSession(chatId);
    this.appendSessionEntry(chatId, id, {
      type: "runtime_event",
      id: createEntryId(),
      parentId: null,
      timestamp: new Date().toISOString(),
      ...event
    });
  }

  appendRunSummary(chatId: string, summary: Record<string, unknown>): void {
    const file = this.getRunSummaryLogPath(chatId);
    const record = {
      createdAt: new Date().toISOString(),
      ...summary
    };
    appendFileSync(file, `${JSON.stringify(record)}\n`, "utf8");
  }

  private getRunDetailsDir(chatId: string): string {
    const dir = join(this.getChatDir(chatId), "run-details");
    ensureDir(dir);
    return dir;
  }

  getRunDetailPath(chatId: string, runId: string): string {
    const safeRunId = String(runId ?? "").replace(/[^a-zA-Z0-9._-]/g, "_").trim();
    return join(this.getRunDetailsDir(chatId), `${safeRunId || "unknown"}.jsonl`);
  }

  appendRunDetail(chatId: string, runId: string, entry: RunDetailEntry): void {
    const file = this.getRunDetailPath(chatId, runId);
    appendFileSync(file, `${JSON.stringify(entry)}\n`, "utf8");
  }

  readRunDetail(chatId: string, runId: string): RunDetailEntry[] {
    const file = this.getRunDetailPath(chatId, runId);
    if (!existsSync(file)) return [];
    try {
      return parseRunDetailEntries(readFileSync(file, "utf8"));
    } catch {
      return [];
    }
  }

  readLatestRunSummary(chatId: string): Record<string, unknown> | null {
    const file = this.getRunSummaryLogPath(chatId);
    try {
      const lines = readFileSync(file, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        try {
          const parsed = JSON.parse(lines[index]) as Record<string, unknown>;
          if (parsed && typeof parsed === "object") return parsed;
        } catch {
          // skip invalid line
        }
      }
    } catch {
      // ignore
    }
    return null;
  }

  listRunSummaries(chatId: string, limit = 20): Array<Record<string, unknown>> {
    const file = this.getRunSummaryLogPath(chatId);
    const max = Math.max(1, Math.min(100, Math.floor(limit) || 20));
    try {
      const lines = readFileSync(file, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const out: Array<Record<string, unknown>> = [];
      for (let index = lines.length - 1; index >= 0 && out.length < max; index -= 1) {
        try {
          const parsed = JSON.parse(lines[index]) as Record<string, unknown>;
          if (parsed && typeof parsed === "object") out.push(parsed);
        } catch {
          // skip invalid line
        }
      }
      return out;
    } catch {
      return [];
    }
  }

  getSessionStatusSnapshot(chatId: string, sessionId?: string): SessionStatusSnapshot {
    const id = sessionId ? this.sanitizeSessionId(sessionId) : this.getActiveSession(chatId);
    const built = buildMessagesFromSessionEntries(this.readSessionFileEntries(chatId, id));
    const messageCount = built.messages.length;
    const estimatedContextTokens = estimateContextTokens(built.messages);
    const compactions = built.entries.filter((entry) => entry.type === "compaction");
    const latestCompaction = compactions[compactions.length - 1];

    return {
      messageCount,
      estimatedContextTokens,
      compactionCount: compactions.length,
      latestCompaction: latestCompaction
        ? {
            timestamp: latestCompaction.timestamp,
            tokensBefore: latestCompaction.tokensBefore,
            tokensAfter: latestCompaction.tokensAfter,
            summarizedMessages: latestCompaction.summarizedMessages,
            reason: latestCompaction.reason
          }
        : undefined,
      usage: this.getSessionUsageSnapshot(chatId, id)
    };
  }

  getSessionUsageSnapshot(chatId: string, sessionId?: string): SessionUsageSnapshot {
    const id = sessionId ? this.sanitizeSessionId(sessionId) : this.getActiveSession(chatId);
    const out: SessionUsageSnapshot = {
      runCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0
    };
    const file = this.getRunSummaryLogPath(chatId);
    if (!existsSync(file)) return out;

    try {
      const lines = readFileSync(file, "utf8")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      for (const line of lines) {
        try {
          const row = JSON.parse(line) as {
            sessionId?: string;
            usage?: {
              inputTokens?: number;
              outputTokens?: number;
              cacheReadTokens?: number;
              cacheWriteTokens?: number;
              totalTokens?: number;
            };
          };
          if (this.sanitizeSessionId(row.sessionId ?? "") !== id) continue;
          out.runCount += 1;
          out.inputTokens += Number(row.usage?.inputTokens ?? 0);
          out.outputTokens += Number(row.usage?.outputTokens ?? 0);
          out.cacheReadTokens += Number(row.usage?.cacheReadTokens ?? 0);
          out.cacheWriteTokens += Number(row.usage?.cacheWriteTokens ?? 0);
          out.totalTokens += Number(row.usage?.totalTokens ?? 0);
        } catch {
          // ignore malformed historical lines
        }
      }
    } catch {
      return out;
    }

    return out;
  }

  readMemory(chatId: string): string {
    this.migrateLegacyMemory(chatId);
    const parts: string[] = [];
    const globalPath = this.getGlobalMemoryFile();
    const chatPath = this.getChatMemoryFile(chatId);

    if (existsSync(globalPath)) {
      try {
        const content = readFileSync(globalPath, "utf8").trim();
        if (content) parts.push(`### Global\n${content}`);
      } catch {
        // ignore
      }
    }

    if (existsSync(chatPath)) {
      try {
        const content = readFileSync(chatPath, "utf8").trim();
        if (content) parts.push(`### Chat\n${content}`);
      } catch {
        // ignore
      }
    }

    return parts.length === 0 ? "(no working memory yet)" : parts.join("\n\n");
  }
}
