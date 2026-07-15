import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { momWarn } from "$lib/server/agent/common/log.js";

// A lease may not run with a sub-second timeout or fewer than one attempt; both
// are clamped on the way in. Requests below these floors are almost always a
// caller bug (e.g. passing milliseconds where seconds were meant), so we warn.
const MIN_LEASE_TIMEOUT_MS = 1000;
const MIN_LEASE_ATTEMPTS = 1;

export type EventExecutionLeaseStatus = "running" | "retry_wait" | "completed" | "failed" | "aborted" | "skipped";

export interface EventExecutionLease {
  id: string;
  leaseScope: string;
  eventFile: string;
  eventType: string;
  triggerSlot: string;
  chatId: string;
  sessionId: string;
  channel: string;
  taskId?: string;
  runId: string;
  status: EventExecutionLeaseStatus;
  attempt: number;
  maxAttempts: number;
  timeoutMs: number;
  startedAt: string;
  lastHeartbeatAt: string;
  finishedAt?: string;
  stopReason?: string;
  lastError?: string;
  retryScheduledAt?: string;
  eventPayloadJson: string;
}

export interface AcquireEventLeaseInput {
  leaseScope?: string;
  eventFile: string;
  eventType: string;
  triggerSlot: string;
  chatId: string;
  sessionId?: string;
  channel?: string;
  taskId?: string;
  runId: string;
  maxAttempts: number;
  timeoutMs: number;
  eventPayloadJson: string;
  now?: Date;
}

interface LeaseRow {
  id: string;
  lease_scope: string;
  event_file: string;
  event_type: string;
  trigger_slot: string;
  chat_id: string;
  session_id: string;
  channel: string;
  task_id: string | null;
  run_id: string;
  status: EventExecutionLeaseStatus;
  attempt: number;
  max_attempts: number;
  timeout_ms: number;
  started_at: string;
  last_heartbeat_at: string;
  finished_at: string | null;
  stop_reason: string | null;
  last_error: string | null;
  retry_scheduled_at: string | null;
  event_payload_json: string;
}

const ACTIVE_STATUSES = ["running", "retry_wait"] as const;

function rowToLease(row: LeaseRow): EventExecutionLease {
  return {
    id: row.id,
    leaseScope: row.lease_scope,
    eventFile: row.event_file,
    eventType: row.event_type,
    triggerSlot: row.trigger_slot,
    chatId: row.chat_id,
    sessionId: row.session_id,
    channel: row.channel,
    taskId: row.task_id ?? undefined,
    runId: row.run_id,
    status: row.status,
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    timeoutMs: row.timeout_ms,
    startedAt: row.started_at,
    lastHeartbeatAt: row.last_heartbeat_at,
    finishedAt: row.finished_at ?? undefined,
    stopReason: row.stop_reason ?? undefined,
    lastError: row.last_error ?? undefined,
    retryScheduledAt: row.retry_scheduled_at ?? undefined,
    eventPayloadJson: row.event_payload_json
  };
}

export class EventExecutionLeaseStore {
  private readonly db: DatabaseSync;

  constructor(dbFile = storagePaths.settingsDbFile) {
    if (dbFile !== ":memory:") {
      mkdirSync(dirname(dbFile), { recursive: true });
    }
    this.db = new DatabaseSync(dbFile);
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.ensureSchema();
  }

  close(): void {
    this.db.close();
  }

  private normalizeTimeoutMs(requested: number, context: { eventFile: string; runId: string }): number {
    const rounded = Math.round(requested);
    if (Number.isFinite(rounded) && rounded < MIN_LEASE_TIMEOUT_MS) {
      momWarn("eventLease", "timeout_below_floor", {
        requestedMs: requested,
        appliedMs: MIN_LEASE_TIMEOUT_MS,
        eventFile: context.eventFile,
        runId: context.runId
      });
    }
    return Math.max(MIN_LEASE_TIMEOUT_MS, Number.isFinite(rounded) ? rounded : MIN_LEASE_TIMEOUT_MS);
  }

  private normalizeMaxAttempts(requested: number, context: { eventFile: string; runId: string }): number {
    const rounded = Math.round(requested);
    if (Number.isFinite(rounded) && rounded < MIN_LEASE_ATTEMPTS) {
      momWarn("eventLease", "max_attempts_below_floor", {
        requested,
        applied: MIN_LEASE_ATTEMPTS,
        eventFile: context.eventFile,
        runId: context.runId
      });
    }
    return Math.max(MIN_LEASE_ATTEMPTS, Number.isFinite(rounded) ? rounded : MIN_LEASE_ATTEMPTS);
  }

  acquire(input: AcquireEventLeaseInput): EventExecutionLease | null {
    const nowIso = (input.now ?? new Date()).toISOString();
    const leaseScope = input.leaseScope ?? "default";
    const sessionId = input.sessionId ?? input.chatId;
    const channel = input.channel ?? "unknown";
    const maxAttempts = this.normalizeMaxAttempts(input.maxAttempts, { eventFile: input.eventFile, runId: input.runId });
    const timeoutMs = this.normalizeTimeoutMs(input.timeoutMs, { eventFile: input.eventFile, runId: input.runId });

    this.db.exec("BEGIN IMMEDIATE");
    try {
      const active = this.findActive(leaseScope, input.eventFile, input.chatId, input.triggerSlot);
      if (active?.status === "running") {
        this.db.exec("COMMIT");
        return null;
      }

      if (active?.status === "retry_wait") {
        const retryAt = Date.parse(active.retryScheduledAt ?? "");
        if (Number.isFinite(retryAt) && retryAt > Date.parse(nowIso)) {
          this.db.exec("COMMIT");
          return null;
        }
        if (active.attempt >= active.maxAttempts) {
          this.db.prepare(`
            UPDATE event_execution_leases
            SET status = 'failed', finished_at = ?, stop_reason = 'retry_exhausted', updated_at = ?
            WHERE id = ?
          `).run(nowIso, nowIso, active.id);
          this.db.exec("COMMIT");
          return null;
        }

        this.db.prepare(`
          UPDATE event_execution_leases
          SET status = 'running',
              run_id = ?,
              attempt = attempt + 1,
              timeout_ms = ?,
              started_at = ?,
              last_heartbeat_at = ?,
              finished_at = NULL,
              stop_reason = NULL,
              last_error = NULL,
              retry_scheduled_at = NULL,
              task_id = ?,
              event_payload_json = ?,
              updated_at = ?
          WHERE id = ?
        `).run(input.runId, timeoutMs, nowIso, nowIso, input.taskId ?? active.taskId ?? null, input.eventPayloadJson, nowIso, active.id);
        const lease = this.getById(active.id);
        this.db.exec("COMMIT");
        return lease;
      }

      const latest = this.findLatest(leaseScope, input.eventFile, input.chatId, input.triggerSlot);
      if (latest) {
        this.db.exec("COMMIT");
        return null;
      }

      const id = `event-lease-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      this.db.prepare(`
        INSERT INTO event_execution_leases (
          id, lease_scope, event_file, event_type, trigger_slot, chat_id, session_id, channel, task_id, run_id,
          status, attempt, max_attempts, timeout_ms, started_at, last_heartbeat_at,
          finished_at, stop_reason, last_error, retry_scheduled_at, event_payload_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', 1, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?)
      `).run(
        id,
        leaseScope,
        input.eventFile,
        input.eventType,
        input.triggerSlot,
        input.chatId,
        sessionId,
        channel,
        input.taskId ?? null,
        input.runId,
        maxAttempts,
        timeoutMs,
        nowIso,
        nowIso,
        input.eventPayloadJson,
        nowIso,
        nowIso
      );
      const lease = this.getById(id);
      this.db.exec("COMMIT");
      return lease;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  markCompleted(id: string, runId: string, now = new Date()): boolean {
    const nowIso = now.toISOString();
    const result = this.db.prepare(`
      UPDATE event_execution_leases
      SET status = 'completed',
          finished_at = ?,
          stop_reason = 'completed',
          retry_scheduled_at = NULL,
          updated_at = ?
      WHERE id = ? AND run_id = ? AND status = 'running'
    `).run(nowIso, nowIso, id, runId);
    return Number(result.changes ?? 0) > 0;
  }

  recordSkipped(input: AcquireEventLeaseInput & { reason: string }): EventExecutionLease {
    const nowIso = (input.now ?? new Date()).toISOString();
    const leaseScope = input.leaseScope ?? "default";
    const sessionId = input.sessionId ?? input.chatId;
    const channel = input.channel ?? "unknown";
    const maxAttempts = this.normalizeMaxAttempts(input.maxAttempts, { eventFile: input.eventFile, runId: input.runId });
    const timeoutMs = this.normalizeTimeoutMs(input.timeoutMs, { eventFile: input.eventFile, runId: input.runId });
    const id = `event-lease-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    this.db.prepare(`
      INSERT INTO event_execution_leases (
        id, lease_scope, event_file, event_type, trigger_slot, chat_id, session_id, channel, task_id, run_id,
        status, attempt, max_attempts, timeout_ms, started_at, last_heartbeat_at,
        finished_at, stop_reason, last_error, retry_scheduled_at, event_payload_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'skipped', 0, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)
    `).run(
      id,
      leaseScope,
      input.eventFile,
      input.eventType,
      input.triggerSlot,
      input.chatId,
      sessionId,
      channel,
      input.taskId ?? null,
      input.runId,
      maxAttempts,
      timeoutMs,
      nowIso,
      nowIso,
      nowIso,
      input.reason,
      input.eventPayloadJson,
      nowIso,
      nowIso
    );
    return this.getById(id)!;
  }

  markFailed(id: string, runId: string, error: string, now = new Date()): boolean {
    const nowIso = now.toISOString();
    const result = this.db.prepare(`
      UPDATE event_execution_leases
      SET status = 'failed',
          finished_at = ?,
          stop_reason = 'error',
          last_error = ?,
          retry_scheduled_at = NULL,
          updated_at = ?
      WHERE id = ? AND run_id = ? AND status = 'running'
    `).run(nowIso, error, nowIso, id, runId);
    return Number(result.changes ?? 0) > 0;
  }

  markAbortedForChat(chatId: string, error = "Stopped by user.", now = new Date(), leaseScope?: string): number {
    const nowIso = now.toISOString();
    const scopeClause = leaseScope ? "AND lease_scope = ?" : "";
    const params = leaseScope
      ? [nowIso, error, nowIso, chatId, leaseScope]
      : [nowIso, error, nowIso, chatId];
    const result = this.db.prepare(`
      UPDATE event_execution_leases
      SET status = 'aborted',
          finished_at = ?,
          stop_reason = 'manual_stop',
          last_error = ?,
          retry_scheduled_at = NULL,
          updated_at = ?
      WHERE chat_id = ? ${scopeClause} AND status IN ('running', 'retry_wait')
    `).run(...params);
    return Number(result.changes ?? 0);
  }

  markTimedOut(id: string, runId: string, retryDelayMs: number, now = new Date()): EventExecutionLease | null {
    const current = this.getById(id);
    if (!current || current.runId !== runId || current.status !== "running") return null;
    const nowIso = now.toISOString();
    const retryAt = new Date(now.getTime() + Math.max(0, retryDelayMs)).toISOString();
    const hasRetry = current.attempt < current.maxAttempts;
    this.db.prepare(`
      UPDATE event_execution_leases
      SET status = ?,
          finished_at = ?,
          stop_reason = 'timeout',
          last_error = ?,
          retry_scheduled_at = ?,
          updated_at = ?
      WHERE id = ? AND run_id = ? AND status = 'running'
    `).run(
      hasRetry ? "retry_wait" : "failed",
      nowIso,
      `Event attempt timed out after ${current.timeoutMs}ms.`,
      hasRetry ? retryAt : null,
      nowIso,
      id,
      runId
    );
    return this.getById(id);
  }

  heartbeat(id: string, runId: string, now = new Date()): boolean {
    const nowIso = now.toISOString();
    const result = this.db.prepare(`
      UPDATE event_execution_leases
      SET last_heartbeat_at = ?, updated_at = ?
      WHERE id = ? AND run_id = ? AND status = 'running'
    `).run(nowIso, nowIso, id, runId);
    return Number(result.changes ?? 0) > 0;
  }

  hasActiveForChat(chatId: string, leaseScope?: string): boolean {
    const scopeClause = leaseScope ? "AND lease_scope = ?" : "";
    const params = leaseScope ? [chatId, leaseScope] : [chatId];
    const row = this.db.prepare(`
      SELECT id FROM event_execution_leases
      WHERE chat_id = ? ${scopeClause} AND status IN ('running', 'retry_wait')
      LIMIT 1
    `).get(...params) as { id: string } | undefined;
    return Boolean(row);
  }

  hasActiveForTask(taskId: string, leaseScope?: string): boolean {
    const trimmed = String(taskId ?? "").trim();
    if (!trimmed) return false;
    const scopeClause = leaseScope ? "AND lease_scope = ?" : "";
    const params = leaseScope ? [trimmed, leaseScope] : [trimmed];
    const row = this.db.prepare(`
      SELECT id FROM event_execution_leases
      WHERE task_id = ? ${scopeClause} AND status IN ('running', 'retry_wait')
      LIMIT 1
    `).get(...params) as { id: string } | undefined;
    return Boolean(row);
  }

  attachSessionByRunId(runId: string, sessionId: string, now = new Date()): boolean {
    const run = String(runId ?? "").trim();
    const session = String(sessionId ?? "").trim();
    if (!run || !session) return false;
    const nowIso = now.toISOString();
    const result = this.db.prepare(`
      UPDATE event_execution_leases
      SET session_id = ?, updated_at = ?
      WHERE run_id = ? AND status IN ('running', 'retry_wait')
    `).run(session, nowIso, run);
    return Number(result.changes ?? 0) > 0;
  }

  countForTask(taskId: string): number {
    const trimmed = String(taskId ?? "").trim();
    if (!trimmed) return 0;
    const row = this.db.prepare(`
      SELECT COUNT(*) AS count FROM event_execution_leases
      WHERE task_id = ?
    `).get(trimmed) as { count: number } | undefined;
    return Number(row?.count ?? 0);
  }

  summarizeTasks(taskIds: string[]): { total: number; completed: number; failed: number } {
    const ids = [...new Set(taskIds.map((id) => String(id ?? "").trim()).filter(Boolean))];
    if (ids.length === 0) return { total: 0, completed: 0, failed: 0 };
    const placeholders = ids.map(() => "?").join(", ");
    const rows = this.db.prepare(`
      SELECT status, COUNT(*) AS count FROM event_execution_leases
      WHERE task_id IN (${placeholders})
      GROUP BY status
    `).all(...ids) as Array<{ status: EventExecutionLeaseStatus; count: number }>;
    const byStatus = new Map(rows.map((row) => [row.status, Number(row.count ?? 0)]));
    return {
      total: rows.reduce((sum, row) => sum + Number(row.count ?? 0), 0),
      completed: byStatus.get("completed") ?? 0,
      failed: (byStatus.get("failed") ?? 0) + (byStatus.get("aborted") ?? 0)
    };
  }

  listForTask(taskId: string, limit = 50, offset = 0): EventExecutionLease[] {
    const trimmed = String(taskId ?? "").trim();
    if (!trimmed) return [];
    const rows = this.db.prepare(`
      SELECT * FROM event_execution_leases
      WHERE task_id = ?
      ORDER BY started_at DESC
      LIMIT ? OFFSET ?
    `).all(
      trimmed,
      Math.max(1, Math.min(200, Math.round(limit))),
      Math.max(0, Math.round(offset))
    ) as unknown as LeaseRow[];
    return rows.map(rowToLease);
  }

  recoverStaleRunning(now = new Date()): number {
    const rows = this.db.prepare(`
      SELECT * FROM event_execution_leases
      WHERE status IN ('running', 'retry_wait')
    `).all() as unknown as LeaseRow[];
    let recovered = 0;
    const nowMs = now.getTime();
    for (const row of rows) {
      if (row.status === "running") {
        const startedAt = Date.parse(row.started_at);
        if (Number.isFinite(startedAt) && nowMs - startedAt <= row.timeout_ms) continue;
        const lease = this.markTimedOut(row.id, row.run_id, 0, now);
        if (lease) recovered += 1;
        continue;
      }

      // retry_wait leases are only re-attempted by the in-process run loop or by
      // resumeRecoveredLease when the event file still points at this slot. If the
      // process died and the file moved on, the retry is orphaned and — because it
      // stays "active" — permanently blocks hasActiveForChat/Task for shared ids.
      // Abandon it once the scheduled retry is overdue by a full timeout window.
      const retryAt = Date.parse(row.retry_scheduled_at ?? "");
      const overdueRef = Number.isFinite(retryAt) ? retryAt : Date.parse(row.started_at);
      if (!Number.isFinite(overdueRef) || nowMs - overdueRef <= row.timeout_ms) continue;
      const nowIso = now.toISOString();
      const result = this.db.prepare(`
        UPDATE event_execution_leases
        SET status = 'failed',
            finished_at = ?,
            stop_reason = 'retry_abandoned',
            last_error = 'Retry was never picked up before startup recovery.',
            retry_scheduled_at = NULL,
            updated_at = ?
        WHERE id = ? AND status = 'retry_wait'
      `).run(nowIso, nowIso, row.id);
      if (Number(result.changes ?? 0) > 0) recovered += 1;
    }
    return recovered;
  }

  getById(id: string): EventExecutionLease | null {
    const row = this.db.prepare("SELECT * FROM event_execution_leases WHERE id = ?").get(id) as LeaseRow | undefined;
    return row ? rowToLease(row) : null;
  }

  listActiveForSession(sessionId: string): EventExecutionLease[] {
    const rows = this.db.prepare(`
      SELECT * FROM event_execution_leases
      WHERE session_id = ? AND status IN ('running', 'retry_wait')
      ORDER BY started_at ASC
    `).all(sessionId) as unknown as LeaseRow[];
    return rows.map(rowToLease);
  }

  getLatest(leaseScope: string, eventFile: string, chatId: string, triggerSlot: string): EventExecutionLease | null {
    return this.findLatest(leaseScope, eventFile, chatId, triggerSlot);
  }

  private findActive(leaseScope: string, eventFile: string, chatId: string, triggerSlot: string): EventExecutionLease | null {
    const rows = this.db.prepare(`
      SELECT * FROM event_execution_leases
      WHERE lease_scope = ? AND event_file = ? AND chat_id = ? AND trigger_slot = ? AND status IN ('running', 'retry_wait')
      ORDER BY started_at DESC
      LIMIT 1
    `).all(leaseScope, eventFile, chatId, triggerSlot) as unknown as LeaseRow[];
    return rows[0] ? rowToLease(rows[0]) : null;
  }

  private findLatest(leaseScope: string, eventFile: string, chatId: string, triggerSlot: string): EventExecutionLease | null {
    const rows = this.db.prepare(`
      SELECT * FROM event_execution_leases
      WHERE lease_scope = ? AND event_file = ? AND chat_id = ? AND trigger_slot = ?
      ORDER BY started_at DESC
      LIMIT 1
    `).all(leaseScope, eventFile, chatId, triggerSlot) as unknown as LeaseRow[];
    return rows[0] ? rowToLease(rows[0]) : null;
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS event_execution_leases (
        id TEXT PRIMARY KEY,
        lease_scope TEXT NOT NULL DEFAULT 'default',
        event_file TEXT NOT NULL,
        event_type TEXT NOT NULL,
        trigger_slot TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        task_id TEXT,
        run_id TEXT NOT NULL,
        status TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        max_attempts INTEGER NOT NULL,
        timeout_ms INTEGER NOT NULL,
        started_at TEXT NOT NULL,
        last_heartbeat_at TEXT NOT NULL,
        finished_at TEXT,
        stop_reason TEXT,
        last_error TEXT,
        retry_scheduled_at TEXT,
        event_payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_event_leases_event ON event_execution_leases(lease_scope, event_file, chat_id, trigger_slot, status);
      CREATE INDEX IF NOT EXISTS idx_event_leases_session_status ON event_execution_leases(session_id, status);
      CREATE INDEX IF NOT EXISTS idx_event_leases_run ON event_execution_leases(run_id);
      CREATE INDEX IF NOT EXISTS idx_event_leases_status_heartbeat ON event_execution_leases(status, last_heartbeat_at);
    `);
    const columns = this.db.prepare("PRAGMA table_info(event_execution_leases)").all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "lease_scope")) {
      this.db.exec("ALTER TABLE event_execution_leases ADD COLUMN lease_scope TEXT NOT NULL DEFAULT 'default';");
    }
    if (!columns.some((column) => column.name === "task_id")) {
      this.db.exec("ALTER TABLE event_execution_leases ADD COLUMN task_id TEXT;");
    }
    this.db.exec(`
      DROP INDEX IF EXISTS idx_event_leases_one_active;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_event_leases_one_active
        ON event_execution_leases(lease_scope, event_file, chat_id, trigger_slot)
        WHERE status IN ('running', 'retry_wait');
      CREATE INDEX IF NOT EXISTS idx_event_leases_task_started ON event_execution_leases(task_id, started_at DESC);
    `);
  }
}

let sharedLeaseStore: EventExecutionLeaseStore | null = null;

export function getEventExecutionLeaseStore(): EventExecutionLeaseStore {
  sharedLeaseStore ??= new EventExecutionLeaseStore();
  return sharedLeaseStore;
}

export function resetEventExecutionLeaseStoreForTests(): void {
  sharedLeaseStore?.close();
  sharedLeaseStore = null;
}

export function isActiveEventLeaseStatus(status: string): boolean {
  return (ACTIVE_STATUSES as readonly string[]).includes(status);
}
