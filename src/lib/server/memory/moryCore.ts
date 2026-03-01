import fs from "node:fs";
import path from "node:path";
import type { SessionStore } from "../services/sessionStore.js";
import { readJsonFile, storagePaths, writeJsonFile } from "../db/sqlite.js";
import type { Channel } from "../types/message.js";
import {
  MoryEngine,
  createSqliteStorageAdapter
} from "../../../../package/mory/src/index.js";
import type { PersistedMemoryNode, SqliteStorageAdapter } from "../../../../package/mory/src/index.js";
import type {
  MemoryAddInput,
  MemoryBackend,
  MemoryBackendCapabilities,
  MemoryFlushResult,
  MemoryLayer,
  MemoryRecord,
  MemoryScope,
  MemorySearchInput,
  MemorySearchMode,
  MemoryUpdateInput
} from "./types.js";

interface ScopeIndexData {
  scopes: Record<string, MemoryScope>;
}

interface MoryRecordMeta {
  channel: string;
  externalUserId: string;
  layer: MemoryLayer;
  tags: string[];
  expiresAt?: string;
  factKey?: string;
  sourceSessionId?: string;
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

function normalizeExpiresAt(input: string | undefined | null): string | undefined {
  if (input === null) return undefined;
  if (typeof input !== "string") return undefined;
  const raw = input.trim();
  if (!raw) return undefined;
  const ts = Date.parse(raw);
  if (!Number.isFinite(ts)) return undefined;
  return new Date(ts).toISOString();
}

function defaultExpiresAt(layer: MemoryLayer, now = new Date()): string | undefined {
  if (layer !== "daily") return undefined;
  const copy = new Date(now.getTime());
  copy.setDate(copy.getDate() + 7);
  return copy.toISOString();
}

function isExpired(item: MemoryRecord, nowMs: number): boolean {
  if (!item.expiresAt) return false;
  const ts = Date.parse(item.expiresAt);
  return Number.isFinite(ts) && ts <= nowMs;
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

function slugify(input: string, fallback = "memory"): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || fallback;
}

function encodeScope(scope: MemoryScope): string {
  return `${encodeURIComponent(scope.channel)}::${encodeURIComponent(scope.externalUserId)}`;
}

function parseMeta(detail: string | undefined, fallback: MemoryScope, fallbackLayer: MemoryLayer): MoryRecordMeta {
  if (detail) {
    try {
      const parsed = JSON.parse(detail) as Partial<MoryRecordMeta>;
      return {
        channel: String(parsed.channel ?? fallback.channel),
        externalUserId: String(parsed.externalUserId ?? fallback.externalUserId),
        layer: parsed.layer === "daily" ? "daily" : fallbackLayer,
        tags: normalizeTags(Array.isArray(parsed.tags) ? parsed.tags : []),
        expiresAt: normalizeExpiresAt(parsed.expiresAt),
        factKey: typeof parsed.factKey === "string" ? parsed.factKey : undefined,
        sourceSessionId: typeof parsed.sourceSessionId === "string" ? parsed.sourceSessionId : undefined
      };
    } catch {
      // fall through
    }
  }
  return {
    channel: fallback.channel,
    externalUserId: fallback.externalUserId,
    layer: fallbackLayer,
    tags: [],
    expiresAt: undefined,
    factKey: undefined,
    sourceSessionId: undefined
  };
}

function toRecord(row: PersistedMemoryNode, fallbackScope: MemoryScope): MemoryRecord {
  const inferredLayer: MemoryLayer = row.memoryType === "event" ? "daily" : "long_term";
  const meta = parseMeta(row.detail, fallbackScope, inferredLayer);
  return {
    id: row.id,
    channel: meta.channel,
    externalUserId: meta.externalUserId,
    content: row.value,
    tags: meta.tags,
    layer: meta.layer,
    factKey: meta.factKey,
    hasConflict: row.conflictFlag,
    sourceSessionId: meta.sourceSessionId,
    expiresAt: meta.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export class MoryMemoryBackend implements MemoryBackend {
  private readonly dbPath: string;
  private readonly indexPath: string;
  private readonly cursorPath: string;
  private readonly storage: SqliteStorageAdapter;
  private readonly engine: MoryEngine;
  private initPromise: Promise<void> | null = null;

  constructor(private readonly sessions: SessionStore) {
    this.dbPath = path.join(storagePaths.dataDir, "memory", "mory.sqlite");
    this.indexPath = path.join(storagePaths.dataDir, "memory", "mory-scopes.json");
    this.cursorPath = path.join(storagePaths.dataDir, "memory", "mory-cursors.json");
    this.storage = createSqliteStorageAdapter(this.dbPath);
    this.engine = new MoryEngine({ storage: this.storage });
  }

  capabilities(): MemoryBackendCapabilities {
    return {
      supportsHybridSearch: true,
      supportsVectorSearch: false,
      supportsIncrementalFlush: true,
      supportsLayeredMemory: true
    };
  }

  private async ensureInit(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.storage.init();
    }
    await this.initPromise;
  }

  private loadScopeIndex(): ScopeIndexData {
    return readJsonFile<ScopeIndexData>(this.indexPath, { scopes: {} });
  }

  private saveScopeIndex(data: ScopeIndexData): void {
    writeJsonFile(this.indexPath, data);
  }

  private rememberScope(scope: MemoryScope): string {
    const userId = encodeScope(scope);
    const data = this.loadScopeIndex();
    data.scopes[userId] = scope;
    this.saveScopeIndex(data);
    return userId;
  }

  private loadCursors(): Record<string, number> {
    return readJsonFile<Record<string, number>>(this.cursorPath, {});
  }

  private saveCursors(cursors: Record<string, number>): void {
    writeJsonFile(this.cursorPath, cursors);
  }

  private makePath(scope: MemoryScope, layer: MemoryLayer, content: string, nowIso: string): string {
    const stamp = nowIso.replace(/[-:.TZ]/g, "").slice(0, 14);
    const scopeSlug = slugify(`${scope.channel}-${scope.externalUserId}`, "scope");
    const contentSlug = slugify(content, "memory");
    if (layer === "daily") {
      return `mory://event/${nowIso.slice(0, 10)}.${scopeSlug}.${contentSlug}.${stamp}`;
    }
    return `mory://task/${scopeSlug}.${contentSlug}.${stamp}`;
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

  private async listScopeRecords(scope: MemoryScope, limit = 500): Promise<MemoryRecord[]> {
    await this.ensureInit();
    const userId = this.rememberScope(scope);
    const rows = await this.storage.list(userId, { includeArchived: false, limit });
    const nowMs = Date.now();
    return rows
      .map((row) => toRecord(row, scope))
      .filter((row) => !isExpired(row, nowMs));
  }

  async add(scope: MemoryScope, input: MemoryAddInput): Promise<MemoryRecord> {
    await this.ensureInit();
    const userId = this.rememberScope(scope);
    const content = normalizeContent(input.content);
    if (!content) throw new Error("Memory content is required.");

    const layer = input.layer ?? "long_term";
    const nowIso = new Date().toISOString();
    const expiresAt = normalizeExpiresAt(input.expiresAt) ?? defaultExpiresAt(layer);
    const memory = {
      path: this.makePath(scope, layer, content, nowIso),
      type: layer === "daily" ? "event" : "task",
      subject: slugify(content),
      value: content,
      confidence: 0.85,
      updatedPolicy: "merge_append" as const,
      title: content.slice(0, 40),
      source: input.sourceSessionId,
      observedAt: nowIso
    };

    const result = await this.engine.ingest({
      userId,
      memory,
      source: input.sourceSessionId,
      observedAt: nowIso
    });

    if (!result.id) {
      throw new Error(`Failed to create mory memory: ${result.reason}`);
    }

    const row = await this.storage.readById(userId, result.id);
    if (!row) throw new Error("Created mory memory could not be loaded.");

    const meta: MoryRecordMeta = {
      channel: scope.channel,
      externalUserId: scope.externalUserId,
      layer,
      tags: normalizeTags(input.tags),
      expiresAt,
      factKey: parseFactKey(content) ?? undefined,
      sourceSessionId: input.sourceSessionId
    };

    const updated = await this.storage.update(userId, row.id, {
      detail: JSON.stringify(meta),
      updatedAt: row.updatedAt
    });

    return toRecord(updated ?? row, scope);
  }

  async search(scope: MemoryScope, input: MemorySearchInput): Promise<MemoryRecord[]> {
    const rows = await this.listScopeRecords(scope, Math.max(Number(input.limit ?? 50) * 4, 100));
    return this.scoreAndSlice(rows, input);
  }

  async searchAll(input: MemorySearchInput): Promise<MemoryRecord[]> {
    await this.ensureInit();
    const index = this.loadScopeIndex();
    const allRows = await Promise.all(
      Object.values(index.scopes).map((scope) => this.listScopeRecords(scope, Math.max(Number(input.limit ?? 100) * 2, 100)))
    );
    return this.scoreAndSlice(allRows.flat(), input);
  }

  async delete(scope: MemoryScope, id: string): Promise<boolean> {
    await this.ensureInit();
    const userId = this.rememberScope(scope);
    const found = await this.storage.readById(userId, id);
    if (!found || found.archivedAt) return false;
    const archived = await this.storage.archive(userId, [id]);
    return archived > 0;
  }

  async update(scope: MemoryScope, id: string, input: MemoryUpdateInput): Promise<MemoryRecord | null> {
    await this.ensureInit();
    const userId = this.rememberScope(scope);
    const found = await this.storage.readById(userId, id);
    if (!found || found.archivedAt) return null;

    const current = toRecord(found, scope);
    const nextContent = typeof input.content === "string" ? normalizeContent(input.content) : current.content;
    if (!nextContent) throw new Error("Memory content cannot be empty.");

    const nextTags = Array.isArray(input.tags) ? normalizeTags(input.tags) : current.tags;
    const nextExpiresAt = typeof input.expiresAt !== "undefined" || input.expiresAt === null
      ? normalizeExpiresAt(input.expiresAt)
      : current.expiresAt;

    const meta: MoryRecordMeta = {
      channel: scope.channel,
      externalUserId: scope.externalUserId,
      layer: current.layer,
      tags: nextTags,
      expiresAt: nextExpiresAt,
      factKey: parseFactKey(nextContent) ?? undefined,
      sourceSessionId: current.sourceSessionId
    };

    const updated = await this.storage.update(userId, id, {
      value: nextContent,
      title: nextContent.slice(0, 40),
      detail: JSON.stringify(meta),
      updatedAt: new Date().toISOString(),
      conflictFlag: false
    });

    return updated ? toRecord(updated, scope) : null;
  }

  async flush(scope: MemoryScope): Promise<MemoryFlushResult> {
    const channel = (scope.channel === "telegram" || scope.channel === "cli" || scope.channel === "web")
      ? scope.channel
      : "web";
    const conversations = this.sessions.listConversations(channel as Channel, scope.externalUserId);
    const added: MemoryRecord[] = [];
    let scannedMessages = 0;
    let updatedCursorConversations = 0;
    const cursors = this.loadCursors();
    const cursorKeyPrefix = `${encodeScope(scope)}:`;

    for (const conv of conversations) {
      const messages = this.sessions.listMessages(conv.id, 1000);
      const cursorKey = `${cursorKeyPrefix}${conv.id}`;
      const start = Math.max(0, Math.min(cursors[cursorKey] ?? 0, messages.length));
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
      cursors[cursorKey] = messages.length;
      updatedCursorConversations += 1;
    }

    for (const key of Object.keys(cursors)) {
      if (!key.startsWith(cursorKeyPrefix)) continue;
      const convId = key.slice(cursorKeyPrefix.length);
      if (!conversations.some((c) => c.id === convId)) {
        delete cursors[key];
      }
    }

    this.saveCursors(cursors);

    return {
      scannedMessages,
      addedCount: added.length,
      memories: added,
      updatedCursorConversations
    };
  }

}
