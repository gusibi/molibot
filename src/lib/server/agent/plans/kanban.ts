import type {
  DurableExecutionStatus,
  KanbanChecklistItem,
  KanbanTaskConfig
} from "$lib/server/agent/durable/types.js";

/**
 * Board projection for the Kanban Task board. Stages and sub-states are
 * derived views over the execution truth; resource and runtime decisions read
 * the execution status directly and never the stage (spec: 看板阶段是投影).
 *
 * Legacy plans (no kanban row) project through the same status mapping. The
 * old `planStatus` buckets deliberately do NOT participate: `completed →
 * archived` must not remove a finished plan from the Done column.
 */

export type KanbanBoardStage = "todo" | "doing" | "done" | "cancelled";

export type KanbanDoingSubState =
  | "queued"
  | "running"
  | "verifying"
  | "waiting_user"
  | "waiting_approval"
  | "paused"
  | "recovery"
  | "stopped"
  | "pending_acceptance";

const STAGE_BY_STATUS: Record<DurableExecutionStatus, KanbanBoardStage> = {
  planned: "todo",
  queued: "doing",
  running: "doing",
  verifying: "doing",
  waiting_for_user: "doing",
  waiting_for_approval: "doing",
  paused: "doing",
  recovery_required: "doing",
  partial: "doing",
  failed: "doing",
  completed: "done",
  cancelled: "cancelled"
};

const SUBSTATE_BY_STATUS: Partial<Record<DurableExecutionStatus, KanbanDoingSubState>> = {
  queued: "queued",
  running: "running",
  verifying: "verifying",
  waiting_for_user: "waiting_user",
  waiting_for_approval: "waiting_approval",
  paused: "paused",
  recovery_required: "recovery",
  partial: "stopped",
  failed: "stopped"
};

export function kanbanStageOf(status: DurableExecutionStatus): KanbanBoardStage {
  return STAGE_BY_STATUS[status];
}

export function kanbanDoingSubStateOf(status: DurableExecutionStatus): KanbanDoingSubState | undefined {
  return SUBSTATE_BY_STATUS[status];
}

export interface KanbanBoardItem {
  executionId: string;
  shortHandle: string;
  kind: "kanban" | "legacy-plan";
  stage: KanbanBoardStage;
  doingSubState?: KanbanDoingSubState;
  title: string;
  goal: string;
  projectId?: string;
  form?: KanbanTaskConfig["form"];
  /** Human-readable executor summary: agent, or coordinator + member count. */
  executorLabel?: string;
  currentAgentId?: string;
  waitingReason?: string;
  /** Legacy plans only: step progress. */
  progress?: { completed: number; total: number };
  /** Kanban tasks only: shown only when the task maintains a checklist. */
  checklist?: { doneChecked: number; checkedTotal: number };
  budgetTokensUsed?: number;
  budgetTokenLimit?: number;
  handoffCount?: number;
  handoffLimit?: number;
  autoStart?: boolean;
  humanAcceptance?: boolean;
  approvalPolicy?: KanbanTaskConfig["approvalPolicy"];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface KanbanBoardFilter {
  ownerId: string;
  search?: string;
  projectId?: string;
  stage?: KanbanBoardStage;
  /** Agent id: matches single executors, team coordinators and members. */
  executorAgentId?: string;
}

export interface KanbanBoardPage {
  items: KanbanBoardItem[];
  total: number;
  projectIds: string[];
  counts: Record<KanbanBoardStage | "all", number>;
}

export function checklistProgressOf(checklist: KanbanChecklistItem[] | undefined): { doneChecked: number; checkedTotal: number } | undefined {
  if (!checklist || checklist.length === 0) return undefined;
  return { doneChecked: checklist.filter(item => item.done).length, checkedTotal: checklist.length };
}

export function executorLabelOf(task: Pick<KanbanTaskConfig, "form" | "members" | "coordinatorAgentId" | "currentAgentId">): string {
  if (task.form === "single") return task.currentAgentId ?? "";
  const coordinator = task.members.find(member => member.agentId === task.coordinatorAgentId);
  return [coordinator?.name ?? task.coordinatorAgentId, `+${Math.max(0, task.members.length - 1)}`].filter(Boolean).join(" ");
}
