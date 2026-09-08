import { DatabaseSync } from "node:sqlite";
import { ensureSqliteParentDir } from "$lib/server/infra/db/storage.js";

export type BulkOperationKind = "archive" | "restore" | "delete";
export type BulkItemStatus = "succeeded" | "skipped" | "failed";

export interface BulkTarget {
  conversationId: string;
  expectedVersion?: number | null;
}

export interface BulkSelection {
  selectionId: string;
  createdAt: string;
  requesterExternalUserId: string | null;
  targets: BulkTarget[];
}

export interface BulkOperationItem extends BulkTarget {
  status: BulkItemStatus;
  reason: string | null;
  detail: string | null;
  /** Resulting lifecycle state for succeeded items. */
  state: string | null;
  /** Resulting lifecycle version for succeeded items. */
  version: number | null;
}

export interface BulkOperation {
  operationId: string;
  idempotencyKey: string;
  kind: BulkOperationKind;
  requesterExternalUserId: string | null;
  createdAt: string;
  updatedAt: string;
  items: BulkOperationItem[];
}

interface SelectionRowRaw {
  selection_id: string;
  created_at: string;
  requester: string | null;
  targets_json: string;
}

interface OperationRowRaw {
  operation_id: string;
  idempotency_key: string;
  kind: string;
  requester: string | null;
  created_at: string;
  updated_at: string;
}

interface OperationItemRowRaw {
  operation_id: string;
  conversation_id: string;
  expected_version: number | null;
  status: string;
  reason: string | null;
  detail: string | null;
  state: string | null;
  version: number | null;
}

/**
 * Durable persistence for bulk selections and bulk operations. Lives in the
 * Session-owned state store (`sessions.db`), next to the lifecycle table —
 * never in settings or a JSON side index. Items are written as they complete
 * so a large operation's progress stays readable after reconnect, and the
 * idempotency key maps replays to the stored result instead of re-executing.
 */
export class SessionBulkStore {
  private readonly db: DatabaseSync;
  private readonly clock: () => Date;

  constructor(dbFile: string, opts?: { clock?: () => Date }) {
    ensureSqliteParentDir(dbFile);
    this.db = new DatabaseSync(dbFile);
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.clock = opts?.clock ?? (() => new Date());
    this.ensureSchema();
  }

  close(): void {
    this.db.close();
  }

  private nowIso(): string {
    return this.clock().toISOString();
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS bulk_selections (
        selection_id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        requester TEXT,
        targets_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS bulk_operations (
        operation_id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL,
        requester TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS bulk_operation_items (
        operation_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        expected_version INTEGER,
        status TEXT NOT NULL DEFAULT 'pending',
        reason TEXT,
        detail TEXT,
        state TEXT,
        version INTEGER,
        PRIMARY KEY (operation_id, conversation_id)
      );
    `);
  }

  createSelection(selectionId: string, requester: string | null, targets: BulkTarget[]): BulkSelection {
    const createdAt = this.nowIso();
    this.db
      .prepare(
        "INSERT INTO bulk_selections (selection_id, created_at, requester, targets_json) VALUES (?, ?, ?, ?)"
      )
      .run(selectionId, createdAt, requester, JSON.stringify(targets));
    return { selectionId, createdAt, requesterExternalUserId: requester, targets };
  }

  getSelection(selectionId: string): BulkSelection | null {
    const raw = this.db
      .prepare("SELECT * FROM bulk_selections WHERE selection_id = ?")
      .get(String(selectionId ?? "").trim()) as unknown as SelectionRowRaw | null;
    if (!raw) return null;
    return {
      selectionId: raw.selection_id,
      createdAt: raw.created_at,
      requesterExternalUserId: raw.requester,
      targets: JSON.parse(raw.targets_json) as BulkTarget[]
    };
  }

  createOperation(
    operationId: string,
    idempotencyKey: string,
    kind: BulkOperationKind,
    requester: string | null,
    targets: BulkTarget[]
  ): void {
    const now = this.nowIso();
    this.db
      .prepare(
        "INSERT INTO bulk_operations (operation_id, idempotency_key, kind, requester, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(operationId, idempotencyKey, kind, requester, now, now);
    const insertItem = this.db.prepare(
      "INSERT INTO bulk_operation_items (operation_id, conversation_id, expected_version, status) VALUES (?, ?, ?, 'pending')"
    );
    for (const target of targets) {
      insertItem.run(operationId, target.conversationId, target.expectedVersion ?? null);
    }
  }

  findOperationByKey(idempotencyKey: string): BulkOperation | null {
    const raw = this.db
      .prepare("SELECT * FROM bulk_operations WHERE idempotency_key = ?")
      .get(idempotencyKey) as unknown as OperationRowRaw | null;
    return raw ? this.toOperation(raw) : null;
  }

  getOperation(operationId: string): BulkOperation | null {
    const raw = this.db
      .prepare("SELECT * FROM bulk_operations WHERE operation_id = ?")
      .get(String(operationId ?? "").trim()) as unknown as OperationRowRaw | null;
    return raw ? this.toOperation(raw) : null;
  }

  updateItem(operationId: string, item: BulkOperationItem): void {
    this.db
      .prepare(
        `UPDATE bulk_operation_items
         SET expected_version = ?, status = ?, reason = ?, detail = ?, state = ?, version = ?
         WHERE operation_id = ? AND conversation_id = ?`
      )
      .run(
        item.expectedVersion ?? null,
        item.status,
        item.reason,
        item.detail,
        item.state,
        item.version,
        operationId,
        item.conversationId
      );
    this.db
      .prepare("UPDATE bulk_operations SET updated_at = ? WHERE operation_id = ?")
      .run(this.nowIso(), operationId);
  }

  private toOperation(raw: OperationRowRaw): BulkOperation {
    const rows = this.db
      .prepare("SELECT * FROM bulk_operation_items WHERE operation_id = ? ORDER BY conversation_id ASC")
      .all(raw.operation_id) as unknown as OperationItemRowRaw[];
    return {
      operationId: raw.operation_id,
      idempotencyKey: raw.idempotency_key,
      kind: raw.kind as BulkOperationKind,
      requesterExternalUserId: raw.requester,
      createdAt: raw.created_at,
      updatedAt: raw.updated_at,
      items: rows.map((row) => ({
        conversationId: row.conversation_id,
        expectedVersion: row.expected_version,
        status: row.status as BulkItemStatus,
        reason: row.reason,
        detail: row.detail,
        state: row.state,
        version: row.version
      }))
    };
  }
}
