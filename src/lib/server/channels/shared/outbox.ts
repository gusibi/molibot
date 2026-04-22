import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { storagePaths } from "../../infra/db/storage.js";

type OutboxStatus = "pending" | "processing";

interface OutboxRow {
  id: number;
  payload_json: string;
}

interface PendingWaiter<TResult> {
  resolve: (value: TResult) => void;
  reject: (reason?: unknown) => void;
}

export interface OutboxRecord<TPayload> {
  id: number;
  payload: TPayload;
}

export interface SqliteOutboxOptions<TPayload, TResult> {
  channel: string;
  instanceId: string;
  dbFile?: string;
  leaseMs?: number;
  retryDelayMs?: number;
  deliver: (payload: TPayload, record: OutboxRecord<TPayload>) => Promise<TResult>;
}

export class SqliteOutbox<TPayload, TResult> {
  private readonly db: DatabaseSync;
  private readonly channel: string;
  private readonly instanceId: string;
  private readonly leaseMs: number;
  private readonly retryDelayMs: number;
  private readonly deliver: (payload: TPayload, record: OutboxRecord<TPayload>) => Promise<TResult>;

  private readonly pending = new Map<number, PendingWaiter<TResult>>();
  private drainPromise: Promise<void> | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(options: SqliteOutboxOptions<TPayload, TResult>) {
    const dbFile = options.dbFile ?? path.join(storagePaths.dataDir, "outbox.sqlite");
    fs.mkdirSync(path.dirname(dbFile), { recursive: true });
    this.db = new DatabaseSync(dbFile);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA busy_timeout = 5000;");

    this.channel = options.channel;
    this.instanceId = options.instanceId;
    this.leaseMs = options.leaseMs ?? 30_000;
    this.retryDelayMs = options.retryDelayMs ?? 5_000;
    this.deliver = options.deliver;

    this.ensureSchema();
  }

  enqueue(chatId: string, payload: TPayload): Promise<TResult> {
    if (this.closed) {
      return Promise.reject(new Error("Outbox is closed."));
    }

    const now = Date.now();
    const createdAt = new Date(now).toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO outbound_messages (
        channel,
        instance_id,
        chat_id,
        status,
        payload_json,
        attempt_count,
        next_attempt_at,
        lease_until,
        last_error,
        created_at,
        updated_at,
        completed_at,
        result_json
      ) VALUES (?, ?, ?, 'pending', ?, 0, ?, NULL, NULL, ?, ?, NULL, NULL)
    `);
    const result = stmt.run(
      this.channel,
      this.instanceId,
      chatId,
      JSON.stringify(payload),
      now,
      createdAt,
      createdAt
    );
    const id = Number(result.lastInsertRowid);

    const promise = new Promise<TResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });

    void this.resume();
    return promise;
  }

  async resume(): Promise<void> {
    if (this.closed) return;
    if (this.drainPromise) return this.drainPromise;

    this.drainPromise = this.drainLoop().finally(() => {
      this.drainPromise = null;
    });
    return this.drainPromise;
  }

  close(): void {
    this.closed = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    for (const waiter of this.pending.values()) {
      waiter.reject(new Error("Outbox closed before delivery completed."));
    }
    this.pending.clear();
    this.db.close();
  }

  pendingCount(chatId?: string): number {
    const row = chatId
      ? this.db.prepare(`
        SELECT COUNT(*) AS count
        FROM outbound_messages
        WHERE channel = ?
          AND instance_id = ?
          AND chat_id = ?
          AND status IN ('pending', 'processing')
      `).get(this.channel, this.instanceId, chatId)
      : this.db.prepare(`
        SELECT COUNT(*) AS count
        FROM outbound_messages
        WHERE channel = ?
          AND instance_id = ?
          AND status IN ('pending', 'processing')
      `).get(this.channel, this.instanceId);
    return Number((row as Record<string, unknown> | undefined)?.count ?? 0);
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS outbound_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel TEXT NOT NULL,
        instance_id TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER NOT NULL,
        lease_until INTEGER,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        result_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_outbound_messages_claim
      ON outbound_messages(channel, instance_id, status, next_attempt_at, lease_until, id);
    `);
  }

  private async drainLoop(): Promise<void> {
    while (!this.closed) {
      const row = this.claimNext();
      if (!row) return;

      let payload: TPayload;
      try {
        payload = JSON.parse(row.payload_json) as TPayload;
      } catch (error) {
        this.fail(row.id, error instanceof Error ? error.message : String(error));
        continue;
      }

      try {
        const result = await this.deliver(payload, { id: row.id, payload });
        this.complete(row.id, result);
      } catch (error) {
        this.fail(row.id, error instanceof Error ? error.message : String(error));
      }
    }
  }

  private claimNext(): OutboxRow | null {
    const now = Date.now();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db.prepare(`
        SELECT id, payload_json
        FROM outbound_messages
        WHERE channel = ?
          AND instance_id = ?
          AND status IN ('pending', 'processing')
          AND next_attempt_at <= ?
          AND (status = 'pending' OR lease_until IS NULL OR lease_until <= ?)
        ORDER BY id ASC
        LIMIT 1
      `).get(this.channel, this.instanceId, now, now) as unknown as OutboxRow | undefined;

      if (!row) {
        this.db.exec("COMMIT");
        return null;
      }

      this.db.prepare(`
        UPDATE outbound_messages
        SET status = 'processing',
            lease_until = ?,
            updated_at = ?
        WHERE id = ?
      `).run(now + this.leaseMs, new Date(now).toISOString(), row.id);
      this.db.exec("COMMIT");
      return row;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private complete(id: number, result: TResult): void {
    this.db.prepare(`
      DELETE FROM outbound_messages
      WHERE id = ?
    `).run(id);

    const waiter = this.pending.get(id);
    if (waiter) {
      this.pending.delete(id);
      waiter.resolve(result);
    }
  }

  private fail(id: number, error: string): void {
    const now = Date.now();
    this.db.prepare(`
      UPDATE outbound_messages
      SET status = 'pending',
          attempt_count = attempt_count + 1,
          lease_until = NULL,
          next_attempt_at = ?,
          last_error = ?,
          updated_at = ?
      WHERE id = ?
    `).run(now + this.retryDelayMs, error, new Date(now).toISOString(), id);

    if (!this.closed && !this.retryTimer) {
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        void this.resume();
      }, this.retryDelayMs);
    }
  }
}
