import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { sourceKeyFor, type ObservedSource } from "./followUpEvidence.js";
import { DEFAULT_KANBAN_TOKEN_BUDGET } from "./kanbanStore.js";
import {
  DurableExecutionConflictError,
  DurableExecutionNotFoundError,
  type CreateFollowUpTaskInput,
  type DurableExecutionStatus,
  type FollowUpConfig,
  type FollowUpDecision,
  type FollowUpDecisionOutcome,
  type FollowUpDelivery,
  type FollowUpDeliveryStatus,
  type FollowUpLifecycle,
  type FollowUpNotifyTarget,
  type FollowUpObservation,
  type FollowUpSourceRef,
  type KanbanTaskConfig,
  type MissingEvidencePolicy
} from "./types.js";
import { enqueueWakeupInTransaction } from "./wakeupStore.js";

function id(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 12)}`;
}

function nowIso(now?: Date): string {
  return (now ?? new Date()).toISOString();
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function deriveFollowUpLifecycle(status: DurableExecutionStatus, closeReason?: string): FollowUpLifecycle {
  if (status === "completed") return "completed";
  if (status === "paused") return "paused";
  if (status === "cancelled") return closeReason === "expired" ? "expired" : "cancelled";
  return "active";
}

interface FollowUpRow {
  execution_id: string;
  owner_id: string;
  request_id: string | null;
  request_payload_hash: string | null;
  authorization_revision: number;
  authorized_at: string;
  allowed_help_json: string;
  missing_evidence_policy: MissingEvidencePolicy;
  timezone: string;
  check_interval_ms: number;
  next_check_at: string | null;
  fixed_checkins_json: string;
  expires_at: string;
  notify_target_json: string;
  created_at: string;
  updated_at: string;
}

interface SourceRow {
  execution_id: string;
  kind: FollowUpSourceRef["kind"];
  source_key: string;
  authorization_revision: number;
  revoked_at: string | null;
}

interface ObservationRow {
  id: string;
  execution_id: string;
  trigger_slot: string;
  kind: FollowUpSourceRef["kind"];
  source_key: string;
  status: FollowUpObservation["status"];
  content_hash: string | null;
  error_code: string | null;
  read_at: string;
}

interface DecisionRow {
  id: string;
  execution_id: string;
  authorization_revision: number;
  trigger_slot: string;
  decision: FollowUpDecisionOutcome;
  reason_code: string;
  evidence_fingerprint: string;
  notify_text: string | null;
  artifact_refs_json: string;
  created_at: string;
}

interface DeliveryRow {
  id: string;
  delivery_key: string;
  execution_id: string;
  decision_id: string;
  target_json: string;
  status: FollowUpDeliveryStatus;
  notify_text: string;
  not_before: string | null;
  expires_at: string | null;
  external_receipt: string | null;
  created_at: string;
  updated_at: string;
}

export function ensureFollowUpSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS durable_follow_ups (
      execution_id TEXT PRIMARY KEY REFERENCES durable_executions(id) ON DELETE CASCADE,
      owner_id TEXT NOT NULL,
      request_id TEXT,
      request_payload_hash TEXT,
      authorization_revision INTEGER NOT NULL DEFAULT 1,
      authorized_at TEXT NOT NULL,
      allowed_help_json TEXT NOT NULL DEFAULT '[]',
      missing_evidence_policy TEXT NOT NULL DEFAULT 'wait' CHECK (missing_evidence_policy IN ('wait','ask_at_check','notify_unavailable')),
      timezone TEXT NOT NULL,
      check_interval_ms INTEGER NOT NULL,
      next_check_at TEXT,
      fixed_checkins_json TEXT NOT NULL DEFAULT '[]',
      expires_at TEXT NOT NULL,
      notify_target_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_durable_follow_ups_request
      ON durable_follow_ups(owner_id, request_id)
      WHERE request_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS durable_follow_up_sources (
      execution_id TEXT NOT NULL REFERENCES durable_executions(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('plan','execution','project_file')),
      source_key TEXT NOT NULL,
      authorization_revision INTEGER NOT NULL,
      revoked_at TEXT,
      PRIMARY KEY (execution_id, kind, source_key)
    );
    CREATE TABLE IF NOT EXISTS durable_follow_up_observations (
      id TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL REFERENCES durable_executions(id) ON DELETE CASCADE,
      trigger_slot TEXT NOT NULL,
      kind TEXT NOT NULL,
      source_key TEXT NOT NULL,
      status TEXT NOT NULL,
      content_hash TEXT,
      error_code TEXT,
      read_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_durable_follow_up_observations_lookup
      ON durable_follow_up_observations(execution_id, kind, source_key, read_at);
    CREATE TABLE IF NOT EXISTS durable_follow_up_decisions (
      id TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL REFERENCES durable_executions(id) ON DELETE CASCADE,
      authorization_revision INTEGER NOT NULL,
      trigger_slot TEXT NOT NULL,
      decision TEXT NOT NULL CHECK (decision IN ('silent','notify','analysis_failed')),
      reason_code TEXT NOT NULL,
      evidence_fingerprint TEXT NOT NULL,
      notify_text TEXT,
      artifact_refs_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      UNIQUE (execution_id, authorization_revision, trigger_slot)
    );
    CREATE INDEX IF NOT EXISTS idx_durable_follow_up_decisions_execution
      ON durable_follow_up_decisions(execution_id, created_at);
    CREATE TABLE IF NOT EXISTS durable_follow_up_deliveries (
      id TEXT PRIMARY KEY,
      delivery_key TEXT NOT NULL UNIQUE,
      execution_id TEXT NOT NULL REFERENCES durable_executions(id) ON DELETE CASCADE,
      decision_id TEXT NOT NULL,
      target_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('reserved','sending','sent','unknown','failed','cancelled')),
      notify_text TEXT NOT NULL,
      not_before TEXT,
      expires_at TEXT,
      external_receipt TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_durable_follow_up_deliveries_execution
      ON durable_follow_up_deliveries(execution_id, created_at);
  `);
}

function sourceRowToRef(row: SourceRow): FollowUpSourceRef {
  if (row.kind === "project_file") return { kind: "project_file", relativePath: row.source_key };
  if (row.kind === "plan") return { kind: "plan", planId: row.source_key };
  return { kind: "execution", executionId: row.source_key };
}

function computeCreatePayloadHash(input: CreateFollowUpTaskInput): string {
  return createHash("sha256").update(JSON.stringify({
    ownerId: text(input.ownerId),
    botId: text(input.botId),
    agentId: text(input.agentId),
    title: text(input.title),
    goal: text(input.goal),
    projectId: text(input.projectId),
    workDir: text(input.workDir),
    sources: input.sources.map(s => `${s.kind}:${sourceKeyFor(s)}`).sort(),
    expiresAt: input.expiresAt.toISOString(),
    notifyTarget: input.notifyTarget
  })).digest("hex");
}

export class FollowUpStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly notify: () => void,
    private readonly getKanbanTask: (executionId: string) => KanbanTaskConfig | null
  ) {}

  getFollowUp(executionId: string): FollowUpConfig | null {
    const row = this.db.prepare("SELECT * FROM durable_follow_ups WHERE execution_id = ?").get(text(executionId)) as FollowUpRow | undefined;
    if (!row) return null;
    const sources = (this.db.prepare(
      "SELECT * FROM durable_follow_up_sources WHERE execution_id = ? AND revoked_at IS NULL ORDER BY kind, source_key"
    ).all(row.execution_id) as unknown as SourceRow[]).map(sourceRowToRef);
    return {
      executionId: row.execution_id,
      ownerId: row.owner_id,
      ...(row.request_id ? { requestId: row.request_id } : {}),
      authorizationRevision: Number(row.authorization_revision),
      authorizedAt: row.authorized_at,
      allowedHelp: parseJson<string[]>(row.allowed_help_json, []),
      missingEvidencePolicy: row.missing_evidence_policy,
      timezone: row.timezone,
      checkIntervalMs: Number(row.check_interval_ms),
      ...(row.next_check_at ? { nextCheckAt: row.next_check_at } : {}),
      fixedCheckins: parseJson<string[]>(row.fixed_checkins_json, []),
      expiresAt: row.expires_at,
      notifyTarget: parseJson<FollowUpNotifyTarget>(row.notify_target_json, { kind: "desktop" }),
      sources,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  /**
   * Creates a follow-up Kanban task + follow-up config + authorized sources +
   * initial `verify` wakeup in one transaction. Idempotent by (ownerId, requestId).
   */
  createFollowUp(input: CreateFollowUpTaskInput): {
    task: KanbanTaskConfig;
    followUp: FollowUpConfig;
    created: boolean;
  } {
    const ownerId = text(input.ownerId);
    const botId = text(input.botId);
    const agentId = text(input.agentId);
    const title = text(input.title);
    const goal = text(input.goal) || title;
    const timezone = text(input.timezone) || "UTC";
    if (!ownerId || !botId || !agentId || !title) {
      throw new Error("ownerId, botId, agentId and title are required.");
    }
    if (!Array.isArray(input.sources) || input.sources.length === 0) {
      throw new Error("A follow-up task requires at least one authorized source.");
    }
    if (!Number.isFinite(input.checkIntervalMs) || input.checkIntervalMs < 1_000) {
      throw new Error("checkIntervalMs must be at least 1000ms.");
    }
    const now = input.now ?? new Date();
    if (input.expiresAt.getTime() <= now.getTime()) {
      throw new Error("expiresAt must be in the future.");
    }

    const requestId = text(input.requestId) || null;
    const payloadHash = requestId ? computeCreatePayloadHash(input) : null;
    const createdAt = nowIso(now);
    const nextCheckAt = input.nextCheckAt.getTime() < input.expiresAt.getTime()
      ? input.nextCheckAt
      : input.expiresAt;
    const nextCheckIso = nextCheckAt.toISOString();
    const expiresIso = input.expiresAt.toISOString();

    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (requestId) {
        const existing = this.db.prepare(
          "SELECT execution_id, request_payload_hash FROM durable_follow_ups WHERE owner_id = ? AND request_id = ?"
        ).get(ownerId, requestId) as { execution_id: string; request_payload_hash: string | null } | undefined;
        if (existing) {
          if (existing.request_payload_hash && existing.request_payload_hash !== payloadHash) {
            throw new DurableExecutionConflictError("follow-up-request", 1, 2);
          }
          const task = this.getKanbanTask(existing.execution_id)!;
          const followUp = this.getFollowUp(existing.execution_id)!;
          this.db.exec("COMMIT");
          return { task, followUp, created: false };
        }
      }

      const executionId = id("followup");
      const sequenceRow = this.db.prepare(
        "SELECT COALESCE(MAX(handle_sequence), 0) + 1 AS next FROM durable_executions WHERE owner_id = ?"
      ).get(ownerId) as { next: number };
      const handleSequence = Number(sequenceRow.next);

      this.db.prepare(`
        INSERT INTO durable_executions (
          id, short_handle, handle_sequence, owner_id, bot_id, source_channel, source_chat_id,
          source_ui_session_id, source_project_id, goal, constraints_json, status, version,
          current_plan_version, lease_owner_id, lease_expires_at, budget_token_limit,
          budget_attempt_limit, budget_lifetime_days, tokens_used, attempts_used, created_at,
          started_at, updated_at, terminal_at, waiting_kind, waiting_reason, next_run_at,
          last_error, activation_path, activation_reason
        ) VALUES (?, ?, ?, ?, ?, 'web', ?, ?, ?, ?, '[]', 'queued', 1,
          1, NULL, NULL, ?, NULL, NULL, 0, 0, ?, ?, ?, NULL, NULL, NULL, ?, NULL, 'forced', 'follow-up-task')
      `).run(
        executionId, `#${handleSequence}`, handleSequence, ownerId, botId,
        `kanban:${executionId}`, text(input.sourceUiSessionId) || null, text(input.projectId) || null, goal,
        input.budgetTokenLimit ?? DEFAULT_KANBAN_TOKEN_BUDGET,
        createdAt, createdAt, createdAt, nextCheckIso
      );

      this.db.prepare(
        "INSERT INTO durable_plan_versions (execution_id, plan_version, revision_reason, author, created_at) VALUES (?, 1, 'follow-up task', 'user', ?)"
      ).run(executionId, createdAt);

      const conditions = (input.completionConditions ?? []).filter(c => text(c.description));
      for (const condition of conditions) {
        this.db.prepare(`
          INSERT INTO durable_acceptance_criteria (
            id, execution_id, plan_version, description, required, checker_type, checker_key,
            author, result, evidence_ref_id, user_edited, created_at, updated_at
          ) VALUES (?, ?, 1, ?, ?, ?, ?, 'user', 'unproven', NULL, 0, ?, ?)
        `).run(
          id("crit"), executionId, text(condition.description),
          condition.required === false ? 0 : 1,
          condition.checkerType ?? "subjective",
          condition.checkerKey ?? null,
          createdAt, createdAt
        );
      }

      this.db.prepare("INSERT INTO durable_plan_origins VALUES (?, ?)").run(executionId, agentId);
      this.db.prepare("INSERT INTO durable_plan_meta (execution_id, title, summary, updated_at) VALUES (?, ?, '', ?)")
        .run(executionId, title, createdAt);

      this.db.prepare(`
        INSERT INTO durable_kanban_tasks (
          execution_id, form, title, goal, coordinator_agent_id, member_snapshot, project_id, work_dir,
          completion_source, budget_token_limit, budget_handoff_limit, approval_policy, human_acceptance,
          auto_start, current_agent_id, mode, close_reason, created_at, updated_at
        ) VALUES (?, 'single', ?, ?, NULL, NULL, ?, ?, ?, ?, 1, 'deny', 1, 1, ?, 'follow_up', NULL, ?, ?)
      `).run(
        executionId, title, goal,
        text(input.projectId) || null,
        text(input.workDir) || null,
        conditions.length > 0 ? "user" : "pending",
        input.budgetTokenLimit ?? DEFAULT_KANBAN_TOKEN_BUDGET,
        agentId, createdAt, createdAt
      );

      this.db.prepare(`
        INSERT INTO durable_follow_ups (
          execution_id, owner_id, request_id, request_payload_hash, authorization_revision,
          authorized_at, allowed_help_json, missing_evidence_policy, timezone, check_interval_ms,
          next_check_at, fixed_checkins_json, expires_at, notify_target_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        executionId, ownerId, requestId, payloadHash,
        createdAt,
        JSON.stringify(input.allowedHelp ?? ["gap_checklist", "draft"]),
        input.missingEvidencePolicy ?? "wait",
        timezone,
        Math.floor(input.checkIntervalMs),
        nextCheckIso,
        JSON.stringify(input.fixedCheckins ?? []),
        expiresIso,
        JSON.stringify(input.notifyTarget),
        createdAt, createdAt
      );

      for (const source of input.sources) {
        const key = sourceKeyFor(source);
        if (!key) continue;
        this.db.prepare(`
          INSERT OR IGNORE INTO durable_follow_up_sources (
            execution_id, kind, source_key, authorization_revision, revoked_at
          ) VALUES (?, ?, ?, 1, NULL)
        `).run(executionId, source.kind, key);
      }

      enqueueWakeupInTransaction(this.db, {
        executionId,
        expectedVersion: 1,
        reason: "verify",
        runAt: nextCheckAt
      }, now);

      const task = this.getKanbanTask(executionId)!;
      const followUp = this.getFollowUp(executionId)!;
      this.db.exec("COMMIT");
      this.notify();
      return { task, followUp, created: true };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getLatestObservationsMap(executionId: string): Map<string, FollowUpObservation> {
    const rows = this.db.prepare(`
      SELECT * FROM durable_follow_up_observations
      WHERE execution_id = ?
      ORDER BY read_at ASC, rowid ASC
    `).all(text(executionId)) as unknown as ObservationRow[];
    const map = new Map<string, FollowUpObservation>();
    for (const row of rows) {
      map.set(`${row.kind}:${row.source_key}`, {
        id: row.id,
        executionId: row.execution_id,
        triggerSlot: row.trigger_slot,
        kind: row.kind,
        sourceKey: row.source_key,
        status: row.status,
        ...(row.content_hash ? { contentHash: row.content_hash } : {}),
        ...(row.error_code ? { errorCode: row.error_code } : {}),
        readAt: row.read_at
      });
    }
    return map;
  }

  recordObservations(executionId: string, triggerSlot: string, observations: ObservedSource[]): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const obs of observations) {
        this.db.prepare(`
          INSERT INTO durable_follow_up_observations (
            id, execution_id, trigger_slot, kind, source_key, status, content_hash, error_code, read_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id("obs"), executionId, triggerSlot, obs.kind, obs.sourceKey,
          obs.status, obs.contentHash ?? null, obs.errorCode ?? null, obs.readAt
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getLastDecision(executionId: string, authorizationRevision?: number): FollowUpDecision | null {
    const row = (authorizationRevision !== undefined
      ? this.db.prepare(
        "SELECT * FROM durable_follow_up_decisions WHERE execution_id = ? AND authorization_revision = ? ORDER BY created_at DESC, rowid DESC LIMIT 1"
      ).get(text(executionId), authorizationRevision)
      : this.db.prepare(
        "SELECT * FROM durable_follow_up_decisions WHERE execution_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1"
      ).get(text(executionId))) as DecisionRow | undefined;
    return row ? decisionRowToModel(row) : null;
  }

  listDecisions(executionId: string): FollowUpDecision[] {
    const rows = this.db.prepare(
      "SELECT * FROM durable_follow_up_decisions WHERE execution_id = ? ORDER BY created_at ASC, rowid ASC"
    ).all(text(executionId)) as unknown as DecisionRow[];
    return rows.map(decisionRowToModel);
  }

  listDeliveries(executionId: string): FollowUpDelivery[] {
    const rows = this.db.prepare(
      "SELECT * FROM durable_follow_up_deliveries WHERE execution_id = ? ORDER BY created_at ASC, rowid ASC"
    ).all(text(executionId)) as unknown as DeliveryRow[];
    return rows.map(deliveryRowToModel);
  }

  /**
   * Commits a short-circuited `silent` check (no model attempt claimed) and
   * schedules the next `verify` wakeup in one transaction.
   */
  commitShortCircuitSilent(input: {
    executionId: string;
    expectedVersion: number;
    authorizationRevision: number;
    triggerSlot: string;
    reasonCode: string;
    evidenceFingerprint: string;
    nextCheckAt: Date;
    now?: Date;
  }): { committed: boolean; decision?: FollowUpDecision } {
    const now = input.now ?? new Date();
    const ts = nowIso(now);
    const nextIso = input.nextCheckAt.toISOString();

    this.db.exec("BEGIN IMMEDIATE");
    try {
      const exec = this.db.prepare("SELECT status, version FROM durable_executions WHERE id = ?").get(input.executionId) as
        | { status: string; version: number } | undefined;
      const fu = this.db.prepare("SELECT authorization_revision FROM durable_follow_ups WHERE execution_id = ?").get(input.executionId) as
        | { authorization_revision: number } | undefined;
      if (!exec || !fu || exec.status !== "queued" || Number(exec.version) !== input.expectedVersion || Number(fu.authorization_revision) !== input.authorizationRevision) {
        this.db.exec("COMMIT");
        return { committed: false };
      }

      const decisionId = id("dec");
      this.db.prepare(`
        INSERT OR IGNORE INTO durable_follow_up_decisions (
          id, execution_id, authorization_revision, trigger_slot, decision,
          reason_code, evidence_fingerprint, notify_text, artifact_refs_json, created_at
        ) VALUES (?, ?, ?, ?, 'silent', ?, ?, NULL, '[]', ?)
      `).run(decisionId, input.executionId, input.authorizationRevision, input.triggerSlot, input.reasonCode, input.evidenceFingerprint, ts);

      const nextVersion = Number(exec.version) + 1;
      this.db.prepare(
        "UPDATE durable_executions SET version = ?, next_run_at = ?, updated_at = ? WHERE id = ? AND version = ?"
      ).run(nextVersion, nextIso, ts, input.executionId, exec.version);
      this.db.prepare(
        "UPDATE durable_follow_ups SET next_check_at = ?, updated_at = ? WHERE execution_id = ?"
      ).run(nextIso, ts, input.executionId);
      enqueueWakeupInTransaction(this.db, {
        executionId: input.executionId,
        expectedVersion: nextVersion,
        reason: "verify",
        runAt: input.nextCheckAt
      }, now);

      const decision = this.getLastDecision(input.executionId, input.authorizationRevision)!;
      this.db.exec("COMMIT");
      this.notify();
      return { committed: true, decision };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /**
   * Records a decision (and optional delivery intent) after a model check round
   * finishes, bound to the authorization revision.
   */
  recordCheckOutcome(input: {
    executionId: string;
    authorizationRevision: number;
    triggerSlot: string;
    decision: FollowUpDecisionOutcome;
    reasonCode: string;
    evidenceFingerprint: string;
    notifyText?: string;
    artifactRefs?: string[];
    notifyTarget?: FollowUpNotifyTarget;
    nextCheckAt: Date;
    expiresAt: string;
    now?: Date;
  }): { decision: FollowUpDecision; delivery?: FollowUpDelivery } {
    const now = input.now ?? new Date();
    const ts = nowIso(now);
    const nextIso = input.nextCheckAt.toISOString();

    this.db.exec("BEGIN IMMEDIATE");
    try {
      const decisionId = id("dec");
      this.db.prepare(`
        INSERT OR IGNORE INTO durable_follow_up_decisions (
          id, execution_id, authorization_revision, trigger_slot, decision,
          reason_code, evidence_fingerprint, notify_text, artifact_refs_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        decisionId, input.executionId, input.authorizationRevision, input.triggerSlot,
        input.decision, input.reasonCode, input.evidenceFingerprint,
        input.notifyText ?? null, JSON.stringify(input.artifactRefs ?? []), ts
      );

      const row = this.db.prepare(
        "SELECT * FROM durable_follow_up_decisions WHERE execution_id = ? AND authorization_revision = ? AND trigger_slot = ?"
      ).get(input.executionId, input.authorizationRevision, input.triggerSlot) as unknown as DecisionRow;

      let delivery: FollowUpDelivery | undefined;
      if (input.decision === "notify" && input.notifyText && input.notifyTarget) {
        const deliveryKey = `follow-up:${input.executionId}:rev${input.authorizationRevision}:${input.triggerSlot}`;
        const existingDel = this.db.prepare(
          "SELECT * FROM durable_follow_up_deliveries WHERE delivery_key = ?"
        ).get(deliveryKey) as DeliveryRow | undefined;
        if (existingDel) {
          delivery = deliveryRowToModel(existingDel);
        } else {
          const delId = id("del");
          this.db.prepare(`
            INSERT INTO durable_follow_up_deliveries (
              id, delivery_key, execution_id, decision_id, target_json, status,
              notify_text, not_before, expires_at, external_receipt, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 'reserved', ?, NULL, ?, NULL, ?, ?)
          `).run(
            delId, deliveryKey, input.executionId, row.id,
            JSON.stringify(input.notifyTarget), input.notifyText,
            input.expiresAt, ts, ts
          );
          const inserted = this.db.prepare(
            "SELECT * FROM durable_follow_up_deliveries WHERE id = ?"
          ).get(delId) as unknown as DeliveryRow;
          delivery = deliveryRowToModel(inserted);
        }
      }

      this.db.prepare(
        "UPDATE durable_follow_ups SET next_check_at = ?, updated_at = ? WHERE execution_id = ?"
      ).run(nextIso, ts, input.executionId);

      this.db.exec("COMMIT");
      this.notify();
      return { decision: decisionRowToModel(row), ...(delivery ? { delivery } : {}) };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  updateDeliveryStatus(deliveryKey: string, status: FollowUpDeliveryStatus, externalReceipt?: string, now?: Date): void {
    const ts = nowIso(now);
    this.db.prepare(`
      UPDATE durable_follow_up_deliveries
      SET status = ?, external_receipt = COALESCE(?, external_receipt), updated_at = ?
      WHERE delivery_key = ?
    `).run(status, externalReceipt ?? null, ts, deliveryKey);
    this.notify();
  }

  expireFollowUp(input: { executionId: string; expectedVersion: number; now?: Date }): boolean {
    const ts = nowIso(input.now);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const exec = this.db.prepare("SELECT status, version FROM durable_executions WHERE id = ?").get(input.executionId) as
        | { status: string; version: number } | undefined;
      if (!exec || Number(exec.version) !== input.expectedVersion || ["completed", "cancelled"].includes(exec.status)) {
        this.db.exec("COMMIT");
        return false;
      }
      this.db.prepare(
        "UPDATE durable_executions SET status = 'cancelled', version = version + 1, terminal_at = ?, updated_at = ?, next_run_at = NULL WHERE id = ? AND version = ?"
      ).run(ts, ts, input.executionId, exec.version);
      this.db.prepare(
        "UPDATE durable_kanban_tasks SET close_reason = 'expired', updated_at = ? WHERE execution_id = ?"
      ).run(ts, input.executionId);
      this.db.prepare(
        "UPDATE durable_follow_ups SET next_check_at = NULL, updated_at = ? WHERE execution_id = ?"
      ).run(ts, input.executionId);
      this.db.prepare(
        "UPDATE durable_follow_up_deliveries SET status = 'cancelled', updated_at = ? WHERE execution_id = ? AND status = 'reserved'"
      ).run(ts, input.executionId);
      this.db.exec("COMMIT");
      this.notify();
      return true;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  completeFollowUp(input: { executionId: string; ownerId: string; expectedVersion: number; now?: Date }): { version: number } {
    const ts = nowIso(input.now);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const exec = this.db.prepare("SELECT owner_id, status, version FROM durable_executions WHERE id = ?").get(input.executionId) as
        | { owner_id: string; status: string; version: number } | undefined;
      if (!exec || exec.owner_id !== input.ownerId) throw new DurableExecutionNotFoundError(input.executionId);
      if (Number(exec.version) !== input.expectedVersion) {
        throw new DurableExecutionConflictError("follow-up", input.expectedVersion, Number(exec.version));
      }
      if (["completed", "cancelled"].includes(exec.status)) {
        this.db.exec("COMMIT");
        return { version: Number(exec.version) };
      }
      const nextVersion = Number(exec.version) + 1;
      this.db.prepare(
        "UPDATE durable_executions SET status = 'completed', version = ?, terminal_at = ?, updated_at = ?, next_run_at = NULL WHERE id = ? AND version = ?"
      ).run(nextVersion, ts, ts, input.executionId, exec.version);
      this.db.prepare(
        "UPDATE durable_follow_ups SET next_check_at = NULL, updated_at = ? WHERE execution_id = ?"
      ).run(ts, input.executionId);
      this.db.prepare(
        "UPDATE durable_follow_up_deliveries SET status = 'cancelled', updated_at = ? WHERE execution_id = ? AND status = 'reserved'"
      ).run(ts, input.executionId);
      this.db.exec("COMMIT");
      this.notify();
      return { version: nextVersion };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  snoozeFollowUp(input: { executionId: string; ownerId: string; expectedVersion: number; until: Date; now?: Date }): { version: number; nextCheckAt: string } {
    const now = input.now ?? new Date();
    if (input.until.getTime() <= now.getTime()) {
      throw new Error("snooze until must be in the future.");
    }
    const ts = nowIso(now);
    const nextIso = input.until.toISOString();

    this.db.exec("BEGIN IMMEDIATE");
    try {
      const exec = this.db.prepare("SELECT owner_id, status, version FROM durable_executions WHERE id = ?").get(input.executionId) as
        | { owner_id: string; status: string; version: number } | undefined;
      if (!exec || exec.owner_id !== input.ownerId) throw new DurableExecutionNotFoundError(input.executionId);
      if (Number(exec.version) !== input.expectedVersion) {
        throw new DurableExecutionConflictError("follow-up", input.expectedVersion, Number(exec.version));
      }
      const fu = this.getFollowUp(input.executionId);
      if (!fu) throw new DurableExecutionNotFoundError(input.executionId);
      if (input.until.getTime() >= Date.parse(fu.expiresAt)) {
        throw new Error("snooze until must be earlier than expiresAt.");
      }
      const nextVersion = Number(exec.version) + 1;
      this.db.prepare(
        "UPDATE durable_executions SET status = 'queued', version = ?, next_run_at = ?, updated_at = ? WHERE id = ? AND version = ?"
      ).run(nextVersion, nextIso, ts, input.executionId, exec.version);
      this.db.prepare(
        "UPDATE durable_follow_ups SET next_check_at = ?, updated_at = ? WHERE execution_id = ?"
      ).run(nextIso, ts, input.executionId);
      enqueueWakeupInTransaction(this.db, {
        executionId: input.executionId,
        expectedVersion: nextVersion,
        reason: "verify",
        runAt: input.until
      }, now);
      this.db.exec("COMMIT");
      this.notify();
      return { version: nextVersion, nextCheckAt: nextIso };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

function decisionRowToModel(row: DecisionRow): FollowUpDecision {
  return {
    id: row.id,
    executionId: row.execution_id,
    authorizationRevision: Number(row.authorization_revision),
    triggerSlot: row.trigger_slot,
    decision: row.decision,
    reasonCode: row.reason_code,
    evidenceFingerprint: row.evidence_fingerprint,
    ...(row.notify_text ? { notifyText: row.notify_text } : {}),
    artifactRefs: parseJson<string[]>(row.artifact_refs_json, []),
    createdAt: row.created_at
  };
}

function deliveryRowToModel(row: DeliveryRow): FollowUpDelivery {
  return {
    id: row.id,
    deliveryKey: row.delivery_key,
    executionId: row.execution_id,
    decisionId: row.decision_id,
    target: parseJson<FollowUpNotifyTarget>(row.target_json, { kind: "desktop" }),
    status: row.status,
    notifyText: row.notify_text,
    ...(row.not_before ? { notBefore: row.not_before } : {}),
    ...(row.expires_at ? { expiresAt: row.expires_at } : {}),
    ...(row.external_receipt ? { externalReceipt: row.external_receipt } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
