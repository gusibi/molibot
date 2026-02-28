/**
 * SQL helpers for persisting mory:// memories in SQLite / PostgreSQL(pgvector).
 */

export interface SqlMemoryRow {
  id: string;
  user_id: string;
  path: string;
  memory_type: string;
  subject: string;
  l0_title: string | null;
  l1_summary: string;
  l2_detail: string | null;
  confidence: number;
  importance: number;
  utility: number;
  access_count: number;
  created_at: string;
  updated_at: string;
  last_accessed_at: string | null;
  version: number;
  supersedes: string | null;
  conflict_flag: number | boolean;
  archived_at: string | null;
  embedding?: number[] | string | null;
}

export const SQLITE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS memory_nodes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  path TEXT NOT NULL,
  memory_type TEXT NOT NULL,
  subject TEXT NOT NULL,
  l0_title TEXT,
  l1_summary TEXT NOT NULL,
  l2_detail TEXT,
  confidence REAL NOT NULL DEFAULT 0.7,
  importance REAL NOT NULL DEFAULT 0.5,
  utility REAL NOT NULL DEFAULT 0.5,
  access_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_accessed_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  supersedes TEXT,
  conflict_flag INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  embedding TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_nodes_user_path_version
  ON memory_nodes(user_id, path, version);

CREATE INDEX IF NOT EXISTS idx_memory_nodes_user_type
  ON memory_nodes(user_id, memory_type);

CREATE INDEX IF NOT EXISTS idx_memory_nodes_user_updated
  ON memory_nodes(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_nodes_user_active
  ON memory_nodes(user_id, archived_at);
`.trim();

export function pgvectorSchemaSql(embeddingDim = 1536): string {
  return `
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS memory_nodes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  path TEXT NOT NULL,
  memory_type TEXT NOT NULL,
  subject TEXT NOT NULL,
  l0_title TEXT,
  l1_summary TEXT NOT NULL,
  l2_detail TEXT,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0.7,
  importance DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  utility DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  access_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  last_accessed_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  supersedes TEXT,
  conflict_flag BOOLEAN NOT NULL DEFAULT FALSE,
  archived_at TIMESTAMPTZ,
  embedding VECTOR(${embeddingDim})
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_nodes_user_path_version
  ON memory_nodes(user_id, path, version);

CREATE INDEX IF NOT EXISTS idx_memory_nodes_user_type
  ON memory_nodes(user_id, memory_type);

CREATE INDEX IF NOT EXISTS idx_memory_nodes_updated
  ON memory_nodes(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_nodes_active
  ON memory_nodes(user_id, archived_at);

CREATE INDEX IF NOT EXISTS idx_memory_nodes_embedding
  ON memory_nodes USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
`.trim();
}

export const SQLITE_UPSERT_SQL = `
INSERT INTO memory_nodes (
  id, user_id, path, memory_type, subject, l0_title, l1_summary, l2_detail,
  confidence, importance, utility, access_count, created_at, updated_at,
  last_accessed_at, version, supersedes, conflict_flag, archived_at, embedding
) VALUES (
  ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
)
ON CONFLICT(id) DO UPDATE SET
  user_id = excluded.user_id,
  path = excluded.path,
  memory_type = excluded.memory_type,
  subject = excluded.subject,
  l0_title = excluded.l0_title,
  l1_summary = excluded.l1_summary,
  l2_detail = excluded.l2_detail,
  confidence = excluded.confidence,
  importance = excluded.importance,
  utility = excluded.utility,
  access_count = excluded.access_count,
  updated_at = excluded.updated_at,
  last_accessed_at = excluded.last_accessed_at,
  version = excluded.version,
  supersedes = excluded.supersedes,
  conflict_flag = excluded.conflict_flag,
  archived_at = excluded.archived_at,
  embedding = excluded.embedding;
`.trim();

export const PGVECTOR_UPSERT_SQL = `
INSERT INTO memory_nodes (
  id, user_id, path, memory_type, subject, l0_title, l1_summary, l2_detail,
  confidence, importance, utility, access_count, created_at, updated_at,
  last_accessed_at, version, supersedes, conflict_flag, archived_at, embedding
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8,
  $9, $10, $11, $12, $13, $14,
  $15, $16, $17, $18, $19, $20
)
ON CONFLICT(id) DO UPDATE SET
  user_id = excluded.user_id,
  path = excluded.path,
  memory_type = excluded.memory_type,
  subject = excluded.subject,
  l0_title = excluded.l0_title,
  l1_summary = excluded.l1_summary,
  l2_detail = excluded.l2_detail,
  confidence = excluded.confidence,
  importance = excluded.importance,
  utility = excluded.utility,
  access_count = excluded.access_count,
  updated_at = excluded.updated_at,
  last_accessed_at = excluded.last_accessed_at,
  version = excluded.version,
  supersedes = excluded.supersedes,
  conflict_flag = excluded.conflict_flag,
  archived_at = excluded.archived_at,
  embedding = excluded.embedding;
`.trim();

export const PGVECTOR_SEARCH_SQL = `
SELECT id, user_id, path, memory_type, subject, l0_title, l1_summary, l2_detail,
       confidence, importance, utility, access_count, created_at, updated_at, last_accessed_at,
       version, supersedes, conflict_flag, archived_at,
       1 - (embedding <=> $2::vector) AS similarity
FROM memory_nodes
WHERE user_id = $1
  AND archived_at IS NULL
  AND ($3::text[] IS NULL OR memory_type = ANY($3::text[]))
  AND ($4::text[] IS NULL OR EXISTS (
    SELECT 1
    FROM unnest($4::text[]) AS prefix
    WHERE path LIKE (prefix || '%')
  ))
ORDER BY embedding <=> $2::vector
LIMIT $5;
`.trim();

export interface SqlNodeLike {
  id: string;
  userId: string;
  path: string;
  memoryType: string;
  subject: string;
  title?: string;
  value: string;
  detail?: string;
  confidence: number;
  importance: number;
  utility?: number;
  accessCount: number;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt?: string;
  version: number;
  supersedes?: string;
  conflictFlag: boolean;
  archivedAt?: string;
  embedding?: number[];
}

export function toSqliteUpsertParams(node: SqlNodeLike): unknown[] {
  return [
    node.id,
    node.userId,
    node.path,
    node.memoryType,
    node.subject,
    node.title ?? null,
    node.value,
    node.detail ?? null,
    node.confidence,
    node.importance,
    node.utility ?? 0.5,
    node.accessCount,
    node.createdAt,
    node.updatedAt,
    node.lastAccessedAt ?? null,
    node.version,
    node.supersedes ?? null,
    node.conflictFlag ? 1 : 0,
    node.archivedAt ?? null,
    node.embedding ? JSON.stringify(node.embedding) : null,
  ];
}

export function toPgvectorUpsertParams(node: SqlNodeLike): unknown[] {
  return [
    node.id,
    node.userId,
    node.path,
    node.memoryType,
    node.subject,
    node.title ?? null,
    node.value,
    node.detail ?? null,
    node.confidence,
    node.importance,
    node.utility ?? 0.5,
    node.accessCount,
    node.createdAt,
    node.updatedAt,
    node.lastAccessedAt ?? null,
    node.version,
    node.supersedes ?? null,
    node.conflictFlag,
    node.archivedAt ?? null,
    node.embedding ?? null,
  ];
}
