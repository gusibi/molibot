import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { RuntimeThinkingLevel } from "../settings/index.js";
import { RUNTIME_THINKING_LEVELS, sanitizeRuntimeThinkingLevel } from "../settings/index.js";
import type { FileAttachment, LoggedMessage } from "./types.js";
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
  type SessionMessageEntry
} from "./session.js";
import {
  resolveDataRootFromWorkspacePath,
  resolveGlobalSkillsDirFromWorkspacePath,
  resolveMemoryRootFromWorkspacePath,
  resolveWorkspaceRelativeFromWorkspacePath
} from "./workspace.js";

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
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

  private sanitizeSessionId(sessionId: string): string {
    const raw = String(sessionId ?? "").trim();
    const safe = raw.replace(/[^a-zA-Z0-9._-]/g, "");
    return safe || this.defaultSessionId;
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
      .filter(Boolean)
      .sort();

    if (out.length === 0) {
      this.ensureSessionContextFile(chatId, this.defaultSessionId);
      return [this.defaultSessionId];
    }
    return out;
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
    const id = `s-${Date.now().toString(36)}-${randomUUID().slice(0, 4)}`;
    this.ensureSessionContextFile(chatId, id);
    this.ensureSessionEntriesFile(chatId, id);
    this.setActiveSession(chatId, id);
    return id;
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
    const inferredMediaType = isImage ? "image" : isAudio ? "audio" : "file";
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
      isImage: mediaType === "image",
      isAudio: mediaType === "audio"
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
