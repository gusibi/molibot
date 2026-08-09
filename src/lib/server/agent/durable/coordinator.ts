import { PROCESS_OWNER_ID } from "$lib/server/agent/eventsLeaseStore.js";
import { config } from "$lib/server/app/env.js";
import { enqueueDurableExecutionEvent } from "./events.js";
import {
  DurableExecutionNotFoundError,
  type CreateDurableExecutionInput,
  type DurableExecution,
  type DurableExecutionDetail,
  type DurableExecutionListFilter,
  type DurableExecutionListItem,
  type DurableExecutionProjection,
  type DurablePrefixEntry,
  type DurableExecutionStatus
} from "./types.js";
import { getDurableExecutionStore, type DurableExecutionStore } from "./store.js";
import { readDurableEvidence, type DurableEvidenceRead, type DurableRunDetailReader } from "./evidence.js";

function projectDetail(detail: DurableExecutionDetail, queuePosition?: number): DurableExecutionProjection {
  const currentSteps = detail.steps
    .filter((step) => step.planVersion === detail.execution.currentPlanVersion)
    .sort((left, right) => left.index - right.index);
  const currentCriteria = detail.acceptanceCriteria.filter((criterion) => criterion.planVersion === detail.execution.currentPlanVersion);
  const requiredCriteria = currentCriteria.filter((criterion) => criterion.required);
  const nextStep = currentSteps.find((step) => step.status !== "completed" && step.status !== "skipped");
  const completed = currentSteps.filter((step) => step.status === "completed" || step.status === "skipped").length;
  return {
    displayStatus: detail.execution.status,
    progress: {
      completed,
      total: currentSteps.length,
      ...(nextStep ? { currentIndex: nextStep.index } : {})
    },
    ...(queuePosition === undefined ? {} : { queuePosition }),
    ...(nextStep ? { nextStep: { id: nextStep.id, title: nextStep.title, status: nextStep.status } } : {}),
    requiredCriteria: {
      total: requiredCriteria.length,
      passed: requiredCriteria.filter((criterion) => criterion.result === "passed").length,
      unproven: requiredCriteria.filter((criterion) => criterion.result === "unproven").length,
      failed: requiredCriteria.filter((criterion) => criterion.result === "failed").length
    },
    ...(detail.execution.waitingKind
      ? { waiting: { kind: detail.execution.waitingKind, reason: detail.execution.waitingReason ?? "Waiting for the next safe action." } }
      : {}),
    active: detail.execution.status === "running" || detail.execution.status === "verifying"
  };
}

export class DurableExecutionCoordinator {
  constructor(
    private readonly store: DurableExecutionStore = getDurableExecutionStore(),
    private readonly processOwnerId = PROCESS_OWNER_ID,
    private readonly dataDir = config.dataDir
  ) {}

  create(input: CreateDurableExecutionInput): DurableExecutionListItem {
    const execution = this.store.create(input);
    return this.projectItem(execution.id, input.ownerId);
  }

  promote(input: {
    ownerId: string;
    botId: string;
    sourceChannel: string;
    sourceChatId: string;
    sourceUiSessionId?: string;
    sourceProjectId?: string;
    goal: string;
    acceptanceCriteria: CreateDurableExecutionInput["acceptanceCriteria"];
    prefix: DurablePrefixEntry[];
    currentEffect: DurablePrefixEntry["effect"];
    reason: string;
  }): DurableExecutionListItem {
    const steps = [
      ...input.prefix.map((entry) => ({
        title: `Already ran: ${entry.toolId}`,
        description: "This tool call was absorbed from the ordinary Run and will not be replayed.",
        sideEffectClass: entry.effect.sideEffectClass,
        idempotencyKey: entry.effect.idempotencyKey,
        inputSummary: entry.inputSummary
      })),
      {
        title: `Continue with: ${input.currentEffect.toolId}`,
        description: "Execute this next step through the Durable Execution side-effect boundary.",
        sideEffectClass: input.currentEffect.sideEffectClass,
        idempotencyKey: input.currentEffect.idempotencyKey,
        inputSummary: `${input.currentEffect.targetSummary}; ${input.currentEffect.contentSummary}`
      }
    ];
    const created = this.store.create({
      ownerId: input.ownerId,
      botId: input.botId,
      sourceChannel: input.sourceChannel,
      sourceChatId: input.sourceChatId,
      sourceUiSessionId: input.sourceUiSessionId,
      sourceProjectId: input.sourceProjectId,
      goal: input.goal,
      steps,
      acceptanceCriteria: input.acceptanceCriteria,
      activationPath: "lazy_promotion",
      activationReason: input.reason
    });
    try {
      const absorbed = this.store.absorbPrefix(created.id, created.version, input.prefix);
      const activated = this.store.transitionStatus(absorbed.id, absorbed.version, "queued");
      this.ensureQueuedEvents(input.ownerId);
      return this.projectOwned(activated.id, input.ownerId);
    } catch (error) {
      const current = this.store.getById(created.id);
      if (current && current.status === "planned") {
        try {
          this.store.transitionStatus(current.id, current.version, "failed", {
            lastError: error instanceof Error ? error.message : String(error)
          });
        } catch {
          // Preserve the original promotion error; the task has no safe path.
        }
      }
      throw error;
    }
  }

  activate(input: { ownerId: string; executionId: string; expectedVersion: number }): DurableExecutionListItem {
    const current = this.store.getDetail(input.executionId, input.ownerId);
    if (!current) throw new DurableExecutionNotFoundError(input.executionId);
    const execution = current.execution.status === "planned"
      ? this.store.transitionStatus(current.execution.id, input.expectedVersion, "queued")
      : current.execution;
    if (execution.status === "queued") {
      this.ensureQueuedEvents(input.ownerId);
    }
    return this.projectOwned(execution.id, input.ownerId);
  }

  list(filter: DurableExecutionListFilter): DurableExecutionListItem[] {
    return this.store.list(filter).flatMap((execution) => {
      const detail = this.store.getDetail(execution.id, filter.ownerId);
      return detail ? [{ execution, projection: this.projectProjection(detail) }] : [];
    });
  }

  inspect(ownerId: string, executionId: string): DurableExecutionDetail & { projection: DurableExecutionProjection } {
    const detail = this.store.getDetail(executionId, ownerId);
    if (!detail) throw new DurableExecutionNotFoundError(executionId);
    return { ...detail, projection: this.projectProjection(detail) };
  }

  readEvidence(ownerId: string, executionId: string, evidenceId: string, readRunDetail?: DurableRunDetailReader): DurableEvidenceRead {
    const detail = this.store.getDetail(executionId, ownerId);
    if (!detail) throw new DurableExecutionNotFoundError(executionId);
    return readDurableEvidence(detail, evidenceId, readRunDetail);
  }

  pause(input: { ownerId: string; executionId: string; expectedVersion: number; actionId: string; reason?: string }): DurableExecutionListItem {
    const result = this.manage(input, () => this.store.runControlAction({
      actionId: input.actionId,
      executionId: input.executionId,
      action: "pause",
      expectedVersion: input.expectedVersion,
      reason: input.reason
    }));
    this.ensureQueuedEvents(input.ownerId);
    return result;
  }

  resume(input: { ownerId: string; executionId: string; expectedVersion: number; actionId: string }): DurableExecutionListItem {
    const result = this.manage(input, () => this.store.runControlAction({
      actionId: input.actionId,
      executionId: input.executionId,
      action: "resume",
      expectedVersion: input.expectedVersion
    }));
    return this.ensureQueuedEvent(result, input.ownerId);
  }

  cancel(input: { ownerId: string; executionId: string; expectedVersion: number; actionId: string; reason?: string }): DurableExecutionListItem {
    const result = this.manage(input, () => this.store.runControlAction({
      actionId: input.actionId,
      executionId: input.executionId,
      action: "cancel",
      expectedVersion: input.expectedVersion,
      reason: input.reason
    }));
    this.ensureQueuedEvents(input.ownerId);
    return result;
  }

  answerDecision(input: { ownerId: string; executionId: string; decisionId: string; answer: string; expectedVersion: number; actionId: string }): DurableExecutionListItem {
    const result = this.manage(input, () => this.store.runControlAction({
      actionId: input.actionId,
      executionId: input.executionId,
      action: "answer_decision",
      decisionId: input.decisionId,
      answer: input.answer,
      answeredBy: input.ownerId,
      expectedVersion: input.expectedVersion
    }));
    return this.ensureQueuedEvent(result, input.ownerId);
  }

  resolveApproval(input: {
    ownerId: string;
    executionId: string;
    approvalId: string;
    status: "approved" | "rejected" | "expired";
    selectedScope?: string;
    expectedVersion: number;
    actionId: string;
  }): DurableExecutionListItem {
    const result = this.manage(input, () => this.store.runControlAction({
      actionId: input.actionId,
      executionId: input.executionId,
      action: "resolve_approval",
      approvalId: input.approvalId,
      status: input.status,
      selectedScope: input.selectedScope,
      expectedVersion: input.expectedVersion
    }));
    return this.ensureQueuedEvent(result, input.ownerId);
  }

  ensureQueuedEvents(ownerId: string): number {
    const candidates = this.list({ ownerId, statuses: ["queued", "verifying"] })
      .sort((left, right) => {
        const leftVerifier = left.execution.status === "verifying" ? 0 : 1;
        const rightVerifier = right.execution.status === "verifying" ? 0 : 1;
        if (leftVerifier !== rightVerifier) return leftVerifier - rightVerifier;
        return (left.projection.queuePosition ?? Number.MAX_SAFE_INTEGER) - (right.projection.queuePosition ?? Number.MAX_SAFE_INTEGER);
      });
    const item = candidates[0];
    if (!item) return 0;
    enqueueDurableExecutionEvent({
      executionId: item.execution.id,
      expectedVersion: item.execution.version,
      runAt: item.execution.nextRunAt ? new Date(item.execution.nextRunAt) : undefined
    }, this.dataDir);
    return 1;
  }

  countUnfinished(ownerId: string): number {
    return this.store.countUnfinished(ownerId);
  }

  private manage(
    input: { ownerId: string; executionId: string; expectedVersion: number; actionId: string },
    run: () => DurableExecution
  ): DurableExecutionListItem {
    const detail = this.store.getDetail(input.executionId, input.ownerId);
    if (!detail) throw new DurableExecutionNotFoundError(input.executionId);
    const result = run();
    const refreshed = this.store.getDetail(result.id, input.ownerId);
    if (!refreshed) throw new DurableExecutionNotFoundError(input.executionId);
    return { execution: refreshed.execution, projection: this.projectProjection(refreshed) };
  }

  private projectOwned(executionId: string, ownerId: string): DurableExecutionListItem {
    const detail = this.store.getDetail(executionId, ownerId);
    if (!detail) throw new DurableExecutionNotFoundError(executionId);
    return { execution: detail.execution, projection: this.projectProjection(detail) };
  }

  private projectItem(executionId: string, ownerId: string): DurableExecutionListItem {
    const detail = this.store.getDetail(executionId, ownerId);
    if (!detail) throw new DurableExecutionNotFoundError(executionId);
    return { execution: detail.execution, projection: this.projectProjection(detail) };
  }

  private projectProjection(detail: DurableExecutionDetail): DurableExecutionProjection {
    return projectDetail(detail, this.store.queuePosition(detail.execution.id));
  }

  private ensureQueuedEvent(item: DurableExecutionListItem, ownerId: string): DurableExecutionListItem {
    if (item.execution.status === "queued") {
      this.ensureQueuedEvents(ownerId);
    }
    return this.projectOwned(item.execution.id, ownerId);
  }

  claimAttempt(input: Parameters<DurableExecutionStore["claimAttempt"]>[0]) {
    return this.store.claimAttempt(input);
  }

  reconcile(processOwnerId = this.processOwnerId): number {
    return this.store.reconcileOrphanedAttempts(processOwnerId);
  }
}

export { projectDetail as projectDurableExecution };
