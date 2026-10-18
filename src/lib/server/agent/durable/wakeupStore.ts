import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import {
  type AttemptProgress,
  type DurableWakeup,
  type WakeupReason,
  type WakeupStatus
} from "./types.js";

/**
 * Scheduling truth for Durable Execution.
 *
 * A wakeup is written in the same transaction as the state change that made the
 * execution runnable again, so a crash can never commit "queued" without the
 * row that will pick it up. The row carries the execution version it was
 * written for: a later version makes it stale, and consuming a stale row is a
 * no-op rather than a second attempt.
 */

export const DEFAULT_WAKEUP_MAX_ATTEMPTS = 5;
const WAKEUP_BACKOFF_BASE_MS = 30_000;
const WAKEUP_BACKOFF_CAP_MS = 30 * 60_000;

export interface WakeupRow {
  id: string;
  execution_id: string;
  expected_version: number;
  reason: WakeupReason;
  run_at: string;
  status: WakeupStatus;
  attempts: number;
  max_attempts: number;
  claimed_by: string | null;
  claimed_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface AttemptProgressRow {
  attempt_id: string;
  seq: number;
  tool_call_id: string;
  tool_id: string;
  status: "completed" | "failed";
  summary: string | null;
  created_at: string;
}

export interface EnqueueWakeupInput {
  executionId: string;
  expectedVersion: number;
  reason: WakeupReason;
  runAt?: Date;
}

export function wakeupRowToRecord(row: WakeupRow): DurableWakeup {
  return {
    id: row.id,
    executionId: row.execution_id,
    expectedVersion: Number(row.expected_version),
    reason: row.reason,
    runAt: row.run_at,
    status: row.status,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    ...(row.claimed_by ? { claimedBy: row.claimed_by } : {}),
    ...(row.claimed_at ? { claimedAt: row.claimed_at } : {}),
    ...(row.last_error ? { lastError: row.last_error } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function attemptProgressRowToRecord(row: AttemptProgressRow): AttemptProgress {
  return {
    attemptId: row.attempt_id,
    seq: Number(row.seq),
    toolCallId: row.tool_call_id,
    toolId: row.tool_id,
    status: row.status,
    ...(row.summary ? { summary: row.summary } : {}),
    createdAt: row.created_at
  };
}

export function ensureWakeupSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS durable_wakeups (
      id TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL REFERENCES durable_executions(id) ON DELETE CASCADE,
      expected_version INTEGER NOT NULL,
      reason TEXT NOT NULL CHECK (reason IN ('advance','verify','capacity','resume','control','retry')),
      run_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending','claimed','done','discarded','failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      claimed_by TEXT,
      claimed_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (execution_id, expected_version)
    );
    CREATE INDEX IF NOT EXISTS idx_durable_wakeups_due ON durable_wakeups(status, run_at);
    CREATE INDEX IF NOT EXISTS idx_durable_wakeups_execution ON durable_wakeups(execution_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_durable_wakeups_claim ON durable_wakeups(status, execution_id);
    CREATE TABLE IF NOT EXISTS durable_runtime_instances (
      id TEXT PRIMARY KEY,
      pid INTEGER NOT NULL,
      started_at TEXT NOT NULL,
      lease_until TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS durable_attempt_progress (
      attempt_id TEXT NOT NULL REFERENCES durable_attempts(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      tool_call_id TEXT NOT NULL,
      tool_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('completed','failed')),
      summary TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (attempt_id, seq),
      UNIQUE (attempt_id, tool_call_id)
    );
    CREATE INDEX IF NOT EXISTS idx_durable_attempt_progress_attempt ON durable_attempt_progress(attempt_id, seq);
  `);
}

/**
 * Must be called with an open `BEGIN IMMEDIATE` transaction; the caller commits
 * the state change and the wakeup together.
 */
export function enqueueWakeupInTransaction(
  db: DatabaseSync,
  input: EnqueueWakeupInput,
  now = new Date()
): boolean {
  const timestamp = now.toISOString();
  const runAt = (input.runAt ?? now).toISOString();
  const result = db.prepare(`
    INSERT INTO durable_wakeups
      (id, execution_id, expected_version, reason, run_at, status, attempts, max_attempts, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)
    ON CONFLICT(execution_id, expected_version) DO NOTHING
  `).run(
    `wakeup-${randomUUID()}`,
    input.executionId,
    input.expectedVersion,
    input.reason,
    runAt,
    DEFAULT_WAKEUP_MAX_ATTEMPTS,
    timestamp,
    timestamp
  );
  // A newer version supersedes every older pending row: they can never make
  // progress, and leaving them queued would keep the execution's pending count
  // growing with each rejected trigger.
  db.prepare(`
    UPDATE durable_wakeups SET status = 'discarded', updated_at = ?
    WHERE execution_id = ? AND expected_version <> ? AND status = 'pending'
  `).run(timestamp, input.executionId, input.expectedVersion);
  return Number(result.changes ?? 0) > 0;
}

/** Supersede pending wakeups when an execution terminal state or a new attempt wins. */
export function discardPendingWakeupsInTransaction(
  db: DatabaseSync,
  executionId: string,
  reason: string,
  now = new Date()
): number {
  const result = db.prepare(`
    UPDATE durable_wakeups SET status = 'discarded', last_error = ?, updated_at = ?
    WHERE execution_id = ? AND status = 'pending'
  `).run(reason, now.toISOString(), executionId);
  return Number(result.changes ?? 0);
}

/**
 * Claim due wakeups in one immediate transaction, FIFO by scheduled time.
 * Concurrent claimers on the same database serialise: a later claimer updates
 * zero rows because the first one already moved the row to `claimed`.
 * An execution with a claimed row is skipped so two workers never run one plan
 * at the same time.
 */
export function claimDueWakeups(
  db: DatabaseSync,
  ownerId: string,
  limit: number,
  now = new Date()
): DurableWakeup[] {
  const timestamp = now.toISOString();
  const claimed: DurableWakeup[] = [];
  db.exec("BEGIN IMMEDIATE");
  try {
    const rows = db.prepare(`
      SELECT * FROM durable_wakeups w
      WHERE w.status = 'pending' AND w.run_at <= ?
        AND NOT EXISTS (
          SELECT 1 FROM durable_wakeups c
          WHERE c.execution_id = w.execution_id AND c.status = 'claimed'
        )
      ORDER BY w.run_at ASC, w.created_at ASC, w.id ASC
      LIMIT ?
    `).all(timestamp, Math.max(1, Math.round(limit))) as unknown as WakeupRow[];
    for (const row of rows) {
      const result = db.prepare(`
        UPDATE durable_wakeups
        SET status = 'claimed', claimed_by = ?, claimed_at = ?, attempts = attempts + 1, updated_at = ?
        WHERE id = ? AND status = 'pending'
      `).run(ownerId, timestamp, timestamp, row.id);
      if (Number(result.changes ?? 0) > 0) {
        claimed.push(wakeupRowToRecord({
          ...row,
          status: "claimed",
          claimed_by: ownerId,
          claimed_at: timestamp,
          attempts: Number(row.attempts) + 1,
          updated_at: timestamp
        }));
      }
    }
    db.exec("COMMIT");
    return claimed;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function settleWakeup(
  db: DatabaseSync,
  wakeupId: string,
  outcome: { status: "done" | "discarded" | "failed"; error?: string },
  now = new Date()
): void {
  db.prepare(`
    UPDATE durable_wakeups SET status = ?, last_error = ?, updated_at = ?
    WHERE id = ? AND status = 'claimed'
  `).run(outcome.status, outcome.error ?? null, now.toISOString(), wakeupId);
}

/**
 * Only process-level failures are retried. Business failures are settled by the
 * runtime as a terminal attempt state; replaying them here would duplicate
 * external side effects.
 */
export function backoffWakeup(
  db: DatabaseSync,
  wakeup: DurableWakeup,
  error: string,
  now = new Date(),
  random: () => number = Math.random
): { status: "pending" | "failed"; runAt: string } {
  if (wakeup.attempts >= wakeup.maxAttempts) {
    settleWakeup(db, wakeup.id, { status: "failed", error }, now);
    return { status: "failed", runAt: now.toISOString() };
  }
  const exponent = Math.max(0, wakeup.attempts - 1);
  const delay = Math.min(WAKEUP_BACKOFF_BASE_MS * 2 ** exponent, WAKEUP_BACKOFF_CAP_MS);
  const jitter = 0.8 + random() * 0.4;
  const runAt = new Date(now.getTime() + Math.round(delay * jitter)).toISOString();
  db.prepare(`
    UPDATE durable_wakeups SET status = 'pending', run_at = ?, last_error = ?, updated_at = ?
    WHERE id = ? AND status = 'claimed'
  `).run(runAt, error, now.toISOString(), wakeup.id);
  return { status: "pending", runAt };
}

/** Requeue old foreign claims, preserving live execution leases and this worker's in-flight work. */
export function recoverStaleClaims(db: DatabaseSync, leaseMs: number, now = new Date(), activeOwnerId?: string): number {
  const cutoff = new Date(now.getTime() - Math.max(1000, Math.round(leaseMs))).toISOString();
  const result = db.prepare(`
    UPDATE durable_wakeups
    SET status = 'pending', claimed_by = NULL, claimed_at = NULL, updated_at = ?
    WHERE status = 'claimed' AND (claimed_at IS NULL OR claimed_at <= ?)
      AND (claimed_by IS NULL OR claimed_by <> ?)
      AND NOT EXISTS (
        SELECT 1 FROM durable_executions e
        WHERE e.id = durable_wakeups.execution_id AND e.status IN ('running','verifying')
          AND e.lease_owner_id IS NOT NULL AND e.lease_expires_at > ?
      )
  `).run(now.toISOString(), cutoff, activeOwnerId ?? "", now.toISOString());
  return Number(result.changes ?? 0);
}

/** Retention: finished rows age out, failed rows stay visible in diagnostics. */
export function pruneWakeups(db: DatabaseSync, retentionDays: number, now = new Date()): number {
  if (retentionDays <= 0) return 0;
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000).toISOString();
  const result = db.prepare(`
    DELETE FROM durable_wakeups
    WHERE status IN ('done','discarded') AND updated_at <= ?
  `).run(cutoff);
  return Number(result.changes ?? 0);
}

export function listWakeups(db: DatabaseSync, executionId: string, limit = 20): DurableWakeup[] {
  const rows = db.prepare(`
    SELECT * FROM durable_wakeups WHERE execution_id = ?
    ORDER BY created_at DESC, id DESC LIMIT ?
  `).all(executionId, Math.max(1, Math.round(limit))) as unknown as WakeupRow[];
  return rows.map(wakeupRowToRecord);
}

export function pendingWakeupsForExecution(db: DatabaseSync, executionId: string): DurableWakeup[] {
  const rows = db.prepare(`
    SELECT * FROM durable_wakeups
    WHERE execution_id = ? AND status IN ('pending','claimed')
    ORDER BY run_at ASC
  `).all(executionId) as unknown as WakeupRow[];
  return rows.map(wakeupRowToRecord);
}

/** Due pending rows, used only by the legacy file mirror. */
export function duePendingWakeups(db: DatabaseSync, now = new Date(), limit = 200): DurableWakeup[] {
  const rows = db.prepare(`
    SELECT * FROM durable_wakeups
    WHERE status = 'pending' AND run_at <= ?
    ORDER BY run_at ASC, created_at ASC LIMIT ?
  `).all(now.toISOString(), Math.max(1, Math.round(limit))) as unknown as WakeupRow[];
  return rows.map(wakeupRowToRecord);
}

/** Single-writer assertion: another live executor on the same store refuses this start. */
export function claimRuntimeInstance(
  db: DatabaseSync,
  input: { ownerId: string; pid: number; ttlMs: number; now?: Date }
): { ok: true } | { ok: false; holder: { id: string; pid: number; startedAt: string } } {
  const now = input.now ?? new Date();
  const timestamp = now.toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM durable_runtime_instances WHERE lease_until <= ?").run(timestamp);
    const holder = db.prepare(`
      SELECT id, pid, started_at FROM durable_runtime_instances WHERE id <> ? LIMIT 1
    `).get(input.ownerId) as { id: string; pid: number; started_at: string } | undefined;
    if (holder) {
      db.exec("COMMIT");
      return { ok: false, holder: { id: holder.id, pid: Number(holder.pid), startedAt: holder.started_at } };
    }
    const leaseUntil = new Date(now.getTime() + Math.max(5000, Math.round(input.ttlMs))).toISOString();
    db.prepare(`
      INSERT INTO durable_runtime_instances (id, pid, started_at, lease_until) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET pid = excluded.pid, lease_until = excluded.lease_until
    `).run(input.ownerId, input.pid, timestamp, leaseUntil);
    db.exec("COMMIT");
    return { ok: true };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function refreshRuntimeInstance(
  db: DatabaseSync,
  ownerId: string,
  ttlMs: number,
  now = new Date()
): boolean {
  const leaseUntil = new Date(now.getTime() + Math.max(5000, Math.round(ttlMs))).toISOString();
  const result = db.prepare("UPDATE durable_runtime_instances SET lease_until = ? WHERE id = ?").run(leaseUntil, ownerId);
  return Number(result.changes ?? 0) > 0;
}

export function releaseRuntimeInstance(db: DatabaseSync, ownerId: string): void {
  db.prepare("DELETE FROM durable_runtime_instances WHERE id = ?").run(ownerId);
}

/**
 * Append one tool boundary. Idempotent per (attempt, tool call): a duplicate
 * runner event updates the existing row instead of inventing a new sequence.
 */
export function recordAttemptProgress(
  db: DatabaseSync,
  input: {
    attemptId: string;
    toolCallId: string;
    toolId: string;
    status: "completed" | "failed";
    summary?: string;
  },
  now = new Date()
): void {
  db.prepare(`
    INSERT INTO durable_attempt_progress (attempt_id, seq, tool_call_id, tool_id, status, summary, created_at)
    VALUES (
      ?,
      (SELECT COALESCE(MAX(seq), 0) + 1 FROM durable_attempt_progress WHERE attempt_id = ?),
      ?, ?, ?, ?, ?
    )
    ON CONFLICT(attempt_id, tool_call_id) DO UPDATE SET status = excluded.status, summary = excluded.summary
  `).run(
    input.attemptId,
    input.attemptId,
    input.toolCallId,
    input.toolId,
    input.status,
    input.summary?.slice(0, 800) ?? null,
    now.toISOString()
  );
}

export function attemptProgress(db: DatabaseSync, attemptId: string): AttemptProgress[] {
  const rows = db.prepare("SELECT * FROM durable_attempt_progress WHERE attempt_id = ? ORDER BY seq ASC")
    .all(attemptId) as unknown as AttemptProgressRow[];
  return rows.map(attemptProgressRowToRecord);
}

/** Latest progress rows for the execution's most recent attempt. */
export function latestAttemptProgress(db: DatabaseSync, executionId: string): AttemptProgress[] {
  const attempt = db.prepare(`
    SELECT id FROM durable_attempts WHERE execution_id = ? ORDER BY started_at DESC LIMIT 1
  `).get(executionId) as { id: string } | undefined;
  return attempt ? attemptProgress(db, attempt.id) : [];
}
