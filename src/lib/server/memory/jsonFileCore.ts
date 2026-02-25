import path from "node:path";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import type { SessionStore } from "../services/sessionStore.js";
import { readJsonFile, storagePaths, writeJsonFile } from "../db/sqlite.js";
import type { Channel } from "../types/message.js";
import type {
  MemoryAddInput,
  MemoryCore,
  MemoryCoreCapabilities,
  MemoryFlushResult,
  MemoryLayer,
  MemoryRecord,
  MemoryScope,
  MemorySearchMode,
  MemorySearchInput,
  MemorySyncResult,
  MemoryUpdateInput
} from "./types.js";

interface MemoryFileData {
  items: MemoryRecord[];
  cursors: Record<string, number>;
}

function normalizeTags(input: string[] | undefined): string[] {
  if (!Array.isArray(input)) return [];
  const dedup = new Set<string>();
  for (const raw of input) {
    const tag = String(raw ?? "").trim().toLowerCase();
    if (tag) dedup.add(tag);
  }
  return Array.from(dedup);
}

function normalizeContent(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function scoreByQuery(content: string, query: string): number {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return 1;
  const target = content.toLowerCase();
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  let score = 0;
  for (const token of tokens) {
    if (target.includes(token)) score += 1;
  }
  return score;
}

function scoreByRecency(updatedAt: string): number {
  const deltaMs = Date.now() - Date.parse(updatedAt);
  if (!Number.isFinite(deltaMs) || deltaMs < 0) return 1;
  const oneDay = 24 * 60 * 60 * 1000;
  return Math.max(0.1, 1 / (1 + (deltaMs / oneDay)));
}

function classifyMemory(
  text: string
): { content: string; layer: MemoryLayer; tags: string[] } | null {
  const normalized = normalizeContent(text);
  if (!normalized || normalized.length < 6) return null;
  if (normalized.length > 500) return null;
  const lower = normalized.toLowerCase();

  const longTermHints = [
    "记住",
    "记一下",
    "以后",
    "总是",
    "偏好",
    "我的名字",
    "my name is",
    "call me",
    "i prefer",
    "remember",
    "always",
    "never"
  ];

  const dailyHints = [
    "今天",
    "明天",
    "this session",
    "today",
    "for now",
    "当前"
  ];

  if (longTermHints.some((hint) => lower.includes(hint))) {
    return { content: normalized, layer: "long_term", tags: ["flush", "auto", "long_term"] };
  }
  if (dailyHints.some((hint) => lower.includes(hint))) {
    return { content: normalized, layer: "daily", tags: ["flush", "auto", "daily"] };
  }

  return null;
}

function parseFactKey(content: string): string | null {
  const text = content.trim();
  const lower = text.toLowerCase();
  const patterns: Array<{ key: string; re: RegExp }> = [
    { key: "user.name", re: /\b(my name is|call me)\b/i },
    { key: "user.preference", re: /\b(i prefer|我喜欢|我的偏好)\b/i },
    { key: "user.rule", re: /\b(always|never|以后|总是|不要)\b/i }
  ];
  for (const p of patterns) {
    if (p.re.test(text)) return p.key;
  }
  if (lower.startsWith("remember")) return "user.remember";
  return null;
}

function isExpired(item: MemoryRecord, nowMs: number): boolean {
  if (!item.expiresAt) return false;
  const ts = Date.parse(item.expiresAt);
  return Number.isFinite(ts) && ts <= nowMs;
}

function defaultExpiresAt(layer: MemoryLayer, now = new Date()): string | undefined {
  if (layer !== "daily") return undefined;
  const copy = new Date(now.getTime());
  copy.setDate(copy.getDate() + 7);
  return copy.toISOString();
}

function normalizeExpiresAt(input: string | undefined | null): string | undefined {
  if (input === null) return undefined;
  if (typeof input !== "string") return undefined;
  const raw = input.trim();
  if (!raw) return undefined;
  const ts = Date.parse(raw);
  if (!Number.isFinite(ts)) return undefined;
  return new Date(ts).toISOString();
}

function scopeKey(scope: MemoryScope): string {
  return `${scope.channel}:${scope.externalUserId}`;
}

function safeSegment(input: string): string {
  return input.replace(/[^a-zA-Z0-9_-]+/g, "_");
}

function parseMemoryTextLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("#"))
    .map((line) => line.startsWith("- ") ? line.slice(2).trim() : line)
    .filter(Boolean);
}

export class JsonFileMemoryCore implements MemoryCore {
  private readonly filePath: string;

  constructor(
    private readonly sessions: SessionStore,
    filePath?: string
  ) {
    this.filePath = filePath ?? path.join(storagePaths.dataDir, "memory", "entries.json");
  }

  capabilities(): MemoryCoreCapabilities {
    return {
      supportsHybridSearch: true,
      supportsVectorSearch: false,
      supportsIncrementalFlush: true,
      supportsLayeredMemory: true
    };
  }

  private loadData(): MemoryFileData {
    const raw = readJsonFile<{ items?: MemoryRecord[]; cursors?: Record<string, number> }>(this.filePath, {});
    const nowMs = Date.now();
    const items = Array.isArray(raw.items)
      ? raw.items.map((row) => ({
          ...row,
          layer: row.layer === "daily" ? "daily" : "long_term",
          tags: Array.isArray(row.tags) ? row.tags : [],
          expiresAt: normalizeExpiresAt(row.expiresAt),
          factKey: typeof row.factKey === "string" ? row.factKey : parseFactKey(row.content),
          hasConflict: Boolean(row.hasConflict)
        })).filter((row) => !isExpired(row, nowMs))
      : [];
    const cursors = raw.cursors && typeof raw.cursors === "object" ? raw.cursors : {};
    const next = { items, cursors };
    this.reconcileConflicts(next);
    return next;
  }

  private saveData(data: MemoryFileData): void {
    writeJsonFile(this.filePath, data);
  }

  private inScope(item: MemoryRecord, scope: MemoryScope): boolean {
    return item.channel === scope.channel && item.externalUserId === scope.externalUserId;
  }

  private scoreAndSlice(items: MemoryRecord[], input: MemorySearchInput): MemoryRecord[] {
    const limit = Number.isFinite(input.limit) ? Math.max(1, Math.min(500, Number(input.limit))) : 50;
    const mode: MemorySearchMode = input.mode ?? "hybrid";
    return items
      .map((item) => {
        const keywordScore = scoreByQuery(item.content, input.query);
        const recentScore = scoreByRecency(item.updatedAt);
        const score = mode === "keyword"
          ? keywordScore
          : (mode === "recent" ? recentScore : ((keywordScore * 1.6) + recentScore));
        return { item, score };
      })
      .filter((row) => row.score > 0)
      .sort((a, b) => (b.score - a.score) || b.item.updatedAt.localeCompare(a.item.updatedAt))
      .slice(0, limit)
      .map((row) => row.item);
  }

  private reconcileConflicts(data: MemoryFileData): void {
    for (const row of data.items) row.hasConflict = false;
    const buckets = new Map<string, Set<string>>();
    for (const row of data.items) {
      if (!row.factKey) continue;
      const bucketKey = `${row.channel}:${row.externalUserId}:${row.factKey}`;
      let set = buckets.get(bucketKey);
      if (!set) {
        set = new Set<string>();
        buckets.set(bucketKey, set);
      }
      set.add(normalizeContent(row.content).toLowerCase());
    }
    for (const row of data.items) {
      if (!row.factKey) continue;
      const bucketKey = `${row.channel}:${row.externalUserId}:${row.factKey}`;
      row.hasConflict = (buckets.get(bucketKey)?.size ?? 0) > 1;
    }
  }

  private scopeDir(scope: MemoryScope): string {
    return path.join(
      storagePaths.dataDir,
      "memory",
      "scopes",
      safeSegment(scope.channel),
      safeSegment(scope.externalUserId)
    );
  }

  private writeMemoryMirror(scope: MemoryScope, row: MemoryRecord): void {
    const dir = this.scopeDir(scope);
    const date = row.updatedAt.slice(0, 10);
    const dailyPath = path.join(dir, "daily", `${date}.md`);
    const longPath = path.join(dir, "MEMORY.md");
    const line = `- ${row.content}`;

    fs.mkdirSync(path.dirname(dailyPath), { recursive: true });

    if (row.layer === "daily") {
      const existing = fs.existsSync(dailyPath) ? fs.readFileSync(dailyPath, "utf8") : "";
      const next = `${String(existing ?? "").trim()}\n${line}\n`.trim() + "\n";
      fs.writeFileSync(dailyPath, next, "utf8");
      return;
    }

    fs.mkdirSync(path.dirname(longPath), { recursive: true });
    const existing = fs.existsSync(longPath) ? fs.readFileSync(longPath, "utf8") : "";
    const text = String(existing ?? "");
    if (text.includes(line)) return;
    const next = `${text.trim()}\n${line}\n`.trim() + "\n";
    fs.writeFileSync(longPath, next, "utf8");
  }

  async add(scope: MemoryScope, input: MemoryAddInput): Promise<MemoryRecord> {
    const now = new Date().toISOString();
    const content = normalizeContent(input.content);
    if (!content) {
      throw new Error("Memory content is required.");
    }

    const data = this.loadData();
    const existing = data.items.find((item) =>
      this.inScope(item, scope) &&
      item.layer === (input.layer ?? "long_term") &&
      normalizeContent(item.content).toLowerCase() === content.toLowerCase()
    );
    if (existing) {
      existing.updatedAt = now;
      existing.tags = normalizeTags([...(existing.tags ?? []), ...(input.tags ?? [])]);
      existing.expiresAt = normalizeExpiresAt(input.expiresAt) ?? existing.expiresAt;
      this.reconcileConflicts(data);
      this.saveData(data);
      return existing;
    }

    const layer = input.layer ?? "long_term";
    const row: MemoryRecord = {
      id: randomUUID(),
      channel: scope.channel,
      externalUserId: scope.externalUserId,
      content,
      tags: normalizeTags(input.tags),
      layer,
      factKey: parseFactKey(content) ?? undefined,
      hasConflict: false,
      sourceSessionId: input.sourceSessionId,
      expiresAt: normalizeExpiresAt(input.expiresAt) ?? defaultExpiresAt(layer),
      createdAt: now,
      updatedAt: now
    };
    data.items.push(row);
    this.reconcileConflicts(data);
    this.saveData(data);
    this.writeMemoryMirror(scope, row);
    return row;
  }

  async search(scope: MemoryScope, input: MemorySearchInput): Promise<MemoryRecord[]> {
    const data = this.loadData();
    return this.scoreAndSlice(
      data.items.filter((item) => this.inScope(item, scope)),
      input
    );
  }

  async searchAll(input: MemorySearchInput): Promise<MemoryRecord[]> {
    const data = this.loadData();
    return this.scoreAndSlice(data.items, input);
  }

  async delete(scope: MemoryScope, id: string): Promise<boolean> {
    const data = this.loadData();
    const before = data.items.length;
    data.items = data.items.filter((item) => !(this.inScope(item, scope) && item.id === id));
    const changed = data.items.length !== before;
    if (changed) {
      this.reconcileConflicts(data);
      this.saveData(data);
    }
    return changed;
  }

  async update(scope: MemoryScope, id: string, input: MemoryUpdateInput): Promise<MemoryRecord | null> {
    const data = this.loadData();
    const found = data.items.find((item) => this.inScope(item, scope) && item.id === id);
    if (!found) return null;
    if (typeof input.content === "string") {
      const next = normalizeContent(input.content);
      if (!next) throw new Error("Memory content cannot be empty.");
      found.content = next;
    }
    if (Array.isArray(input.tags)) {
      found.tags = normalizeTags(input.tags);
    }
    if (typeof input.expiresAt !== "undefined" || input.expiresAt === null) {
      found.expiresAt = normalizeExpiresAt(input.expiresAt);
    }
    found.factKey = parseFactKey(found.content) ?? undefined;
    found.updatedAt = new Date().toISOString();
    this.reconcileConflicts(data);
    this.saveData(data);
    this.writeMemoryMirror(scope, found);
    return found;
  }

  async flush(scope: MemoryScope): Promise<MemoryFlushResult> {
    const channel = (scope.channel === "telegram" || scope.channel === "cli" || scope.channel === "web")
      ? scope.channel
      : "web";
    const conversations = this.sessions.listConversations(channel as Channel, scope.externalUserId);
    const added: MemoryRecord[] = [];
    let scannedMessages = 0;
    let updatedCursorConversations = 0;
    const cursorState = this.loadData();
    const cursorKeyPrefix = `${scopeKey(scope)}:`;

    for (const conv of conversations) {
      const messages = this.sessions.listMessages(conv.id, 1000);
      const cursorKey = `${cursorKeyPrefix}${conv.id}`;
      const start = Math.max(0, Math.min(cursorState.cursors[cursorKey] ?? 0, messages.length));
      for (const msg of messages.slice(start)) {
        scannedMessages += 1;
        if (msg.role !== "user") continue;
        const classified = classifyMemory(msg.content);
        if (!classified) continue;
        const memory = await this.add(scope, {
          content: classified.content,
          tags: classified.tags,
          layer: classified.layer,
          sourceSessionId: conv.id
        });
        added.push(memory);
      }
      cursorState.cursors[cursorKey] = messages.length;
      updatedCursorConversations += 1;
    }
    for (const key of Object.keys(cursorState.cursors)) {
      if (!key.startsWith(cursorKeyPrefix)) continue;
      const convId = key.slice(cursorKeyPrefix.length);
      if (!conversations.some((c) => c.id === convId)) {
        delete cursorState.cursors[key];
      }
    }
    const latest = this.loadData();
    latest.cursors = {
      ...(latest.cursors ?? {}),
      ...cursorState.cursors
    };
    this.saveData(latest);

    return {
      scannedMessages,
      addedCount: added.length,
      memories: added,
      updatedCursorConversations
    };
  }

  async syncExternalMemories(): Promise<MemorySyncResult> {
    const memoryRoot = path.join(storagePaths.dataDir, "memory");
    const telegramBotsRoot = path.join(memoryRoot, "moli-t", "bots");
    if (!fs.existsSync(telegramBotsRoot)) {
      return { scannedFiles: 0, importedCount: 0 };
    }

    let scannedFiles = 0;
    let importedCount = 0;
    const botDirs = fs.readdirSync(telegramBotsRoot, { withFileTypes: true }).filter((d) => d.isDirectory());
    for (const botDir of botDirs) {
      const botId = botDir.name;
      const botPath = path.join(telegramBotsRoot, botId);
      const chatDirs = fs.readdirSync(botPath, { withFileTypes: true }).filter((d) => d.isDirectory());
      for (const chatDir of chatDirs) {
        const chatId = chatDir.name;
        const chatMemoryFile = path.join(botPath, chatId, "MEMORY.md");
        if (!fs.existsSync(chatMemoryFile)) continue;
        scannedFiles += 1;
        const raw = fs.readFileSync(chatMemoryFile, "utf8");
        const lines = parseMemoryTextLines(raw);
        for (const line of lines) {
          const before = await this.search({ channel: "telegram", externalUserId: chatId }, { query: line, mode: "keyword", limit: 1 });
          if (before.some((item) => normalizeContent(item.content).toLowerCase() === normalizeContent(line).toLowerCase())) {
            continue;
          }
          await this.add(
            { channel: "telegram", externalUserId: chatId },
            {
              content: line,
              tags: ["imported", "telegram-file", `bot:${botId}`],
              layer: "long_term"
            }
          );
          importedCount += 1;
        }
      }
    }
    return { scannedFiles, importedCount };
  }
}
