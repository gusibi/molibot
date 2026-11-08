import { DatabaseSync } from "node:sqlite";
import { ensureSqliteParentDir, storagePaths } from "$lib/server/infra/db/storage.js";

/**
 * The standardized home notification center: every item the owner should see
 * or review on the Agent home is one row, typed by `type` and deduplicated by
 * `dedupe_key`. Rows are pointers — the underlying entity (memory candidate,
 * task execution, plan) stays the single source of truth — so the home reads
 * one table and resolves each row's detail by type.
 *
 * Read state lives here (server-side), replacing the per-browser localStorage
 * receipts: 已读 is owner-level state. A row leaves the home the moment it is
 * read or resolved; retention drops terminal rows after the keep window.
 */
export type HomeNotificationType =
  | "memory-review"
  | "materials"
  | "task-result"
  | "task-failed"
  | "action-required"
  | "plan-completed"
  | "cross-channel";

export type HomeNotificationStatus = "unread" | "read" | "resolved";

export interface HomeNotificationRecord {
  id: string;
  type: HomeNotificationType;
  dedupeKey: string;
  refId?: string;
  botId?: string;
  projectId?: string;
  payload: Record<string, unknown>;
  status: HomeNotificationStatus;
  createdAt: string;
  readAt?: string;
  updatedAt: string;
}

export interface HomeNotificationInput {
  type: HomeNotificationType;
  /** Idempotency within a producer: e.g. `memory-review:owner:2026-11-07`. */
  dedupeKey: string;
  refId?: string;
  botId?: string;
  projectId?: string;
  payload?: Record<string, unknown>;
}

interface NotificationRow {
  id: string;
  type: string;
  dedupe_key: string;
  ref_id: string | null;
  bot_id: string | null;
  project_id: string | null;
  payload_json: string;
  status: string;
  created_at: string;
  read_at: string | null;
  updated_at: string;
}

function parseRow(row: NotificationRow): HomeNotificationRecord {
  let payload: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.payload_json) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>;
  } catch {
    // A malformed payload degrades to empty, never to a crashed home.
  }
  return {
    id: row.id,
    type: row.type as HomeNotificationType,
    dedupeKey: row.dedupe_key,
    ...(row.ref_id ? { refId: row.ref_id } : {}),
    ...(row.bot_id ? { botId: row.bot_id } : {}),
    ...(row.project_id ? { projectId: row.project_id } : {}),
    payload,
    status: row.status as HomeNotificationStatus,
    createdAt: row.created_at,
    ...(row.read_at ? { readAt: row.read_at } : {}),
    updatedAt: row.updated_at
  };
}

const MAX_LIMIT = 200;

export class HomeNotificationStore {
  private readonly db: DatabaseSync;

  constructor(dbFile = storagePaths.notificationsDbFile) {
    if (dbFile !== ":memory:") {
      ensureSqliteParentDir(dbFile);
    }
    this.db = new DatabaseSync(dbFile);
    this.db.exec(`CREATE TABLE IF NOT EXISTS home_notifications (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      dedupe_key TEXT NOT NULL UNIQUE,
      ref_id TEXT,
      bot_id TEXT,
      project_id TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'unread',
      created_at TEXT NOT NULL,
      read_at TEXT,
      updated_at TEXT NOT NULL
    )`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_home_notifications_status
      ON home_notifications(status, created_at)`);
  }

  /**
   * Writes one notification, deduplicating by key. A resolved row stays
   * resolved (the underlying item was handled; a re-run must not resurrect
   * it), and an unchanged payload never rewrites the row — a reconcile that
   * runs on every read must not churn timestamps or re-open what the owner
   * already read. Only changed content re-opens the row as unread.
   */
  record(input: HomeNotificationInput): HomeNotificationRecord {
    const now = new Date().toISOString();
    const payloadJson = JSON.stringify(input.payload ?? {});
    const existing = this.db.prepare("SELECT * FROM home_notifications WHERE dedupe_key = ?").get(input.dedupeKey) as NotificationRow | undefined;
    if (existing) {
      if (existing.status === "resolved" || existing.payload_json === payloadJson) return parseRow(existing);
      this.db.prepare(`UPDATE home_notifications
        SET payload_json = ?, ref_id = ?, bot_id = ?, project_id = ?, status = 'unread', read_at = NULL, updated_at = ?
        WHERE id = ?`).run(
        payloadJson,
        input.refId ?? null,
        input.botId ?? null,
        input.projectId ?? null,
        now,
        existing.id
      );
      return this.get(existing.id)!;
    }
    const id = crypto.randomUUID();
    this.db.prepare(`INSERT INTO home_notifications
      (id, type, dedupe_key, ref_id, bot_id, project_id, payload_json, status, created_at, read_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'unread', ?, NULL, ?)`).run(
      id,
      input.type,
      input.dedupeKey,
      input.refId ?? null,
      input.botId ?? null,
      input.projectId ?? null,
      payloadJson,
      now,
      now
    );
    return this.get(id)!;
  }

  /**
   * Newest first, unread only — the home shows what still needs a look.
   * `rowid` breaks same-millisecond ties: `id` is a random UUID and would
   * shuffle rows inserted within one clock tick.
   */
  listUnread(limit = 50): HomeNotificationRecord[] {
    const safeLimit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit)));
    const rows = this.db.prepare(`SELECT * FROM home_notifications
      WHERE status = 'unread' ORDER BY created_at DESC, rowid DESC LIMIT ?`).all(safeLimit) as unknown as NotificationRow[];
    return rows.map(parseRow);
  }

  /** Newest first, unread rows of one type — the reconcile's resolution source. */
  listUnreadByType(type: HomeNotificationType, limit = 200): HomeNotificationRecord[] {
    const safeLimit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit)));
    const rows = this.db.prepare(`SELECT * FROM home_notifications
      WHERE status = 'unread' AND type = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`).all(type, safeLimit) as unknown as NotificationRow[];
    return rows.map(parseRow);
  }

  get(id: string): HomeNotificationRecord | null {
    const row = this.db.prepare("SELECT * FROM home_notifications WHERE id = ?").get(id) as NotificationRow | undefined;
    return row ? parseRow(row) : null;
  }

  getByDedupe(dedupeKey: string): HomeNotificationRecord | null {
    const row = this.db.prepare("SELECT * FROM home_notifications WHERE dedupe_key = ?").get(dedupeKey) as NotificationRow | undefined;
    return row ? parseRow(row) : null;
  }

  markRead(id: string): HomeNotificationRecord | null {
    const row = this.db.prepare("SELECT * FROM home_notifications WHERE id = ?").get(id) as NotificationRow | undefined;
    if (!row || row.status !== "unread") return row ? parseRow(row) : null;
    const now = new Date().toISOString();
    this.db.prepare("UPDATE home_notifications SET status = 'read', read_at = ?, updated_at = ? WHERE id = ?")
      .run(now, now, id);
    return this.get(id);
  }

  /** 已阅全部：only unread rows are touched; resolved history is preserved. */
  markAllRead(): number {
    const now = new Date().toISOString();
    const result = this.db.prepare(`UPDATE home_notifications
      SET status = 'read', read_at = ?, updated_at = ? WHERE status = 'unread'`).run(now, now);
    return Number(result.changes);
  }

  /**
   * Re-opens a row the owner already read, with fresh content. Only callers
   * that can prove genuine growth use this (e.g. more pending review
   * candidates than the read row carried); `record()` deliberately never
   * resurrects a resolved row.
   */
  reopenByDedupe(dedupeKey: string, payload: Record<string, unknown>): HomeNotificationRecord | null {
    const row = this.db.prepare("SELECT * FROM home_notifications WHERE dedupe_key = ?").get(dedupeKey) as NotificationRow | undefined;
    if (!row || row.status === "unread") return row ? parseRow(row) : null;
    const now = new Date().toISOString();
    this.db.prepare(`UPDATE home_notifications
      SET status = 'unread', payload_json = ?, created_at = ?, read_at = NULL, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify(payload), now, now, row.id);
    return this.get(row.id);
  }

  /** The underlying entity was handled elsewhere (confirm, approve, retry). */
  resolveByDedupe(dedupeKey: string): HomeNotificationRecord | null {
    const row = this.db.prepare("SELECT * FROM home_notifications WHERE dedupe_key = ?").get(dedupeKey) as NotificationRow | undefined;
    if (!row || row.status === "resolved") return row ? parseRow(row) : null;
    const now = new Date().toISOString();
    this.db.prepare("UPDATE home_notifications SET status = 'resolved', read_at = COALESCE(read_at, ?), updated_at = ? WHERE id = ?")
      .run(now, now, row.id);
    return this.get(row.id);
  }

  /** Drops terminal rows past the keep window; unread rows are never dropped. */
  retain({ keepDays = 30, maxRows = 1000 }: { keepDays?: number; maxRows?: number } = {}): number {
    const cutoff = new Date(Date.now() - keepDays * 24 * 60 * 60 * 1000).toISOString();
    const old = this.db.prepare(`DELETE FROM home_notifications
      WHERE status IN ('read', 'resolved') AND updated_at < ?`).run(cutoff);
    const excess = this.db.prepare(`DELETE FROM home_notifications
      WHERE id IN (
        SELECT id FROM home_notifications WHERE status IN ('read', 'resolved')
        ORDER BY updated_at DESC LIMIT -1 OFFSET ?
      )`).run(Math.max(0, Math.floor(maxRows)));
    return Number(old.changes) + Number(excess.changes);
  }

  close(): void {
    if (this.db.isOpen) this.db.close();
  }
}
