import { DatabaseSync } from "node:sqlite";
import { ensureSqliteParentDir, storagePaths } from "$lib/server/infra/db/storage.js";

export type SessionLifecycleState = "active" | "archived" | "trashed";
export type SessionPreTrashState = "active" | "archived";

export interface SessionLifecycleRow {
  conversationId: string;
  state: SessionLifecycleState;
  version: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  trashedAt: string | null;
  lastActivityAt: string | null;
  retain: boolean;
  preTrashState: SessionPreTrashState | null;
}

export class SessionLifecycleVersionConflictError extends Error {
  readonly code = "SESSION_LIFECYCLE_VERSION_CONFLICT";
}

export interface SessionCleanupIntent {
  conversationId: string;
  failedStep: string;
  error: string;
  updatedAt: string;
}

interface CleanupIntentRaw {
  conversation_id: string;
  failed_step: string;
  error: string;
  updated_at: string;
}

interface LifecycleRowRaw {
  conversation_id: string;
  state: string;
  version: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  trashed_at: string | null;
  last_activity_at: string | null;
  retain: number;
  pre_trash_state: string | null;
}

function toRow(raw: LifecycleRowRaw): SessionLifecycleRow {
  return {
    conversationId: raw.conversation_id,
    state: raw.state as SessionLifecycleState,
    version: raw.version,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    archivedAt: raw.archived_at,
    trashedAt: raw.trashed_at,
    lastActivityAt: raw.last_activity_at,
    retain: raw.retain === 1,
    preTrashState: raw.pre_trash_state as SessionPreTrashState | null
  };
}

/**
 * Session-owned lifecycle state store (ADR 0004: `sessions.db` owns Sessions
 * and Agent Context). Queried lifecycle and concurrency fields live as real
 * columns here — never in a settings/JSON side index. Transcript content stays
 * in the existing JSON session files; this store only tracks lifecycle.
 */
export class SessionLifecycleStore {
  private readonly db: DatabaseSync;
  private readonly clock: () => Date;

  constructor(dbFile: string = storagePaths.sessionsDbFile, opts?: { clock?: () => Date }) {
    ensureSqliteParentDir(dbFile);
    this.db = new DatabaseSync(dbFile);
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.clock = opts?.clock ?? (() => new Date());
    this.ensureSchema();
  }

  close(): void {
    this.db.close();
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_lifecycle (
        conversation_id TEXT PRIMARY KEY,
        state TEXT NOT NULL DEFAULT 'active',
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT,
        trashed_at TEXT,
        last_activity_at TEXT,
        retain INTEGER NOT NULL DEFAULT 0,
        pre_trash_state TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_session_lifecycle_state_activity
        ON session_lifecycle (state, last_activity_at);
      CREATE TABLE IF NOT EXISTS session_cleanup_intents (
        conversation_id TEXT PRIMARY KEY,
        failed_step TEXT NOT NULL,
        error TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      );
    `);
  }

  private nowIso(): string {
    return this.clock().toISOString();
  }

  get(conversationId: string): SessionLifecycleRow | null {
    const id = String(conversationId ?? "").trim();
    if (!id) return null;
    const raw = this.db
      .prepare("SELECT * FROM session_lifecycle WHERE conversation_id = ?")
      .get(id) as unknown as LifecycleRowRaw | null;
    return raw ? toRow(raw) : null;
  }

  /**
   * Creates the row when absent. `lastActivityAt` is only seeded from existing
   * message evidence supplied by the caller — never fabricated.
   */
  ensureRow(
    conversationId: string,
    init?: { createdAt?: string; lastActivityAt?: string | null }
  ): SessionLifecycleRow {
    const id = String(conversationId ?? "").trim();
    if (!id) throw new Error("conversationId is required");
    const existing = this.get(id);
    if (existing) return existing;
    const now = this.nowIso();
    const createdAt = init?.createdAt ?? now;
    this.db
      .prepare(
        `INSERT INTO session_lifecycle
           (conversation_id, state, version, created_at, updated_at, archived_at, trashed_at, last_activity_at, retain, pre_trash_state)
         VALUES (?, 'active', 1, ?, ?, NULL, NULL, ?, 0, NULL)
         ON CONFLICT(conversation_id) DO NOTHING`
      )
      .run(id, createdAt, now, init?.lastActivityAt ?? null);
    const row = this.get(id);
    if (!row) throw new Error(`Failed to create lifecycle row for ${id}`);
    return row;
  }

  /**
   * Optimistic-concurrency mutation. Throws
   * {@link SessionLifecycleVersionConflictError} when `expectedVersion` no
   * longer matches, so concurrent archive/message races converge instead of
   * silently overwriting each other.
   */
  updateWithVersion(
    conversationId: string,
    expectedVersion: number,
    patch: {
      state?: SessionLifecycleState;
      archivedAt?: string | null;
      trashedAt?: string | null;
      lastActivityAt?: string | null;
      retain?: boolean;
      preTrashState?: SessionPreTrashState | null;
    }
  ): SessionLifecycleRow {
    const id = String(conversationId ?? "").trim();
    const current = this.get(id) ?? this.ensureRow(id);
    if (current.version !== expectedVersion) {
      throw new SessionLifecycleVersionConflictError(
        `Lifecycle version conflict for ${id}: expected ${expectedVersion}, found ${current.version}`
      );
    }
    const next: SessionLifecycleRow = {
      ...current,
      state: patch.state ?? current.state,
      archivedAt: patch.archivedAt !== undefined ? patch.archivedAt : current.archivedAt,
      trashedAt: patch.trashedAt !== undefined ? patch.trashedAt : current.trashedAt,
      lastActivityAt: patch.lastActivityAt !== undefined ? patch.lastActivityAt : current.lastActivityAt,
      retain: patch.retain ?? current.retain,
      preTrashState: patch.preTrashState !== undefined ? patch.preTrashState : current.preTrashState,
      version: current.version + 1,
      updatedAt: this.nowIso()
    };
    this.db
      .prepare(
        `UPDATE session_lifecycle
         SET state = ?, version = ?, updated_at = ?, archived_at = ?, trashed_at = ?,
             last_activity_at = ?, retain = ?, pre_trash_state = ?
         WHERE conversation_id = ? AND version = ?`
      )
      .run(
        next.state,
        next.version,
        next.updatedAt,
        next.archivedAt,
        next.trashedAt,
        next.lastActivityAt,
        next.retain ? 1 : 0,
        next.preTrashState,
        id,
        expectedVersion
      );
    const row = this.get(id);
    if (!row || row.version !== next.version) {
      throw new SessionLifecycleVersionConflictError(
        `Lifecycle version conflict for ${id}: expected ${expectedVersion}, found ${row?.version ?? "missing"}`
      );
    }
    return row;
  }

  listByState(state: SessionLifecycleState): SessionLifecycleRow[] {
    const rows = this.db
      .prepare("SELECT * FROM session_lifecycle WHERE state = ? ORDER BY last_activity_at DESC, conversation_id ASC")
      .all(state) as unknown as LifecycleRowRaw[];
    return rows.map(toRow);
  }

  deleteRow(conversationId: string): void {
    this.db.prepare("DELETE FROM session_lifecycle WHERE conversation_id = ?").run(String(conversationId ?? "").trim());
  }

  /**
   * Recoverable cross-store cleanup work left by a partially failed purge.
   * The trashed lifecycle row is never removed on failure, so recording the
   * intent here can never resurrect the session — it only lets startup
   * reconciliation retry the remaining steps.
   */
  recordCleanupIntent(conversationId: string, failedStep: string, error: string): SessionCleanupIntent {
    const id = String(conversationId ?? "").trim();
    if (!id) throw new Error("conversationId is required");
    const now = this.nowIso();
    this.db
      .prepare(
        `INSERT INTO session_cleanup_intents (conversation_id, failed_step, error, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(conversation_id) DO UPDATE SET failed_step = excluded.failed_step, error = excluded.error, updated_at = excluded.updated_at`
      )
      .run(id, failedStep, String(error ?? "").slice(0, 2000), now);
    return { conversationId: id, failedStep, error: String(error ?? "").slice(0, 2000), updatedAt: now };
  }

  listCleanupIntents(): SessionCleanupIntent[] {
    const rows = this.db
      .prepare("SELECT * FROM session_cleanup_intents ORDER BY updated_at ASC, conversation_id ASC")
      .all() as unknown as CleanupIntentRaw[];
    return rows.map((row) => ({
      conversationId: row.conversation_id,
      failedStep: row.failed_step,
      error: row.error,
      updatedAt: row.updated_at
    }));
  }

  clearCleanupIntent(conversationId: string): void {
    this.db.prepare("DELETE FROM session_cleanup_intents WHERE conversation_id = ?").run(String(conversationId ?? "").trim());
  }
}

let sharedStore: SessionLifecycleStore | null = null;

/** Production singleton behind `storagePaths.sessionsDbFile`. Tests inject their own instances. */
export function getSessionLifecycleStore(): SessionLifecycleStore {
  if (!sharedStore) sharedStore = new SessionLifecycleStore();
  return sharedStore;
}

/** Test seam: swaps the production singleton (restored with `resetSessionLifecycleStore`). */
export function setSharedSessionLifecycleStore(store: SessionLifecycleStore | null): void {
  sharedStore?.close();
  sharedStore = store;
}

export function resetSessionLifecycleStore(): void {
  sharedStore?.close();
  sharedStore = null;
}
