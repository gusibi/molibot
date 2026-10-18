import { DurableExecutionCoordinator, projectDurableExecution } from "$lib/server/agent/durable/coordinator.js";
import { getDurableExecutionStore, type DurableExecutionStore } from "$lib/server/agent/durable/store.js";
import {
  DurableExecutionNotFoundError,
  PlanDeletedError,
  type CreatePlanInput,
  type DurableExecution,
  type DurableExecutionStatus,
  type PlanDetail,
  type PlanListFilter,
  type ReplacePlanContentInput,
  type RevisePlanInput
} from "$lib/server/agent/durable/types.js";

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
