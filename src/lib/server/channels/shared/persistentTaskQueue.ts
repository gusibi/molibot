import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { storagePaths } from "../../infra/db/storage.js";

export type PersistentTaskStatus = "pending" | "running" | "failed" | "cancelled";

export interface PersistentTaskListItem {
  id: number;
  status: PersistentTaskStatus;
  preview: string;
  createdAt: string;
}

export interface PersistentTaskPreviewResult {
  status: "pending" | "running" | "not_found";
  preview?: string;
}

interface QueueRow {
  id: number;
  payload_json: string;
}

export interface PersistentTaskRecord<TPayload> {
  id: number;
  scopeId: string;
  payload: TPayload;
}

export interface PersistentTaskQueueOptions<TPayload> {
  channel: string;
  instanceId: string;
  dbFile?: string;
  process: (payload: TPayload, record: PersistentTaskRecord<TPayload>) => Promise<void>;
}

export class PersistentTaskQueue<TPayload> {
  private readonly db: DatabaseSync;
  private readonly channel: string;
  private readonly instanceId: string;
  private readonly processTask: (payload: TPayload, record: PersistentTaskRecord<TPayload>) => Promise<void>;
  private readonly activeScopes = new Set<string>();

  constructor(options: PersistentTaskQueueOptions<TPayload>) {
    const dbFile = options.dbFile ?? path.join(storagePaths.dataDir, "inbound-queue.sqlite");
    fs.mkdirSync(path.dirname(dbFile), { recursive: true });
    this.db = new DatabaseSync(dbFile);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA busy_timeout = 5000;");

    this.channel = options.channel;
    this.instanceId = options.instanceId;
    this.processTask = options.process;

    this.ensureSchema();
    this.resetRunningTasks();
  }

  enqueue(scopeId: string, payload: TPayload, options?: { front?: boolean; preview?: string }): number {
    const orderValue = options?.front ? this.nextFrontOrder(scopeId) : this.nextBackOrder(scopeId);
    const nowIso = new Date().toISOString();
    const result = this.db.prepare(`
      INSERT INTO inbound_tasks (
        channel,
        instance_id,
        scope_id,
        status,
        queue_order,
        preview_text,
        payload_json,
        error_text,
        created_at,
        updated_at,
        started_at,
        finished_at
      ) VALUES (?, ?, ?, 'pending', ?, ?, ?, NULL, ?, ?, NULL, NULL)
    `).run(
      this.channel,
      this.instanceId,
      scopeId,
      orderValue,
      String(options?.preview ?? "").trim(),
      JSON.stringify(payload),
      nowIso,
      nowIso
    );
    const id = Number(result.lastInsertRowid);
    void this.resumeScope(scopeId);
    return id;
  }

  async resumeAll(): Promise<void> {
    const rows = this.db.prepare(`
      SELECT DISTINCT scope_id
      FROM inbound_tasks
      WHERE channel = ?
        AND instance_id = ?
        AND status = 'pending'
      ORDER BY scope_id ASC
    `).all(this.channel, this.instanceId) as Array<{ scope_id: string }>;

    await Promise.all(rows.map((row) => this.resumeScope(row.scope_id)));
  }

  async resumeScope(scopeId: string): Promise<void> {
    if (this.activeScopes.has(scopeId)) return;
    this.activeScopes.add(scopeId);

    try {
      while (true) {
        const row = this.claimNext(scopeId);
        if (!row) return;

        let payload: TPayload;
        try {
          payload = JSON.parse(row.payload_json) as TPayload;
        } catch (error) {
          this.fail(row.id, error instanceof Error ? error.message : String(error));
          continue;
        }

        try {
          await this.processTask(payload, { id: row.id, scopeId, payload });
          this.complete(row.id);
        } catch (error) {
          this.fail(row.id, error instanceof Error ? error.message : String(error));
        }
      }
    } finally {
      this.activeScopes.delete(scopeId);
    }
  }

  list(scopeId: string): PersistentTaskListItem[] {
    return this.db.prepare(`
      SELECT id, status, preview_text, created_at
      FROM inbound_tasks
      WHERE channel = ?
        AND instance_id = ?
        AND scope_id = ?
        AND status IN ('pending', 'running')
      ORDER BY
        CASE status WHEN 'running' THEN 0 ELSE 1 END,
        queue_order ASC,
        id ASC
    `).all(this.channel, this.instanceId, scopeId).map((row) => {
      const typed = row as Record<string, unknown>;
      return {
        id: Number(typed.id),
        status: String(typed.status) as PersistentTaskStatus,
        preview: String(typed.preview_text ?? "").trim(),
        createdAt: String(typed.created_at ?? "")
      };
    });
  }

  size(scopeId: string): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM inbound_tasks
      WHERE channel = ?
        AND instance_id = ?
        AND scope_id = ?
        AND status IN ('pending', 'running')
    `).get(this.channel, this.instanceId, scopeId) as Record<string, unknown> | undefined;
    return Number(row?.count ?? 0);
  }

  delete(scopeId: string, id: number): "deleted" | "running" | "not_found" {
    const row = this.db.prepare(`
      SELECT status
      FROM inbound_tasks
      WHERE channel = ?
        AND instance_id = ?
        AND scope_id = ?
        AND id = ?
    `).get(this.channel, this.instanceId, scopeId, id) as Record<string, unknown> | undefined;

    if (!row) return "not_found";
    if (String(row.status) === "running") return "running";
    if (String(row.status) !== "pending") return "not_found";

    this.db.prepare(`
      UPDATE inbound_tasks
      SET status = 'cancelled',
          updated_at = ?,
          finished_at = ?
      WHERE id = ?
    `).run(new Date().toISOString(), new Date().toISOString(), id);
    return "deleted";
  }

  peek(scopeId: string, id: number): PersistentTaskPreviewResult {
    const row = this.db.prepare(`
      SELECT status, preview_text
      FROM inbound_tasks
      WHERE channel = ?
        AND instance_id = ?
        AND scope_id = ?
        AND id = ?
    `).get(this.channel, this.instanceId, scopeId, id) as Record<string, unknown> | undefined;

    if (!row) return { status: "not_found" };
    const status = String(row.status);
    if (status === "running") {
      return {
        status: "running",
        preview: String(row.preview_text ?? "").trim()
      };
    }
    if (status !== "pending") {
      return { status: "not_found" };
    }
    return {
      status: "pending",
      preview: String(row.preview_text ?? "").trim()
    };
  }

  cancelPending(scopeId: string): number {
    const nowIso = new Date().toISOString();
    const result = this.db.prepare(`
      UPDATE inbound_tasks
      SET status = 'cancelled',
          updated_at = ?,
          finished_at = ?
      WHERE channel = ?
        AND instance_id = ?
        AND scope_id = ?
        AND status = 'pending'
    `).run(nowIso, nowIso, this.channel, this.instanceId, scopeId);
    return Number(result.changes ?? 0);
  }

  close(): void {
    this.db.close();
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS inbound_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel TEXT NOT NULL,
        instance_id TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        status TEXT NOT NULL,
        queue_order REAL NOT NULL,
        preview_text TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        error_text TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_inbound_tasks_scope
      ON inbound_tasks(channel, instance_id, scope_id, status, queue_order, id);
    `);
  }

  private resetRunningTasks(): void {
    this.db.prepare(`
      UPDATE inbound_tasks
      SET status = 'pending',
          updated_at = ?,
          started_at = NULL,
          error_text = NULL
      WHERE channel = ?
        AND instance_id = ?
        AND status = 'running'
    `).run(new Date().toISOString(), this.channel, this.instanceId);
  }

  private nextBackOrder(scopeId: string): number {
    const row = this.db.prepare(`
      SELECT MAX(queue_order) AS max_order
      FROM inbound_tasks
      WHERE channel = ?
        AND instance_id = ?
        AND scope_id = ?
        AND status IN ('pending', 'running')
    `).get(this.channel, this.instanceId, scopeId) as Record<string, unknown> | undefined;
    return Number(row?.max_order ?? 0) + 1;
  }

  private nextFrontOrder(scopeId: string): number {
    const row = this.db.prepare(`
      SELECT MIN(queue_order) AS min_order
      FROM inbound_tasks
      WHERE channel = ?
        AND instance_id = ?
        AND scope_id = ?
        AND status IN ('pending', 'running')
    `).get(this.channel, this.instanceId, scopeId) as Record<string, unknown> | undefined;
    return Number(row?.min_order ?? 0) - 1;
  }

  private claimNext(scopeId: string): QueueRow | null {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db.prepare(`
        SELECT id, payload_json
        FROM inbound_tasks
        WHERE channel = ?
          AND instance_id = ?
          AND scope_id = ?
          AND status = 'pending'
        ORDER BY queue_order ASC, id ASC
        LIMIT 1
      `).get(this.channel, this.instanceId, scopeId) as unknown as QueueRow | undefined;

      if (!row) {
        this.db.exec("COMMIT");
        return null;
      }

      this.db.prepare(`
        UPDATE inbound_tasks
        SET status = 'running',
            updated_at = ?,
            started_at = ?
        WHERE id = ?
      `).run(new Date().toISOString(), new Date().toISOString(), row.id);
      this.db.exec("COMMIT");
      return row;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private complete(id: number): void {
    this.db.prepare(`
      UPDATE inbound_tasks
      SET status = 'completed',
          updated_at = ?,
          finished_at = ?,
          error_text = NULL
      WHERE id = ?
    `).run(new Date().toISOString(), new Date().toISOString(), id);
  }

  private fail(id: number, errorText: string): void {
    this.db.prepare(`
      UPDATE inbound_tasks
      SET status = 'failed',
          updated_at = ?,
          finished_at = ?,
          error_text = ?
      WHERE id = ?
    `).run(new Date().toISOString(), new Date().toISOString(), errorText, id);
  }
}
