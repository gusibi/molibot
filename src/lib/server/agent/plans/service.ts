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
    const executions = this.store.list({ ownerId: filter.ownerId, botId: filter.botId, limit: Math.max(1, Math.min(200, filter.limit ?? 50)) });
    const search = filter.search?.trim().toLowerCase();
    const items: PlanListItem[] = [];
    for (const execution of executions) {
      const planStatus = planStatusOf(execution.status);
      if (!filter.includeArchived && planStatus === "archived") continue;
      if (filter.statuses && filter.statuses.length > 0 && !filter.statuses.includes(execution.status)) continue;
      if (filter.projectId && execution.sourceProjectId !== filter.projectId) continue;
      const detail = this.store.getDetail(execution.id, filter.ownerId);
      if (!detail) continue;
      const meta = this.store.getPlanMeta(execution.id);
      const title = meta?.title ?? execution.goal;
      if (search && !title.toLowerCase().includes(search) && !execution.id.toLowerCase().includes(search)) continue;
      const projection = projectDurableExecution(detail, this.store.queuePosition(execution.id));
      items.push(this.toListItem(execution, title, meta?.summary ?? "", projection, execution.sourceProjectId));
    }
    return items;
  }

  read(ownerId: string, planId: string, planVersion?: number): PlanDetail {
    const detail = this.store.getDetail(planId, ownerId);
    if (!detail) {
      if (this.store.getPlanTombstone(planId)) throw new PlanDeletedError(planId);
      throw new DurableExecutionNotFoundError(planId);
    }
    const meta = this.store.getPlanMeta(planId) ?? { executionId: planId, title: detail.execution.goal, summary: "", updatedAt: detail.execution.updatedAt };
    const version = planVersion ?? detail.execution.currentPlanVersion;
    let tasks = this.store.getPlanTasks(planId, version);
    if (tasks.length === 0) {
      const steps = detail.steps.filter((step) => step.planVersion === version).sort((left, right) => left.index - right.index);
      tasks = [{ id: `${planId}-task-1`, executionId: planId, planVersion: version, index: 0, title: meta.title, description: meta.summary, steps }];
    }
    return { ...detail, meta, tasks, projection: projectDurableExecution(detail, this.store.queuePosition(planId)) };
  }

  revise(input: RevisePlanInput): PlanDetail {
    this.store.revisePlan(input);
    return this.read(input.ownerId, input.executionId);
  }

  start(input: PlanStartInput): PlanDetail {
    const detail = this.read(input.ownerId, input.planId);
    const execution = detail.execution.status === "planned"
      ? this.coordinator.activate({ ownerId: input.ownerId, executionId: input.planId, expectedVersion: input.expectedVersion }).execution
      : detail.execution;
    return this.read(input.ownerId, execution.id);
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
