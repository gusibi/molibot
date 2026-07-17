/**
 * moryAdapter.ts
 *
 * Storage adapter contracts + in-memory + SQL executors.
 */

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { createRequire } from "node:module";
import {
  PGVECTOR_SEARCH_SQL,
  PGVECTOR_UPSERT_SQL,
  SQLITE_SCHEMA_SQL,
  SQLITE_UPSERT_SQL,
  pgvectorSchemaSql,
  toPgvectorUpsertParams,
  toSqliteUpsertParams,
  type SqlMemoryRow,
} from "./morySql.js";

export interface PersistedMemoryNode {
  id: string;
  userId: string;
  path: string;
  domain?: string;
  memoryType: string;
  subject: string;
  title?: string;
  value: string;
  detail?: string;
  confidence: number;
  importance: number;
  utility?: number;
  accessCount: number;
  injectionCount: number;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt?: string;
  lastInjectedAt?: string;
  embedding?: number[];
  version: number;
  supersedes?: string;
  conflictFlag: boolean;
  lifecycleState: "active" | "disputed" | "dormant" | "archived";
  archivedAt?: string;
}

export interface ListOptions {
  includeArchived?: boolean;
  memoryTypes?: string[];
  pathPrefixes?: string[];
  lifecycleStates?: PersistedMemoryNode["lifecycleState"][];
  limit?: number;
}

export interface VectorSearchOptions {
  vector: number[];
  topK: number;
  memoryTypes?: string[];
  pathPrefixes?: string[];
}

export interface StorageAdapter {
  init(): Promise<void>;
  readByPath(userId: string, path: string, includeArchived?: boolean): Promise<PersistedMemoryNode[]>;
  readById(userId: string, id: string): Promise<PersistedMemoryNode | undefined>;
  list(userId: string, options?: ListOptions): Promise<PersistedMemoryNode[]>;
  insert(node: PersistedMemoryNode): Promise<PersistedMemoryNode>;
  update(userId: string, id: string, patch: Partial<PersistedMemoryNode>): Promise<PersistedMemoryNode | undefined>;
  archive(userId: string, ids: string[]): Promise<number>;
  recordInjectionUsage(userId: string, id: string, eventKey: string, injectedAt: string): Promise<boolean>;
  vectorSearch(userId: string, options: VectorSearchOptions): Promise<Array<{ node: PersistedMemoryNode; similarity: number }>>;
}

function byUpdatedDesc(a: PersistedMemoryNode, b: PersistedMemoryNode): number {
  return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
}

function matchesListOptions(node: PersistedMemoryNode, options: ListOptions): boolean {
  if (!options.includeArchived && node.archivedAt) return false;
  if (options.memoryTypes && options.memoryTypes.length > 0 && !options.memoryTypes.includes(node.memoryType)) {
    return false;
  }
  if (options.pathPrefixes && options.pathPrefixes.length > 0) {
    if (!options.pathPrefixes.some((prefix) => node.path.startsWith(prefix))) return false;
  }
  if (options.lifecycleStates && options.lifecycleStates.length > 0 && !options.lifecycleStates.includes(node.lifecycleState)) {
    return false;
  }
  return true;
}

export class InMemoryStorageAdapter implements StorageAdapter {
  private rows: PersistedMemoryNode[] = [];
  private readonly injectionUsageEvents = new Set<string>();

  async init(): Promise<void> {
    // no-op
  }

  async readByPath(userId: string, path: string, includeArchived = false): Promise<PersistedMemoryNode[]> {
    return this.rows
      .filter((r) => r.userId === userId && r.path === path && (includeArchived || !r.archivedAt))
      .sort(byUpdatedDesc);
  }

  async readById(userId: string, id: string): Promise<PersistedMemoryNode | undefined> {
    return this.rows.find((r) => r.userId === userId && r.id === id);
  }

  async list(userId: string, options: ListOptions = {}): Promise<PersistedMemoryNode[]> {
    const rows = this.rows
      .filter((r) => r.userId === userId)
      .filter((r) => matchesListOptions(r, options))
      .sort(byUpdatedDesc);
    const limit = options.limit ?? rows.length;
    return rows.slice(0, limit);
  }

  async insert(node: PersistedMemoryNode): Promise<PersistedMemoryNode> {
    const normalized = {
      ...node,
      injectionCount: node.injectionCount ?? 0,
      lifecycleState: node.archivedAt ? "archived" as const : (node.lifecycleState ?? "active" as const),
    };
    this.rows.push(normalized);
    return normalized;
  }

  async update(userId: string, id: string, patch: Partial<PersistedMemoryNode>): Promise<PersistedMemoryNode | undefined> {
    const idx = this.rows.findIndex((r) => r.userId === userId && r.id === id);
    if (idx < 0) return undefined;
    const next = {
      ...this.rows[idx],
      ...patch,
    };
    this.rows[idx] = next;
    return next;
  }

  async archive(userId: string, ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const idSet = new Set(ids);
    let count = 0;
    const now = new Date().toISOString();
    this.rows = this.rows.map((row) => {
      if (row.userId !== userId || !idSet.has(row.id) || row.archivedAt) return row;
      count += 1;
      return { ...row, archivedAt: now, lifecycleState: "archived", updatedAt: now };
    });
    return count;
  }

  async recordInjectionUsage(userId: string, id: string, eventKey: string, injectedAt: string): Promise<boolean> {
    if (this.injectionUsageEvents.has(eventKey)) return false;
    const row = this.rows.find((item) => item.userId === userId && item.id === id && !item.archivedAt);
    if (!row) return false;
    this.injectionUsageEvents.add(eventKey);
    row.injectionCount += 1;
    row.lastInjectedAt = injectedAt;
    return true;
  }

  async vectorSearch(
    userId: string,
    options: VectorSearchOptions
  ): Promise<Array<{ node: PersistedMemoryNode; similarity: number }>> {
    const rows = await this.list(userId, {
      memoryTypes: options.memoryTypes,
      pathPrefixes: options.pathPrefixes,
      includeArchived: false,
      lifecycleStates: ["active"],
      limit: Math.max(options.topK * 5, options.topK),
    });

    const result = rows
      .filter((node) => Array.isArray(node.embedding) && node.embedding.length > 0)
      .map((node) => ({
        node,
        similarity: cosineSimilarity(options.vector, node.embedding ?? []),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, options.topK);

    return result;
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface SqliteDriver {
  run(sql: string, params?: unknown[]): Promise<void> | void;
  all<T>(sql: string, params?: unknown[]): Promise<T[]> | T[];
  get<T>(sql: string, params?: unknown[]): Promise<T | undefined> | T | undefined;
  close?(): Promise<void> | void;
}

function rowToNode(row: SqlMemoryRow): PersistedMemoryNode {
  let embedding: number[] | undefined;
  if (Array.isArray(row.embedding)) {
    embedding = row.embedding;
  } else if (typeof row.embedding === "string" && row.embedding.trim()) {
    try {
      const parsed = JSON.parse(row.embedding) as unknown;
      if (Array.isArray(parsed) && parsed.every((value) => typeof value === "number")) {
        embedding = parsed;
      }
    } catch {
      embedding = undefined;
    }
  }

  return {
    id: row.id,
    userId: row.user_id,
    path: row.path,
    domain: row.domain ?? undefined,
    memoryType: row.memory_type,
    subject: row.subject,
    title: row.l0_title ?? undefined,
    value: row.l1_summary,
    detail: row.l2_detail ?? undefined,
    confidence: row.confidence,
    importance: row.importance,
    utility: row.utility ?? undefined,
    accessCount: row.access_count,
    injectionCount: row.injection_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastAccessedAt: row.last_accessed_at ?? undefined,
    lastInjectedAt: row.last_injected_at ?? undefined,
    embedding,
    version: row.version,
    supersedes: row.supersedes ?? undefined,
    conflictFlag: !!row.conflict_flag,
    lifecycleState: row.archived_at ? "archived" : (row.lifecycle_state === "disputed" || row.lifecycle_state === "dormant" ? row.lifecycle_state : "active"),
    archivedAt: row.archived_at ?? undefined,
  };
}

export class NodeSqliteDriver implements SqliteDriver {
  private readonly db: DatabaseSync;

  constructor(filename = ":memory:") {
    if (filename !== ":memory:") {
      fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
    }
    this.db = new DatabaseSync(filename);
    this.db.exec("PRAGMA journal_mode = WAL;");
  }

  run(sql: string, params: unknown[] = []): void {
    if (params.length === 0) {
      this.db.exec(sql);
      return;
    }
    this.db.prepare(sql).run(...(params as SQLInputValue[]));
  }

  all<T>(sql: string, params: unknown[] = []): T[] {
    return this.db.prepare(sql).all(...(params as SQLInputValue[])) as T[];
  }

  get<T>(sql: string, params: unknown[] = []): T | undefined {
    return this.db.prepare(sql).get(...(params as SQLInputValue[])) as T | undefined;
  }

  close(): void {
    this.db.close();
  }
}

export class SqliteStorageAdapter implements StorageAdapter {
  constructor(private readonly driver: SqliteDriver) { }

  async init(): Promise<void> {
    await this.driver.run(SQLITE_SCHEMA_SQL);
    const columns = await this.driver.all<{ name: string }>("PRAGMA table_info(memory_nodes)");
    if (!columns.some((column) => column.name === "domain")) {
      await this.driver.run("ALTER TABLE memory_nodes ADD COLUMN domain TEXT");
    }
    if (!columns.some((column) => column.name === "lifecycle_state")) {
      await this.driver.run("ALTER TABLE memory_nodes ADD COLUMN lifecycle_state TEXT NOT NULL DEFAULT 'active'");
    }
    if (!columns.some((column) => column.name === "injection_count")) {
      await this.driver.run("ALTER TABLE memory_nodes ADD COLUMN injection_count INTEGER NOT NULL DEFAULT 0");
    }
    if (!columns.some((column) => column.name === "last_injected_at")) {
      await this.driver.run("ALTER TABLE memory_nodes ADD COLUMN last_injected_at TEXT");
    }
    await this.driver.run("CREATE INDEX IF NOT EXISTS idx_memory_nodes_user_domain ON memory_nodes(user_id, domain)");
    await this.driver.run("CREATE INDEX IF NOT EXISTS idx_memory_nodes_user_state_type ON memory_nodes(user_id, lifecycle_state, memory_type)");
  }

  async readByPath(userId: string, path: string, includeArchived = false): Promise<PersistedMemoryNode[]> {
    const rows = await this.driver.all<SqlMemoryRow>(
      `SELECT * FROM memory_nodes WHERE user_id = ? AND path = ? ${includeArchived ? "" : "AND archived_at IS NULL"} ORDER BY updated_at DESC`,
      [userId, path]
    );
    return rows.map(rowToNode);
  }

  async readById(userId: string, id: string): Promise<PersistedMemoryNode | undefined> {
    const row = await this.driver.get<SqlMemoryRow>(
      "SELECT * FROM memory_nodes WHERE user_id = ? AND id = ? LIMIT 1",
      [userId, id]
    );
    return row ? rowToNode(row) : undefined;
  }

  async list(userId: string, options: ListOptions = {}): Promise<PersistedMemoryNode[]> {
    const rows = await this.driver.all<SqlMemoryRow>(
      `SELECT * FROM memory_nodes WHERE user_id = ? ${options.includeArchived ? "" : "AND archived_at IS NULL"} ORDER BY updated_at DESC LIMIT ?`,
      [userId, options.limit ?? 200]
    );
    return rows
      .map(rowToNode)
      .filter((r) => matchesListOptions(r, options));
  }

  async insert(node: PersistedMemoryNode): Promise<PersistedMemoryNode> {
    await this.driver.run(SQLITE_UPSERT_SQL, toSqliteUpsertParams(node));
    return node;
  }

  async update(userId: string, id: string, patch: Partial<PersistedMemoryNode>): Promise<PersistedMemoryNode | undefined> {
    const current = await this.readById(userId, id);
    if (!current) return undefined;
    const next = { ...current, ...patch };
    // Use a direct UPDATE (not upsert) to avoid triggering the
    // (user_id, path, version) UNIQUE index on every accessCount patch.
    await this.driver.run(
      `UPDATE memory_nodes SET
        domain = ?, l0_title = ?, l1_summary = ?, l2_detail = ?,
        confidence = ?, importance = ?, utility = ?,
        access_count = ?, injection_count = ?, updated_at = ?, last_accessed_at = ?, last_injected_at = ?,
        version = ?, supersedes = ?, conflict_flag = ?, lifecycle_state = ?,
        archived_at = ?, embedding = ?
      WHERE user_id = ? AND id = ?`,
      [
        next.domain ?? null,
        next.title ?? null,
        next.value,
        next.detail ?? null,
        next.confidence,
        next.importance,
        next.utility ?? 0.5,
        next.accessCount,
        next.injectionCount,
        next.updatedAt,
        next.lastAccessedAt ?? null,
        next.lastInjectedAt ?? null,
        next.version,
        next.supersedes ?? null,
        next.conflictFlag ? 1 : 0,
        next.archivedAt ? "archived" : next.lifecycleState,
        next.archivedAt ?? null,
        next.embedding ? JSON.stringify(next.embedding) : null,
        userId,
        id,
      ]
    );
    return next;
  }

  async archive(userId: string, ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const now = new Date().toISOString();
    let updated = 0;
    for (const id of ids) {
      await this.driver.run(
        "UPDATE memory_nodes SET archived_at = ?, lifecycle_state = 'archived', updated_at = ? WHERE user_id = ? AND id = ? AND archived_at IS NULL",
        [now, now, userId, id]
      );
      updated += 1;
    }
    return updated;
  }

  async recordInjectionUsage(userId: string, id: string, eventKey: string, injectedAt: string): Promise<boolean> {
    await this.driver.run("BEGIN IMMEDIATE");
    try {
      const existing = await this.driver.get<{ event_key: string }>(
        "SELECT event_key FROM memory_injection_usage_events WHERE event_key = ?",
        [eventKey]
      );
      if (existing) {
        await this.driver.run("ROLLBACK");
        return false;
      }
      const memory = await this.driver.get<{ id: string }>(
        "SELECT id FROM memory_nodes WHERE user_id = ? AND id = ? AND archived_at IS NULL",
        [userId, id]
      );
      if (!memory) {
        await this.driver.run("ROLLBACK");
        return false;
      }
      await this.driver.run(
        "INSERT INTO memory_injection_usage_events(event_key, user_id, memory_id, injected_at) VALUES (?, ?, ?, ?)",
        [eventKey, userId, id, injectedAt]
      );
      await this.driver.run(
        "UPDATE memory_nodes SET injection_count = injection_count + 1, last_injected_at = ? WHERE user_id = ? AND id = ?",
        [injectedAt, userId, id]
      );
      await this.driver.run("COMMIT");
      return true;
    } catch (error) {
      await this.driver.run("ROLLBACK");
      throw error;
    }
  }

  async vectorSearch(userId: string, options: VectorSearchOptions): Promise<Array<{ node: PersistedMemoryNode; similarity: number }>> {
    const rows = await this.driver.all<SqlMemoryRow>(
      "SELECT * FROM memory_nodes WHERE user_id = ? AND archived_at IS NULL LIMIT ?",
      [userId, Math.max(options.topK * 5, options.topK)]
    );
    return rows
      .map(rowToNode)
      .filter((node) => Array.isArray(node.embedding) && node.embedding.length > 0)
      .filter((node) => !options.memoryTypes?.length || options.memoryTypes.includes(node.memoryType))
      .filter((node) => !options.pathPrefixes?.length || options.pathPrefixes.some((prefix) => node.path.startsWith(prefix)))
      .map((node) => ({ node, similarity: cosineSimilarity(options.vector, node.embedding ?? []) }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, options.topK);
  }
}

export interface PgDriver {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  close?(): Promise<void> | void;
}

export interface NodePgDriverConfig {
  connectionString?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  ssl?: unknown;
  max?: number;
  idleTimeoutMillis?: number;
}

export class NodePgDriver implements PgDriver {
  private readonly pool: {
    query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
    end(): Promise<void>;
  };

  constructor(config: string | NodePgDriverConfig) {
    const require = createRequire(import.meta.url);
    const pgModule = require("pg") as {
      Pool: new (config: NodePgDriverConfig) => {
        query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
        end(): Promise<void>;
      };
    };
    const PoolCtor = pgModule.Pool;
    this.pool = typeof config === "string"
      ? new PoolCtor({ connectionString: config })
      : new PoolCtor(config);
  }

  async query<T>(sql: string, params: unknown[] = []): Promise<{ rows: T[] }> {
    const result = await this.pool.query<T>(sql, params);
    return { rows: result.rows };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export class PgvectorStorageAdapter implements StorageAdapter {
  constructor(private readonly driver: PgDriver, private readonly embeddingDim = 1536) { }

  async init(): Promise<void> {
    await this.driver.query(pgvectorSchemaSql(this.embeddingDim));
  }

  async readByPath(userId: string, path: string, includeArchived = false): Promise<PersistedMemoryNode[]> {
    const { rows } = await this.driver.query<SqlMemoryRow>(
      `SELECT * FROM memory_nodes WHERE user_id = $1 AND path = $2 ${includeArchived ? "" : "AND archived_at IS NULL"} ORDER BY updated_at DESC`,
      [userId, path]
    );
    return rows.map(rowToNode);
  }

  async readById(userId: string, id: string): Promise<PersistedMemoryNode | undefined> {
    const { rows } = await this.driver.query<SqlMemoryRow>(
      "SELECT * FROM memory_nodes WHERE user_id = $1 AND id = $2 LIMIT 1",
      [userId, id]
    );
    return rows[0] ? rowToNode(rows[0]) : undefined;
  }

  async list(userId: string, options: ListOptions = {}): Promise<PersistedMemoryNode[]> {
    const { rows } = await this.driver.query<SqlMemoryRow>(
      `SELECT * FROM memory_nodes WHERE user_id = $1 ${options.includeArchived ? "" : "AND archived_at IS NULL"} ORDER BY updated_at DESC LIMIT $2`,
      [userId, options.limit ?? 200]
    );
    return rows.map(rowToNode).filter((row) => matchesListOptions(row, options));
  }

  async insert(node: PersistedMemoryNode): Promise<PersistedMemoryNode> {
    await this.driver.query(PGVECTOR_UPSERT_SQL, toPgvectorUpsertParams(node));
    return node;
  }

  async update(userId: string, id: string, patch: Partial<PersistedMemoryNode>): Promise<PersistedMemoryNode | undefined> {
    const current = await this.readById(userId, id);
    if (!current) return undefined;
    const next = { ...current, ...patch };
    await this.driver.query(PGVECTOR_UPSERT_SQL, toPgvectorUpsertParams(next));
    return next;
  }

  async archive(userId: string, ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const now = new Date().toISOString();
    const { rows } = await this.driver.query<{ id: string }>(
      "UPDATE memory_nodes SET archived_at = $1, lifecycle_state = 'archived', updated_at = $1 WHERE user_id = $2 AND id = ANY($3::text[]) AND archived_at IS NULL RETURNING id",
      [now, userId, ids]
    );
    return rows.length;
  }

  async recordInjectionUsage(userId: string, id: string, eventKey: string, injectedAt: string): Promise<boolean> {
    const inserted = await this.driver.query<{ event_key: string }>(`
      INSERT INTO memory_injection_usage_events(event_key, user_id, memory_id, injected_at)
      SELECT $1, $2, $3, $4
      WHERE EXISTS (
        SELECT 1 FROM memory_nodes WHERE user_id = $2 AND id = $3 AND archived_at IS NULL
      )
      ON CONFLICT(event_key) DO NOTHING
      RETURNING event_key
    `, [eventKey, userId, id, injectedAt]);
    if (inserted.rows.length === 0) return false;
    await this.driver.query(
      "UPDATE memory_nodes SET injection_count = injection_count + 1, last_injected_at = $1 WHERE user_id = $2 AND id = $3",
      [injectedAt, userId, id]
    );
    return true;
  }

  async vectorSearch(userId: string, options: VectorSearchOptions): Promise<Array<{ node: PersistedMemoryNode; similarity: number }>> {
    const { rows } = await this.driver.query<SqlMemoryRow & { similarity: number }>(
      PGVECTOR_SEARCH_SQL,
      [
        userId,
        JSON.stringify(options.vector),
        options.memoryTypes?.length ? options.memoryTypes : null,
        options.pathPrefixes?.length ? options.pathPrefixes : null,
        options.topK,
      ]
    );
    return rows.map((row) => ({ node: rowToNode(row), similarity: Number(row.similarity ?? 0) }));
  }
}

export function createSqliteStorageAdapter(filename = ":memory:"): SqliteStorageAdapter {
  return new SqliteStorageAdapter(new NodeSqliteDriver(filename));
}

export function createPgvectorStorageAdapter(
  config: string | NodePgDriverConfig,
  embeddingDim = 1536
): PgvectorStorageAdapter {
  return new PgvectorStorageAdapter(new NodePgDriver(config), embeddingDim);
}
