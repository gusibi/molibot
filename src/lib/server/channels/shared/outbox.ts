import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { storagePaths } from "$lib/server/infra/db/storage.js";

export type OutboxStatus =
  | "pending"
  | "processing"
  | "sending"
  | "sent"
  | "failed"
  | "expired"
  | "cancelled"
  | "unknown";

export type OutboxTerminalFailureStatus = "failed" | "expired" | "cancelled" | "unknown";

export type OutboxErrorDisposition = "retryable" | "permanent" | "unknown";

export type OutboxGateResult =
  | { allow: true }
  | { allow: false; reason: string; status?: "cancelled" | "expired" };

export class OutboxDeliveryError extends Error {
  readonly status: OutboxTerminalFailureStatus;
  readonly deliveryKey: string | null;
  readonly attemptCount: number;

  constructor(
    status: OutboxTerminalFailureStatus,
    message: string,
    options?: { deliveryKey?: string | null; attemptCount?: number; cause?: unknown }
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "OutboxDeliveryError";
    this.status = status;
    this.deliveryKey = options?.deliveryKey ?? null;
    this.attemptCount = options?.attemptCount ?? 0;
  }
}

interface OutboxRow {
  id: number;
  chat_id: string;
  delivery_key: string | null;
  status: OutboxStatus;
  payload_json: string;
  attempt_count: number;
  expires_at: number | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  result_json: string | null;
}

interface PendingWaiter<TResult> {
  resolve: (value: TResult) => void;
  reject: (reason?: unknown) => void;
}

export interface OutboxRecord<TPayload> {
  id: number;
  chatId: string;
  deliveryKey: string | null;
  attemptCount: number;
  expiresAt: number | null;
  payload: TPayload;
}

export interface OutboxEnqueueOptions {
  deliveryKey?: string;
  expiresAt?: number;
}

export interface OutboxReceipt<TResult> {
  id: number;
  chatId: string;
  deliveryKey: string | null;
  status: OutboxStatus;
  attemptCount: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  expiresAt: number | null;
  result: TResult | null;
}

export interface SqliteOutboxOptions<TPayload, TResult> {
  channel: string;
  instanceId: string;
  dbFile?: string;
  leaseMs?: number;
  retryDelayMs?: number;
  maxRetryDelayMs?: number;
  maxAttempts?: number;
  retentionMs?: number;
  now?: () => number;
  beforeDeliver?: (payload: TPayload, record: OutboxRecord<TPayload>) => Promise<OutboxGateResult> | OutboxGateResult;
  classifyError?: (error: unknown, payload: TPayload, record: OutboxRecord<TPayload>) => OutboxErrorDisposition;
  deliver: (payload: TPayload, record: OutboxRecord<TPayload>) => Promise<TResult>;
}

const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_RETRY_DELAY_MS = 5_000;
const DEFAULT_MAX_RETRY_DELAY_MS = 300_000;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export class SqliteOutbox<TPayload, TResult> {
  private readonly db: DatabaseSync;
  private readonly channel: string;
  private readonly instanceId: string;
  private readonly leaseMs: number;
  private readonly retryDelayMs: number;
  private readonly maxRetryDelayMs: number;
  private readonly maxAttempts: number;
  private readonly retentionMs: number;
  private readonly now: () => number;
  private readonly beforeDeliver?: (payload: TPayload, record: OutboxRecord<TPayload>) => Promise<OutboxGateResult> | OutboxGateResult;
  private readonly classifyError?: (error: unknown, payload: TPayload, record: OutboxRecord<TPayload>) => OutboxErrorDisposition;
  private readonly deliver: (payload: TPayload, record: OutboxRecord<TPayload>) => Promise<TResult>;

  private readonly pending = new Map<number, PendingWaiter<TResult>[]>();
  private drainPromise: Promise<void> | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private retryTimerTargetAt: number | null = null;
  private closed = false;

  constructor(options: SqliteOutboxOptions<TPayload, TResult>) {
    const dbFile = options.dbFile ?? storagePaths.outboxDbFile;
    if (dbFile !== ":memory:") {
      fs.mkdirSync(path.dirname(dbFile), { recursive: true });
    }
    this.db = new DatabaseSync(dbFile);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA busy_timeout = 5000;");

    this.channel = options.channel;
    this.instanceId = options.instanceId;
    this.leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
    this.retryDelayMs = Math.max(1, options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
    this.maxRetryDelayMs = Math.max(this.retryDelayMs, options.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS);
    this.maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
    this.retentionMs = Math.max(0, options.retentionMs ?? DEFAULT_RETENTION_MS);
    this.now = options.now ?? (() => Date.now());
    this.beforeDeliver = options.beforeDeliver;
    this.classifyError = options.classifyError;
    this.deliver = options.deliver;

    this.ensureSchema();
  }

  enqueue(chatId: string, payload: TPayload, options?: OutboxEnqueueOptions): Promise<TResult> {
    if (this.closed) {
      return Promise.reject(new Error("Outbox is closed."));
    }

    const deliveryKey = normalizeDeliveryKey(options?.deliveryKey);
    const expiresAt = options?.expiresAt != null && Number.isFinite(options.expiresAt)
      ? Math.floor(options.expiresAt)
      : null;
    const now = this.now();
    const nowIso = new Date(now).toISOString();

    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (deliveryKey) {
        const existing = this.findByDeliveryKey(deliveryKey);
        if (existing) {
          this.db.exec("COMMIT");
          return this.settleExistingRow(existing);
        }
      }

      if (expiresAt !== null && expiresAt <= now) {
        this.db.prepare(`
          INSERT INTO outbound_messages (
            channel, instance_id, chat_id, delivery_key, status,
            payload_json, attempt_count, next_attempt_at, lease_until,
            expires_at, sending_at, last_error, created_at, updated_at,
            completed_at, result_json
          ) VALUES (?, ?, ?, ?, 'expired', ?, 0, ?, NULL, ?, NULL, ?, ?, ?, ?, NULL)
        `).run(
          this.channel,
          this.instanceId,
          chatId,
          deliveryKey,
          JSON.stringify(payload),
          now,
          expiresAt,
          "Message expired before delivery.",
          nowIso,
          nowIso,
          nowIso
        );
        this.db.exec("COMMIT");
        return Promise.reject(
          new OutboxDeliveryError("expired", "Message expired before delivery.", { deliveryKey, attemptCount: 0 })
        );
      }

      const result = this.db.prepare(`
        INSERT INTO outbound_messages (
          channel, instance_id, chat_id, delivery_key, status,
          payload_json, attempt_count, next_attempt_at, lease_until,
          expires_at, sending_at, last_error, created_at, updated_at,
          completed_at, result_json
        ) VALUES (?, ?, ?, ?, 'pending', ?, 0, ?, NULL, ?, NULL, NULL, ?, ?, NULL, NULL)
      `).run(
        this.channel,
        this.instanceId,
        chatId,
        deliveryKey,
        JSON.stringify(payload),
        now,
        expiresAt,
        nowIso,
        nowIso
      );
      const id = Number(result.lastInsertRowid);
      this.db.exec("COMMIT");

      const promise = this.addWaiter(id);
      void this.resume();
      return promise;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getReceipt(deliveryKey: string): OutboxReceipt<TResult> | null {
    const normalized = normalizeDeliveryKey(deliveryKey);
    if (!normalized) return null;
    const row = this.findByDeliveryKey(normalized);
    if (!row) return null;
    let parsedResult: TResult | null = null;
    if (row.result_json) {
      try {
        parsedResult = JSON.parse(row.result_json) as TResult;
      } catch {
        parsedResult = null;
      }
    }
    return {
      id: row.id,
      chatId: row.chat_id,
      deliveryKey: row.delivery_key,
      status: row.status,
      attemptCount: row.attempt_count,
      lastError: row.last_error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
      expiresAt: row.expires_at,
      result: parsedResult
    };
  }

  cancel(deliveryKey: string, reason = "Delivery cancelled."): { cancelled: boolean; status: OutboxStatus | null } {
    const normalized = normalizeDeliveryKey(deliveryKey);
    if (!normalized) return { cancelled: false, status: null };
    const now = this.now();
    const nowIso = new Date(now).toISOString();

    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.findByDeliveryKey(normalized);
      if (!row) {
        this.db.exec("COMMIT");
        return { cancelled: false, status: null };
      }
      if (row.status !== "pending") {
        this.db.exec("COMMIT");
        return { cancelled: false, status: row.status };
      }
      this.db.prepare(`
        UPDATE outbound_messages
        SET status = 'cancelled',
            lease_until = NULL,
            last_error = ?,
            updated_at = ?,
            completed_at = ?
        WHERE id = ?
      `).run(reason, nowIso, nowIso, row.id);
      this.db.exec("COMMIT");

      this.rejectWaiters(row.id, new OutboxDeliveryError("cancelled", reason, {
        deliveryKey: row.delivery_key,
        attemptCount: row.attempt_count
      }));
      return { cancelled: true, status: "cancelled" };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  pruneReceipts(nowMs?: number): number {
    if (this.closed) return 0;
    const cutoffIso = new Date((nowMs ?? this.now()) - this.retentionMs).toISOString();
    const result = this.db.prepare(`
      DELETE FROM outbound_messages
      WHERE channel = ?
        AND instance_id = ?
        AND status IN ('sent', 'failed', 'expired', 'cancelled', 'unknown')
        AND completed_at IS NOT NULL
        AND completed_at < ?
    `).run(this.channel, this.instanceId, cutoffIso);
    return Number(result.changes ?? 0);
  }

  async resume(): Promise<void> {
    if (this.closed) return;
    if (this.drainPromise) return this.drainPromise;

    this.drainPromise = this.drainLoop().finally(() => {
      this.drainPromise = null;
      this.scheduleNextPendingTimer();
    });
    return this.drainPromise;
  }

  close(): void {
    this.closed = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
      this.retryTimerTargetAt = null;
    }
    for (const waiters of this.pending.values()) {
      for (const waiter of waiters) {
        waiter.reject(new Error("Outbox closed before delivery completed."));
      }
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
          AND status IN ('pending', 'processing', 'sending')
      `).get(this.channel, this.instanceId, chatId)
      : this.db.prepare(`
        SELECT COUNT(*) AS count
        FROM outbound_messages
        WHERE channel = ?
          AND instance_id = ?
          AND status IN ('pending', 'processing', 'sending')
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
        delivery_key TEXT,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER NOT NULL,
        lease_until INTEGER,
        expires_at INTEGER,
        sending_at INTEGER,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        result_json TEXT
      );
    `);

    const columns = new Set(
      (this.db.prepare("PRAGMA table_info(outbound_messages)").all() as Array<{ name: string }>).map((c) => c.name)
    );
    if (!columns.has("delivery_key")) {
      this.db.exec("ALTER TABLE outbound_messages ADD COLUMN delivery_key TEXT;");
    }
    if (!columns.has("expires_at")) {
      this.db.exec("ALTER TABLE outbound_messages ADD COLUMN expires_at INTEGER;");
    }
    if (!columns.has("sending_at")) {
      this.db.exec("ALTER TABLE outbound_messages ADD COLUMN sending_at INTEGER;");
    }

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_outbound_messages_claim
      ON outbound_messages(channel, instance_id, status, next_attempt_at, lease_until, id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_outbound_messages_delivery_key
      ON outbound_messages(channel, instance_id, delivery_key)
      WHERE delivery_key IS NOT NULL;
    `);
  }

  private findByDeliveryKey(deliveryKey: string): OutboxRow | null {
    const row = this.db.prepare(`
      SELECT id, chat_id, delivery_key, status, payload_json, attempt_count,
             expires_at, last_error, created_at, updated_at, completed_at, result_json
      FROM outbound_messages
      WHERE channel = ?
        AND instance_id = ?
        AND delivery_key = ?
      LIMIT 1
    `).get(this.channel, this.instanceId, deliveryKey) as unknown as OutboxRow | undefined;
    return row ?? null;
  }

  private settleExistingRow(row: OutboxRow): Promise<TResult> {
    if (row.status === "sent") {
      const parsed = row.result_json ? (JSON.parse(row.result_json) as TResult) : (undefined as TResult);
      return Promise.resolve(parsed);
    }
    if (row.status === "failed" || row.status === "expired" || row.status === "cancelled" || row.status === "unknown") {
      return Promise.reject(
        new OutboxDeliveryError(row.status, row.last_error || `Outbox delivery ${row.status}.`, {
          deliveryKey: row.delivery_key,
          attemptCount: row.attempt_count
        })
      );
    }
    const promise = this.addWaiter(row.id);
    void this.resume();
    return promise;
  }

  private addWaiter(id: number): Promise<TResult> {
    return new Promise<TResult>((resolve, reject) => {
      const list = this.pending.get(id);
      if (list) {
        list.push({ resolve, reject });
      } else {
        this.pending.set(id, [{ resolve, reject }]);
      }
    });
  }

  private resolveWaiters(id: number, result: TResult): void {
    const waiters = this.pending.get(id);
    if (!waiters) return;
    this.pending.delete(id);
    for (const waiter of waiters) {
      waiter.resolve(result);
    }
  }

  private rejectWaiters(id: number, error: unknown): void {
    const waiters = this.pending.get(id);
    if (!waiters) return;
    this.pending.delete(id);
    for (const waiter of waiters) {
      waiter.reject(error);
    }
  }

  private reconcileStaleAndExpired(): void {
    const now = this.now();
    const nowIso = new Date(now).toISOString();
    const newlyUnknown: Array<{ id: number; delivery_key: string | null; attempt_count: number }> = [];
    const newlyExpired: Array<{ id: number; delivery_key: string | null; attempt_count: number }> = [];

    this.db.exec("BEGIN IMMEDIATE");
    try {
      const staleSending = this.db.prepare(`
        SELECT id, delivery_key, attempt_count
        FROM outbound_messages
        WHERE channel = ?
          AND instance_id = ?
          AND status = 'sending'
          AND delivery_key IS NOT NULL
          AND (lease_until IS NULL OR lease_until <= ?)
      `).all(this.channel, this.instanceId, now) as Array<{ id: number; delivery_key: string | null; attempt_count: number }>;

      for (const row of staleSending) {
        this.db.prepare(`
          UPDATE outbound_messages
          SET status = 'unknown',
              lease_until = NULL,
              last_error = ?,
              updated_at = ?,
              completed_at = ?
          WHERE id = ?
        `).run("Process interrupted after send gate; delivery outcome is unknown.", nowIso, nowIso, row.id);
        newlyUnknown.push(row);
      }

      const expiredRows = this.db.prepare(`
        SELECT id, delivery_key, attempt_count
        FROM outbound_messages
        WHERE channel = ?
          AND instance_id = ?
          AND status IN ('pending', 'processing')
          AND expires_at IS NOT NULL
          AND expires_at <= ?
      `).all(this.channel, this.instanceId, now) as Array<{ id: number; delivery_key: string | null; attempt_count: number }>;

      for (const row of expiredRows) {
        this.db.prepare(`
          UPDATE outbound_messages
          SET status = 'expired',
              lease_until = NULL,
              last_error = ?,
              updated_at = ?,
              completed_at = ?
          WHERE id = ?
        `).run("Message expired before delivery.", nowIso, nowIso, row.id);
        newlyExpired.push(row);
      }

      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }

    for (const row of newlyUnknown) {
      this.rejectWaiters(
        row.id,
        new OutboxDeliveryError("unknown", "Process interrupted after send gate; delivery outcome is unknown.", {
          deliveryKey: row.delivery_key,
          attemptCount: row.attempt_count
        })
      );
    }
    for (const row of newlyExpired) {
      this.rejectWaiters(
        row.id,
        new OutboxDeliveryError("expired", "Message expired before delivery.", {
          deliveryKey: row.delivery_key,
          attemptCount: row.attempt_count
        })
      );
    }
  }

  private async drainLoop(): Promise<void> {
    this.reconcileStaleAndExpired();
    this.pruneReceipts();

    while (!this.closed) {
      const row = this.claimNext();
      if (!row) return;

      if (row.expires_at !== null && row.expires_at <= this.now()) {
        this.settleTerminal(row, "expired", "Message expired before delivery.", false);
        continue;
      }

      let payload: TPayload;
      try {
        payload = JSON.parse(row.payload_json) as TPayload;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.settleTerminal(row, "failed", message, true, error);
        continue;
      }

      const record: OutboxRecord<TPayload> = {
        id: row.id,
        chatId: row.chat_id,
        deliveryKey: row.delivery_key,
        attemptCount: row.attempt_count,
        expiresAt: row.expires_at,
        payload
      };

      if (this.beforeDeliver) {
        try {
          const gate = await this.beforeDeliver(payload, record);
          if (this.closed) return;
          if (!gate.allow) {
            this.settleTerminal(row, gate.status ?? "cancelled", gate.reason, false);
            continue;
          }
        } catch (error) {
          if (this.closed) return;
          this.handleFailure(row, payload, record, error);
          continue;
        }
      }

      if (this.closed) return;

      // Linearization point: once marked `sending`, a crash on a keyed delivery
      // reconciles to `unknown` rather than blindly resending.
      this.markSending(row.id);

      try {
        const result = await this.deliver(payload, record);
        if (this.closed) return;
        this.complete(row.id, result);
      } catch (error) {
        if (this.closed) return;
        this.handleFailure(row, payload, record, error);
      }
    }
  }

  private claimNext(): OutboxRow | null {
    const now = this.now();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db.prepare(`
        SELECT id, chat_id, delivery_key, status, payload_json, attempt_count,
               expires_at, last_error, created_at, updated_at, completed_at, result_json
        FROM outbound_messages
        WHERE channel = ?
          AND instance_id = ?
          AND (
            (status = 'pending' AND next_attempt_at <= ?)
            OR (status = 'processing' AND (lease_until IS NULL OR lease_until <= ?))
            OR (status = 'sending' AND delivery_key IS NULL AND (lease_until IS NULL OR lease_until <= ?))
          )
        ORDER BY id ASC
        LIMIT 1
      `).get(this.channel, this.instanceId, now, now, now) as unknown as OutboxRow | undefined;

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

  private markSending(id: number): void {
    const now = this.now();
    this.db.prepare(`
      UPDATE outbound_messages
      SET status = 'sending',
          sending_at = ?,
          lease_until = ?,
          updated_at = ?
      WHERE id = ?
    `).run(now, now + this.leaseMs, new Date(now).toISOString(), id);
  }

  private complete(id: number, result: TResult): void {
    const nowIso = new Date(this.now()).toISOString();
    this.db.prepare(`
      UPDATE outbound_messages
      SET status = 'sent',
          lease_until = NULL,
          last_error = NULL,
          updated_at = ?,
          completed_at = ?,
          result_json = ?
      WHERE id = ?
    `).run(nowIso, nowIso, JSON.stringify(result ?? null), id);

    this.resolveWaiters(id, result);
  }

  private settleTerminal(
    row: OutboxRow,
    status: OutboxTerminalFailureStatus,
    errorMessage: string,
    incrementAttempt: boolean,
    cause?: unknown
  ): void {
    const nowIso = new Date(this.now()).toISOString();
    const attemptCount = incrementAttempt ? row.attempt_count + 1 : row.attempt_count;
    this.db.prepare(`
      UPDATE outbound_messages
      SET status = ?,
          attempt_count = ?,
          lease_until = NULL,
          last_error = ?,
          updated_at = ?,
          completed_at = ?
      WHERE id = ?
    `).run(status, attemptCount, errorMessage, nowIso, nowIso, row.id);

    this.rejectWaiters(
      row.id,
      new OutboxDeliveryError(status, errorMessage, {
        deliveryKey: row.delivery_key,
        attemptCount,
        cause
      })
    );
  }

  private handleFailure(row: OutboxRow, payload: TPayload, record: OutboxRecord<TPayload>, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const nextAttemptCount = row.attempt_count + 1;
    const disposition: OutboxErrorDisposition = this.classifyError
      ? this.classifyError(error, payload, { ...record, attemptCount: nextAttemptCount })
      : "retryable";

    if (disposition === "permanent") {
      this.settleTerminal(row, "failed", message, true, error);
      return;
    }

    if (disposition === "unknown") {
      this.settleTerminal(row, "unknown", message, true, error);
      return;
    }

    if (nextAttemptCount >= this.maxAttempts) {
      this.settleTerminal(row, "failed", message, true, error);
      return;
    }

    const now = this.now();
    const delayMs = Math.min(this.maxRetryDelayMs, this.retryDelayMs * Math.pow(2, nextAttemptCount - 1));
    const nextAttemptAt = now + delayMs;
    this.db.prepare(`
      UPDATE outbound_messages
      SET status = 'pending',
          attempt_count = ?,
          lease_until = NULL,
          sending_at = NULL,
          next_attempt_at = ?,
          last_error = ?,
          updated_at = ?
      WHERE id = ?
    `).run(nextAttemptCount, nextAttemptAt, message, new Date(now).toISOString(), row.id);

    this.scheduleRetryAt(nextAttemptAt);
  }

  private scheduleNextPendingTimer(): void {
    if (this.closed) return;
    const row = this.db.prepare(`
      SELECT MIN(next_attempt_at) AS next_at
      FROM outbound_messages
      WHERE channel = ?
        AND instance_id = ?
        AND status = 'pending'
    `).get(this.channel, this.instanceId) as { next_at: number | null } | undefined;
    if (row && typeof row.next_at === "number" && Number.isFinite(row.next_at)) {
      this.scheduleRetryAt(row.next_at);
    }
  }

  private scheduleRetryAt(targetAt: number): void {
    if (this.closed) return;
    if (this.retryTimer && this.retryTimerTargetAt !== null && this.retryTimerTargetAt <= targetAt) {
      return;
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
      this.retryTimerTargetAt = null;
    }
    const waitMs = Math.max(1, targetAt - this.now());
    this.retryTimerTargetAt = targetAt;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.retryTimerTargetAt = null;
      void this.resume();
    }, waitMs);
  }
}

function normalizeDeliveryKey(key: string | undefined): string | null {
  const trimmed = String(key ?? "").trim();
  return trimmed ? trimmed : null;
}
