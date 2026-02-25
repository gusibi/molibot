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
import { dirname, join, resolve } from "node:path";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { FileAttachment, LoggedMessage } from "./types.js";

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export class TelegramMomStore {
  private readonly dedupe = new Map<string, number>();
  private readonly defaultSessionId = "default";

  constructor(private readonly workspaceDir: string) {
    ensureDir(this.workspaceDir);
    ensureDir(join(this.workspaceDir, "skills"));
  }

  private getWorkspaceMemoryRoot(): string {
    const normalized = resolve(this.workspaceDir).replace(/\\/g, "/");
    const marker = "/moli-t/";
    const idx = normalized.indexOf(marker);
    if (idx > 0) {
      return join(normalized.slice(0, idx), "memory");
    }
    return join(this.workspaceDir, "memory");
  }

  private getWorkspaceMemoryRelative(): string {
    const normalized = resolve(this.workspaceDir).replace(/\\/g, "/");
    const marker = "/moli-t/";
    const idx = normalized.indexOf(marker);
    if (idx > 0) {
      return normalized.slice(idx + 1); // remove leading slash
    }
    return "workspace";
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

  listSessions(chatId: string): string[] {
    this.migrateLegacyContext(chatId);
    const dir = this.getContextsDir(chatId);
    const out = readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.slice(0, -".json".length))
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
    const id = `s-${Date.now().toString(36)}`;
    this.ensureSessionContextFile(chatId, id);
    this.setActiveSession(chatId, id);
    return id;
  }

  clearSessionContext(chatId: string, sessionId: string): void {
    const id = this.sanitizeSessionId(sessionId);
    this.ensureSessionContextFile(chatId, id);
    writeFileSync(this.getSessionContextFile(chatId, id), "[]\n", "utf8");
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
    const remaining = this.listSessions(chatId);
    const current = this.getActiveSession(chatId);
    const active = current === id ? this.setActiveSession(chatId, remaining[0]) : current;
    return { deleted: id, active, remaining };
  }

  saveAttachment(chatId: string, filename: string, ts: string, content: Buffer): FileAttachment {
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_") || "file.bin";
    const millis = Math.floor(parseFloat(ts) * 1000);
    const local = `${chatId}/attachments/${millis}_${safeName}`;
    const fullPath = join(this.workspaceDir, local);
    ensureDir(dirname(fullPath));
    writeFileSync(fullPath, content);

    const lower = safeName.toLowerCase();
    const isImage = lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".gif") || lower.endsWith(".webp");

    return {
      original: filename,
      local,
      isImage
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
    const file = this.ensureSessionContextFile(chatId, id);
    if (!existsSync(file)) {
      return [];
    }

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
    const file = this.ensureSessionContextFile(chatId, id);
    writeFileSync(file, JSON.stringify(messages, null, 2), "utf8");
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
