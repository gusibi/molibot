import { DurableExecutionCoordinator, projectDurableExecution } from "$lib/server/agent/durable/coordinator.js";
import { getDurableExecutionStore, type DurableExecutionStore } from "$lib/server/agent/durable/store.js";
import {
  DurableExecutionConflictError,
  DurableExecutionNotFoundError,
  PlanDeletedError,
  type CreateKanbanTaskInput,
  type CreatePlanInput,
  type DurableExecution,
  type DurableExecutionStatus,
  type KanbanTaskConfig,
  type PlanDetail,
  type PlanListFilter,
  type ReplacePlanContentInput,
  type RevisePlanInput
} from "$lib/server/agent/durable/types.js";
import {
  checklistProgressOf,
  executorLabelOf,
  kanbanDoingSubStateOf,
  kanbanStageOf,
  type KanbanBoardFilter,
  type KanbanBoardItem,
  type KanbanBoardPage,
  type KanbanBoardStage
} from "./kanban.js";

/** Lifecycle buckets the Plan list filters on. Derived from execution truth. */
export type PlanStatus = "not_started" | "in_progress" | "needs_attention" | "finished" | "archived";

const STATUS_BUCKETS: Record<DurableExecutionStatus, PlanStatus> = {
  planned: "not_started",
  queued: "in_progress",
  running: "in_progress",
  verifying: "in_progress",
  paused: "needs_attention",
  waiting_for_user: "needs_attention",
  waiting_for_approval: "needs_attention",
  recovery_required: "needs_attention",
  partial: "needs_attention",
  failed: "needs_attention",
  cancelled: "finished",
  completed: "archived"
};

export function planStatusOf(status: DurableExecutionStatus): PlanStatus {
  return STATUS_BUCKETS[status];
}

export interface PlanListItem {
  planId: string;
  shortHandle: string;
  title: string;
  summary: string;
  projectId?: string;
  status: DurableExecutionStatus;
  planStatus: PlanStatus;
  archived: boolean;
  version: number;
  currentPlanVersion: number;
  progress: { completed: number; total: number; currentStepTitle?: string };
  waitingReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlanStartInput {
  ownerId: string;
  planId: string;
  expectedVersion: number;
}

export interface PlanControlInput extends PlanStartInput {
  actionId: string;
  reason?: string;
}

/** Shared plan coordinator: UI and model tools must go through this layer. */
export class PlanService {
  constructor(
    private readonly store: DurableExecutionStore = getDurableExecutionStore(),
    private readonly coordinator: DurableExecutionCoordinator = new DurableExecutionCoordinator(store)
  ) {}

  create(input: CreatePlanInput): PlanDetail {
    const execution = this.store.createPlan(input);
    return this.read(input.ownerId, execution.id);
  }

  list(filter: PlanListFilter): PlanListItem[] {
    return this.listPage(filter).items;
  }

  listPage(filter: PlanListFilter): { items: PlanListItem[]; total: number; projectIds: string[]; counts: Record<string, number> } {
    const page = this.store.queryPlans(filter);
    const items = page.executions.map(execution => {
      const detail = this.read(filter.ownerId, execution.id);
      return this.toListItem(execution, detail.meta.title, detail.meta.summary, detail.projection, execution.sourceProjectId);
    });
    const counts: Record<string, number> = { all: 0, not_started: 0, in_progress: 0, needs_attention: 0, finished: 0, archived: 0 };
    for (const [status, count] of Object.entries(page.statusCounts)) { counts[planStatusOf(status as DurableExecutionStatus)] += count; counts.all += count; }
    return { items, total: page.total, projectIds: page.projectIds, counts };
  }

  read(ownerId: string, planId: string, planVersion?: number): PlanDetail {
    const detail = this.store.getDetail(planId, ownerId);
    if (!detail) {
      if (this.store.getPlanTombstone(planId)) throw new PlanDeletedError(planId);
      throw new DurableExecutionNotFoundError(planId);
    }
    const meta = this.store.getPlanMeta(planId) ?? { executionId: planId, title: detail.execution.goal, summary: "", updatedAt: detail.execution.updatedAt };
    if (planVersion !== undefined && planVersion !== detail.execution.currentPlanVersion) {
      const snapshot = this.store.getPlanSnapshot(planId, planVersion);
      if (snapshot) return snapshot;
    }
    const version = planVersion ?? detail.execution.currentPlanVersion;
    let tasks = this.store.getPlanTasks(planId, version);
    if (tasks.length === 0) {
      const steps = detail.steps.filter((step) => step.planVersion === version).sort((left, right) => left.index - right.index);
      tasks = [{ id: `${planId}-task-1`, executionId: planId, planVersion: version, index: 0, title: meta.title, description: meta.summary, steps }];
    }
    return { ...detail, meta, tasks, agentId: this.store.getPlanAgent(planId), binding: this.store.getPlanBinding(planId), controlRequest: this.store.getControlRequest(planId), projection: projectDurableExecution(detail, this.store.queuePosition(planId)) };
  }

  revise(input: RevisePlanInput): PlanDetail {
    const current = this.read(input.ownerId, input.executionId);
    return this.edit({ ...input, tasks: [...current.tasks.map(task => ({ ...task, steps: task.steps })), ...input.addTasks.map(task => ({ ...task, id: undefined, steps: task.steps.map(step => ({ ...step, id: undefined })) }))], acceptanceCriteria: [...current.acceptanceCriteria.filter(criterion => criterion.planVersion === current.execution.currentPlanVersion), ...(input.addCriteria ?? [])] });
  }

  edit(input: ReplacePlanContentInput): PlanDetail {
    const snapshot = this.read(input.ownerId, input.executionId);
    this.store.editPlanContent(input, snapshot);
    return this.read(input.ownerId, input.executionId);
  }

  replaceContent(input: ReplacePlanContentInput): PlanDetail {
    this.store.replacePlanContent(input);
    return this.read(input.ownerId, input.executionId);
  }

  subscribe(listener: () => void): () => void { return this.store.subscribe(listener); }

  /** Read-only executor diagnostics for the plan detail page. */
  diagnostics(ownerId: string, planId: string) {
    return this.coordinator.diagnostics(ownerId, planId);
  }

  approve(input: { ownerId: string; planId: string; expectedVersion: number; sessionId: string; agentId: string; mode: "manual" | "accept_edits" }): PlanDetail {
    this.read(input.ownerId, input.planId);
    this.store.bindPlan(input);
    return this.read(input.ownerId, input.planId);
  }

  pause(input: PlanControlInput): PlanDetail {
    this.coordinator.pause({ ownerId: input.ownerId, executionId: input.planId, expectedVersion: input.expectedVersion, actionId: input.actionId, reason: input.reason });
    return this.read(input.ownerId, input.planId);
  }

  resume(input: PlanControlInput): PlanDetail {
    this.coordinator.resume({ ownerId: input.ownerId, executionId: input.planId, expectedVersion: input.expectedVersion, actionId: input.actionId });
    return this.read(input.ownerId, input.planId);
  }

  cancel(input: PlanControlInput): PlanDetail {
    this.coordinator.cancel({ ownerId: input.ownerId, executionId: input.planId, expectedVersion: input.expectedVersion, actionId: input.actionId, reason: input.reason });
    return this.read(input.ownerId, input.planId);
  }

  delete(input: { ownerId: string; planId: string; expectedVersion?: number }): { deleted: boolean; title?: string } {
    const existing = this.store.getById(input.planId, input.ownerId);
    const title = existing ? this.store.getPlanMeta(input.planId)?.title ?? existing.goal : this.store.getPlanTombstone(input.planId)?.title;
    const deleted = this.store.deletePlan({ executionId: input.planId, ownerId: input.ownerId, expectedVersion: input.expectedVersion });
    return { deleted, ...(title ? { title } : {}) };
  }

  // ---- Kanban Task（看板任务）---------------------------------------------

  createKanbanTask(input: CreateKanbanTaskInput): PlanDetail {
    const task = this.store.kanban.createTask(input);
    return this.read(input.ownerId, task.executionId);
  }

  getKanbanTask(ownerId: string, executionId: string): { task: KanbanTaskConfig; detail: PlanDetail } {
    const task = this.store.kanban.getTask(executionId);
    if (!task) throw new DurableExecutionNotFoundError(executionId);
    return { task, detail: this.read(ownerId, executionId) };
  }

  startKanbanTask(input: { ownerId: string; executionId: string; expectedVersion: number; actionId: string }): PlanDetail {
    this.store.kanban.startTask({ executionId: input.executionId, ownerId: input.ownerId, expectedVersion: input.expectedVersion, actionId: input.actionId });
    return this.read(input.ownerId, input.executionId);
  }

  addKanbanInput(input: { ownerId: string; executionId: string; text: string }) {
    this.read(input.ownerId, input.executionId);
    return this.store.kanban.recordInput({ executionId: input.executionId, text: input.text });
  }

  listKanbanInputs(ownerId: string, executionId: string, onlyPending = false) {
    this.read(ownerId, executionId);
    return this.store.kanban.listInputs(executionId, onlyPending);
  }

  getKanbanChecklist(ownerId: string, executionId: string) {
    this.read(ownerId, executionId);
    return this.store.kanban.getChecklist(executionId);
  }

  getKanbanReceipts(ownerId: string, executionId: string) {
    this.read(ownerId, executionId);
    return this.store.kanban.listReceipts(executionId);
  }

  getKanbanHandoffs(ownerId: string, executionId: string) {
    this.read(ownerId, executionId);
    return this.store.kanban.listHandoffs(executionId);
  }

  /** Adds a one-off budget top-up; the ledger is never reset. */
  addKanbanBudget(input: { ownerId: string; executionId: string; expectedVersion: number; addTokens: number }): PlanDetail {
    this.read(input.ownerId, input.executionId);
    const task = this.store.kanban.getTask(input.executionId);
    if (!task) throw new DurableExecutionNotFoundError(input.executionId);
    const addTokens = Math.max(0, Math.round(input.addTokens));
    if (addTokens === 0) throw new Error("Budget top-up must be positive.");
    this.store.kanban.extendKanbanBudget({ executionId: input.executionId, expectedVersion: input.expectedVersion, topup: addTokens });
    return this.read(input.ownerId, input.executionId);
  }

  /**
   * The board: kanban tasks and legacy plans projected onto Todo/Doing/Done/
   * 已取消 by execution status. Counts are computed over the full filtered set,
   * not the current page.
   */
  boardPage(filter: KanbanBoardFilter & { limit?: number; offset?: number }): KanbanBoardPage {
    const stageStatuses: Record<KanbanBoardStage, DurableExecutionStatus[]> = {
      todo: ["planned"],
      doing: ["queued", "running", "verifying", "waiting_for_user", "waiting_for_approval", "paused", "recovery_required", "partial", "failed"],
      done: ["completed"],
      cancelled: ["cancelled"]
    };
    const statuses = filter.stage ? stageStatuses[filter.stage] : undefined;
    const summaries = this.store.kanban.listExecutionSummaries({ ownerId: filter.ownerId, statuses });
    const search = filter.search?.trim().toLowerCase();
    const items: KanbanBoardItem[] = [];
    const projectIds = new Set<string>();
    for (const summary of summaries) {
      if (summary.projectId) projectIds.add(summary.projectId);
      if (filter.projectId && summary.projectId !== filter.projectId) continue;
      if (search && !summary.title.toLowerCase().includes(search) && !summary.goal.toLowerCase().includes(search)) continue;
      const stage = kanbanStageOf(summary.status as DurableExecutionStatus);
      const subState = kanbanDoingSubStateOf(summary.status as DurableExecutionStatus);
      const base: KanbanBoardItem = {
        executionId: summary.executionId,
        shortHandle: this.shortHandleOf(summary.executionId),
        kind: summary.isKanban ? "kanban" : "legacy-plan",
        stage,
        ...(subState ? { doingSubState: subState } : {}),
        title: summary.title,
        goal: summary.goal,
        ...(summary.projectId ? { projectId: summary.projectId } : {}),
        ...(summary.waitingReason ? { waitingReason: summary.waitingReason } : {}),
        version: this.versionOf(summary.executionId),
        createdAt: summary.createdAt,
        updatedAt: summary.updatedAt
      };
      const task = summary.isKanban ? this.store.kanban.getTask(summary.executionId) : undefined;
      if (task) {
        if (filter.executorAgentId) {
          const involved = task.form === "single"
            ? task.currentAgentId === filter.executorAgentId
            : task.members.some(member => member.agentId === filter.executorAgentId);
          if (!involved) continue;
        }
        items.push({
          ...base,
          kind: "kanban",
          form: task.form,
          executorLabel: executorLabelOf(task),
          ...(task.currentAgentId ? { currentAgentId: task.currentAgentId } : {}),
          ...(checklistProgressOf(this.store.kanban.getChecklist(summary.executionId))
            ? { checklist: checklistProgressOf(this.store.kanban.getChecklist(summary.executionId)) }
            : {}),
          budgetTokensUsed: this.tokensUsedOf(summary.executionId),
          ...(task.budgetTokenLimit != null ? { budgetTokenLimit: task.budgetTokenLimit } : {}),
          handoffCount: task.handoffCount,
          handoffLimit: task.handoffLimit,
          autoStart: task.autoStart,
          humanAcceptance: task.humanAcceptance,
          approvalPolicy: task.approvalPolicy
        });
        continue;
      }
      if (filter.executorAgentId && this.store.getPlanAgent(summary.executionId) !== filter.executorAgentId) continue;
      items.push({ ...base, progress: this.legacyProgressOf(summary.executionId) });
    }
    const counts: Record<KanbanBoardStage | "all", number> = { all: items.length, todo: 0, doing: 0, done: 0, cancelled: 0 };
    for (const item of items) counts[item.stage] += 1;
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? items.length;
    return { items: items.slice(offset, offset + limit), total: items.length, projectIds: [...projectIds].sort(), counts };
  }

  private legacyProgressOf(executionId: string): { completed: number; total: number } | undefined {
    const execution = this.store.getById(executionId);
    if (!execution) return undefined;
    const detail = this.store.getDetail(executionId);
    const steps = detail?.steps.filter(step => step.planVersion === execution.currentPlanVersion) ?? [];
    return { completed: steps.filter(step => step.status === "completed" || step.status === "skipped").length, total: steps.length };
  }

  private shortHandleOf(executionId: string): string {
    return this.store.getById(executionId)?.shortHandle ?? "";
  }

  private versionOf(executionId: string): number {
    return this.store.getById(executionId)?.version ?? 0;
  }

  private tokensUsedOf(executionId: string): number {
    return this.store.getById(executionId)?.tokensUsed ?? 0;
  }

  private toListItem(
    execution: DurableExecution,
    title: string,
    summary: string,
    projection: { progress: { completed: number; total: number }; nextStep?: { title: string } },
    projectId: string | undefined
  ): PlanListItem {
    const planStatus = planStatusOf(execution.status);
    return {
      planId: execution.id,
      shortHandle: execution.shortHandle,
      title,
      summary,
      ...(projectId ? { projectId } : {}),
      status: execution.status,
      planStatus,
      archived: planStatus === "archived",
      version: execution.version,
      currentPlanVersion: execution.currentPlanVersion,
      progress: {
        completed: projection.progress.completed,
        total: projection.progress.total,
        ...(projection.nextStep ? { currentStepTitle: projection.nextStep.title } : {})
      },
      ...(execution.waitingReason ? { waitingReason: execution.waitingReason } : {}),
      createdAt: execution.createdAt,
      updatedAt: execution.updatedAt
    };
  }
}
