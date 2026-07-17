import fs from "node:fs";
import path from "node:path";
import type { SessionStore } from "$lib/server/sessions/store.js";
import { readJsonFile, storagePaths, writeJsonFile } from "$lib/server/infra/db/storage.js";
import type { Channel } from "$lib/shared/types/message.js";
import {
  MoryEngine,
  createSqliteStorageAdapter,
  planForgetting,
  scoreLexical
} from "#mory";
import type { PersistedMemoryNode, SqliteStorageAdapter } from "#mory";
import type {
  MemoryAddInput,
  MemoryBackend,
  MemoryBackendCapabilities,
  MemoryCompactResult,
  MemoryFlushResult,
  MemoryLayer,
  MemoryDomain,
  MemoryOrigin,
  MemoryNamespace,
  MemoryRecord,
  MemoryScope,
  MemorySearchInput,
  MemorySearchMode,
  MemoryUpdateInput
} from "$lib/server/memory/types.js";
import { chatNamespace, contentNamespace, namespaceForDomain, promptMemoryNamespaces } from "$lib/server/memory/namespaces.js";
import {
  classifyAutoMemoryCandidate,
  inferFactKey
} from "$lib/server/memory/classifier.js";

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
  namespace?: MemoryNamespace;
  domain?: MemoryDomain;
  lowConfidencePath?: boolean;
  reason?: string;
  sources?: MemoryRecord["sources"];
  pinned?: boolean;
  allowInjection?: boolean;
  origin?: MemoryOrigin;
  privacySuppressed?: boolean;
  suppressionKey?: string;
}

export interface MoryWritePlan {
  namespace: MemoryNamespace;
  domain: MemoryDomain;
  type: NonNullable<MemoryRecord["type"]>;
  subject: string;
  path: string;
  lowConfidencePath: boolean;
  updatedPolicy: "overwrite" | "merge_append";
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
  if (item.pinned) return false;
  if (!item.expiresAt) return false;
  const ts = Date.parse(item.expiresAt);
  return Number.isFinite(ts) && ts <= nowMs;
}

// CJK-aware lexical scoring (T1a): whitespace splitting turned Chinese
// queries into one giant token; the shared mory tokenizer segments words and
// backs them with character bigrams.
function scoreByQuery(content: string, query: string): number {
  return scoreLexical(content, query);
}

function scoreByRecency(updatedAt: string): number {
  const deltaMs = Date.now() - Date.parse(updatedAt);
  if (!Number.isFinite(deltaMs) || deltaMs < 0) return 1;
  const oneDay = 24 * 60 * 60 * 1000;
  return Math.max(0.1, 1 / (1 + (deltaMs / oneDay)));
}

function slugify(input: string, fallback = "memory"): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || fallback;
}

function normalizeSubject(input: string, fallback = "memory"): string {
  const subject = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/^[_ .-]+|[_ .-]+$/g, "")
    .slice(0, 96);
  return subject || fallback;
}

export function buildMoryWritePlan(
  scope: MemoryScope,
  input: MemoryAddInput,
  content: string,
  layer: MemoryLayer,
  nowIso: string
): MoryWritePlan {
  const structured = Boolean(input.type && input.subject?.trim());
  const domain: MemoryDomain = input.domain ?? (scope.projectId ? "project" : "owner");
  const namespace = input.namespace ?? (structured
    ? namespaceForDomain(scope, domain)
    : chatNamespace(scope));
  const type = input.type ?? (layer === "daily" ? "event" : "task");
  const subject = structured ? normalizeSubject(input.subject!, "memory") : slugify(content);
  if (structured) {
    return { namespace, domain, type, subject, path: `mory://${type}/${subject}`, lowConfidencePath: false, updatedPolicy: "overwrite" };
  }
  const stamp = nowIso.replace(/[-:.TZ]/g, "").slice(0, 14);
  const scopeSlug = slugify(`${scope.channel}-${scope.externalUserId}`, "scope");
  const contentSlug = slugify(content, "memory");
  const path = layer === "daily"
    ? `mory://event/${nowIso.slice(0, 10)}.${scopeSlug}.${contentSlug}.${stamp}`
    : `mory://task/${scopeSlug}.${contentSlug}.${stamp}`;
  return { namespace, domain, type, subject, path, lowConfidencePath: true, updatedPolicy: "merge_append" };
}

function legacyEncodeScope(scope: MemoryScope): string {
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
        sourceSessionId: typeof parsed.sourceSessionId === "string" ? parsed.sourceSessionId : undefined,
        namespace: typeof parsed.namespace === "string" ? parsed.namespace as MemoryNamespace : undefined,
        domain: typeof parsed.domain === "string" ? parsed.domain as MemoryDomain : undefined,
        lowConfidencePath: parsed.lowConfidencePath === true,
        reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
        sources: Array.isArray(parsed.sources) ? parsed.sources : undefined,
        pinned: parsed.pinned === true,
        allowInjection: parsed.allowInjection !== false,
        origin: parsed.origin && typeof parsed.origin === "object" ? { ...parsed.origin } : undefined,
        privacySuppressed: parsed.privacySuppressed === true,
        suppressionKey: typeof parsed.suppressionKey === "string" ? parsed.suppressionKey : undefined
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
    sourceSessionId: undefined,
    namespace: undefined,
    domain: undefined,
    lowConfidencePath: undefined,
    reason: undefined,
    sources: undefined,
    pinned: undefined,
    allowInjection: true,
    origin: undefined,
    privacySuppressed: false,
    suppressionKey: undefined
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
    namespace: meta.namespace ?? row.userId as MemoryNamespace,
    domain: meta.domain ?? row.domain as MemoryDomain | undefined,
    type: row.memoryType as MemoryRecord["type"],
    subject: row.subject,
    path: row.path,
    state: row.archivedAt ? "archived" : row.lifecycleState,
    version: row.version,
    supersedes: row.supersedes,
    lowConfidencePath: meta.lowConfidencePath,
    confidence: row.confidence,
    importance: row.importance,
    utility: row.utility,
    accessCount: row.accessCount,
    lastAccessedAt: row.lastAccessedAt,
    injectionCount: row.injectionCount,
    lastInjectedAt: row.lastInjectedAt,
    reason: meta.reason,
    sources: meta.sources,
    pinned: meta.pinned,
    allowInjection: meta.allowInjection,
    privacySuppressed: meta.privacySuppressed,
    suppressionKey: meta.suppressionKey,
    origin: meta.origin,
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
  private readonly lexicalEngine: MoryEngine;
  private readonly embeddingFailureCooldownMs: number;
  private engine: MoryEngine;
  private embedder?: (text: string) => Promise<number[]>;
  private embeddingModelVersion?: string;
  private embeddingUnavailableUntil = 0;
  private initPromise: Promise<void> | null = null;

  constructor(private readonly sessions: SessionStore, options?: { dbPath?: string; dataDir?: string; embeddingFailureCooldownMs?: number }) {
    const dataDir = options?.dataDir ?? storagePaths.dataDir;
    this.dbPath = options?.dbPath ?? storagePaths.moryDbFile;
    this.indexPath = path.join(dataDir, "memory", "mory-scopes.json");
    this.cursorPath = path.join(dataDir, "memory", "mory-cursors.json");
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    this.storage = createSqliteStorageAdapter(this.dbPath);
    this.lexicalEngine = new MoryEngine({ storage: this.storage });
    this.engine = this.lexicalEngine;
    this.embeddingFailureCooldownMs = Math.max(1, options?.embeddingFailureCooldownMs ?? 60_000);
  }

  capabilities(): MemoryBackendCapabilities {
    return {
      supportsHybridSearch: true,
      supportsVectorSearch: Boolean(this.embedder),
      supportsIncrementalFlush: true,
      supportsLayeredMemory: true,
      supportsDomains: true,
      supportsVersioning: true,
      supportsCandidates: false
    };
  }

  configureEmbedder(embedder?: (text: string) => Promise<number[]>, modelVersion?: string): void {
    this.embedder = embedder;
    this.embeddingModelVersion = modelVersion;
    this.embeddingUnavailableUntil = 0;
    this.engine = embedder ? new MoryEngine({ storage: this.storage, embedder }) : this.lexicalEngine;
  }

  private embeddingAvailable(): boolean {
    return Boolean(this.embedder) && Date.now() >= this.embeddingUnavailableUntil;
  }

  private recordEmbeddingFailure(): void {
    this.embeddingUnavailableUntil = Date.now() + this.embeddingFailureCooldownMs;
  }

  async backfillEmbeddings(limit = 100): Promise<{ scannedCount: number; updatedCount: number; remainingCount: number }> {
    await this.ensureInit();
    if (!this.embedder) return { scannedCount: 0, updatedCount: 0, remainingCount: 0 };
    const entries = Object.entries(this.loadScopeIndex().scopes);
    const rows = (await Promise.all(entries.map(async ([namespace, scope]) =>
      (await this.storage.list(namespace, { includeArchived: false, limit: 10_000 })).map((row) => ({ namespace, scope, row }))
    ))).flat();
    const missing = rows.filter(({ row }) => !row.embedding?.length || !row.detail?.includes(`\"embeddingModelVersion\":\"${this.embeddingModelVersion}\"`));
    let updatedCount = 0;
    for (const { namespace, scope, row } of missing.slice(0, Math.max(1, limit))) {
      const embedding = await this.embedder(row.value);
      const meta = parseMeta(row.detail, scope, row.memoryType === "event" ? "daily" : "long_term") as MoryRecordMeta & { embeddingModelVersion?: string };
      meta.embeddingModelVersion = this.embeddingModelVersion;
      await this.storage.update(namespace, row.id, { embedding, detail: JSON.stringify(meta) });
      updatedCount += 1;
    }
    return { scannedCount: Math.min(missing.length, Math.max(1, limit)), updatedCount, remainingCount: Math.max(0, missing.length - updatedCount) };
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
    const userId = chatNamespace(scope);
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
    const legacyUserId = legacyEncodeScope(scope);
    const rows = [
      ...await this.storage.list(userId, { includeArchived: false, limit }),
      ...(legacyUserId === userId ? [] : await this.storage.list(legacyUserId, { includeArchived: false, limit }))
    ];
    const nowMs = Date.now();
    return rows
      .map((row) => toRecord(row, scope))
      .filter((row) => !isExpired(row, nowMs));
  }

  private async listPromptRecords(scope: MemoryScope, limit = 500): Promise<MemoryRecord[]> {
    await this.ensureInit();
    const namespaces = [...promptMemoryNamespaces(scope), legacyEncodeScope(scope)];
    const unique = [...new Set(namespaces)];
    const rows = (await Promise.all(unique.map((namespace) =>
      this.storage.list(namespace, { includeArchived: false, limit })
    ))).flat();
    const nowMs = Date.now();
    return rows.map((row) => toRecord(row, scope)).filter((row) => !isExpired(row, nowMs));
  }

  private managementNamespaces(scope: MemoryScope): string[] {
    return [...new Set([
      ...promptMemoryNamespaces(scope),
      contentNamespace(scope.botId),
      legacyEncodeScope(scope)
    ])];
  }

  private async findRecord(scope: MemoryScope, id: string): Promise<{ userId: string; row: PersistedMemoryNode } | null> {
    for (const userId of this.managementNamespaces(scope)) {
      const row = await this.storage.readById(userId, id);
      if (row && !row.archivedAt) return { userId, row };
    }
    return null;
  }

  async add(scope: MemoryScope, input: MemoryAddInput): Promise<MemoryRecord> {
    await this.ensureInit();
    const content = normalizeContent(input.content);
    if (!content) throw new Error("Memory content is required.");

    const layer = input.layer ?? "long_term";
    const nowIso = new Date().toISOString();
    const plan = buildMoryWritePlan(scope, input, content, layer, nowIso);
    const { namespace, domain } = plan;
    const userId = plan.namespace;
    const scopeData = this.loadScopeIndex();
    scopeData.scopes[userId] = scope;
    this.saveScopeIndex(scopeData);
    const existingRows = plan.lowConfidencePath
      ? await this.listScopeRecords(scope, 2000)
      : (await this.storage.list(userId, { includeArchived: false, limit: 2000 })).map((row) => toRecord(row, scope));
    const existing = existingRows.find((row) =>
      row.layer === layer && normalizeContent(row.content).toLowerCase() === content.toLowerCase()
    );
    if (existing) {
      const mergedTags = normalizeTags([...(existing.tags ?? []), ...(input.tags ?? [])]);
      const existingSourceKeys = new Set((existing.sources ?? []).map((source) => `${source.channel}:${source.sessionId}:${source.conversationMessageId}`));
      const mergedSources = [...(existing.sources ?? []), ...(input.sources ?? []).filter((source) => {
        const key = `${source.channel}:${source.sessionId}:${source.conversationMessageId}`;
        if (existingSourceKeys.has(key)) return false;
        existingSourceKeys.add(key);
        return true;
      })];
      const nextExpiresAt = normalizeExpiresAt(input.expiresAt) ?? existing.expiresAt ?? defaultExpiresAt(layer);
      const meta: MoryRecordMeta = {
        channel: scope.channel,
        externalUserId: scope.externalUserId,
        layer,
        tags: mergedTags,
        expiresAt: nextExpiresAt,
        factKey: inferFactKey(content) ?? existing.factKey,
        sourceSessionId: input.sourceSessionId ?? existing.sourceSessionId,
        namespace,
        domain,
        lowConfidencePath: existing.lowConfidencePath ?? plan.lowConfidencePath,
        reason: input.reason ?? existing.reason,
        sources: mergedSources.length > 0 ? mergedSources : undefined,
        pinned: input.pinned ?? existing.pinned,
        allowInjection: input.allowInjection ?? existing.allowInjection,
        origin: existing.origin,
        privacySuppressed: existing.privacySuppressed,
        suppressionKey: existing.suppressionKey
      };
      const updated = await this.storage.update(userId, existing.id, {
        detail: JSON.stringify(meta),
        updatedAt: new Date().toISOString(),
        conflictFlag: false
      });
      return updated ? toRecord(updated, scope) : existing;
    }

    const expiresAt = normalizeExpiresAt(input.expiresAt) ?? defaultExpiresAt(layer);
    const memory = {
      path: plan.path,
      domain,
      type: plan.type,
      subject: plan.subject,
      value: content,
      confidence: input.confidence ?? 0.85,
      updatedPolicy: plan.updatedPolicy,
      title: content.slice(0, 40),
      source: input.sourceSessionId,
      observedAt: nowIso
    };

    let result;
    const useEmbedding = this.embeddingAvailable();
    try {
      result = await (useEmbedding ? this.engine : this.lexicalEngine).ingest({ userId, memory, source: input.sourceSessionId, observedAt: nowIso });
    } catch (cause) {
      if (!useEmbedding) throw cause;
      this.recordEmbeddingFailure();
      result = await this.lexicalEngine.ingest({ userId, memory, source: input.sourceSessionId, observedAt: nowIso });
    }

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
      factKey: inferFactKey(content) ?? undefined,
      sourceSessionId: input.sourceSessionId,
      namespace,
      domain,
      lowConfidencePath: plan.lowConfidencePath,
      reason: input.reason,
      sources: input.sources,
      pinned: input.pinned,
      allowInjection: input.allowInjection,
      origin: {
        botId: scope.botId,
        channel: scope.channel,
        externalUserId: scope.externalUserId,
        projectId: scope.projectId,
        conversationId: scope.conversationId
      },
      privacySuppressed: false
    };

    const updated = await this.storage.update(userId, row.id, {
      detail: JSON.stringify(meta),
      updatedAt: row.updatedAt
    });

    return toRecord(updated ?? row, scope);
  }

  async get(scope: MemoryScope, id: string): Promise<MemoryRecord | null> {
    await this.ensureInit();
    const found = await this.findRecord(scope, id);
    if (!found) return null;
    const record = toRecord(found.row, scope);
    return isExpired(record, Date.now()) ? null : record;
  }

  async search(scope: MemoryScope, input: MemorySearchInput): Promise<MemoryRecord[]> {
    await this.ensureInit();
    const namespaces = [...new Set([...promptMemoryNamespaces(scope), legacyEncodeScope(scope)])];
    return this.searchNamespaces(namespaces as MemoryNamespace[], scope, input);
  }

  async searchNamespaces(namespaces: MemoryNamespace[], scope: MemoryScope, input: MemorySearchInput): Promise<MemoryRecord[]> {
    await this.ensureInit();
    const limit = Number.isFinite(input.limit) ? Math.max(1, Math.min(500, Number(input.limit))) : 50;
    let result;
    const useEmbedding = this.embeddingAvailable();
    try {
      result = await (useEmbedding ? this.engine : this.lexicalEngine).retrieve(namespaces[0], input.query, { namespaces, topK: Math.max(limit * 2, 20) });
    } catch (cause) {
      if (!useEmbedding) throw cause;
      this.recordEmbeddingFailure();
      result = await this.lexicalEngine.retrieve(namespaces[0], input.query, { namespaces, topK: Math.max(limit * 2, 20) });
    }
    return result.hits
      .filter((hit) => !input.query.trim() || hit.lexicalScore > 0 || hit.semanticScore > 0)
      .map((hit) => toRecord(hit.node, scope))
      .filter((row) => row.state === "active")
      .filter((row) => !isExpired(row, Date.now()))
      .slice(0, limit);
  }

  async listProfileRecords(namespaces: MemoryNamespace[], scope: MemoryScope, limit: number): Promise<MemoryRecord[]> {
    await this.ensureInit();
    const safeLimit = Math.max(1, Math.min(2_000, limit));
    const rows = (await Promise.all([...new Set(namespaces)].map((namespace) => this.storage.list(namespace, {
      includeArchived: false,
      lifecycleStates: ["active", "disputed", "dormant"],
      memoryTypes: ["user_preference", "user_fact", "task", "event"],
      limit: safeLimit
    })))).flat();
    return rows.map((row) => toRecord(row, scope)).slice(0, safeLimit);
  }

  async listMaintenanceRecords(scope: MemoryScope, limit: number): Promise<MemoryRecord[]> {
    await this.ensureInit();
    const safeLimit = Math.max(1, Math.min(10_000, limit));
    const rows = (await Promise.all(this.managementNamespaces(scope).map((namespace) => this.storage.list(namespace, {
      includeArchived: false,
      lifecycleStates: ["active", "disputed", "dormant"],
      limit: safeLimit
    })))).flat();
    return rows.map((row) => toRecord(row, scope)).slice(0, safeLimit);
  }

  async searchAll(input: MemorySearchInput): Promise<MemoryRecord[]> {
    await this.ensureInit();
    const index = this.loadScopeIndex();
    const allRows = await Promise.all(Object.entries(index.scopes).map(async ([namespace, scope]) => {
      const rows = await this.storage.list(namespace, {
        includeArchived: false,
        limit: Math.max(Number(input.limit ?? 100) * 2, 100)
      });
      return rows.map((row) => toRecord(row, scope)).filter((row) => !isExpired(row, Date.now()));
    }));
    return this.scoreAndSlice(allRows.flat(), input);
  }

  async delete(scope: MemoryScope, id: string): Promise<boolean> {
    await this.ensureInit();
    const found = await this.findRecord(scope, id);
    if (!found) return false;
    const { userId } = found;
    const archived = await this.storage.archive(userId, [id]);
    return archived > 0;
  }

  async versions(scope: MemoryScope, id: string): Promise<MemoryRecord[]> {
    await this.ensureInit();
    const found = await this.findRecord(scope, id);
    if (!found) return [];
    const rows = await this.storage.readByPath(found.userId, found.row.path, true);
    return rows.map((row) => toRecord(row, scope)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async update(scope: MemoryScope, id: string, input: MemoryUpdateInput): Promise<MemoryRecord | null> {
    await this.ensureInit();
    const located = await this.findRecord(scope, id);
    if (!located) return null;
    const { userId, row: found } = located;

    const current = toRecord(found, scope);
    const nextContent = typeof input.content === "string" ? normalizeContent(input.content) : current.content;
    if (!nextContent) throw new Error("Memory content cannot be empty.");

    const nextTags = Array.isArray(input.tags) ? normalizeTags(input.tags) : current.tags;
    const nextExpiresAt = typeof input.expiresAt !== "undefined" || input.expiresAt === null
      ? normalizeExpiresAt(input.expiresAt)
      : current.expiresAt;
    const nextPinned = typeof input.pinned === "boolean" ? input.pinned : current.pinned;
    const nextAllowInjection = typeof input.allowInjection === "boolean" ? input.allowInjection : current.allowInjection;
    const nextState = input.state ?? (current.state === "archived" ? "active" : current.state);
    const nextConfidence = typeof input.confidence === "number" ? Math.max(0, Math.min(1, input.confidence)) : current.confidence;
    const nextUtility = typeof input.utility === "number" ? Math.max(0, Math.min(1, input.utility)) : current.utility;
    const siblingRows = await this.storage.list(userId, { includeArchived: false, limit: 2000 });
    const sibling = siblingRows.map((row) => toRecord(row, scope)).find((row) =>
      row.id !== id &&
      row.layer === current.layer &&
      normalizeContent(row.content).toLowerCase() === nextContent.toLowerCase()
    );

    if (sibling) {
      const mergedTags = normalizeTags([...(sibling.tags ?? []), ...nextTags]);
      const siblingSourceKeys = new Set((sibling.sources ?? []).map((source) => `${source.channel}:${source.sessionId}:${source.conversationMessageId}`));
      const mergedSources = [...(sibling.sources ?? []), ...(current.sources ?? []).filter((source) => {
        const key = `${source.channel}:${source.sessionId}:${source.conversationMessageId}`;
        if (siblingSourceKeys.has(key)) return false;
        siblingSourceKeys.add(key);
        return true;
      })];
      const mergedExpiresAt = nextExpiresAt ?? sibling.expiresAt;
      const siblingMeta: MoryRecordMeta = {
        channel: scope.channel,
        externalUserId: scope.externalUserId,
        layer: sibling.layer,
        tags: mergedTags,
        expiresAt: mergedExpiresAt,
        factKey: inferFactKey(nextContent) ?? sibling.factKey,
        sourceSessionId: sibling.sourceSessionId ?? current.sourceSessionId,
        namespace: sibling.namespace,
        domain: sibling.domain,
        lowConfidencePath: sibling.lowConfidencePath,
        reason: sibling.reason,
        sources: mergedSources.length > 0 ? mergedSources : undefined,
        pinned: nextPinned ?? sibling.pinned,
        allowInjection: nextAllowInjection ?? sibling.allowInjection,
        origin: sibling.origin ?? current.origin,
        privacySuppressed: input.privacySuppressed ?? (sibling.privacySuppressed || current.privacySuppressed),
        suppressionKey: input.suppressionKey === null ? undefined : input.suppressionKey ?? sibling.suppressionKey ?? current.suppressionKey
      };
      const updatedSibling = await this.storage.update(userId, sibling.id, {
        detail: JSON.stringify(siblingMeta),
        updatedAt: new Date().toISOString(),
        conflictFlag: nextState === "disputed",
        lifecycleState: nextState,
        confidence: nextConfidence,
        utility: nextUtility
      });
      await this.storage.archive(userId, [id]);
      return updatedSibling ? toRecord(updatedSibling, scope) : sibling;
    }

    const meta: MoryRecordMeta = {
      channel: scope.channel,
      externalUserId: scope.externalUserId,
      layer: current.layer,
      tags: nextTags,
      expiresAt: nextExpiresAt,
      factKey: inferFactKey(nextContent) ?? undefined,
      sourceSessionId: current.sourceSessionId,
      namespace: current.namespace,
      domain: current.domain,
      lowConfidencePath: current.lowConfidencePath,
      reason: current.reason,
      sources: current.sources,
      pinned: nextPinned,
      allowInjection: nextAllowInjection,
      origin: current.origin,
      privacySuppressed: input.privacySuppressed ?? current.privacySuppressed,
      suppressionKey: input.suppressionKey === null ? undefined : input.suppressionKey ?? current.suppressionKey
    };

    const updated = await this.storage.update(userId, id, {
      value: nextContent,
      title: nextContent.slice(0, 40),
      detail: JSON.stringify(meta),
      updatedAt: new Date().toISOString(),
      conflictFlag: nextState === "disputed",
      lifecycleState: nextState,
      confidence: nextConfidence,
      utility: nextUtility
    });

    return updated ? toRecord(updated, scope) : null;
  }

  async restoreArchived(scope: MemoryScope, id: string): Promise<MemoryRecord | null> {
    await this.ensureInit();
    for (const userId of this.managementNamespaces(scope)) {
      const row = await this.storage.readById(userId, id);
      if (!row?.archivedAt) continue;
      const restored = await this.storage.update(userId, id, {
        archivedAt: undefined,
        lifecycleState: "active",
        conflictFlag: false,
        updatedAt: new Date().toISOString()
      });
      return restored ? toRecord(restored, scope) : null;
    }
    return null;
  }

  async recordInjectionUsage(scope: MemoryScope, id: string, eventKey: string, injectedAt: string): Promise<boolean> {
    await this.ensureInit();
    const located = await this.findRecord(scope, id);
    if (!located || located.row.lifecycleState !== "active" || located.row.archivedAt) return false;
    return this.storage.recordInjectionUsage(located.userId, id, eventKey, injectedAt);
  }

  async flush(scope: MemoryScope): Promise<MemoryFlushResult> {
    const channel = (scope.channel === "telegram" || scope.channel === "cli" || scope.channel === "web" || scope.channel === "qq" || scope.channel === "weixin")
      ? scope.channel
      : "web";
    const conversations = this.sessions.listConversations(channel as Channel, scope.externalUserId);
    const added: MemoryRecord[] = [];
    let scannedMessages = 0;
    let updatedCursorConversations = 0;
    const cursors = this.loadCursors();
    const cursorKeyPrefix = `${chatNamespace(scope)}:`;

    for (const conv of conversations) {
      const messages = this.sessions.listMessages(conv.id, 1000);
      const cursorKey = `${cursorKeyPrefix}${conv.id}`;
      const start = Math.max(0, Math.min(cursors[cursorKey] ?? 0, messages.length));
      for (const msg of messages.slice(start)) {
        scannedMessages += 1;
        if (msg.role !== "user") continue;
        const classified = classifyAutoMemoryCandidate(msg.content);
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

  async compact(scope?: MemoryScope): Promise<MemoryCompactResult> {
    await this.ensureInit();
    const indexedScopes = this.loadScopeIndex().scopes;
    const scopes = scope
      ? this.managementNamespaces(scope).map((namespace) => ({ namespace, scope }))
      : Object.entries(indexedScopes).map(([namespace, indexedScope]) => ({ namespace, scope: indexedScope }));
    let scannedCount = 0;
    let removedCount = 0;
    let scopesAffected = 0;

    for (const { namespace: userId, scope: currentScope } of scopes) {
      const rows = await this.storage.list(userId, { includeArchived: false, limit: 10000 });
      const records = rows
        .map((row) => toRecord(row, currentScope))
        .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt));
      const expiredIds = records.filter((record) => !record.pinned && isExpired(record, Date.now())).map((record) => record.id);
      const expiredIdSet = new Set(expiredIds);
      if (expiredIds.length > 0) removedCount += await this.storage.archive(userId, expiredIds);

      const seen = new Set<string>();
      const duplicateIds: string[] = [];
      const tagsByKey = new Map<string, string[]>();
      const sourcesByKey = new Map<string, NonNullable<MemoryRecord["sources"]>>();
      const survivorIdByKey = new Map<string, string>();

      for (const record of records) {
        if (expiredIdSet.has(record.id)) continue;
        scannedCount += 1;
        const key = `${record.layer}:${normalizeContent(record.content).toLowerCase()}`;
        if (!tagsByKey.has(key)) tagsByKey.set(key, [...record.tags]);
        else tagsByKey.set(key, normalizeTags([...(tagsByKey.get(key) ?? []), ...record.tags]));
        const knownSources = sourcesByKey.get(key) ?? [];
        const sourceIds = new Set(knownSources.map((source) => `${source.channel}:${source.sessionId}:${source.conversationMessageId}`));
        sourcesByKey.set(key, [...knownSources, ...(record.sources ?? []).filter((source) => {
          const sourceId = `${source.channel}:${source.sessionId}:${source.conversationMessageId}`;
          if (sourceIds.has(sourceId)) return false;
          sourceIds.add(sourceId);
          return true;
        })]);

        if (seen.has(key) && !record.pinned) {
          duplicateIds.push(record.id);
          continue;
        }
        seen.add(key);
        survivorIdByKey.set(key, record.id);
      }

      if (expiredIds.length > 0 || duplicateIds.length > 0) scopesAffected += 1;
      if (duplicateIds.length > 0) removedCount += await this.storage.archive(userId, duplicateIds);
      const duplicateIdSet = new Set(duplicateIds);

      for (const record of duplicateIds.length > 0 ? records : []) {
        const key = `${record.layer}:${normalizeContent(record.content).toLowerCase()}`;
        if (survivorIdByKey.get(key) !== record.id) continue;
        const mergedTags = tagsByKey.get(key) ?? record.tags;
        const mergedSources = sourcesByKey.get(key) ?? record.sources;
        const tagsUnchanged = mergedTags.length === record.tags.length && mergedTags.every((tag, idx) => tag === record.tags[idx]);
        const sourcesUnchanged = (mergedSources?.length ?? 0) === (record.sources?.length ?? 0);
        if (tagsUnchanged && sourcesUnchanged) continue;
        await this.storage.update(userId, record.id, {
          detail: JSON.stringify({
            channel: record.channel,
            externalUserId: record.externalUserId,
            layer: record.layer,
            tags: mergedTags,
            expiresAt: record.expiresAt,
            factKey: record.factKey,
            sourceSessionId: record.sourceSessionId,
            namespace: record.namespace,
            domain: record.domain,
            lowConfidencePath: record.lowConfidencePath,
            reason: record.reason,
            sources: mergedSources,
            pinned: record.pinned,
            allowInjection: record.allowInjection,
            origin: record.origin,
            privacySuppressed: record.privacySuppressed,
            suppressionKey: record.suppressionKey
          })
        });
      }

      const pinnedIds = new Set(records.filter((record) => record.pinned).map((record) => record.id));
      const forgetting = planForgetting(rows.filter((row) => !pinnedIds.has(row.id) && !expiredIdSet.has(row.id) && !duplicateIdSet.has(row.id)), {
        capacity: 500,
        // Low retention alone becomes dormant in MemoryMaintenanceService;
        // compact archives only when the explicit capacity ceiling is exceeded.
        minRetentionScore: 0,
        halfLifeDays: 21
      });
      if (forgetting.archivedIds.length > 0) {
        if (expiredIds.length === 0 && duplicateIds.length === 0) scopesAffected += 1;
        removedCount += await this.storage.archive(userId, forgetting.archivedIds);
      }
    }

    return { scannedCount, removedCount, scopesAffected };
  }

}
