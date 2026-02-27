/**
 * SQL helpers for persisting mory:// memories in SQLite / PostgreSQL(pgvector).
 *
 * This module intentionally provides SQL templates only, so callers can plug
 * in their own DB client (better-sqlite3, node:sqlite, pg, drizzle, prisma...).
 */

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
  access_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_accessed_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_nodes_user_path
  ON memory_nodes(user_id, path);

CREATE INDEX IF NOT EXISTS idx_memory_nodes_user_type
  ON memory_nodes(user_id, memory_type);

CREATE INDEX IF NOT EXISTS idx_memory_nodes_user_updated
  ON memory_nodes(user_id, updated_at DESC);
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
  access_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  last_accessed_at TIMESTAMPTZ,
  embedding VECTOR(${embeddingDim})
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_nodes_user_path
  ON memory_nodes(user_id, path);

CREATE INDEX IF NOT EXISTS idx_memory_nodes_user_type
  ON memory_nodes(user_id, memory_type);

CREATE INDEX IF NOT EXISTS idx_memory_nodes_updated
  ON memory_nodes(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_nodes_embedding
  ON memory_nodes USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
`.trim();
}

export const SQLITE_UPSERT_SQL = `
INSERT INTO memory_nodes (
  id, user_id, path, memory_type, subject, l0_title, l1_summary, l2_detail,
  confidence, importance, access_count, created_at, updated_at, last_accessed_at
) VALUES (
  ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
)
ON CONFLICT(user_id, path) DO UPDATE SET
  l0_title = excluded.l0_title,
  l1_summary = excluded.l1_summary,
  l2_detail = excluded.l2_detail,
  confidence = excluded.confidence,
  importance = excluded.importance,
  access_count = excluded.access_count,
  updated_at = excluded.updated_at,
  last_accessed_at = excluded.last_accessed_at;
`.trim();

export const PGVECTOR_UPSERT_SQL = `
INSERT INTO memory_nodes (
  id, user_id, path, memory_type, subject, l0_title, l1_summary, l2_detail,
  confidence, importance, access_count, created_at, updated_at, last_accessed_at, embedding
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8,
  $9, $10, $11, $12, $13, $14, $15
)
ON CONFLICT(user_id, path) DO UPDATE SET
  l0_title = excluded.l0_title,
  l1_summary = excluded.l1_summary,
  l2_detail = excluded.l2_detail,
  confidence = excluded.confidence,
  importance = excluded.importance,
  access_count = excluded.access_count,
  updated_at = excluded.updated_at,
  last_accessed_at = excluded.last_accessed_at,
  embedding = excluded.embedding;
`.trim();

export const PGVECTOR_SEARCH_SQL = `
SELECT id, user_id, path, memory_type, subject, l0_title, l1_summary, l2_detail,
       confidence, importance, access_count, created_at, updated_at, last_accessed_at,
       1 - (embedding <=> $2::vector) AS similarity
FROM memory_nodes
WHERE user_id = $1
  AND ($3::text[] IS NULL OR memory_type = ANY($3::text[]))
  AND ($4::text[] IS NULL OR EXISTS (
    SELECT 1
    FROM unnest($4::text[]) AS prefix
    WHERE path LIKE (prefix || '%')
  ))
ORDER BY embedding <=> $2::vector
LIMIT $5;
`.trim();
