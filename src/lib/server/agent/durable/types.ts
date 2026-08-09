import type { ToolResult, ToolSideEffect } from "$lib/server/agent/tools/toolTypes.js";

export const DURABLE_EXECUTION_STATUSES = [
  "planned",
  "queued",
  "running",
  "verifying",
  "waiting_for_user",
  "waiting_for_approval",
  "paused",
  "recovery_required",
  "partial",
  "completed",
  "failed",
  "cancelled"
] as const;

export type DurableExecutionStatus = typeof DURABLE_EXECUTION_STATUSES[number];

export const EXECUTION_STEP_STATUSES = [
  "pending",
  "running",
  "completed",
  "uncertain",
  "blocked",
  "skipped",
  "failed"
] as const;

export type ExecutionStepStatus = typeof EXECUTION_STEP_STATUSES[number];

export const SIDE_EFFECT_CLASSES = ["pure", "idempotent", "queryable", "non_idempotent"] as const;
export type SideEffectClass = typeof SIDE_EFFECT_CLASSES[number];

export type PlanAuthor = "model" | "user";
export type CriterionResult = "unproven" | "passed" | "failed";
export type DecisionStatus = "open" | "answered" | "cancelled";
export type AttemptStatus = "running" | "completed" | "failed" | "interrupted" | "waiting";
export type SideEffectPhase = "intent" | "receipt";
export type DurableApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export interface ExecutionStepInput {
  title: string;
  description?: string;
  sideEffectClass?: SideEffectClass;
  idempotencyKey?: string;
  inputSummary?: string;
}

/** A completed tool call from an ordinary Run that is absorbed on promotion. */
export interface DurablePrefixEntry {
  runId: string;
  toolId: string;
  toolCallId?: string;
  inputSummary: string;
  effect: ToolSideEffect;
  result?: ToolResult;
  isError: boolean;
  occurredAt: string;
}

export interface AcceptanceCriterionInput {
  description: string;
  required?: boolean;
  checkerType?: "deterministic" | "subjective";
  checkerKey?: string;
  author?: PlanAuthor;
}

export interface CreateDurableExecutionInput {
  ownerId: string;
  botId: string;
  sourceChannel?: string;
  sourceChatId?: string;
  sourceUiSessionId?: string;
  sourceProjectId?: string;
  goal: string;
  constraints?: string[];
  steps: ExecutionStepInput[];
  acceptanceCriteria: AcceptanceCriterionInput[];
  activationPath: "deterministic" | "lazy_promotion" | "forced";
  activationReason?: string;
  budget?: {
    tokenLimit?: number;
    attemptLimit?: number;
    lifetimeDays?: number;
  };
  now?: Date;
}

export interface DurableExecution {
  id: string;
  shortHandle: string;
  ownerId: string;
  botId: string;
  sourceChannel: string;
  sourceChatId?: string;
  sourceUiSessionId?: string;
  sourceProjectId?: string;
  goal: string;
  constraints: string[];
  status: DurableExecutionStatus;
  version: number;
  currentPlanVersion: number;
  leaseOwnerId?: string;
  leaseExpiresAt?: string;
  budgetTokenLimit?: number;
  budgetAttemptLimit?: number;
  budgetLifetimeDays?: number;
  tokensUsed: number;
  attemptsUsed: number;
  createdAt: string;
  startedAt?: string;
  updatedAt: string;
  terminalAt?: string;
  waitingKind?: "user" | "approval" | "recovery";
  waitingReason?: string;
  nextRunAt?: string;
  lastError?: string;
  activationPath: CreateDurableExecutionInput["activationPath"];
  activationReason?: string;
}

export interface PlanVersion {
  executionId: string;
  version: number;
  reason: string;
  author: PlanAuthor;
  createdAt: string;
}

export interface ExecutionStep {
  id: string;
  executionId: string;
  planVersion: number;
  index: number;
  title: string;
  description: string;
  status: ExecutionStepStatus;
  sideEffectClass: SideEffectClass;
  idempotencyKey?: string;
  inputSummary?: string;
  outputSummary?: string;
  outputRef?: string;
  evidenceSummary?: string;
  attemptCount: number;
  startedAt?: string;
  completedAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AcceptanceCriterion {
  id: string;
  executionId: string;
  planVersion: number;
  description: string;
  required: boolean;
  checkerType: "deterministic" | "subjective";
  checkerKey?: string;
  author: PlanAuthor;
  result: CriterionResult;
  evidenceRefId?: string;
  userEdited: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SideEffectRecord {
  id: string;
  executionId: string;
  stepId: string;
  attemptId?: string;
  phase: SideEffectPhase;
  sideEffectClass: SideEffectClass;
  idempotencyKey: string;
  targetSummary: string;
  contentSummary: string;
  externalId?: string;
  payload?: unknown;
  createdAt: string;
}

export interface EvidenceRef {
  id: string;
  executionId: string;
  stepId?: string;
  attemptId?: string;
  referenceType: string;
  referenceId: string;
  summary: string;
  status: "available" | "unavailable";
  unavailableReason?: string;
  createdAt: string;
}

export interface DecisionRequest {
  id: string;
  executionId: string;
  planVersion: number;
  question: string;
  options: string[];
  status: DecisionStatus;
  answer?: string;
  answeredBy?: string;
  createdAt: string;
  answeredAt?: string;
}

export interface DurableApprovalRequest {
  id: string;
  executionId: string;
  attemptId?: string;
  requestId: string;
  backend: "approval_broker" | "host_bash";
  actionKey: string;
  toolId: string;
  title: string;
  summary: string;
  options: string[];
  status: DurableApprovalStatus;
  repeatCount: number;
  requestedAt: string;
  resolvedAt?: string;
  selectedScope?: string;
}

export interface ExecutionAttempt {
  id: string;
  executionId: string;
  ownerId: string;
  runId: string;
  contextSessionId: string;
  planVersion: number;
  status: AttemptStatus;
  startedAt: string;
  finishedAt?: string;
  endReason?: string;
  tokensUsed: number;
}

export interface DurableExecutionDetail {
  execution: DurableExecution;
  plans: PlanVersion[];
  steps: ExecutionStep[];
  acceptanceCriteria: AcceptanceCriterion[];
  sideEffects: SideEffectRecord[];
  evidenceRefs: EvidenceRef[];
  decisions: DecisionRequest[];
  approvals: DurableApprovalRequest[];
  attempts: ExecutionAttempt[];
}

export interface DurableExecutionProjection {
  displayStatus: DurableExecutionStatus;
  progress: { completed: number; total: number; currentIndex?: number };
  queuePosition?: number;
  nextStep?: { id: string; title: string; status: ExecutionStepStatus };
  requiredCriteria: { total: number; passed: number; unproven: number; failed: number };
  waiting?: { kind: "user" | "approval" | "recovery"; reason: string };
  active: boolean;
}

export interface DurableExecutionListItem {
  execution: DurableExecution;
  projection: DurableExecutionProjection;
}

export interface DurableExecutionListFilter {
  ownerId: string;
  botId?: string;
  statuses?: DurableExecutionStatus[];
  limit?: number;
}

export interface ClaimAttemptInput {
  executionId: string;
  expectedVersion: number;
  processOwnerId: string;
  runId: string;
  contextSessionId: string;
  leaseDurationMs: number;
  /** Verification leases do not consume the task's Agent-attempt budget. */
  countTowardsAttemptBudget?: boolean;
  now?: Date;
}

export interface ClaimedAttempt {
  execution: DurableExecution;
  attempt: ExecutionAttempt;
}

export interface FinishAttemptInput {
  executionId: string;
  attemptId: string;
  expectedVersion: number;
  processOwnerId: string;
  status: AttemptStatus;
  nextExecutionStatus: DurableExecutionStatus;
  reason?: string;
  waitingKind?: DurableExecution["waitingKind"];
  tokensUsed?: number;
  now?: Date;
}

export interface RecordAcceptanceResultInput {
  executionId: string;
  criterionId: string;
  expectedVersion: number;
  processOwnerId: string;
  result: CriterionResult;
  evidenceRefId?: string;
  now?: Date;
}

export interface SideEffectInput {
  executionId: string;
  stepId: string;
  attemptId?: string;
  processOwnerId: string;
  expectedVersion: number;
  sideEffectClass: SideEffectClass;
  idempotencyKey: string;
  targetSummary: string;
  contentSummary: string;
  externalId?: string;
  payload?: unknown;
  now?: Date;
}

export class DurableExecutionNotFoundError extends Error {
  constructor(id: string) {
    super(`Durable Execution not found: ${id}`);
    this.name = "DurableExecutionNotFoundError";
  }
}

export class DurableExecutionConflictError extends Error {
  constructor(id: string, expected: number, actual: number) {
    super(`Durable Execution version conflict for ${id}: expected ${expected}, actual ${actual}`);
    this.name = "DurableExecutionConflictError";
  }
}

export class DurableExecutionTransitionError extends Error {
  constructor(from: DurableExecutionStatus, to: DurableExecutionStatus) {
    super(`Illegal Durable Execution transition: ${from} -> ${to}`);
    this.name = "DurableExecutionTransitionError";
  }
}

export class DurableExecutionLeaseError extends Error {
  constructor(id: string) {
    super(`Durable Execution lease is not owned by this attempt: ${id}`);
    this.name = "DurableExecutionLeaseError";
  }
}

export class DurableExecutionBudgetError extends Error {
  constructor(id: string, reason: string) {
    super(`Durable Execution budget exhausted for ${id}: ${reason}`);
    this.name = "DurableExecutionBudgetError";
  }
}

export class DurableExecutionQuotaError extends Error {
  constructor(ownerId: string, limit: number) {
    super(`Durable Execution unfinished-task quota reached for ${ownerId}: ${limit}`);
    this.name = "DurableExecutionQuotaError";
  }
}
