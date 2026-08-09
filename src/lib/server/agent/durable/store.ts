import { DatabaseSync } from "node:sqlite";
import { ensureSqliteParentDir, storagePaths } from "$lib/server/infra/db/storage.js";
import {
  DURABLE_EXECUTION_STATUSES,
  EXECUTION_STEP_STATUSES,
  SIDE_EFFECT_CLASSES,
  type AcceptanceCriterion,
  type AcceptanceCriterionInput,
  type AttemptStatus,
  type ClaimAttemptInput,
  type ClaimedAttempt,
  type CreateDurableExecutionInput,
  type DecisionRequest,
  type DurableExecution,
  type DurableExecutionDetail,
  type DurableApprovalRequest,
  type DurableApprovalStatus,
  type DurableExecutionListFilter,
  type DurableExecutionStatus,
  type DurablePrefixEntry,
  type EvidenceRef,
  type ExecutionAttempt,
  type ExecutionStep,
  type ExecutionStepInput,
  type FinishAttemptInput,
  type PlanVersion,
  type RecordAcceptanceResultInput,
  type SideEffectClass,
  type SideEffectInput,
  type SideEffectRecord,
  DurableExecutionBudgetError,
  DurableExecutionConflictError,
  DurableExecutionLeaseError,
  DurableExecutionNotFoundError,
  DurableExecutionTransitionError
} from "./types.js";

export {
  DurableExecutionBudgetError,
  DurableExecutionConflictError,
  DurableExecutionLeaseError,
  DurableExecutionNotFoundError,
  DurableExecutionTransitionError
} from "./types.js";

const TERMINAL_STATUSES = new Set<DurableExecutionStatus>(["partial", "completed", "failed", "cancelled"]);
const ACTIVE_LEASE_STATUSES = new Set<DurableExecutionStatus>(["running", "verifying"]);
const DEFAULT_SIDE_EFFECT_CLASS: SideEffectClass = "non_idempotent";

type DurableControlAction =
  | { actionId: string; executionId: string; action: "pause"; expectedVersion: number; reason?: string; now?: Date }
  | { actionId: string; executionId: string; action: "resume"; expectedVersion: number; now?: Date }
  | { actionId: string; executionId: string; action: "cancel"; expectedVersion: number; reason?: string; now?: Date }
  | { actionId: string; executionId: string; action: "answer_decision"; decisionId: string; answer: string; answeredBy: string; expectedVersion: number; now?: Date }
  | { actionId: string; executionId: string; action: "resolve_approval"; approvalId: string; status: "approved" | "rejected" | "expired"; selectedScope?: string; expectedVersion: number; now?: Date };

const ALLOWED_TRANSITIONS: Record<DurableExecutionStatus, readonly DurableExecutionStatus[]> = {
  planned: ["queued", "running", "paused", "partial", "failed", "cancelled"],
  queued: ["running", "paused", "recovery_required", "partial", "cancelled", "failed"],
  running: ["queued", "verifying", "waiting_for_user", "waiting_for_approval", "paused", "recovery_required", "partial", "failed", "cancelled"],
  verifying: ["running", "waiting_for_user", "waiting_for_approval", "paused", "recovery_required", "partial", "completed", "failed", "cancelled"],
  waiting_for_user: ["queued", "running", "paused", "cancelled", "failed"],
  waiting_for_approval: ["queued", "running", "paused", "cancelled", "failed"],
  paused: ["planned", "queued", "running", "cancelled", "failed"],
  recovery_required: ["queued", "running", "verifying", "waiting_for_user", "paused", "partial", "failed", "cancelled"],
  partial: [],
  completed: [],
  failed: [],
  cancelled: []
};

interface ExecutionRow {
  id: string;
  short_handle: string;
  handle_sequence: number;
  owner_id: string;
  bot_id: string;
  source_channel: string;
  source_chat_id: string | null;
  source_ui_session_id: string | null;
  source_project_id: string | null;
  goal: string;
  constraints_json: string;
  status: DurableExecutionStatus;
  version: number;
  current_plan_version: number;
  lease_owner_id: string | null;
  lease_expires_at: string | null;
  budget_token_limit: number | null;
  budget_attempt_limit: number | null;
  budget_lifetime_days: number | null;
  tokens_used: number;
  attempts_used: number;
  created_at: string;
  started_at: string | null;
  updated_at: string;
  terminal_at: string | null;
  waiting_kind: "user" | "approval" | "recovery" | null;
  waiting_reason: string | null;
  next_run_at: string | null;
  last_error: string | null;
  activation_path: CreateDurableExecutionInput["activationPath"];
  activation_reason: string | null;
}

interface PlanRow {
  execution_id: string;
  plan_version: number;
  revision_reason: string;
  author: "model" | "user";
  created_at: string;
}

interface StepRow {
  id: string;
  execution_id: string;
  plan_version: number;
  step_index: number;
  title: string;
  description: string;
  status: ExecutionStep["status"];
  side_effect_class: SideEffectClass;
  idempotency_key: string | null;
  input_summary: string | null;
  output_summary: string | null;
  output_ref: string | null;
  evidence_summary: string | null;
  attempt_count: number;
  started_at: string | null;
  completed_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

interface CriterionRow {
  id: string;
  execution_id: string;
  plan_version: number;
  description: string;
  required: number;
  checker_type: "deterministic" | "subjective";
  checker_key: string | null;
  author: "model" | "user";
  result: AcceptanceCriterion["result"];
  evidence_ref_id: string | null;
  user_edited: number;
  created_at: string;
  updated_at: string;
}

interface SideEffectRow {
  id: string;
  execution_id: string;
  step_id: string;
  attempt_id: string | null;
  phase: SideEffectRecord["phase"];
  side_effect_class: SideEffectClass;
  idempotency_key: string;
  target_summary: string;
  content_summary: string;
  external_id: string | null;
  payload_json: string | null;
  created_at: string;
}

interface EvidenceRow {
  id: string;
  execution_id: string;
  step_id: string | null;
  attempt_id: string | null;
  reference_type: string;
  reference_id: string;
  summary: string;
  status: EvidenceRef["status"];
  unavailable_reason: string | null;
  created_at: string;
}

interface DecisionRow {
  id: string;
  execution_id: string;
  plan_version: number;
  question: string;
  options_json: string;
  status: DecisionRequest["status"];
  answer: string | null;
  answered_by: string | null;
  created_at: string;
  answered_at: string | null;
}

interface ApprovalRow {
  id: string;
  execution_id: string;
  attempt_id: string | null;
  request_id: string;
  backend: "approval_broker" | "host_bash";
  action_key: string;
  tool_id: string;
  title: string;
  summary: string;
  options_json: string;
  status: DurableApprovalStatus;
  repeat_count: number;
  requested_at: string;
  resolved_at: string | null;
  selected_scope: string | null;
}

interface AttemptRow {
  id: string;
  execution_id: string;
  owner_id: string;
  run_id: string;
  context_session_id: string;
  plan_version: number;
  status: AttemptStatus;
  started_at: string;
  finished_at: string | null;
  end_reason: string | null;
  tokens_used: number;
}

function id(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

function boundedJson(value: unknown, limit = 1200): string {
  if (typeof value === "string") return value.slice(0, limit);
  try {
    return JSON.stringify(value).slice(0, limit);
  } catch {
    return String(value).slice(0, limit);
  }
}

function positiveInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : undefined;
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function nowIso(value?: Date): string {
  return (value ?? new Date()).toISOString();
}

function rowToExecution(row: ExecutionRow): DurableExecution {
  return {
    id: row.id,
    shortHandle: row.short_handle,
    ownerId: row.owner_id,
    botId: row.bot_id,
    sourceChannel: row.source_channel,
    ...(row.source_chat_id ? { sourceChatId: row.source_chat_id } : {}),
    ...(row.source_ui_session_id ? { sourceUiSessionId: row.source_ui_session_id } : {}),
    ...(row.source_project_id ? { sourceProjectId: row.source_project_id } : {}),
    goal: row.goal,
    constraints: parseJson<string[]>(row.constraints_json, []),
    status: row.status,
    version: Number(row.version),
    currentPlanVersion: Number(row.current_plan_version),
    ...(row.lease_owner_id ? { leaseOwnerId: row.lease_owner_id } : {}),
    ...(row.lease_expires_at ? { leaseExpiresAt: row.lease_expires_at } : {}),
    ...(row.budget_token_limit ? { budgetTokenLimit: Number(row.budget_token_limit) } : {}),
    ...(row.budget_attempt_limit ? { budgetAttemptLimit: Number(row.budget_attempt_limit) } : {}),
    ...(row.budget_lifetime_days ? { budgetLifetimeDays: Number(row.budget_lifetime_days) } : {}),
    tokensUsed: Number(row.tokens_used),
    attemptsUsed: Number(row.attempts_used),
    createdAt: row.created_at,
    ...(row.started_at ? { startedAt: row.started_at } : {}),
    updatedAt: row.updated_at,
    ...(row.terminal_at ? { terminalAt: row.terminal_at } : {}),
    ...(row.waiting_kind ? { waitingKind: row.waiting_kind } : {}),
    ...(row.waiting_reason ? { waitingReason: row.waiting_reason } : {}),
    ...(row.next_run_at ? { nextRunAt: row.next_run_at } : {}),
    ...(row.last_error ? { lastError: row.last_error } : {}),
    activationPath: row.activation_path,
    ...(row.activation_reason ? { activationReason: row.activation_reason } : {})
  };
}

function rowToPlan(row: PlanRow): PlanVersion {
  return {
    executionId: row.execution_id,
    version: Number(row.plan_version),
    reason: row.revision_reason,
    author: row.author,
    createdAt: row.created_at
  };
}

function rowToStep(row: StepRow): ExecutionStep {
  return {
    id: row.id,
    executionId: row.execution_id,
    planVersion: Number(row.plan_version),
    index: Number(row.step_index),
    title: row.title,
    description: row.description,
    status: row.status,
    sideEffectClass: row.side_effect_class,
    ...(row.idempotency_key ? { idempotencyKey: row.idempotency_key } : {}),
    ...(row.input_summary ? { inputSummary: row.input_summary } : {}),
    ...(row.output_summary ? { outputSummary: row.output_summary } : {}),
    ...(row.output_ref ? { outputRef: row.output_ref } : {}),
    ...(row.evidence_summary ? { evidenceSummary: row.evidence_summary } : {}),
    attemptCount: Number(row.attempt_count),
    ...(row.started_at ? { startedAt: row.started_at } : {}),
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    ...(row.last_error ? { lastError: row.last_error } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToCriterion(row: CriterionRow): AcceptanceCriterion {
  return {
    id: row.id,
    executionId: row.execution_id,
    planVersion: Number(row.plan_version),
    description: row.description,
    required: row.required === 1,
    checkerType: row.checker_type,
    ...(row.checker_key ? { checkerKey: row.checker_key } : {}),
    author: row.author,
    result: row.result,
    ...(row.evidence_ref_id ? { evidenceRefId: row.evidence_ref_id } : {}),
    userEdited: row.user_edited === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToSideEffect(row: SideEffectRow): SideEffectRecord {
  return {
    id: row.id,
    executionId: row.execution_id,
    stepId: row.step_id,
    ...(row.attempt_id ? { attemptId: row.attempt_id } : {}),
    phase: row.phase,
    sideEffectClass: row.side_effect_class,
    idempotencyKey: row.idempotency_key,
    targetSummary: row.target_summary,
    contentSummary: row.content_summary,
    ...(row.external_id ? { externalId: row.external_id } : {}),
    ...(row.payload_json ? { payload: parseJson(row.payload_json, undefined) } : {}),
    createdAt: row.created_at
  };
}

function rowToEvidence(row: EvidenceRow): EvidenceRef {
  return {
    id: row.id,
    executionId: row.execution_id,
    ...(row.step_id ? { stepId: row.step_id } : {}),
    ...(row.attempt_id ? { attemptId: row.attempt_id } : {}),
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    summary: row.summary,
    status: row.status,
    ...(row.unavailable_reason ? { unavailableReason: row.unavailable_reason } : {}),
    createdAt: row.created_at
  };
}

function rowToDecision(row: DecisionRow): DecisionRequest {
  return {
    id: row.id,
    executionId: row.execution_id,
    planVersion: Number(row.plan_version),
    question: row.question,
    options: parseJson<string[]>(row.options_json, []),
    status: row.status,
    ...(row.answer ? { answer: row.answer } : {}),
    ...(row.answered_by ? { answeredBy: row.answered_by } : {}),
    createdAt: row.created_at,
    ...(row.answered_at ? { answeredAt: row.answered_at } : {})
  };
}

function rowToApproval(row: ApprovalRow): DurableApprovalRequest {
  return {
    id: row.id,
    executionId: row.execution_id,
    ...(row.attempt_id ? { attemptId: row.attempt_id } : {}),
    requestId: row.request_id,
    backend: row.backend,
    actionKey: row.action_key,
    toolId: row.tool_id,
    title: row.title,
    summary: row.summary,
    options: parseJson<string[]>(row.options_json, []),
    status: row.status,
    repeatCount: Number(row.repeat_count),
    requestedAt: row.requested_at,
    ...(row.resolved_at ? { resolvedAt: row.resolved_at } : {}),
    ...(row.selected_scope ? { selectedScope: row.selected_scope } : {})
  };
}

function rowToAttempt(row: AttemptRow): ExecutionAttempt {
  return {
    id: row.id,
    executionId: row.execution_id,
    ownerId: row.owner_id,
    runId: row.run_id,
    contextSessionId: row.context_session_id,
    planVersion: Number(row.plan_version),
    status: row.status,
    startedAt: row.started_at,
    ...(row.finished_at ? { finishedAt: row.finished_at } : {}),
    ...(row.end_reason ? { endReason: row.end_reason } : {}),
    tokensUsed: Number(row.tokens_used)
  };
}

function normalizeSteps(input: ExecutionStepInput[]): ExecutionStepInput[] {
  return input.map((step) => {
    const title = text(step.title);
    if (!title) throw new Error("Durable Execution step title is required.");
    return {
      title,
      description: text(step.description),
      sideEffectClass: step.sideEffectClass ?? DEFAULT_SIDE_EFFECT_CLASS,
      idempotencyKey: text(step.idempotencyKey) || undefined,
      inputSummary: text(step.inputSummary) || undefined
    };
  });
}

function normalizeCriteria(input: AcceptanceCriterionInput[]): AcceptanceCriterionInput[] {
  return input.map((criterion) => {
    const description = text(criterion.description);
    if (!description) throw new Error("Durable Execution acceptance criterion is required.");
    const checkerType = criterion.checkerType ?? (criterion.checkerKey ? "deterministic" : "subjective");
    return {
      description,
      required: criterion.required !== false,
      checkerType,
      checkerKey: text(criterion.checkerKey) || undefined,
      author: criterion.author ?? "model"
    };
  });
}

export class DurableExecutionStore {
  private readonly db: DatabaseSync;

  constructor(dbFile = storagePaths.durableExecutionDbFile) {
    ensureSqliteParentDir(dbFile);
    this.db = new DatabaseSync(dbFile);
    this.db.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
    this.ensureSchema();
  }

  close(): void {
    this.db.close();
  }

  create(input: CreateDurableExecutionInput): DurableExecution {
    const ownerId = text(input.ownerId);
    const botId = text(input.botId);
    const goal = text(input.goal);
    const steps = normalizeSteps(input.steps);
    const criteria = normalizeCriteria(input.acceptanceCriteria);
    if (!ownerId || !botId || !goal) throw new Error("ownerId, botId and goal are required.");
    if (steps.length === 0) throw new Error("At least one Durable Execution step is required.");
    if (criteria.length === 0) throw new Error("At least one acceptance criterion is required.");

    const createdAt = nowIso(input.now);
    const executionId = id("durable");
    const constraints = (input.constraints ?? []).map((value) => text(value)).filter(Boolean);
    const tokenLimit = positiveInt(input.budget?.tokenLimit);
    const attemptLimit = positiveInt(input.budget?.attemptLimit);
    const lifetimeDays = positiveInt(input.budget?.lifetimeDays);

    this.db.exec("BEGIN IMMEDIATE");
    try {
      const sequenceRow = this.db.prepare("SELECT COALESCE(MAX(handle_sequence), 0) + 1 AS next FROM durable_executions WHERE owner_id = ?").get(ownerId) as { next: number };
      const handleSequence = Number(sequenceRow.next);
      const execution: ExecutionRow = {
        id: executionId,
        short_handle: `#${handleSequence}`,
        handle_sequence: handleSequence,
        owner_id: ownerId,
        bot_id: botId,
        source_channel: text(input.sourceChannel, "web"),
        source_chat_id: text(input.sourceChatId) || null,
        source_ui_session_id: text(input.sourceUiSessionId) || null,
        source_project_id: text(input.sourceProjectId) || null,
        goal,
        constraints_json: JSON.stringify(constraints),
        status: "planned",
        version: 1,
        current_plan_version: 1,
        lease_owner_id: null,
        lease_expires_at: null,
        budget_token_limit: tokenLimit ?? null,
        budget_attempt_limit: attemptLimit ?? null,
        budget_lifetime_days: lifetimeDays ?? null,
        tokens_used: 0,
        attempts_used: 0,
        created_at: createdAt,
        started_at: null,
        updated_at: createdAt,
        terminal_at: null,
        waiting_kind: null,
        waiting_reason: null,
        next_run_at: null,
        last_error: null,
        activation_path: input.activationPath,
        activation_reason: text(input.activationReason) || null
      };
      this.db.prepare(`
        INSERT INTO durable_executions (
          id, short_handle, handle_sequence, owner_id, bot_id, source_channel, source_chat_id,
          source_ui_session_id, source_project_id, goal, constraints_json, status, version,
          current_plan_version, lease_owner_id, lease_expires_at, budget_token_limit,
          budget_attempt_limit, budget_lifetime_days, tokens_used, attempts_used, created_at,
          started_at, updated_at, terminal_at, waiting_kind, waiting_reason, next_run_at,
          last_error, activation_path, activation_reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        execution.id, execution.short_handle, execution.handle_sequence, execution.owner_id,
        execution.bot_id, execution.source_channel, execution.source_chat_id, execution.source_ui_session_id,
        execution.source_project_id, execution.goal, execution.constraints_json, execution.status,
        execution.version, execution.current_plan_version, execution.lease_owner_id, execution.lease_expires_at,
        execution.budget_token_limit, execution.budget_attempt_limit, execution.budget_lifetime_days,
        execution.tokens_used, execution.attempts_used, execution.created_at, execution.started_at,
        execution.updated_at, execution.terminal_at, execution.waiting_kind, execution.waiting_reason,
        execution.next_run_at, execution.last_error, execution.activation_path, execution.activation_reason
      );
      this.db.prepare("INSERT INTO durable_plan_versions (execution_id, plan_version, revision_reason, author, created_at) VALUES (?, 1, ?, 'model', ?)").run(executionId, "initial plan", createdAt);

      const insertStep = this.db.prepare(`
        INSERT INTO durable_steps (
          id, execution_id, plan_version, step_index, title, description, status,
          side_effect_class, idempotency_key, input_summary, output_summary, output_ref,
          evidence_summary, attempt_count, started_at, completed_at, last_error, created_at, updated_at
        ) VALUES (?, ?, 1, ?, ?, ?, 'pending', ?, ?, ?, NULL, NULL, NULL, 0, NULL, NULL, NULL, ?, ?)
      `);
      steps.forEach((step, index) => insertStep.run(
        id("step"), executionId, index, step.title, step.description ?? "",
        step.sideEffectClass ?? DEFAULT_SIDE_EFFECT_CLASS, step.idempotencyKey ?? null, step.inputSummary ?? null, createdAt, createdAt
      ));

      const insertCriterion = this.db.prepare(`
        INSERT INTO durable_acceptance_criteria (
          id, execution_id, plan_version, description, required, checker_type, checker_key,
          author, result, evidence_ref_id, user_edited, created_at, updated_at
        ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, 'unproven', NULL, ?, ?, ?)
      `);
      criteria.forEach((criterion) => insertCriterion.run(
        id("criterion"), executionId, criterion.description, criterion.required === false ? 0 : 1,
        criterion.checkerType ?? (criterion.checkerKey ? "deterministic" : "subjective"), criterion.checkerKey ?? null, criterion.author ?? "model",
        criterion.author === "user" ? 1 : 0, createdAt, createdAt
      ));

      this.db.exec("COMMIT");
      return rowToExecution(execution);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /**
   * Absorb the already completed prefix of an ordinary Run before the newly
   * promoted execution is activated. This is a store-owned mutation so a
   * promotion cannot leave the plan visible without its evidence boundary.
   */
  absorbPrefix(executionId: string, expectedVersion: number, prefix: DurablePrefixEntry[]): DurableExecution {
    if (prefix.length === 0) {
      const current = this.getById(executionId);
      if (!current) throw new DurableExecutionNotFoundError(executionId);
      if (current.version !== expectedVersion) throw new DurableExecutionConflictError(executionId, expectedVersion, current.version);
      return current;
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.requireRow(executionId);
      this.assertVersion(current, expectedVersion);
      if (current.status !== "planned") throw new DurableExecutionTransitionError(current.status, "planned");
      const steps = this.db.prepare("SELECT * FROM durable_steps WHERE execution_id = ? AND plan_version = ? ORDER BY step_index ASC").all(executionId, current.current_plan_version) as unknown as StepRow[];
      if (prefix.length > steps.length) throw new Error("Durable promotion prefix is longer than its initial plan.");
      const timestamp = new Date().toISOString();
      const updateStep = this.db.prepare(`
        UPDATE durable_steps
        SET status = ?, output_summary = ?, evidence_summary = ?, completed_at = ?, last_error = ?, updated_at = ?
        WHERE id = ? AND execution_id = ? AND plan_version = ?
      `);
      const insertEvidence = this.db.prepare(`
        INSERT INTO durable_evidence_refs (
          id, execution_id, step_id, attempt_id, reference_type, reference_id, summary,
          status, unavailable_reason, created_at
        ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)
      `);
      const insertIntent = this.db.prepare(`
        INSERT OR IGNORE INTO durable_side_effects (
          id, execution_id, step_id, attempt_id, phase, side_effect_class,
          idempotency_key, target_summary, content_summary, external_id, payload_json, created_at
        ) VALUES (?, ?, ?, NULL, 'intent', ?, ?, ?, ?, NULL, NULL, ?)
      `);
      const insertReceipt = this.db.prepare(`
        INSERT OR IGNORE INTO durable_side_effects (
          id, execution_id, step_id, attempt_id, phase, side_effect_class,
          idempotency_key, target_summary, content_summary, external_id, payload_json, created_at
        ) VALUES (?, ?, ?, NULL, 'receipt', ?, ?, ?, ?, ?, ?, ?)
      `);

      prefix.forEach((entry, index) => {
        const step = steps[index];
        if (!step) throw new Error(`Durable promotion step ${index} is missing.`);
        const successful = !entry.isError;
        const status = successful
          ? "completed"
          : entry.effect.sideEffectClass === "pure" ? "failed" : "uncertain";
        const outputSummary = boundedJson(entry.result?.content ?? entry.result?.error ?? "Tool result was observed.");
        const lastError = entry.isError
          ? text(entry.result?.error, "The ordinary Run tool call did not complete successfully.")
          : null;
        updateStep.run(
          status,
          outputSummary,
          successful ? "Absorbed from the ordinary Run with a completed tool result." : "Absorbed from the ordinary Run; external state needs recovery review.",
          successful ? entry.occurredAt : null,
          lastError,
          timestamp,
          step.id,
          executionId,
          current.current_plan_version
        );

        const evidenceSummary = successful
          ? `Tool ${entry.toolId} returned a result in the ordinary Run: ${outputSummary}`
          : `Tool ${entry.toolId} did not return a successful result; external state is uncertain.`;
        insertEvidence.run(
          id("evidence"),
          executionId,
          step.id,
          "ordinary-run-tool-result",
          `${entry.runId}:${entry.toolCallId ?? entry.toolId}`,
          evidenceSummary,
          entry.result ? "available" : "unavailable",
          entry.result ? null : "The ordinary Run did not provide a tool result.",
          entry.occurredAt
        );

        if (entry.effect.sideEffectClass !== "pure") {
          insertIntent.run(
            id("side-effect"),
            executionId,
            step.id,
            entry.effect.sideEffectClass,
            entry.effect.idempotencyKey,
            entry.effect.targetSummary,
            entry.effect.contentSummary,
            entry.occurredAt
          );
          if (successful && entry.result) {
            insertReceipt.run(
              id("side-effect"),
              executionId,
              step.id,
              entry.effect.sideEffectClass,
              entry.effect.idempotencyKey,
              entry.effect.targetSummary,
              `${entry.effect.contentSummary}; result=${outputSummary}`,
              typeof entry.result.metadata?.externalId === "string" ? entry.result.metadata.externalId : null,
              JSON.stringify({ ok: entry.result.ok, content: entry.result.content }),
              entry.occurredAt
            );
          }
        }
      });

      this.db.prepare("UPDATE durable_executions SET version = version + 1, updated_at = ? WHERE id = ? AND version = ?").run(timestamp, executionId, expectedVersion);
      const next = rowToExecution(this.requireRow(executionId));
      this.db.exec("COMMIT");
      return next;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getById(idValue: string, ownerId?: string): DurableExecution | null {
    const idText = text(idValue);
    if (!idText) return null;
    const row = ownerId
      ? this.db.prepare("SELECT * FROM durable_executions WHERE id = ? AND owner_id = ?").get(idText, ownerId)
      : this.db.prepare("SELECT * FROM durable_executions WHERE id = ?").get(idText);
    return row ? rowToExecution(row as unknown as ExecutionRow) : null;
  }

  getByHandle(ownerId: string, handle: string): DurableExecution | null {
    const row = this.db.prepare("SELECT * FROM durable_executions WHERE owner_id = ? AND short_handle = ?").get(text(ownerId), text(handle));
    return row ? rowToExecution(row as unknown as ExecutionRow) : null;
  }

  list(filter: DurableExecutionListFilter): DurableExecution[] {
    const ownerId = text(filter.ownerId);
    if (!ownerId) return [];
    const clauses = ["owner_id = ?"];
    const params: Array<string | number> = [ownerId];
    if (filter.botId) {
      clauses.push("bot_id = ?");
      params.push(text(filter.botId));
    }
    if (filter.statuses && filter.statuses.length > 0) {
      const statuses = filter.statuses.filter((status) => (DURABLE_EXECUTION_STATUSES as readonly string[]).includes(status));
      if (statuses.length === 0) return [];
      clauses.push(`status IN (${statuses.map(() => "?").join(", ")})`);
      params.push(...statuses);
    }
    const limit = Math.max(1, Math.min(200, Math.round(filter.limit ?? 50)));
    const rows = this.db.prepare(`
      SELECT * FROM durable_executions
      WHERE ${clauses.join(" AND ")}
      ORDER BY CASE status
        WHEN 'running' THEN 0 WHEN 'verifying' THEN 0 WHEN 'waiting_for_user' THEN 1
        WHEN 'waiting_for_approval' THEN 1 WHEN 'recovery_required' THEN 1
        WHEN 'queued' THEN 2 WHEN 'paused' THEN 3 ELSE 4 END,
        updated_at DESC
      LIMIT ?
    `).all(...params, limit) as unknown as ExecutionRow[];
    return rows.map(rowToExecution);
  }

  countUnfinished(ownerId: string): number {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM durable_executions WHERE owner_id = ? AND status NOT IN ('partial', 'completed', 'failed', 'cancelled')").get(text(ownerId)) as { count: number };
    return Number(row?.count ?? 0);
  }

  countActive(ownerId: string, now = new Date()): number {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM durable_executions WHERE owner_id = ? AND status IN ('running', 'verifying') AND lease_expires_at IS NOT NULL AND lease_expires_at > ?").get(text(ownerId), nowIso(now)) as { count: number };
    return Number(row?.count ?? 0);
  }

  queuePosition(executionId: string): number | undefined {
    const row = this.db.prepare("SELECT owner_id, status, handle_sequence FROM durable_executions WHERE id = ?").get(text(executionId)) as { owner_id: string; status: DurableExecutionStatus; handle_sequence: number } | undefined;
    if (!row || row.status !== "queued") return undefined;
    const count = this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM durable_executions
      WHERE owner_id = ? AND status = 'queued' AND handle_sequence <= ?
    `).get(row.owner_id, row.handle_sequence) as { count: number };
    return Number(count?.count ?? 0);
  }

  getDetail(idValue: string, ownerId?: string): DurableExecutionDetail | null {
    const execution = this.getById(idValue, ownerId);
    if (!execution) return null;
    const idText = execution.id;
    const plans = (this.db.prepare("SELECT * FROM durable_plan_versions WHERE execution_id = ? ORDER BY plan_version DESC").all(idText) as unknown as PlanRow[]).map(rowToPlan);
    const steps = (this.db.prepare("SELECT * FROM durable_steps WHERE execution_id = ? ORDER BY plan_version DESC, step_index ASC").all(idText) as unknown as StepRow[]).map(rowToStep);
    const acceptanceCriteria = (this.db.prepare("SELECT * FROM durable_acceptance_criteria WHERE execution_id = ? ORDER BY plan_version DESC, created_at ASC").all(idText) as unknown as CriterionRow[]).map(rowToCriterion);
    const sideEffects = (this.db.prepare("SELECT * FROM durable_side_effects WHERE execution_id = ? ORDER BY created_at ASC").all(idText) as unknown as SideEffectRow[]).map(rowToSideEffect);
    const evidenceRefs = (this.db.prepare("SELECT * FROM durable_evidence_refs WHERE execution_id = ? ORDER BY created_at ASC").all(idText) as unknown as EvidenceRow[]).map(rowToEvidence);
    const decisions = (this.db.prepare("SELECT * FROM durable_decisions WHERE execution_id = ? ORDER BY created_at ASC").all(idText) as unknown as DecisionRow[]).map(rowToDecision);
    const approvals = (this.db.prepare("SELECT * FROM durable_approval_requests WHERE execution_id = ? ORDER BY requested_at ASC").all(idText) as unknown as ApprovalRow[]).map(rowToApproval);
    const attempts = (this.db.prepare("SELECT * FROM durable_attempts WHERE execution_id = ? ORDER BY started_at DESC").all(idText) as unknown as AttemptRow[]).map(rowToAttempt);
    return { execution, plans, steps, acceptanceCriteria, sideEffects, evidenceRefs, decisions, approvals, attempts };
  }

  transitionStatus(
    idValue: string,
    expectedVersion: number,
    nextStatus: DurableExecutionStatus,
    patch: { waitingKind?: DurableExecution["waitingKind"]; waitingReason?: string; nextRunAt?: string; lastError?: string } = {}
  ): DurableExecution {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const next = this.transitionStatusInTransaction(idValue, expectedVersion, nextStatus, patch);
      this.db.exec("COMMIT");
      return next;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  pause(idValue: string, expectedVersion: number, reason = "Paused by user."): DurableExecution {
    return this.transitionStatus(idValue, expectedVersion, "paused", { waitingReason: reason });
  }

  resume(idValue: string, expectedVersion: number): DurableExecution {
    return this.transitionStatus(idValue, expectedVersion, "queued", { waitingReason: undefined });
  }

  cancel(idValue: string, expectedVersion: number, reason = "Cancelled by user."): DurableExecution {
    return this.transitionStatus(idValue, expectedVersion, "cancelled", { lastError: reason });
  }

  runControlAction(input: DurableControlAction): DurableExecution {
    const actionId = text(input.actionId);
    if (!actionId) throw new Error("actionId is required.");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.db.prepare("SELECT action, result_json FROM durable_action_receipts WHERE action_id = ? AND execution_id = ?").get(actionId, input.executionId) as { action: string; result_json: string } | undefined;
      if (existing) {
        if (existing.action !== input.action) throw new Error(`Action ID already used for ${existing.action}.`);
        const replayed = parseJson<DurableExecution | null>(existing.result_json, null);
        if (!replayed) throw new Error(`Action receipt is invalid: ${actionId}`);
        this.db.exec("COMMIT");
        return replayed;
      }

      const next = input.action === "pause"
        ? this.transitionStatusInTransaction(input.executionId, input.expectedVersion, "paused", { waitingReason: input.reason ?? "Paused by user." })
        : input.action === "resume"
          ? this.transitionStatusInTransaction(input.executionId, input.expectedVersion, "queued", { waitingReason: undefined })
            : input.action === "cancel"
              ? this.transitionStatusInTransaction(input.executionId, input.expectedVersion, "cancelled", { lastError: input.reason ?? "Cancelled by user." })
              : input.action === "answer_decision"
                ? this.answerDecisionInTransaction(input)
                : this.resolveApprovalInTransaction(input);
      this.db.prepare("INSERT INTO durable_action_receipts (action_id, execution_id, action, result_json, created_at) VALUES (?, ?, ?, ?, ?)").run(
        actionId, input.executionId, input.action, JSON.stringify(next), nowIso(input.now)
      );
      this.db.exec("COMMIT");
      return next;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  claimAttempt(input: ClaimAttemptInput): ClaimedAttempt {
    const now = input.now ?? new Date();
    const startedAt = nowIso(now);
    const leaseDurationMs = Math.max(1000, Math.round(input.leaseDurationMs));
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.requireRow(input.executionId);
      this.assertVersion(current, input.expectedVersion);
      if (TERMINAL_STATUSES.has(current.status) || current.status === "paused" || current.status === "waiting_for_user" || current.status === "waiting_for_approval") {
        throw new DurableExecutionTransitionError(current.status, "running");
      }
      const leaseExpires = Date.parse(current.lease_expires_at ?? "");
      const activeLease = ACTIVE_LEASE_STATUSES.has(current.status) && current.lease_owner_id && Number.isFinite(leaseExpires) && leaseExpires > now.getTime();
      if (activeLease) throw new DurableExecutionLeaseError(input.executionId);
      if (ACTIVE_LEASE_STATUSES.has(current.status) && current.lease_owner_id) {
        this.db.prepare("UPDATE durable_steps SET status = 'uncertain', updated_at = ? WHERE execution_id = ? AND status = 'running'").run(startedAt, input.executionId);
        this.db.prepare("UPDATE durable_attempts SET status = 'interrupted', finished_at = ?, end_reason = 'lease_expired' WHERE execution_id = ? AND status = 'running'").run(startedAt, input.executionId);
      }
      const countTowardsAttemptBudget = input.countTowardsAttemptBudget !== false;
      if (countTowardsAttemptBudget) {
        if (current.budget_attempt_limit && current.attempts_used >= current.budget_attempt_limit) {
          throw new DurableExecutionBudgetError(input.executionId, "attempt limit");
        }
        if (current.budget_token_limit && current.tokens_used >= current.budget_token_limit) {
          throw new DurableExecutionBudgetError(input.executionId, "token limit");
        }
        if (current.budget_lifetime_days && Date.parse(current.created_at) + current.budget_lifetime_days * 86400000 <= now.getTime()) {
          throw new DurableExecutionBudgetError(input.executionId, "lifetime limit");
        }
      }
      const attemptId = id("attempt");
      const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs).toISOString();
      const nextStatus: DurableExecutionStatus = current.status === "queued" || current.status === "planned" || current.status === "recovery_required" ? "running" : current.status;
      this.db.prepare(`
        INSERT INTO durable_attempts (id, execution_id, owner_id, run_id, context_session_id, plan_version, status, started_at, finished_at, end_reason, tokens_used)
        VALUES (?, ?, ?, ?, ?, ?, 'running', ?, NULL, NULL, 0)
      `).run(attemptId, input.executionId, current.owner_id, input.runId, input.contextSessionId, current.current_plan_version, startedAt);
      this.db.prepare(`
        UPDATE durable_executions
        SET status = ?, version = version + 1, lease_owner_id = ?, lease_expires_at = ?,
            attempts_used = attempts_used + ?, started_at = COALESCE(started_at, ?),
            updated_at = ?, waiting_kind = NULL, waiting_reason = NULL, next_run_at = NULL, last_error = NULL
        WHERE id = ? AND version = ?
      `).run(nextStatus, input.processOwnerId, leaseExpiresAt, countTowardsAttemptBudget ? 1 : 0, startedAt, startedAt, input.executionId, input.expectedVersion);
      const execution = rowToExecution(this.requireRow(input.executionId));
      const attempt = rowToAttempt(this.db.prepare("SELECT * FROM durable_attempts WHERE id = ?").get(attemptId) as unknown as AttemptRow);
      this.db.exec("COMMIT");
      return { execution, attempt };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  heartbeat(executionId: string, processOwnerId: string, leaseDurationMs: number, now = new Date()): boolean {
    const timestamp = nowIso(now);
    const expires = new Date(now.getTime() + Math.max(1000, Math.round(leaseDurationMs))).toISOString();
    const result = this.db.prepare(`UPDATE durable_executions SET lease_expires_at = ?, updated_at = ? WHERE id = ? AND lease_owner_id = ? AND status IN ('running', 'verifying')`).run(expires, timestamp, executionId, processOwnerId);
    return Number(result.changes ?? 0) > 0;
  }

  setAttemptContextSession(executionId: string, attemptId: string, processOwnerId: string, contextSessionId: string): boolean {
    const result = this.db.prepare(`
      UPDATE durable_attempts
      SET context_session_id = ?
      WHERE id = ? AND execution_id = ? AND status = 'running'
        AND EXISTS (
          SELECT 1 FROM durable_executions
          WHERE id = ? AND lease_owner_id = ? AND status IN ('running', 'verifying')
        )
    `).run(String(contextSessionId).trim(), attemptId, executionId, executionId, processOwnerId);
    return Number(result.changes ?? 0) > 0;
  }

  deferQueued(executionId: string, expectedVersion: number, delayMs = 1000, now = new Date()): DurableExecution {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.requireRow(executionId);
      this.assertVersion(current, expectedVersion);
      if (current.status !== "queued") throw new DurableExecutionTransitionError(current.status, "queued");
      const timestamp = nowIso(now);
      const nextRunAt = new Date(now.getTime() + Math.max(250, Math.round(delayMs))).toISOString();
      this.db.prepare("UPDATE durable_executions SET version = version + 1, next_run_at = ?, updated_at = ?, last_error = NULL WHERE id = ? AND version = ?").run(nextRunAt, timestamp, executionId, expectedVersion);
      const next = rowToExecution(this.requireRow(executionId));
      this.db.exec("COMMIT");
      return next;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  finishAttempt(input: FinishAttemptInput): DurableExecution {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.requireRow(input.executionId);
      this.assertVersion(current, input.expectedVersion);
      this.assertLease(current, input.processOwnerId);
      const attempt = this.db.prepare("SELECT * FROM durable_attempts WHERE id = ? AND execution_id = ? AND status = 'running'").get(input.attemptId, input.executionId) as AttemptRow | undefined;
      if (!attempt) throw new Error(`Running attempt not found: ${input.attemptId}`);
      this.assertTransition(current.status, input.nextExecutionStatus);
      const timestamp = nowIso(input.now);
      const waitingKind = input.waitingKind
        ?? (input.nextExecutionStatus === "waiting_for_user" ? "user" : input.nextExecutionStatus === "waiting_for_approval" ? "approval" : input.nextExecutionStatus === "recovery_required" ? "recovery" : undefined);
      const waitingReason = waitingKind ? input.reason ?? null : null;
      const lastError = ["failed", "recovery_required", "partial"].includes(input.nextExecutionStatus)
        ? input.reason ?? null
        : null;
      this.db.prepare("UPDATE durable_attempts SET status = ?, finished_at = ?, end_reason = ?, tokens_used = ? WHERE id = ?").run(input.status, timestamp, input.reason ?? null, Math.max(0, Math.round(input.tokensUsed ?? 0)), input.attemptId);
      this.db.prepare(`UPDATE durable_executions SET status = ?, version = version + 1, lease_owner_id = NULL, lease_expires_at = NULL, tokens_used = tokens_used + ?, updated_at = ?, terminal_at = ?, waiting_kind = ?, waiting_reason = ?, last_error = ? WHERE id = ? AND version = ?`).run(
        input.nextExecutionStatus, Math.max(0, Math.round(input.tokensUsed ?? 0)), timestamp,
        TERMINAL_STATUSES.has(input.nextExecutionStatus) ? timestamp : null,
        waitingKind ?? null, waitingReason, lastError, input.executionId, input.expectedVersion
      );
      const execution = rowToExecution(this.requireRow(input.executionId));
      this.db.exec("COMMIT");
      return execution;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  recordAcceptanceResult(input: RecordAcceptanceResultInput): AcceptanceCriterion {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.requireRow(input.executionId);
      this.assertVersion(current, input.expectedVersion);
      this.assertLease(current, input.processOwnerId);
      const criterion = this.db.prepare("SELECT * FROM durable_acceptance_criteria WHERE id = ? AND execution_id = ?").get(input.criterionId, input.executionId) as CriterionRow | undefined;
      if (!criterion) throw new Error(`Acceptance criterion not found: ${input.criterionId}`);
      if (criterion.user_edited) {
        this.db.exec("COMMIT");
        return rowToCriterion(criterion);
      }
      const timestamp = nowIso(input.now);
      this.db.prepare("UPDATE durable_acceptance_criteria SET result = ?, evidence_ref_id = ?, updated_at = ? WHERE id = ? AND execution_id = ?").run(
        input.result,
        input.evidenceRefId ?? null,
        timestamp,
        input.criterionId,
        input.executionId
      );
      this.bumpExecution(input.executionId, input.expectedVersion, timestamp);
      const next = this.db.prepare("SELECT * FROM durable_acceptance_criteria WHERE id = ? AND execution_id = ?").get(input.criterionId, input.executionId) as unknown as CriterionRow;
      this.db.exec("COMMIT");
      return rowToCriterion(next);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  reconcileOrphanedAttempts(processOwnerId: string, now = new Date()): number {
    const timestamp = nowIso(now);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const rows = this.db.prepare("SELECT * FROM durable_executions WHERE status IN ('running', 'verifying') AND lease_owner_id IS NOT NULL AND lease_owner_id != ?").all(processOwnerId) as unknown as ExecutionRow[];
      for (const row of rows) {
        const isVerifying = row.status === "verifying";
        if (!isVerifying) {
          this.db.prepare("UPDATE durable_steps SET status = 'uncertain', updated_at = ? WHERE execution_id = ? AND status = 'running'").run(timestamp, row.id);
        }
        this.db.prepare("UPDATE durable_attempts SET status = 'interrupted', finished_at = ?, end_reason = ? WHERE execution_id = ? AND status = 'running'").run(timestamp, isVerifying ? "verification_interrupted" : "service_restarted", row.id);
        this.db.prepare(`UPDATE durable_executions SET status = ?, version = version + 1, lease_owner_id = NULL, lease_expires_at = NULL, waiting_kind = ?, waiting_reason = ?, last_error = ?, updated_at = ? WHERE id = ? AND version = ?`).run(
          isVerifying ? "verifying" : "recovery_required",
          isVerifying ? null : "recovery",
          isVerifying ? null : "An active step has uncertain external state.",
          isVerifying ? "Verification was interrupted and will be recomputed." : "An active step has uncertain external state.",
          timestamp, row.id, row.version
        );
      }
      this.db.exec("COMMIT");
      return rows.length;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  markStepRunning(executionId: string, stepId: string, expectedVersion: number, processOwnerId: string, now = new Date()): ExecutionStep {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.requireRow(executionId);
      this.assertVersion(current, expectedVersion);
      this.assertLease(current, processOwnerId);
      const step = this.requireStep(executionId, stepId);
      if (step.status !== "pending" && step.status !== "uncertain") throw new Error(`Step cannot start from ${step.status}`);
      const timestamp = nowIso(now);
      this.db.prepare("UPDATE durable_steps SET status = 'running', attempt_count = attempt_count + 1, started_at = ?, completed_at = NULL, last_error = NULL, updated_at = ? WHERE id = ? AND execution_id = ?").run(timestamp, timestamp, stepId, executionId);
      this.bumpExecution(executionId, expectedVersion, timestamp);
      const next = this.requireStep(executionId, stepId);
      this.db.exec("COMMIT");
      return rowToStep(next);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  completeStep(input: { executionId: string; stepId: string; expectedVersion: number; processOwnerId: string; outputSummary?: string; outputRef?: string; evidenceSummary?: string; now?: Date }): ExecutionStep {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.requireRow(input.executionId);
      this.assertVersion(current, input.expectedVersion);
      this.assertLease(current, input.processOwnerId);
      const step = this.requireStep(input.executionId, input.stepId);
      if (step.status !== "running") throw new Error(`Step cannot complete from ${step.status}`);
      const timestamp = nowIso(input.now);
      this.db.prepare("UPDATE durable_steps SET status = 'completed', output_summary = ?, output_ref = ?, evidence_summary = ?, completed_at = ?, updated_at = ? WHERE id = ? AND execution_id = ?").run(
        text(input.outputSummary) || null, text(input.outputRef) || null, text(input.evidenceSummary) || null, timestamp, timestamp, input.stepId, input.executionId
      );
      this.bumpExecution(input.executionId, input.expectedVersion, timestamp);
      const next = this.requireStep(input.executionId, input.stepId);
      this.db.exec("COMMIT");
      return rowToStep(next);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  reconcileQueryableStep(input: {
    executionId: string;
    stepId: string;
    expectedVersion: number;
    outcome: "completed" | "not_found";
    summary: string;
    referenceId: string;
    externalId?: string;
    now?: Date;
  }): DurableExecution {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.requireRow(input.executionId);
      this.assertVersion(current, input.expectedVersion);
      if (current.status !== "recovery_required") throw new DurableExecutionTransitionError(current.status, "recovery_required");
      const step = this.requireStep(input.executionId, input.stepId);
      if (step.side_effect_class !== "queryable") throw new Error("Only queryable steps can be reconciled by an external probe.");
      const timestamp = nowIso(input.now);
      const summary = text(input.summary, "Queryable recovery probe completed.");
      this.db.prepare("UPDATE durable_steps SET status = ?, output_summary = ?, evidence_summary = ?, output_ref = ?, completed_at = ?, last_error = NULL, updated_at = ? WHERE id = ? AND execution_id = ?").run(
        input.outcome === "completed" ? "completed" : "pending",
        input.outcome === "completed" ? summary : null,
        summary,
        text(input.externalId) || null,
        input.outcome === "completed" ? timestamp : null,
        timestamp,
        input.stepId,
        input.executionId
      );
      this.db.prepare("INSERT INTO durable_evidence_refs (id, execution_id, step_id, attempt_id, reference_type, reference_id, summary, status, unavailable_reason, created_at) VALUES (?, ?, ?, NULL, 'durable-queryable-probe', ?, ?, 'available', NULL, ?)").run(
        id("evidence"), input.executionId, input.stepId, text(input.referenceId, "queryable-probe"), summary, timestamp
      );
      const intent = this.db.prepare("SELECT * FROM durable_side_effects WHERE execution_id = ? AND step_id = ? AND phase = 'intent' ORDER BY created_at DESC LIMIT 1").get(input.executionId, input.stepId) as SideEffectRow | undefined;
      if (input.outcome === "completed" && intent) {
        this.db.prepare(`INSERT OR IGNORE INTO durable_side_effects (
          id, execution_id, step_id, attempt_id, phase, side_effect_class,
          idempotency_key, target_summary, content_summary, external_id, payload_json, created_at
        ) VALUES (?, ?, ?, ?, 'receipt', 'queryable', ?, ?, ?, ?, ?, ?)`).run(
          id("side-effect-receipt"), input.executionId, input.stepId, intent.attempt_id,
          intent.idempotency_key, intent.target_summary, summary, text(input.externalId) || null,
          JSON.stringify({ source: "queryable_probe", referenceId: input.referenceId }), timestamp
        );
      }
      this.bumpExecution(input.executionId, input.expectedVersion, timestamp);
      const next = rowToExecution(this.requireRow(input.executionId));
      this.db.exec("COMMIT");
      return next;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  recordSideEffectIntent(input: SideEffectInput): SideEffectRecord {
    return this.recordSideEffect(input, "intent");
  }

  recordSideEffectReceipt(input: SideEffectInput): SideEffectRecord {
    return this.recordSideEffect(input, "receipt");
  }

  private recordSideEffect(input: SideEffectInput, phase: SideEffectRecord["phase"]): SideEffectRecord {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.requireRow(input.executionId);
      this.assertVersion(current, input.expectedVersion);
      this.assertLease(current, input.processOwnerId);
      this.requireStep(input.executionId, input.stepId);
      const existing = this.db.prepare("SELECT * FROM durable_side_effects WHERE execution_id = ? AND step_id = ? AND phase = ? AND idempotency_key = ?").get(input.executionId, input.stepId, phase, text(input.idempotencyKey)) as SideEffectRow | undefined;
      if (existing) {
        this.db.exec("COMMIT");
        return rowToSideEffect(existing);
      }
      const timestamp = nowIso(input.now);
      const recordId = id(`side-effect-${phase}`);
      this.db.prepare(`INSERT INTO durable_side_effects (id, execution_id, step_id, attempt_id, phase, side_effect_class, idempotency_key, target_summary, content_summary, external_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        recordId, input.executionId, input.stepId, input.attemptId ?? null, phase, input.sideEffectClass,
        text(input.idempotencyKey), text(input.targetSummary), text(input.contentSummary), text(input.externalId) || null,
        input.payload === undefined ? null : JSON.stringify(input.payload), timestamp
      );
      this.bumpExecution(input.executionId, input.expectedVersion, timestamp);
      const record = this.db.prepare("SELECT * FROM durable_side_effects WHERE id = ?").get(recordId) as unknown as SideEffectRow;
      this.db.exec("COMMIT");
      return rowToSideEffect(record);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  openDecision(input: { executionId: string; question: string; options: string[]; expectedVersion: number; processOwnerId: string; planVersion?: number; now?: Date }): DecisionRequest {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.requireRow(input.executionId);
      this.assertVersion(current, input.expectedVersion);
      this.assertLease(current, input.processOwnerId);
      const question = text(input.question);
      const options = input.options.map((option) => text(option)).filter(Boolean);
      if (!question || options.length === 0) throw new Error("Decision question and options are required.");
      const timestamp = nowIso(input.now);
      const decisionId = id("decision");
      this.db.prepare("INSERT INTO durable_decisions (id, execution_id, plan_version, question, options_json, status, answer, answered_by, created_at, answered_at) VALUES (?, ?, ?, ?, ?, 'open', NULL, NULL, ?, NULL)").run(decisionId, input.executionId, input.planVersion ?? current.current_plan_version, question, JSON.stringify(options), timestamp);
      this.db.prepare("UPDATE durable_attempts SET status = 'waiting', finished_at = ?, end_reason = 'waiting_for_user' WHERE execution_id = ? AND status = 'running'").run(timestamp, input.executionId);
      this.db.prepare("UPDATE durable_executions SET status = 'waiting_for_user', version = version + 1, lease_owner_id = NULL, lease_expires_at = NULL, waiting_kind = 'user', waiting_reason = ?, updated_at = ? WHERE id = ? AND version = ?").run(question, timestamp, input.executionId, input.expectedVersion);
      const row = this.db.prepare("SELECT * FROM durable_decisions WHERE id = ?").get(decisionId) as unknown as DecisionRow;
      this.db.exec("COMMIT");
      return rowToDecision(row);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  openRecoveryDecision(input: { executionId: string; question: string; options: string[]; expectedVersion: number; planVersion?: number; now?: Date }): DecisionRequest {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.requireRow(input.executionId);
      this.assertVersion(current, input.expectedVersion);
      if (current.status !== "recovery_required") throw new DurableExecutionTransitionError(current.status, "waiting_for_user");
      const question = text(input.question);
      const options = input.options.map((option) => text(option)).filter(Boolean);
      if (!question || options.length === 0) throw new Error("Decision question and options are required.");
      const timestamp = nowIso(input.now);
      const decisionId = id("decision");
      this.db.prepare("INSERT INTO durable_decisions (id, execution_id, plan_version, question, options_json, status, answer, answered_by, created_at, answered_at) VALUES (?, ?, ?, ?, ?, 'open', NULL, NULL, ?, NULL)").run(
        decisionId, input.executionId, input.planVersion ?? current.current_plan_version, question, JSON.stringify(options), timestamp
      );
      this.db.prepare("UPDATE durable_executions SET status = 'waiting_for_user', version = version + 1, lease_owner_id = NULL, lease_expires_at = NULL, waiting_kind = 'recovery', waiting_reason = ?, updated_at = ? WHERE id = ? AND version = ?").run(
        question, timestamp, input.executionId, input.expectedVersion
      );
      const row = this.db.prepare("SELECT * FROM durable_decisions WHERE id = ?").get(decisionId) as unknown as DecisionRow;
      this.db.exec("COMMIT");
      return rowToDecision(row);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  answerDecision(input: { executionId: string; decisionId: string; answer: string; answeredBy: string; expectedVersion: number; now?: Date }): DurableExecution {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const next = this.answerDecisionInTransaction(input);
      this.db.exec("COMMIT");
      return next;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  recordApprovalRequest(input: {
    executionId: string;
    attemptId: string;
    expectedVersion: number;
    processOwnerId: string;
    requestId: string;
    backend: "approval_broker" | "host_bash";
    actionKey: string;
    toolId: string;
    title: string;
    summary: string;
    options: string[];
    now?: Date;
  }): DurableApprovalRequest {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.requireRow(input.executionId);
      this.assertVersion(current, input.expectedVersion);
      this.assertLease(current, input.processOwnerId);
      const existing = this.db.prepare("SELECT * FROM durable_approval_requests WHERE execution_id = ? AND request_id = ?").get(input.executionId, text(input.requestId)) as ApprovalRow | undefined;
      if (existing) {
        this.db.exec("COMMIT");
        return rowToApproval(existing);
      }
      const previous = this.db.prepare("SELECT COALESCE(MAX(repeat_count), 0) AS repeat_count FROM durable_approval_requests WHERE execution_id = ? AND action_key = ?").get(input.executionId, text(input.actionKey)) as { repeat_count: number };
      const timestamp = nowIso(input.now);
      const approvalId = id("approval");
      this.db.prepare(`
        INSERT INTO durable_approval_requests (
          id, execution_id, attempt_id, request_id, backend, action_key, tool_id, title,
          summary, options_json, status, repeat_count, requested_at, resolved_at, selected_scope
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL, NULL)
      `).run(
        approvalId,
        input.executionId,
        input.attemptId,
        text(input.requestId),
        input.backend,
        text(input.actionKey),
        text(input.toolId),
        text(input.title, "Approval required"),
        text(input.summary, "A controlled action needs your approval."),
        JSON.stringify(input.options.map((option) => text(option)).filter(Boolean)),
        Math.max(1, Number(previous.repeat_count ?? 0) + 1),
        timestamp
      );
      this.bumpExecution(input.executionId, input.expectedVersion, timestamp);
      const row = this.db.prepare("SELECT * FROM durable_approval_requests WHERE id = ?").get(approvalId) as unknown as ApprovalRow;
      this.db.exec("COMMIT");
      return rowToApproval(row);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  consumeApprovedApproval(input: {
    executionId: string;
    approvalId: string;
    expectedVersion: number;
    processOwnerId: string;
  }): DurableApprovalRequest | null {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.requireRow(input.executionId);
      this.assertVersion(current, input.expectedVersion);
      this.assertLease(current, input.processOwnerId);
      const approval = this.db.prepare("SELECT * FROM durable_approval_requests WHERE id = ? AND execution_id = ?").get(input.approvalId, input.executionId) as ApprovalRow | undefined;
      if (!approval || approval.status !== "approved") {
        this.db.exec("COMMIT");
        return null;
      }
      const scope = approval.selected_scope ?? "once";
      if (scope === "once") {
        // A one-time approval is consumed before the handler starts. If the
        // process dies after this point, recovery asks again instead of
        // replaying an approved external action.
        const timestamp = new Date().toISOString();
        this.db.prepare("UPDATE durable_approval_requests SET status = 'expired' WHERE id = ? AND status = 'approved'").run(input.approvalId);
        this.bumpExecution(input.executionId, input.expectedVersion, timestamp);
      }
      const row = this.db.prepare("SELECT * FROM durable_approval_requests WHERE id = ?").get(input.approvalId) as unknown as ApprovalRow;
      this.db.exec("COMMIT");
      return rowToApproval(row);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private resolveApprovalInTransaction(input: Extract<DurableControlAction, { action: "resolve_approval" }>): DurableExecution {
    const current = this.requireRow(input.executionId);
    this.assertVersion(current, input.expectedVersion);
    if (current.status !== "waiting_for_approval") throw new DurableExecutionTransitionError(current.status, "queued");
    const approval = this.db.prepare("SELECT * FROM durable_approval_requests WHERE id = ? AND execution_id = ?").get(input.approvalId, input.executionId) as ApprovalRow | undefined;
    if (!approval) throw new Error(`Approval request not found: ${input.approvalId}`);
    if (approval.status !== "pending") return rowToExecution(current);
    const timestamp = nowIso(input.now);
    const nextStatus = input.status === "approved" ? "queued" : "failed";
    const reason = input.status === "approved"
      ? null
      : input.status === "expired" ? "The approval request expired." : "The approval request was rejected.";
    this.db.prepare("UPDATE durable_approval_requests SET status = ?, selected_scope = ?, resolved_at = ? WHERE id = ? AND status = 'pending'").run(
      input.status,
      text(input.selectedScope) || null,
      timestamp,
      input.approvalId
    );
    this.db.prepare(`
      UPDATE durable_executions
      SET status = ?, version = version + 1, lease_owner_id = NULL, lease_expires_at = NULL,
          waiting_kind = NULL, waiting_reason = NULL, next_run_at = NULL, last_error = ?,
          terminal_at = ?, updated_at = ?
      WHERE id = ? AND version = ?
    `).run(
      nextStatus,
      reason,
      nextStatus === "failed" ? timestamp : null,
      timestamp,
      input.executionId,
      input.expectedVersion
    );
    return rowToExecution(this.requireRow(input.executionId));
  }

  addEvidence(input: { executionId: string; stepId?: string; attemptId?: string; referenceType: string; referenceId: string; summary: string; now?: Date }): EvidenceRef {
    const timestamp = nowIso(input.now);
    const evidenceId = id("evidence");
    this.db.prepare("INSERT INTO durable_evidence_refs (id, execution_id, step_id, attempt_id, reference_type, reference_id, summary, status, unavailable_reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'available', NULL, ?)").run(
      evidenceId, input.executionId, input.stepId ?? null, input.attemptId ?? null, text(input.referenceType), text(input.referenceId), text(input.summary), timestamp
    );
    return rowToEvidence(this.db.prepare("SELECT * FROM durable_evidence_refs WHERE id = ?").get(evidenceId) as unknown as EvidenceRow);
  }

  markEvidenceUnavailable(evidenceId: string, reason: string, now = new Date()): boolean {
    const result = this.db.prepare("UPDATE durable_evidence_refs SET status = 'unavailable', unavailable_reason = ? WHERE id = ?").run(text(reason, "Evidence is unavailable."), evidenceId);
    return Number(result.changes ?? 0) > 0;
  }

  getActionReceipt(actionId: string, executionId: string): { action: string; result: unknown } | null {
    const row = this.db.prepare("SELECT action, result_json FROM durable_action_receipts WHERE action_id = ? AND execution_id = ?").get(text(actionId), executionId) as { action: string; result_json: string } | undefined;
    return row ? { action: row.action, result: parseJson(row.result_json, null) } : null;
  }

  saveActionReceipt(actionId: string, executionId: string, action: string, result: unknown, now = new Date()): void {
    this.db.prepare("INSERT OR IGNORE INTO durable_action_receipts (action_id, execution_id, action, result_json, created_at) VALUES (?, ?, ?, ?, ?)").run(
      text(actionId), executionId, text(action), JSON.stringify(result), nowIso(now)
    );
  }

  private transitionStatusInTransaction(
    idValue: string,
    expectedVersion: number,
    nextStatus: DurableExecutionStatus,
    patch: { waitingKind?: DurableExecution["waitingKind"]; waitingReason?: string; nextRunAt?: string; lastError?: string } = {}
  ): DurableExecution {
    const current = this.requireRow(idValue);
    this.assertVersion(current, expectedVersion);
    if (current.status === "waiting_for_approval" && nextStatus === "queued") {
      throw new DurableExecutionTransitionError(current.status, nextStatus);
    }
    this.assertTransition(current.status, nextStatus);
    const timestamp = new Date().toISOString();
    const leavesActiveLease = ACTIVE_LEASE_STATUSES.has(nextStatus);
    if (!leavesActiveLease) {
      this.db.prepare("UPDATE durable_attempts SET status = 'interrupted', finished_at = ?, end_reason = ? WHERE execution_id = ? AND status = 'running'").run(
        timestamp, patch.lastError ?? patch.waitingReason ?? `execution_${nextStatus}`, idValue
      );
      if (current.status === "running") {
        this.db.prepare("UPDATE durable_steps SET status = 'uncertain', updated_at = ?, last_error = ? WHERE execution_id = ? AND status = 'running'").run(
          timestamp, patch.lastError ?? patch.waitingReason ?? `execution_${nextStatus}`, idValue
        );
      }
    }
    const terminalAt = TERMINAL_STATUSES.has(nextStatus) ? timestamp : null;
    this.db.prepare(`
      UPDATE durable_executions
      SET status = ?, version = version + 1, updated_at = ?, terminal_at = ?,
          lease_owner_id = ?, lease_expires_at = ?,
          waiting_kind = ?, waiting_reason = ?, next_run_at = ?, last_error = ?
      WHERE id = ? AND version = ?
    `).run(
      nextStatus,
      timestamp,
      terminalAt,
      leavesActiveLease ? current.lease_owner_id : null,
      leavesActiveLease ? current.lease_expires_at : null,
      patch.waitingKind ?? null,
      patch.waitingReason ?? null,
      patch.nextRunAt ?? null,
      patch.lastError ?? null,
      idValue,
      expectedVersion
    );
    return rowToExecution(this.requireRow(idValue));
  }

  private answerDecisionInTransaction(input: { executionId: string; decisionId: string; answer: string; answeredBy: string; expectedVersion: number; now?: Date }): DurableExecution {
    const current = this.requireRow(input.executionId);
    this.assertVersion(current, input.expectedVersion);
    const decision = this.db.prepare("SELECT * FROM durable_decisions WHERE id = ? AND execution_id = ?").get(input.decisionId, input.executionId) as DecisionRow | undefined;
    if (!decision) throw new Error(`Decision not found: ${input.decisionId}`);
    if (decision.status !== "open") return rowToExecution(current);
    this.assertTransition(current.status, "queued");
    const answer = text(input.answer);
    if (!answer || !parseJson<string[]>(decision.options_json, []).includes(answer)) throw new Error("Decision answer is not one of the allowed options.");
    const timestamp = nowIso(input.now);
    this.db.prepare("UPDATE durable_decisions SET status = 'answered', answer = ?, answered_by = ?, answered_at = ? WHERE id = ? AND status = 'open'").run(
      answer, text(input.answeredBy, "user"), timestamp, input.decisionId
    );
    if (answer === "confirm_completion") {
      this.db.prepare(`
        UPDATE durable_acceptance_criteria
        SET result = 'passed', user_edited = 1, updated_at = ?
        WHERE execution_id = ? AND plan_version = ? AND required = 1
          AND checker_type = 'subjective' AND result = 'unproven'
      `).run(timestamp, input.executionId, current.current_plan_version);
    } else if (answer === "continue_work") {
      this.appendContinuationPlanInTransaction(current, timestamp);
    }
    this.db.prepare("UPDATE durable_executions SET status = 'queued', version = version + 1, lease_owner_id = NULL, lease_expires_at = NULL, waiting_kind = NULL, waiting_reason = NULL, next_run_at = NULL, last_error = NULL, updated_at = ? WHERE id = ? AND version = ?").run(
      timestamp, input.executionId, input.expectedVersion
    );
    return rowToExecution(this.requireRow(input.executionId));
  }

  private appendContinuationPlanInTransaction(current: ExecutionRow, timestamp: string): void {
    const nextPlanVersion = current.current_plan_version + 1;
    this.db.prepare("INSERT INTO durable_plan_versions (execution_id, plan_version, revision_reason, author, created_at) VALUES (?, ?, ?, 'user', ?)").run(
      current.id,
      nextPlanVersion,
      "Owner requested another controlled attempt after verification.",
      timestamp
    );
    this.db.prepare(`
      INSERT INTO durable_steps (
        id, execution_id, plan_version, step_index, title, description, status,
        side_effect_class, idempotency_key, input_summary, output_summary, output_ref,
        evidence_summary, attempt_count, started_at, completed_at, last_error, created_at, updated_at
      ) VALUES (?, ?, ?, 0, ?, ?, 'pending', 'non_idempotent', NULL, ?, NULL, NULL, NULL, 0, NULL, NULL, NULL, ?, ?)
    `).run(
      id("step"),
      current.id,
      nextPlanVersion,
      "Continue working toward the goal",
      "The owner requested another controlled attempt after verification.",
      "Continue the unfinished goal and leave fresh evidence for verification.",
      timestamp,
      timestamp
    );

    const criteria = this.db.prepare("SELECT * FROM durable_acceptance_criteria WHERE execution_id = ? AND plan_version = ? ORDER BY rowid ASC").all(current.id, current.current_plan_version) as unknown as CriterionRow[];
    for (const criterion of criteria) {
      const preserveUserPass = criterion.user_edited === 1 && criterion.result === "passed";
      this.db.prepare(`
        INSERT INTO durable_acceptance_criteria (
          id, execution_id, plan_version, description, required, checker_type, checker_key,
          author, result, evidence_ref_id, user_edited, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id("criterion"),
        current.id,
        nextPlanVersion,
        criterion.description,
        criterion.required,
        criterion.checker_type,
        criterion.checker_key,
        criterion.author,
        preserveUserPass ? "passed" : "unproven",
        preserveUserPass ? criterion.evidence_ref_id : null,
        preserveUserPass ? 1 : 0,
        timestamp,
        timestamp
      );
    }
    this.db.prepare("UPDATE durable_executions SET current_plan_version = ? WHERE id = ? AND version = ?").run(
      nextPlanVersion,
      current.id,
      current.version
    );
  }

  private requireRow(idValue: string): ExecutionRow {
    const row = this.db.prepare("SELECT * FROM durable_executions WHERE id = ?").get(text(idValue)) as ExecutionRow | undefined;
    if (!row) throw new DurableExecutionNotFoundError(idValue);
    return row;
  }

  private requireStep(executionId: string, stepId: string): StepRow {
    const row = this.db.prepare("SELECT * FROM durable_steps WHERE execution_id = ? AND id = ?").get(executionId, stepId) as StepRow | undefined;
    if (!row) throw new Error(`Execution step not found: ${stepId}`);
    return row;
  }

  private assertVersion(row: ExecutionRow, expectedVersion: number): void {
    if (Number(row.version) !== Number(expectedVersion)) throw new DurableExecutionConflictError(row.id, expectedVersion, Number(row.version));
  }

  private assertLease(row: ExecutionRow, processOwnerId: string): void {
    if (!row.lease_owner_id || row.lease_owner_id !== processOwnerId) throw new DurableExecutionLeaseError(row.id);
  }

  private assertTransition(from: DurableExecutionStatus, to: DurableExecutionStatus): void {
    if (from === to) return;
    if (!(ALLOWED_TRANSITIONS[from] ?? []).includes(to)) throw new DurableExecutionTransitionError(from, to);
  }

  private bumpExecution(executionId: string, expectedVersion: number, timestamp: string): void {
    const result = this.db.prepare("UPDATE durable_executions SET version = version + 1, updated_at = ? WHERE id = ? AND version = ?").run(timestamp, executionId, expectedVersion);
    if (Number(result.changes ?? 0) !== 1) {
      const current = this.requireRow(executionId);
      throw new DurableExecutionConflictError(executionId, expectedVersion, current.version);
    }
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS durable_executions (
        id TEXT PRIMARY KEY,
        short_handle TEXT NOT NULL,
        handle_sequence INTEGER NOT NULL,
        owner_id TEXT NOT NULL,
        bot_id TEXT NOT NULL,
        source_channel TEXT NOT NULL,
        source_chat_id TEXT,
        source_ui_session_id TEXT,
        source_project_id TEXT,
        goal TEXT NOT NULL,
        constraints_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('planned','queued','running','verifying','waiting_for_user','waiting_for_approval','paused','recovery_required','partial','completed','failed','cancelled')),
        version INTEGER NOT NULL,
        current_plan_version INTEGER NOT NULL,
        lease_owner_id TEXT,
        lease_expires_at TEXT,
        budget_token_limit INTEGER,
        budget_attempt_limit INTEGER,
        budget_lifetime_days INTEGER,
        tokens_used INTEGER NOT NULL DEFAULT 0,
        attempts_used INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        started_at TEXT,
        updated_at TEXT NOT NULL,
        terminal_at TEXT,
        waiting_kind TEXT CHECK (waiting_kind IS NULL OR waiting_kind IN ('user','approval','recovery')),
        waiting_reason TEXT,
        next_run_at TEXT,
        last_error TEXT,
        activation_path TEXT NOT NULL CHECK (activation_path IN ('deterministic','lazy_promotion','forced')),
        activation_reason TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_durable_execution_owner_handle ON durable_executions(owner_id, short_handle);
      CREATE INDEX IF NOT EXISTS idx_durable_execution_owner_status ON durable_executions(owner_id, status, updated_at DESC);
      CREATE TABLE IF NOT EXISTS durable_plan_versions (
        execution_id TEXT NOT NULL REFERENCES durable_executions(id) ON DELETE CASCADE,
        plan_version INTEGER NOT NULL,
        revision_reason TEXT NOT NULL,
        author TEXT NOT NULL CHECK (author IN ('model','user')),
        created_at TEXT NOT NULL,
        PRIMARY KEY (execution_id, plan_version)
      );
      CREATE TABLE IF NOT EXISTS durable_steps (
        id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL REFERENCES durable_executions(id) ON DELETE CASCADE,
        plan_version INTEGER NOT NULL,
        step_index INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending','running','completed','uncertain','blocked','skipped','failed')),
        side_effect_class TEXT NOT NULL CHECK (side_effect_class IN ('pure','idempotent','queryable','non_idempotent')),
        idempotency_key TEXT,
        input_summary TEXT,
        output_summary TEXT,
        output_ref TEXT,
        evidence_summary TEXT,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        started_at TEXT,
        completed_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (execution_id, plan_version, step_index)
      );
      CREATE INDEX IF NOT EXISTS idx_durable_steps_execution_status ON durable_steps(execution_id, status, step_index);
      CREATE TABLE IF NOT EXISTS durable_acceptance_criteria (
        id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL REFERENCES durable_executions(id) ON DELETE CASCADE,
        plan_version INTEGER NOT NULL,
        description TEXT NOT NULL,
        required INTEGER NOT NULL CHECK (required IN (0,1)),
        checker_type TEXT NOT NULL CHECK (checker_type IN ('deterministic','subjective')),
        checker_key TEXT,
        author TEXT NOT NULL CHECK (author IN ('model','user')),
        result TEXT NOT NULL CHECK (result IN ('unproven','passed','failed')),
        evidence_ref_id TEXT,
        user_edited INTEGER NOT NULL CHECK (user_edited IN (0,1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_durable_criteria_execution ON durable_acceptance_criteria(execution_id, plan_version);
      CREATE TABLE IF NOT EXISTS durable_side_effects (
        id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL REFERENCES durable_executions(id) ON DELETE CASCADE,
        step_id TEXT NOT NULL REFERENCES durable_steps(id) ON DELETE CASCADE,
        attempt_id TEXT,
        phase TEXT NOT NULL CHECK (phase IN ('intent','receipt')),
        side_effect_class TEXT NOT NULL CHECK (side_effect_class IN ('pure','idempotent','queryable','non_idempotent')),
        idempotency_key TEXT NOT NULL,
        target_summary TEXT NOT NULL,
        content_summary TEXT NOT NULL,
        external_id TEXT,
        payload_json TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (execution_id, step_id, phase, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS idx_durable_side_effects_execution ON durable_side_effects(execution_id, created_at);
      CREATE TABLE IF NOT EXISTS durable_evidence_refs (
        id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL REFERENCES durable_executions(id) ON DELETE CASCADE,
        step_id TEXT,
        attempt_id TEXT,
        reference_type TEXT NOT NULL,
        reference_id TEXT NOT NULL,
        summary TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('available','unavailable')),
        unavailable_reason TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS durable_decisions (
        id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL REFERENCES durable_executions(id) ON DELETE CASCADE,
        plan_version INTEGER NOT NULL,
        question TEXT NOT NULL,
        options_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('open','answered','cancelled')),
        answer TEXT,
        answered_by TEXT,
        created_at TEXT NOT NULL,
        answered_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_durable_decisions_open ON durable_decisions(execution_id, status);
      CREATE TABLE IF NOT EXISTS durable_approval_requests (
        id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL REFERENCES durable_executions(id) ON DELETE CASCADE,
        attempt_id TEXT,
        request_id TEXT NOT NULL,
        backend TEXT NOT NULL CHECK (backend IN ('approval_broker','host_bash')),
        action_key TEXT NOT NULL,
        tool_id TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        options_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','expired')),
        repeat_count INTEGER NOT NULL DEFAULT 1,
        requested_at TEXT NOT NULL,
        resolved_at TEXT,
        selected_scope TEXT,
        UNIQUE (execution_id, request_id)
      );
      CREATE INDEX IF NOT EXISTS idx_durable_approvals_execution ON durable_approval_requests(execution_id, status, requested_at);
      CREATE TABLE IF NOT EXISTS durable_attempts (
        id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL REFERENCES durable_executions(id) ON DELETE CASCADE,
        owner_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        context_session_id TEXT NOT NULL,
        plan_version INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('running','completed','failed','interrupted','waiting')),
        started_at TEXT NOT NULL,
        finished_at TEXT,
        end_reason TEXT,
        tokens_used INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_durable_attempts_execution_started ON durable_attempts(execution_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_durable_attempts_running ON durable_attempts(status, execution_id);
      CREATE TABLE IF NOT EXISTS durable_action_receipts (
        action_id TEXT NOT NULL,
        execution_id TEXT NOT NULL REFERENCES durable_executions(id) ON DELETE CASCADE,
        action TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (execution_id, action_id)
      );
      CREATE INDEX IF NOT EXISTS idx_durable_action_receipts_execution ON durable_action_receipts(execution_id, created_at);
    `);
  }
}

let sharedStore: DurableExecutionStore | null = null;

export function getDurableExecutionStore(): DurableExecutionStore {
  sharedStore ??= new DurableExecutionStore();
  return sharedStore;
}

export function resetDurableExecutionStoreForTests(): void {
  sharedStore?.close();
  sharedStore = null;
}
