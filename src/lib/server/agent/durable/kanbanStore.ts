import type { DatabaseSync } from "node:sqlite";
import {
  DurableExecutionConflictError,
  DurableExecutionNotFoundError,
  DurableExecutionTransitionError,
  KanbanProjectSlotHeldError,
  type CreateKanbanTaskInput,
  type KanbanChecklistItem,
  type KanbanHandoffRecord,
  type KanbanReceipt,
  type KanbanReceiptActions,
  type KanbanTaskConfig,
  type KanbanUserInput,
  type PlanCriterionInput,
  type RecordKanbanReceiptInput
} from "./types.js";
import { enqueueWakeupInTransaction } from "./wakeupStore.js";

/**
 * Kanban Task storage. A Kanban Task is a Durable Execution task form: every
 * kanban row hangs off the aggregate's execution id and every state change that
 * touches the execution (start, slot release, receipts) runs in the same
 * transaction as the execution row itself (ADR 0004). Legacy plans have no
 * kanban row and never enter these tables.
 */

const TERMINAL_STATUSES = new Set(["completed", "cancelled"]);
export const DEFAULT_KANBAN_HANDOFF_LIMIT = 8;
export const DEFAULT_KANBAN_TOKEN_BUDGET = 2_000_000;
/** Fallback Primary Agent for team coordinators; matches settings DEFAULT_AGENT_ID. */
export const DEFAULT_KANBAN_PRIMARY_AGENT_ID = "default";

function id(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

function nowIso(value?: Date): string {
  return (value ?? new Date()).toISOString();
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

interface KanbanTaskRow {
  execution_id: string;
  form: "single" | "team";
  title: string;
  goal: string;
  coordinator_agent_id: string | null;
  member_snapshot: string | null;
  project_id: string | null;
  work_dir: string | null;
  completion_source: "user" | "generated" | "pending";
  budget_token_limit: number | null;
  budget_handoff_limit: number;
  approval_policy: "deny" | "suspend";
  human_acceptance: number;
  auto_start: number;
  handoff_count: number;
  current_agent_id: string | null;
  round_count: number;
  retry_count: number;
  next_retry_at: string | null;
  usage_gap_count: number;
  source_type: string | null;
  external_id: string | null;
  source_url: string | null;
  budget_topups_json: string | null;
  created_at: string;
  updated_at: string;
}

interface ReceiptRow {
  receipt_id: string;
  execution_id: string;
  round: number;
  actor_agent_id: string;
  actions_json: string;
  dedup_key: string;
  expected_version: number;
  created_at: string;
}

interface ChecklistRow {
  item_id: string;
  execution_id: string;
  text: string;
  done: number;
  sort_index: number;
  updated_round: number;
}

interface UserInputRow {
  input_id: string;
  execution_id: string;
  text: string;
  created_at: string;
  consumed_round: number | null;
}

interface HandoffRow {
  id: string;
  execution_id: string;
  round: number;
  from_agent_id: string | null;
  to_agent_id: string;
  kind: "assign" | "dispatch" | "return";
  brief: string;
  created_at: string;
}

function rowToTask(row: KanbanTaskRow): KanbanTaskConfig {
  return {
    executionId: row.execution_id,
    form: row.form,
    title: row.title,
    goal: row.goal,
    ...(row.coordinator_agent_id ? { coordinatorAgentId: row.coordinator_agent_id } : {}),
    members: parseJson<KanbanTaskConfig["members"]>(row.member_snapshot, []),
    ...(row.project_id ? { projectId: row.project_id } : {}),
    ...(row.work_dir ? { workDir: row.work_dir } : {}),
    completionSource: row.completion_source,
    ...(row.budget_token_limit != null ? { budgetTokenLimit: Number(row.budget_token_limit) } : {}),
    handoffLimit: Number(row.budget_handoff_limit),
    approvalPolicy: row.approval_policy,
    humanAcceptance: Number(row.human_acceptance) === 1,
    autoStart: Number(row.auto_start) === 1,
    handoffCount: Number(row.handoff_count),
    ...(row.current_agent_id ? { currentAgentId: row.current_agent_id } : {}),
    roundCount: Number(row.round_count),
    retryCount: Number(row.retry_count),
    ...(row.next_retry_at ? { nextRetryAt: row.next_retry_at } : {}),
    usageGapCount: Number(row.usage_gap_count),
    ...(row.source_type ? { sourceType: row.source_type } : {}),
    ...(row.external_id ? { externalId: row.external_id } : {}),
    ...(row.source_url ? { sourceUrl: row.source_url } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function ensureKanbanSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS durable_kanban_tasks (
      execution_id TEXT PRIMARY KEY REFERENCES durable_executions(id) ON DELETE CASCADE,
      form TEXT NOT NULL CHECK (form IN ('single','team')),
      title TEXT NOT NULL,
      goal TEXT NOT NULL,
      coordinator_agent_id TEXT,
      member_snapshot TEXT,
      project_id TEXT,
      work_dir TEXT,
      completion_source TEXT NOT NULL DEFAULT 'user' CHECK (completion_source IN ('user','generated','pending')),
      budget_token_limit INTEGER,
      budget_handoff_limit INTEGER NOT NULL DEFAULT 8,
      approval_policy TEXT NOT NULL DEFAULT 'suspend' CHECK (approval_policy IN ('deny','suspend')),
      human_acceptance INTEGER NOT NULL CHECK (human_acceptance IN (0,1)),
      auto_start INTEGER NOT NULL CHECK (auto_start IN (0,1)),
      handoff_count INTEGER NOT NULL DEFAULT 0,
      current_agent_id TEXT,
      round_count INTEGER NOT NULL DEFAULT 0,
      retry_count INTEGER NOT NULL DEFAULT 0,
      next_retry_at TEXT,
      usage_gap_count INTEGER NOT NULL DEFAULT 0,
      source_type TEXT,
      external_id TEXT,
      source_url TEXT,
      budget_topups_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_durable_kanban_tasks_project ON durable_kanban_tasks(project_id, created_at);
    CREATE TABLE IF NOT EXISTS durable_kanban_member_sessions (
      execution_id TEXT NOT NULL REFERENCES durable_executions(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      PRIMARY KEY (execution_id, agent_id)
    );
    CREATE TABLE IF NOT EXISTS durable_kanban_receipts (
      receipt_id TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL REFERENCES durable_executions(id) ON DELETE CASCADE,
      round INTEGER NOT NULL,
      actor_agent_id TEXT NOT NULL,
      actions_json TEXT NOT NULL,
      dedup_key TEXT NOT NULL,
      expected_version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (execution_id, round, actor_agent_id, dedup_key)
    );
    CREATE INDEX IF NOT EXISTS idx_durable_kanban_receipts_execution ON durable_kanban_receipts(execution_id, round, created_at);
    CREATE TABLE IF NOT EXISTS durable_kanban_checklist (
      item_id TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL REFERENCES durable_executions(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      done INTEGER NOT NULL CHECK (done IN (0,1)),
      sort_index INTEGER NOT NULL,
      updated_round INTEGER NOT NULL DEFAULT 0,
      UNIQUE (execution_id, text)
    );
    CREATE TABLE IF NOT EXISTS durable_kanban_inputs (
      input_id TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL REFERENCES durable_executions(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      consumed_round INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_durable_kanban_inputs_execution ON durable_kanban_inputs(execution_id, created_at);
    CREATE TABLE IF NOT EXISTS durable_kanban_handoffs (
      id TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL REFERENCES durable_executions(id) ON DELETE CASCADE,
      round INTEGER NOT NULL,
      from_agent_id TEXT,
      to_agent_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('assign','dispatch','return')),
      brief TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_durable_kanban_handoffs_execution ON durable_kanban_handoffs(execution_id, created_at);
    CREATE TABLE IF NOT EXISTS durable_kanban_side_effects (
      id TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL REFERENCES durable_executions(id) ON DELETE CASCADE,
      round INTEGER NOT NULL,
      attempt_id TEXT,
      phase TEXT NOT NULL CHECK (phase IN ('intent','receipt')),
      side_effect_class TEXT NOT NULL CHECK (side_effect_class IN ('pure','idempotent','queryable','non_idempotent')),
      idempotency_key TEXT NOT NULL,
      target_summary TEXT NOT NULL,
      content_summary TEXT NOT NULL,
      external_id TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (execution_id, round, phase, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS idx_durable_kanban_side_effects_attempt ON durable_kanban_side_effects(execution_id, attempt_id);
    CREATE TABLE IF NOT EXISTS durable_kanban_project_slots (
      project_key TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL,
      acquired_at TEXT NOT NULL
    );
  `);
}

/** Normalized key for the Project advance slot: project id, else work dir. */
export function kanbanProjectKey(input: { projectId?: string; workDir?: string }): string | null {
  const projectId = text(input.projectId);
  if (projectId) return `project:${projectId}`;
  const workDir = text(input.workDir);
  if (workDir) return `dir:${workDir}`;
  return null;
}

/**
 * Releases the Project slot held by `executionId` (if any) and, when a queued
 * kanban task is waiting on the same key, enqueues its `capacity` wakeup. Must
 * run inside the caller's transaction that also committed the terminal state.
 * Returns the woken execution id, if any.
 */
export function releaseProjectSlotInTransaction(db: DatabaseSync, executionId: string, now = new Date()): string | null {
  const slot = db.prepare("SELECT project_key FROM durable_kanban_project_slots WHERE execution_id = ?").get(executionId) as { project_key: string } | undefined;
  if (!slot) return null;
  const released = db.prepare("DELETE FROM durable_kanban_project_slots WHERE execution_id = ? AND project_key = ?").run(executionId, slot.project_key);
  if (Number(released.changes ?? 0) === 0) return null;
  const [keyKind, ...rest] = slot.project_key.split(":");
  const keyValue = rest.join(":");
  const next = db.prepare(`
    SELECT t.execution_id, e.version FROM durable_kanban_tasks t
    JOIN durable_executions e ON e.id = t.execution_id
    WHERE e.status = 'queued' AND t.${keyKind === "project" ? "project_id" : "work_dir"} = ?
    ORDER BY t.created_at ASC LIMIT 1
  `).get(keyValue) as { execution_id: string; version: number } | undefined;
  if (!next) return null;
  enqueueWakeupInTransaction(db, {
    executionId: next.execution_id,
    expectedVersion: Number(next.version),
    reason: "capacity"
  }, now);
  return next.execution_id;
}

export class KanbanStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly notify: () => void
  ) {}

  private requireTaskRow(executionId: string): KanbanTaskRow {
    const row = this.db.prepare("SELECT * FROM durable_kanban_tasks WHERE execution_id = ?").get(text(executionId)) as KanbanTaskRow | undefined;
    if (!row) throw new DurableExecutionNotFoundError(executionId);
    return row;
  }

  private requireExecutionRow(executionId: string) {
    const row = this.db.prepare("SELECT * FROM durable_executions WHERE id = ?").get(text(executionId)) as
      | { id: string; owner_id: string; status: string; version: number; current_plan_version: number; created_at: string }
      | undefined;
    if (!row) throw new DurableExecutionNotFoundError(executionId);
    return row;
  }

  private assertVersion(row: { version: number }, expectedVersion: number): void {
    if (Number(row.version) !== Number(expectedVersion)) {
      throw new DurableExecutionConflictError("kanban-task", expectedVersion, Number(row.version));
    }
  }

  getTask(executionId: string): KanbanTaskConfig | null {
    const row = this.db.prepare("SELECT * FROM durable_kanban_tasks WHERE execution_id = ?").get(text(executionId)) as KanbanTaskRow | undefined;
    return row ? rowToTask(row) : null;
  }

  /** Runs kanban writes that do not need to fuse with an execution transition. */
  transact<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.db.exec("COMMIT"); this.notify();
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getTaskByExternalId(externalId: string): KanbanTaskConfig | null {
    const row = this.db.prepare("SELECT * FROM durable_kanban_tasks WHERE external_id = ? ORDER BY created_at DESC LIMIT 1").get(text(externalId)) as KanbanTaskRow | undefined;
    return row ? rowToTask(row) : null;
  }

  /**
   * Creates the kanban task and its execution aggregate in one transaction. The
   * task starts `planned` (Todo); auto-start dispatch is a separate start call
   * so a rejected start leaves the card in Todo with the reason.
   */
  createTask(input: CreateKanbanTaskInput): KanbanTaskConfig {
    const ownerId = text(input.ownerId);
    const botId = text(input.botId);
    const title = text(input.title);
    const goal = text(input.goal) || title;
    if (!ownerId || !botId || !title || !goal) throw new Error("ownerId, botId, title and goal are required.");
    const form = input.form;
    // Spec: 默认负责人 = Primary Agent. The store keeps a value-level fallback
    // matching settings DEFAULT_AGENT_ID; callers that know the bot's actual
    // primary agent pass it explicitly.
    const coordinatorAgentId = text(input.coordinatorAgentId) || (form === "team" ? DEFAULT_KANBAN_PRIMARY_AGENT_ID : undefined);
    const agentId = text(input.agentId) || (form === "team" ? coordinatorAgentId : undefined);
    // A team without an explicit member list starts as coordinator-only.
    const members = form === "team"
      ? (input.members && input.members.length > 0 ? input.members : [{ agentId: coordinatorAgentId!, name: coordinatorAgentId! }])
      : [];
    if (form === "single" && !agentId) throw new Error("A single-agent kanban task requires an executor agent.");
    if (form === "team") {
      if (members.length === 0) throw new Error("A team kanban task requires at least one member.");
      if (!coordinatorAgentId) throw new Error("A team kanban task requires a coordinator agent.");
      if (!members.some(member => member.agentId === coordinatorAgentId)) throw new Error("The coordinator must be one of the team members.");
    }
    const conditions = (input.completionConditions ?? []).filter(condition => text(condition.description));
    const completionSource = input.completionSource ?? (conditions.length > 0 ? "user" : "pending");
    if (completionSource === "user" && conditions.length === 0) throw new Error("completionSource 'user' requires at least one completion condition.");
    const handoffLimit = input.handoffLimit ?? DEFAULT_KANBAN_HANDOFF_LIMIT;
    if (!Number.isInteger(handoffLimit) || handoffLimit < 1) throw new Error("handoffLimit must be a positive integer.");
    const approvalPolicy = input.approvalPolicy ?? "suspend";
    const autoStart = input.autoStart ?? true;
    const createdAt = nowIso(input.now);
    const executionId = text(input.kanbanTaskId) || id("kanban");
    if (text(input.kanbanTaskId)) {
      const existing = this.getTask(executionId);
      if (existing) return existing;
    }

    this.db.exec("BEGIN IMMEDIATE");
    try {
      const sequenceRow = this.db.prepare("SELECT COALESCE(MAX(handle_sequence), 0) + 1 AS next FROM durable_executions WHERE owner_id = ?").get(ownerId) as { next: number };
      const handleSequence = Number(sequenceRow.next);
      // The synthetic source chat isolates every attempt of this task: the
      // chat-scoped single-flight lock serializes rounds (and team members),
      // and the per-agent event store keeps member contexts separate. The
      // visible conversation (source_ui_session_id) is a delivery target only —
      // live output and final replies stream there (spec 执行形态修订).
      this.db.prepare(`
        INSERT INTO durable_executions (
          id, short_handle, handle_sequence, owner_id, bot_id, source_channel, source_chat_id,
          source_ui_session_id, source_project_id, goal, constraints_json, status, version,
          current_plan_version, lease_owner_id, lease_expires_at, budget_token_limit,
          budget_attempt_limit, budget_lifetime_days, tokens_used, attempts_used, created_at,
          started_at, updated_at, terminal_at, waiting_kind, waiting_reason, next_run_at,
          last_error, activation_path, activation_reason
        ) VALUES (?, ?, ?, ?, ?, 'web', ?, ?, ?, ?, '[]', 'planned', 1,
          1, NULL, NULL, ?, NULL, NULL, 0, 0, ?, NULL, ?, NULL, NULL, NULL, NULL, NULL, 'forced', 'kanban-task')
      `).run(
        executionId, `#${handleSequence}`, handleSequence, ownerId, botId,
        `kanban:${executionId}`, text(input.sourceUiSessionId) || null, input.projectId ?? null, goal,
        input.budgetTokenLimit ?? DEFAULT_KANBAN_TOKEN_BUDGET,
        createdAt, createdAt
      );
      this.db.prepare("INSERT INTO durable_plan_versions (execution_id, plan_version, revision_reason, author, created_at) VALUES (?, 1, 'kanban task', 'user', ?)")
        .run(executionId, createdAt);
      for (const condition of conditions) {
        this.db.prepare(`
          INSERT INTO durable_acceptance_criteria (
            id, execution_id, plan_version, description, required, checker_type, checker_key,
            author, result, evidence_ref_id, user_edited, created_at, updated_at
          ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, 'unproven', NULL, 0, ?, ?)
        `).run(
          condition.id || id("criterion"), executionId, condition.description,
          condition.required === false ? 0 : 1,
          condition.checkerType === "deterministic" ? "deterministic" : "subjective",
          condition.checkerKey ?? null,
          condition.author === "model" ? "model" : "user",
          createdAt, createdAt
        );
      }
      if (agentId) this.db.prepare("INSERT INTO durable_plan_origins VALUES (?, ?)").run(executionId, agentId);
      for (const session of input.memberSessions ?? []) {
        if (!text(session.agentId) || !text(session.sessionId)) continue;
        this.db.prepare("INSERT INTO durable_kanban_member_sessions (execution_id, agent_id, session_id) VALUES (?, ?, ?)")
          .run(executionId, text(session.agentId), text(session.sessionId));
      }
      this.db.prepare("INSERT INTO durable_plan_meta (execution_id, title, summary, updated_at) VALUES (?, ?, '', ?)")
        .run(executionId, title, createdAt);
      this.db.prepare(`
        INSERT INTO durable_kanban_tasks (
          execution_id, form, title, goal, coordinator_agent_id, member_snapshot, project_id, work_dir,
          completion_source, budget_token_limit, budget_handoff_limit, approval_policy, human_acceptance,
          auto_start, current_agent_id, source_type, external_id, source_url, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        executionId, form, title, goal,
        form === "team" ? coordinatorAgentId! : null,
        form === "team" ? JSON.stringify(members) : null,
        text(input.projectId) || null,
        text(input.workDir) || null,
        completionSource,
        input.budgetTokenLimit ?? DEFAULT_KANBAN_TOKEN_BUDGET,
        handoffLimit,
        approvalPolicy,
        input.humanAcceptance ? 1 : 0,
        autoStart ? 1 : 0,
        agentId ?? null,
        text(input.sourceType) || null,
        text(input.externalId) || null,
        text(input.sourceUrl) || null,
        createdAt, createdAt
      );
      if (form === "team" && agentId) {
        this.db.prepare("INSERT INTO durable_kanban_handoffs (id, execution_id, round, from_agent_id, to_agent_id, kind, brief, created_at) VALUES (?, ?, 0, NULL, ?, 'assign', '', ?)")
          .run(id("handoff"), executionId, agentId, createdAt);
      }
      const task = rowToTask(this.requireTaskRow(executionId));
      this.db.exec("COMMIT"); this.notify();
      return task;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /**
   * Starts (or resumes) a task: `planned`/`paused` → `queued` plus its resume
   * wakeup in one transaction. Idempotent through the action receipt. The
   * Project slot is checked at attempt time, so a blocked task still enters
   * Doing/排队 with the holder visible.
   */
  startTask(input: { executionId: string; ownerId: string; expectedVersion: number; actionId: string; now?: Date }): { execution: { id: string; status: string; version: number }; started: boolean; receipt?: unknown } {
    const existing = this.db.prepare("SELECT result_json FROM durable_action_receipts WHERE execution_id = ? AND action_id = ?")
      .get(input.executionId, input.actionId) as { result_json: string } | undefined;
    if (existing) return { execution: this.requireExecutionRow(input.executionId) as { id: string; status: string; version: number }, started: false, receipt: parseJson(existing.result_json, null) };

    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.requireExecutionRow(input.executionId);
      if (current.owner_id !== input.ownerId) throw new DurableExecutionNotFoundError(input.executionId);
      this.assertVersion(current, input.expectedVersion);
      // `partial` is the budget-exhausted state; a top-up plus start resumes
      // from there (追加后从当前状态继续).
      if (!["planned", "paused", "recovery_required", "failed", "partial"].includes(current.status)) {
        throw new DurableExecutionTransitionError(current.status as never, "queued");
      }
      const timestamp = nowIso(input.now);
      this.db.prepare("UPDATE durable_executions SET status = 'queued', version = version + 1, updated_at = ?, terminal_at = NULL, waiting_kind = NULL, waiting_reason = NULL, next_run_at = NULL WHERE id = ? AND version = ?")
        .run(timestamp, input.executionId, current.version);
      enqueueWakeupInTransaction(this.db, {
        executionId: input.executionId,
        expectedVersion: Number(current.version) + 1,
        reason: "resume"
      }, input.now);
      const result = { started: true, fromStatus: current.status };
      this.db.prepare("INSERT OR IGNORE INTO durable_action_receipts (action_id, execution_id, action, result_json, created_at) VALUES (?, ?, 'kanban_start', ?, ?)")
        .run(input.actionId, input.executionId, JSON.stringify(result), timestamp);
      const execution = this.requireExecutionRow(input.executionId) as { id: string; status: string; version: number };
      this.db.exec("COMMIT"); this.notify();
      return { execution, started: true, receipt: result };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  listTasks(filter: { ownerId: string; projectId?: string; statuses?: string[] }): KanbanTaskConfig[] {
    const clauses = ["e.owner_id = ?"];
    const params: Array<string | number | null> = [text(filter.ownerId)];
    if (filter.projectId) { clauses.push("t.project_id = ?"); params.push(text(filter.projectId)); }
    if (filter.statuses && filter.statuses.length > 0) {
      clauses.push(`e.status IN (${filter.statuses.map(() => "?").join(",")})`);
      params.push(...filter.statuses);
    }
    const rows = this.db.prepare(`
      SELECT t.* FROM durable_kanban_tasks t
      JOIN durable_executions e ON e.id = t.execution_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY t.created_at ASC
    `).all(...params) as unknown as KanbanTaskRow[];
    return rows.map(rowToTask);
  }

  /** Legacy plans and kanban tasks both project onto the board by execution status. */
  listExecutionSummaries(filter: { ownerId: string; statuses?: string[] }): Array<{ executionId: string; status: string; goal: string; projectId: string | null; createdAt: string; updatedAt: string; isKanban: boolean; title: string; waitingReason: string | null; version: number; tokensUsed: number; shortHandle: string; currentPlanVersion: number }> {
    const clauses = ["e.owner_id = ?"];
    const params: Array<string | number | null> = [text(filter.ownerId)];
    if (filter.statuses && filter.statuses.length > 0) {
      clauses.push(`e.status IN (${filter.statuses.map(() => "?").join(",")})`);
      params.push(...filter.statuses);
    }
    const rows = this.db.prepare(`
      SELECT e.id, e.status, e.goal, e.source_project_id, e.created_at, e.updated_at, e.waiting_reason,
        e.version, e.tokens_used, e.short_handle, e.current_plan_version,
        m.title AS title, t.execution_id AS kanban_id
      FROM durable_executions e
      LEFT JOIN durable_plan_meta m ON m.execution_id = e.id
      LEFT JOIN durable_kanban_tasks t ON t.execution_id = e.id
      WHERE ${clauses.join(" AND ")}
      ORDER BY e.created_at ASC
    `).all(...params) as unknown as Array<{ id: string; status: string; goal: string; source_project_id: string | null; created_at: string; updated_at: string; waiting_reason: string | null; title: string | null; kanban_id: string | null; version: number; tokens_used: number; short_handle: string; current_plan_version: number }>;
    return rows.map(row => ({
      executionId: row.id,
      status: row.status,
      goal: row.goal,
      projectId: row.source_project_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      isKanban: row.kanban_id != null,
      title: row.title ?? row.goal,
      waitingReason: row.waiting_reason,
      version: Number(row.version),
      tokensUsed: Number(row.tokens_used ?? 0),
      shortHandle: row.short_handle,
      currentPlanVersion: Number(row.current_plan_version)
    }));
  }

  /** Batched board projection: one query per table instead of one per card. */
  getTasksByExecutions(executionIds: string[]): Map<string, KanbanTaskConfig> {
    const map = new Map<string, KanbanTaskConfig>();
    if (executionIds.length === 0) return map;
    const rows = this.db.prepare(`
      SELECT * FROM durable_kanban_tasks WHERE execution_id IN (${executionIds.map(() => "?").join(",")})
    `).all(...executionIds) as unknown as KanbanTaskRow[];
    for (const row of rows) map.set(row.execution_id, rowToTask(row));
    return map;
  }

  getChecklistsByExecutions(executionIds: string[]): Map<string, KanbanChecklistItem[]> {
    const map = new Map<string, KanbanChecklistItem[]>();
    if (executionIds.length === 0) return map;
    const rows = this.db.prepare(`
      SELECT * FROM durable_kanban_checklist WHERE execution_id IN (${executionIds.map(() => "?").join(",")})
      ORDER BY sort_index ASC, rowid ASC
    `).all(...executionIds) as unknown as ChecklistRow[];
    for (const row of rows) {
      const list = map.get(row.execution_id) ?? [];
      list.push({
        itemId: row.item_id,
        text: row.text,
        done: Number(row.done) === 1,
        sortIndex: Number(row.sort_index),
        updatedRound: Number(row.updated_round)
      });
      map.set(row.execution_id, list);
    }
    return map;
  }

  getProjectSlot(projectKey: string): { executionId: string; acquiredAt: string } | null {
    const row = this.db.prepare("SELECT execution_id, acquired_at FROM durable_kanban_project_slots WHERE project_key = ?").get(text(projectKey)) as { execution_id: string; acquired_at: string } | undefined;
    return row ? { executionId: row.execution_id, acquiredAt: row.acquired_at } : null;
  }

  /**
   * Acquires the Project slot inside the attempt-claim transaction. Throws
   * `KanbanProjectSlotHeldError` when another task holds it; the runtime then
   * defers with a capacity wakeup instead of consuming a round.
   *
   * Creation-order arbitration (spec 45/46): even when the slot itself is
   * free, a same-key task created earlier and still queued outranks this one.
   * The claim aborts and the runtime parks this task without a wakeup; the
   * older sibling's settlement later releases the slot and wakes the oldest
   * queued task, so no ordering deadlock is possible.
   */
  acquireProjectSlotInTransaction(executionId: string, projectKey: string, now = new Date()): void {
    const holder = this.db.prepare("SELECT execution_id FROM durable_kanban_project_slots WHERE project_key = ?").get(text(projectKey)) as { execution_id: string } | undefined;
    if (holder && holder.execution_id !== executionId) {
      throw new KanbanProjectSlotHeldError(executionId, projectKey, holder.execution_id);
    }
    if (!holder) {
      const [keyKind, ...rest] = projectKey.split(":");
      const keyValue = rest.join(":");
      const older = this.db.prepare(`
        SELECT t.execution_id FROM durable_kanban_tasks t
        WHERE t.execution_id != ? AND t.${keyKind === "project" ? "project_id" : "work_dir"} = ?
          AND t.created_at < (SELECT created_at FROM durable_kanban_tasks WHERE execution_id = ?)
          AND EXISTS (SELECT 1 FROM durable_executions e WHERE e.id = t.execution_id AND e.status = 'queued')
        ORDER BY t.created_at ASC LIMIT 1
      `).get(executionId, keyValue, executionId) as { execution_id: string } | undefined;
      if (older) throw new KanbanProjectSlotHeldError(executionId, projectKey, older.execution_id);
    }
    this.db.prepare("INSERT OR REPLACE INTO durable_kanban_project_slots (project_key, execution_id, acquired_at) VALUES (?, ?, ?)")
      .run(text(projectKey), executionId, nowIso(now));
  }

  /**
   * Adds a one-off budget top-up in its own ledger entry. The accumulated
   * usage is never reset; the new limit only extends the ceiling.
   */
  extendKanbanBudget(input: { executionId: string; expectedVersion: number; topup: number; now?: Date }): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.requireExecutionRow(input.executionId);
      this.assertVersion(current, input.expectedVersion);
      const row = this.requireTaskRow(input.executionId);
      const topups = parseJson<Array<{ tokens: number; at: string }>>(row.budget_topups_json, []);
      topups.push({ tokens: Math.round(input.topup), at: nowIso(input.now) });
      const timestamp = nowIso(input.now);
      this.db.prepare("UPDATE durable_kanban_tasks SET budget_token_limit = COALESCE(budget_token_limit, 0) + ?, budget_topups_json = ?, updated_at = ? WHERE execution_id = ?")
        .run(Math.round(input.topup), JSON.stringify(topups), timestamp, input.executionId);
      this.db.prepare("UPDATE durable_executions SET budget_token_limit = COALESCE(budget_token_limit, 0) + ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?")
        .run(Math.round(input.topup), timestamp, input.executionId, current.version);
      this.db.exec("COMMIT"); this.notify();
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  recordInput(input: { executionId: string; text: string; now?: Date }): KanbanUserInput {
    const value = text(input.text);
    if (!value) throw new Error("User input text is required.");
    const timestamp = nowIso(input.now);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.requireExecutionRow(input.executionId);
      const inputId = id("input");
      this.db.prepare("INSERT INTO durable_kanban_inputs (input_id, execution_id, text, created_at, consumed_round) VALUES (?, ?, ?, ?, NULL)")
        .run(inputId, input.executionId, value, timestamp);
      this.db.prepare("UPDATE durable_executions SET version = version + 1, updated_at = ? WHERE id = ?").run(timestamp, input.executionId);
      const record: KanbanUserInput = { inputId, executionId: input.executionId, text: value, createdAt: timestamp, consumedRound: null };
      this.db.exec("COMMIT"); this.notify();
      return record;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  listInputs(executionId: string, onlyPending = false): KanbanUserInput[] {
    const rows = (onlyPending
      ? this.db.prepare("SELECT * FROM durable_kanban_inputs WHERE execution_id = ? AND consumed_round IS NULL ORDER BY created_at ASC")
      : this.db.prepare("SELECT * FROM durable_kanban_inputs WHERE execution_id = ? ORDER BY created_at ASC"))
      .all(executionId) as unknown as UserInputRow[];
    return rows.map(row => ({
      inputId: row.input_id,
      executionId: row.execution_id,
      text: row.text,
      createdAt: row.created_at,
      consumedRound: row.consumed_round == null ? null : Number(row.consumed_round)
    }));
  }

  /**
   * Persists condition candidates the executor proposed through its receipt
   * (story 53: 先提出可见的完成条件，用户可修订). Subjective criteria only;
   * the source becomes `generated` until the user revises it.
   */
  proposeCompletionConditions(input: { executionId: string; descriptions: string[]; now?: Date }): void {
    const descriptions = input.descriptions.map(item => text(item)).filter(Boolean);
    if (descriptions.length === 0) throw new Error("At least one condition description is required.");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const execution = this.requireExecutionRow(input.executionId);
      this.requireTaskRow(input.executionId);
      const existing = this.db.prepare("SELECT COUNT(*) AS count FROM durable_acceptance_criteria WHERE execution_id = ? AND plan_version = ?").get(input.executionId, execution.current_plan_version) as { count: number };
      if (Number(existing.count) > 0) throw new Error("Completion conditions already exist; revise them instead of proposing new ones.");
      const timestamp = nowIso(input.now);
      const insert = this.db.prepare(`
        INSERT INTO durable_acceptance_criteria (
          id, execution_id, plan_version, description, required, checker_type, checker_key,
          author, result, evidence_ref_id, user_edited, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 1, 'subjective', NULL, 'model', 'unproven', NULL, 0, ?, ?)
      `);
      for (const description of descriptions) insert.run(id("criterion"), input.executionId, execution.current_plan_version, description, timestamp, timestamp);
      this.db.prepare("UPDATE durable_kanban_tasks SET completion_source = 'generated', updated_at = ? WHERE execution_id = ?").run(timestamp, input.executionId);
      this.db.prepare("UPDATE durable_executions SET version = version + 1, updated_at = ? WHERE id = ?").run(timestamp, input.executionId);
      this.db.exec("COMMIT"); this.notify();
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /**
   * Owner revision of completion conditions (story 53): replaces the current
   * unproven subjective criteria with the owner's list, marks them user-edited
   * and returns the source to `user`.
   */
  setCompletionConditions(input: { executionId: string; expectedVersion: number; descriptions: string[]; now?: Date }): void {
    const descriptions = input.descriptions.map(item => text(item)).filter(Boolean);
    if (descriptions.length === 0) throw new Error("At least one condition description is required.");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const execution = this.requireExecutionRow(input.executionId);
      this.assertVersion(execution, input.expectedVersion);
      this.requireTaskRow(input.executionId);
      const timestamp = nowIso(input.now);
      this.db.prepare("DELETE FROM durable_acceptance_criteria WHERE execution_id = ? AND plan_version = ? AND result != 'passed' AND checker_type = 'subjective'").run(input.executionId, execution.current_plan_version);
      const insert = this.db.prepare(`
        INSERT INTO durable_acceptance_criteria (
          id, execution_id, plan_version, description, required, checker_type, checker_key,
          author, result, evidence_ref_id, user_edited, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 1, 'subjective', NULL, 'user', 'unproven', NULL, 1, ?, ?)
      `);
      for (const description of descriptions) insert.run(id("criterion"), input.executionId, execution.current_plan_version, description, timestamp, timestamp);
      this.db.prepare("UPDATE durable_kanban_tasks SET completion_source = 'user', updated_at = ? WHERE execution_id = ?").run(timestamp, input.executionId);
      this.db.prepare("UPDATE durable_executions SET version = version + 1, updated_at = ? WHERE id = ? AND version = ?").run(timestamp, input.executionId, input.expectedVersion);
      this.db.exec("COMMIT"); this.notify();
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /**
   * Marks this round's consumed inputs inside the round-settle transaction.
   * When `inputIds` is given (the ids presented in this round's briefing),
   * only those count as consumed; inputs submitted while the round ran stay
   * pending for the next briefing (story 24).
   */
  consumeInputsInTransaction(executionId: string, round: number, inputIds?: string[]): void {
    if (inputIds && inputIds.length > 0) {
      const placeholders = inputIds.map(() => "?").join(", ");
      this.db.prepare(`UPDATE durable_kanban_inputs SET consumed_round = ? WHERE execution_id = ? AND consumed_round IS NULL AND input_id IN (${placeholders})`)
        .run(round, executionId, ...inputIds);
      return;
    }
    if (inputIds) return;
    this.db.prepare("UPDATE durable_kanban_inputs SET consumed_round = ? WHERE execution_id = ? AND consumed_round IS NULL")
      .run(round, executionId);
  }

  getChecklist(executionId: string): KanbanChecklistItem[] {
    const rows = this.db.prepare("SELECT * FROM durable_kanban_checklist WHERE execution_id = ? ORDER BY sort_index ASC, rowid ASC").all(executionId) as unknown as ChecklistRow[];
    return rows.map(row => ({
      itemId: row.item_id,
      text: row.text,
      done: Number(row.done) === 1,
      sortIndex: Number(row.sort_index),
      updatedRound: Number(row.updated_round)
    }));
  }

  applyChecklistInTransaction(executionId: string, round: number, changes: NonNullable<KanbanReceiptActions["checklist"]>): void {
    for (const change of changes) {
      const itemText = text(change.text);
      if (change.remove) {
        if (change.itemId) {
          this.db.prepare("DELETE FROM durable_kanban_checklist WHERE execution_id = ? AND item_id = ?").run(executionId, change.itemId);
        } else if (itemText) {
          this.db.prepare("DELETE FROM durable_kanban_checklist WHERE execution_id = ? AND text = ?").run(executionId, itemText);
        }
        continue;
      }
      if (change.itemId) {
        if (itemText) {
          this.db.prepare("UPDATE durable_kanban_checklist SET text = ?, done = ?, updated_round = ? WHERE execution_id = ? AND item_id = ?")
            .run(itemText, change.done ? 1 : 0, round, executionId, change.itemId);
        } else {
          this.db.prepare("UPDATE durable_kanban_checklist SET done = ?, updated_round = ? WHERE execution_id = ? AND item_id = ?")
            .run(change.done ? 1 : 0, round, executionId, change.itemId);
        }
        continue;
      }
      if (!itemText) continue;
      this.db.prepare(`
        INSERT INTO durable_kanban_checklist (item_id, execution_id, text, done, sort_index, updated_round)
        VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort_index), 0) + 1 FROM durable_kanban_checklist WHERE execution_id = ?), ?)
        ON CONFLICT(execution_id, text) DO UPDATE SET done = excluded.done, updated_round = excluded.updated_round
      `).run(id("check"), executionId, itemText, change.done ? 1 : 0, executionId, round);
    }
  }

  listHandoffs(executionId: string): KanbanHandoffRecord[] {
    const rows = this.db.prepare("SELECT * FROM durable_kanban_handoffs WHERE execution_id = ? ORDER BY created_at ASC, rowid ASC").all(executionId) as unknown as HandoffRow[];
    return rows.map(row => ({
      id: row.id,
      executionId: row.execution_id,
      round: Number(row.round),
      fromAgentId: row.from_agent_id,
      toAgentId: row.to_agent_id,
      kind: row.kind,
      brief: row.brief,
      createdAt: row.created_at
    }));
  }

  /** Member child sessions (spec 切片③): one visible read-only session per member, created with the task. */
  setMemberSession(executionId: string, agentId: string, sessionId: string): void {
    this.db.prepare(`
      INSERT INTO durable_kanban_member_sessions (execution_id, agent_id, session_id) VALUES (?, ?, ?)
      ON CONFLICT(execution_id, agent_id) DO UPDATE SET session_id = excluded.session_id
    `).run(executionId, agentId, sessionId);
  }

  getMemberSession(executionId: string, agentId: string): string | undefined {
    const row = this.db.prepare("SELECT session_id FROM durable_kanban_member_sessions WHERE execution_id = ? AND agent_id = ?").get(executionId, agentId) as { session_id: string } | undefined;
    return row?.session_id;
  }

  listMemberSessions(executionId: string): Array<{ agentId: string; sessionId: string }> {
    const rows = this.db.prepare("SELECT agent_id, session_id FROM durable_kanban_member_sessions WHERE execution_id = ? ORDER BY agent_id").all(executionId) as Array<{ agent_id: string; session_id: string }>;
    return rows.map(row => ({ agentId: row.agent_id, sessionId: row.session_id }));
  }

  /** Reverse lookup: the kanban task whose visible conversation is this session. */
  getExecutionIdByUiSession(sessionId: string): string | undefined {
    const row = this.db.prepare("SELECT k.execution_id AS id FROM durable_kanban_tasks k JOIN durable_executions e ON e.id = k.execution_id WHERE e.source_ui_session_id = ?").get(sessionId) as { id: string } | undefined;
    return row?.id;
  }

  /**
   * Kanban rounds have no plan steps, so their tool side effects land in this
   * task-scoped ledger (the legacy table hard-references durable_steps). Used
   * by the retry guard: a non-idempotent intent without a receipt means the
   * round must not be auto-retried.
   */
  recordRoundSideEffect(input: {
    executionId: string;
    round: number;
    attemptId: string;
    phase: "intent" | "receipt";
    sideEffectClass: import("./types.js").SideEffectClass;
    idempotencyKey: string;
    targetSummary: string;
    contentSummary: string;
    externalId?: string;
    now?: Date;
  }): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO durable_kanban_side_effects (
        id, execution_id, round, attempt_id, phase, side_effect_class,
        idempotency_key, target_summary, content_summary, external_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id(`side-effect-${input.phase}`), input.executionId, input.round, input.attemptId,
      input.phase, input.sideEffectClass, text(input.idempotencyKey),
      text(input.targetSummary), text(input.contentSummary),
      text(input.externalId) || null, nowIso(input.now)
    );
  }

  listAttemptSideEffects(executionId: string, attemptId: string): Array<{ phase: "intent" | "receipt"; sideEffectClass: import("./types.js").SideEffectClass; idempotencyKey: string }> {
    const rows = this.db.prepare("SELECT phase, side_effect_class, idempotency_key FROM durable_kanban_side_effects WHERE execution_id = ? AND attempt_id = ? ORDER BY created_at ASC").all(executionId, attemptId) as Array<{ phase: "intent" | "receipt"; side_effect_class: import("./types.js").SideEffectClass; idempotency_key: string }>;
    return rows.map(row => ({ phase: row.phase, sideEffectClass: row.side_effect_class, idempotencyKey: row.idempotency_key }));
  }

  getLatestReceipt(executionId: string): KanbanReceipt | null {
    const row = this.db.prepare(`
      SELECT * FROM durable_kanban_receipts WHERE execution_id = ?
      ORDER BY round DESC, created_at DESC, rowid DESC LIMIT 1
    `).get(executionId) as unknown as ReceiptRow | undefined;
    return row ? this.rowToReceipt(row) : null;
  }

  listReceipts(executionId: string): KanbanReceipt[] {
    const rows = this.db.prepare("SELECT * FROM durable_kanban_receipts WHERE execution_id = ? ORDER BY round ASC, created_at ASC, rowid ASC").all(executionId) as unknown as ReceiptRow[];
    return rows.map(row => this.rowToReceipt(row));
  }

  private rowToReceipt(row: ReceiptRow): KanbanReceipt {
    return {
      receiptId: row.receipt_id,
      executionId: row.execution_id,
      round: Number(row.round),
      actorAgentId: row.actor_agent_id,
      actions: parseJson<KanbanReceiptActions>(row.actions_json, {}),
      dedupKey: row.dedup_key,
      expectedVersion: Number(row.expected_version),
      createdAt: row.created_at
    };
  }

  /**
   * Records a receipt inside the round-settle transaction. The unique key
   * `(execution_id, round, actor, dedup_key)` makes a duplicate submission a
   * no-op; a conflicting receipt body under the same identity is rejected.
   */
  recordReceiptInTransaction(input: RecordKanbanReceiptInput): { recorded: boolean; receipt: KanbanReceipt } {
    const existing = this.db.prepare(`
      SELECT * FROM durable_kanban_receipts
      WHERE execution_id = ? AND round = ? AND actor_agent_id = ? AND dedup_key = ?
    `).get(input.executionId, input.round, input.actorAgentId, input.dedupKey) as unknown as ReceiptRow | undefined;
    if (existing) {
      const receipt = this.rowToReceipt(existing);
      const same = JSON.stringify(receipt.actions) === JSON.stringify(input.actions);
      if (!same) {
        throw new Error(`Kanban receipt conflict: round ${input.round} already recorded a different receipt from ${input.actorAgentId} under dedup key "${input.dedupKey}" (existing receipt ${existing.receipt_id}).`);
      }
      return { recorded: false, receipt };
    }
    const timestamp = nowIso(input.now);
    const receiptId = id("receipt");
    this.db.prepare(`
      INSERT INTO durable_kanban_receipts (receipt_id, execution_id, round, actor_agent_id, actions_json, dedup_key, expected_version, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(receiptId, input.executionId, input.round, input.actorAgentId, JSON.stringify(input.actions), input.dedupKey, input.expectedVersion, timestamp);
    // Checklist changes are NOT applied here: they ride with the round
    // settlement (FinishAttemptInput.kanban.checklist) so that receipts which
    // end up ignored (duplicates, superseded within the round) never mutate
    // the checklist.
    const receipt: KanbanReceipt = {
      receiptId,
      executionId: input.executionId,
      round: input.round,
      actorAgentId: input.actorAgentId,
      actions: input.actions,
      dedupKey: input.dedupKey,
      expectedVersion: input.expectedVersion,
      createdAt: timestamp
    };
    return { recorded: true, receipt };
  }

  /**
   * Round-settlement bookkeeping for the kanban branch: bumps the round
   * counter, applies a handoff (with limit check) and keeps the kanban row in
   * step with the aggregate inside the caller's transaction.
   */
  applyRoundSettlementInTransaction(input: {
    executionId: string;
    round: number;
    nextAgentId?: string;
    handoff?: { fromAgentId: string | null; toAgentId: string; kind: "assign" | "dispatch" | "return"; brief: string };
    retry?: { count: number; nextRetryAt?: string };
    usageGap?: boolean;
  }): void {
    const row = this.requireTaskRow(input.executionId);
    if (input.handoff) {
      // Coordinator pure scheduling (spec 155: 负责人串行派活) is not a member
      // bounce: it re-points the task without consuming the handoff budget.
      const coordinatorDispatch = input.handoff.kind === "dispatch"
        && Boolean(row.coordinator_agent_id)
        && input.handoff.fromAgentId === row.coordinator_agent_id;
      const nextCount = coordinatorDispatch ? Number(row.handoff_count) : Number(row.handoff_count) + 1;
      // Initial assignment and member-to-member handoffs count; the runtime
      // pre-checks this limit and parks the task on the user.
      if (input.handoff.kind !== "assign" && !coordinatorDispatch && Number(row.handoff_count) >= Number(row.budget_handoff_limit)) {
        throw new Error(`Kanban Task ${input.executionId} reached its member handoff limit of ${row.budget_handoff_limit}.`);
      }
      this.db.prepare("UPDATE durable_kanban_tasks SET handoff_count = ?, current_agent_id = ?, updated_at = ? WHERE execution_id = ?")
        .run(nextCount, input.handoff.toAgentId, nowIso(), input.executionId);
      this.db.prepare("INSERT INTO durable_kanban_handoffs (id, execution_id, round, from_agent_id, to_agent_id, kind, brief, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id("handoff"), input.executionId, input.round, input.handoff.fromAgentId, input.handoff.toAgentId, input.handoff.kind, input.handoff.brief, nowIso());
    }
    // The retry ledger keeps its previous value unless this settlement
    // explicitly records a retry or resets it after a completed round.
    const retryCount = input.retry?.count ?? Number(row.retry_count);
    const nextRetryAt = input.retry ? (input.retry.nextRetryAt ?? null) : (row.next_retry_at ?? null);
    this.db.prepare(`
      UPDATE durable_kanban_tasks SET
        round_count = MAX(round_count, ?),
        retry_count = ?,
        next_retry_at = ?,
        usage_gap_count = usage_gap_count + ?,
        updated_at = ?
      WHERE execution_id = ?
    `).run(
      input.round,
      retryCount,
      nextRetryAt,
      input.usageGap ? 1 : 0,
      nowIso(),
      input.executionId
    );
  }
}
