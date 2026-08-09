import { randomUUID } from "node:crypto";
import { momLog, momWarn } from "$lib/server/agent/common/log.js";
import { PROCESS_OWNER_ID } from "$lib/server/agent/eventsLeaseStore.js";
import { config } from "$lib/server/app/env.js";
import type { MomEvent } from "$lib/server/agent/events.js";
import type { ChannelInboundMessage, DurableAttemptHooks } from "$lib/server/agent/core/types.js";
import type { ToolApprovalRequest, ToolApprovalConsumptionRequest, ToolResult, ToolSideEffect } from "$lib/server/agent/tools/toolTypes.js";
import type { ChannelManager } from "$lib/server/channels/registry.js";
import type { DurableExecution, ExecutionStep, SideEffectRecord } from "./types.js";
import { DurableExecutionCoordinator } from "./coordinator.js";
import { DurableExecutionBudgetError, DurableExecutionConflictError, DurableExecutionNotFoundError } from "./store.js";
import { DurableExecutionStore } from "./store.js";

export interface DurableExecutionRuntimeOptions {
  channelManagers: Map<string, Map<string, ChannelManager>>;
  store?: DurableExecutionStore;
  processOwnerId?: string;
  leaseDurationMs?: number;
  dataDir?: string;
  maxActiveExecutions?: number;
  queryableProbes?: Record<string, DurableQueryableProbe>;
}

export interface DurableQueryableProbeInput {
  execution: DurableExecution;
  step: ExecutionStep;
  intent?: SideEffectRecord;
}

export interface DurableQueryableProbeResult {
  status: "completed" | "not_found" | "unknown";
  summary: string;
  referenceId?: string;
  externalId?: string;
}

export type DurableQueryableProbe = (input: DurableQueryableProbeInput) => Promise<DurableQueryableProbeResult>;

function briefing(detail: NonNullable<ReturnType<DurableExecutionStore["getDetail"]>>, stepId: string): string {
  const step = detail.steps.find((item) => item.id === stepId);
  const criteria = detail.acceptanceCriteria
    .filter((criterion) => criterion.planVersion === detail.execution.currentPlanVersion)
    .map((criterion) => `- ${criterion.required ? "[required]" : "[optional]"} ${criterion.description}`)
    .join("\n");
  return [
    `[Durable Execution ${detail.execution.shortHandle}]`,
    "This is one controlled execution attempt. Work only on the current step below.",
    "Do not claim the overall execution is complete. Return a concise factual summary of actions taken and evidence that a verifier can inspect.",
    `Goal: ${detail.execution.goal}`,
    detail.execution.constraints.length > 0 ? `Constraints:\n${detail.execution.constraints.map((item) => `- ${item}`).join("\n")}` : "",
    step ? `Current step: ${step.title}\n${step.description || "No further step description was provided."}` : "No current step is available.",
    criteria ? `Acceptance criteria:\n${criteria}` : ""
  ].filter(Boolean).join("\n\n");
}

function eventForAttempt(detail: NonNullable<ReturnType<DurableExecutionStore["getDetail"]>>, stepId: string, runId: string): MomEvent {
  const taskId = `durable-execution:${detail.execution.id}:attempt:${runId}`;
  return {
    type: "immediate",
    enabled: true,
    taskId,
    chatId: detail.execution.sourceChatId!,
    text: briefing(detail, stepId),
    execution: "channel",
    delivery: "agent",
    sessionMode: "fresh",
    status: { state: "running", runId }
  };
}

function isTerminalOrWaiting(status: string): boolean {
  return ["partial", "completed", "failed", "cancelled", "paused", "waiting_for_user", "waiting_for_approval"].includes(status);
}

function deterministicCriterionResult(
  criterion: NonNullable<ReturnType<DurableExecutionStore["getDetail"]>>["acceptanceCriteria"][number],
  detail: NonNullable<ReturnType<DurableExecutionStore["getDetail"]>>
): { result: "unproven" | "passed" | "failed"; summary: string } {
  if (criterion.checkerType !== "deterministic") {
    return { result: "unproven", summary: "Subjective criterion requires an explicit user or judge decision." };
  }
  const steps = detail.steps.filter((step) => step.planVersion === detail.execution.currentPlanVersion);
  switch (criterion.checkerKey) {
    case "all_steps_completed":
    case "steps_completed": {
      const passed = steps.length > 0 && steps.every((step) => step.status === "completed" || step.status === "skipped");
      return { result: passed ? "passed" : "failed", summary: passed ? "All current plan steps are completed." : "At least one current plan step is not completed." };
    }
    case "evidence_present": {
      const passed = detail.evidenceRefs.some((evidence) => evidence.status === "available");
      return { result: passed ? "passed" : "failed", summary: passed ? "The execution has an available evidence reference." : "No available evidence reference was found." };
    }
    case "no_open_decisions": {
      const passed = detail.decisions.every((decision) => decision.status !== "open");
      return { result: passed ? "passed" : "failed", summary: passed ? "There are no open decisions." : "An open decision still blocks completion." };
    }
    default:
      return { result: "unproven", summary: `No deterministic checker is registered for ${criterion.checkerKey ?? "this criterion"}.` };
  }
}

/**
 * Runs one durable attempt through the existing shared channel runner seam.
 * The durable state machine remains here; ChannelManager only adapts the
 * channel's response surface to the common runner context.
 */
export class DurableExecutionRuntime {
  private readonly store: DurableExecutionStore;
  private readonly processOwnerId: string;
  private readonly leaseDurationMs: number;
  private readonly maxActiveExecutions: number;
  private readonly coordinator: DurableExecutionCoordinator;

  constructor(private readonly options: DurableExecutionRuntimeOptions) {
    this.store = options.store ?? new DurableExecutionStore();
    this.processOwnerId = options.processOwnerId ?? PROCESS_OWNER_ID;
    this.leaseDurationMs = Math.max(1000, Math.round(options.leaseDurationMs ?? 600_000));
    this.maxActiveExecutions = Math.max(1, Math.round(options.maxActiveExecutions ?? 1));
    this.coordinator = new DurableExecutionCoordinator(this.store, this.processOwnerId, options.dataDir ?? config.dataDir);
  }

  reconcile(): number {
    return this.store.reconcileOrphanedAttempts(this.processOwnerId);
  }

  ensureQueuedEvents(ownerId = "owner"): number {
    return this.coordinator.ensureQueuedEvents(ownerId);
  }

  handleSkippedEvent(event: MomEvent, reason: string): void {
    const durable = event.internal?.durable;
    if (event.internal?.kind !== "durable-execution" || !durable) return;
    const current = this.store.getById(durable.executionId);
    if (!current || current.version !== durable.expectedVersion || !["planned", "queued"].includes(current.status)) return;
    const message = `Continuation event missed the offline catch-up window (${reason}); manual recovery is required.`;
    try {
      this.store.transitionStatus(durable.executionId, durable.expectedVersion, "recovery_required", {
        waitingKind: "recovery",
        waitingReason: message,
        lastError: message
      });
      momWarn("durableExecution", "continuation_missed_catchup_window", {
        executionId: durable.executionId,
        expectedVersion: durable.expectedVersion,
        reason
      });
    } catch (cause) {
      momWarn("durableExecution", "continuation_missed_recovery_persist_failed", {
        executionId: durable.executionId,
        error: cause instanceof Error ? cause.message : String(cause)
      });
    }
  }

  async run(event: MomEvent, filename: string): Promise<{ kind: "durable-execution" }> {
    const input = event.internal?.durable;
    if (!input?.executionId || !Number.isFinite(input.expectedVersion)) {
      throw new Error("Durable internal event payload is invalid.");
    }
    let detail = this.store.getDetail(input.executionId);
    if (!detail) throw new DurableExecutionNotFoundError(input.executionId);

    // The event file is an idempotent trigger, not the source of truth. A
    // later version means another attempt/control action already won the CAS.
    if (detail.execution.version !== input.expectedVersion) {
      if (isTerminalOrWaiting(detail.execution.status) || detail.execution.status === "running" || detail.execution.status === "verifying") {
        return { kind: "durable-execution" };
      }
      throw new DurableExecutionConflictError(input.executionId, input.expectedVersion, detail.execution.version);
    }
    if (detail.execution.status === "verifying") {
      await this.verify(detail, filename);
      return { kind: "durable-execution" };
    }
    if (!(["planned", "queued", "recovery_required"] as string[]).includes(detail.execution.status)) {
      return { kind: "durable-execution" };
    }
    let expectedVersionForAttempt = input.expectedVersion;
    if (detail.execution.status === "recovery_required") {
      const recovery = await this.prepareRecovery(detail, filename);
      if (recovery.kind === "stopped") return { kind: "durable-execution" };
      expectedVersionForAttempt = recovery.expectedVersion;
      detail = this.store.getDetail(input.executionId);
      if (!detail) throw new DurableExecutionNotFoundError(input.executionId);
    }

    const activeExecutions = this.store.countActive(detail.execution.ownerId);
    if (detail.execution.status === "queued" && activeExecutions >= this.maxActiveExecutions) {
      this.store.deferQueued(input.executionId, expectedVersionForAttempt);
      this.coordinator.ensureQueuedEvents(detail.execution.ownerId);
      momLog("durableExecution", "attempt_queued_for_capacity", {
        executionId: input.executionId,
        ownerId: detail.execution.ownerId,
        active: activeExecutions,
        maxActive: this.maxActiveExecutions
      });
      return { kind: "durable-execution" };
    }

    const sourceChatId = detail.execution.sourceChatId;
    const manager = sourceChatId
      ? this.options.channelManagers.get(detail.execution.sourceChannel)?.get(detail.execution.botId)
      : undefined;
    if (!sourceChatId || !manager?.runDurableAttempt) {
      this.store.transitionStatus(input.executionId, expectedVersionForAttempt, "failed", {
        lastError: sourceChatId
          ? `Durable runner is unavailable for ${detail.execution.sourceChannel}/${detail.execution.botId}.`
          : "Durable Execution needs a source chat before it can run."
      });
      return { kind: "durable-execution" };
    }

    const runId = `durable-attempt-${randomUUID()}`;
    const nextStep = detail.steps.find((step) => step.planVersion === detail.execution.currentPlanVersion && step.status !== "completed" && step.status !== "skipped");
    const taskEvent = eventForAttempt(detail, nextStep?.id ?? detail.steps[0].id, runId);
    const contextSessionId = `pending:${runId}`;
    let claimed: ReturnType<DurableExecutionStore["claimAttempt"]>;
    try {
      claimed = this.store.claimAttempt({
        executionId: input.executionId,
        expectedVersion: expectedVersionForAttempt,
        processOwnerId: this.processOwnerId,
        runId,
        contextSessionId,
        leaseDurationMs: this.leaseDurationMs
      });
    } catch (cause) {
      if (!(cause instanceof DurableExecutionBudgetError)) throw cause;
      const current = this.store.getById(input.executionId);
      if (current && current.version === expectedVersionForAttempt && ["planned", "queued", "recovery_required"].includes(current.status)) {
        this.store.transitionStatus(input.executionId, expectedVersionForAttempt, "partial", { lastError: cause.message });
      }
      momWarn("durableExecution", "budget_exhausted_before_attempt", {
        executionId: input.executionId,
        reason: cause.message
      });
      return { kind: "durable-execution" };
    }
    let expectedVersion = claimed.execution.version;
    const step = nextStep;
    if (!step) {
      this.store.finishAttempt({
        executionId: input.executionId,
        attemptId: claimed.attempt.id,
        expectedVersion,
        processOwnerId: this.processOwnerId,
        status: "completed",
        nextExecutionStatus: "verifying",
        reason: "All execution steps are ready for verification."
      });
      this.coordinator.ensureQueuedEvents(detail.execution.ownerId);
      return { kind: "durable-execution" };
    }

    this.store.markStepRunning(input.executionId, step.id, expectedVersion, this.processOwnerId);
    expectedVersion = this.store.getById(input.executionId)!.version;
    const inbound: ChannelInboundMessage = {
      chatId: sourceChatId,
      chatType: "private",
      messageId: Date.now(),
      userId: "DURABLE_EXECUTION",
      userName: "DURABLE_EXECUTION",
      text: taskEvent.text,
      ts: (Date.now() / 1000).toFixed(6),
      attachments: [],
      imageContents: [],
      isEvent: true,
      taskId: taskEvent.taskId,
      projectId: detail.execution.sourceProjectId,
      sessionMode: "fresh",
      runId
    };

    // Tool calls can be emitted by the model loop in parallel. Serialize only
    // the durable writes so each intent/receipt advances the same execution
    // version without turning the external handler itself into a global lock.
    let sideEffectWriteChain = Promise.resolve();
    const serializeSideEffectWrite = <T>(work: () => T | Promise<T>): Promise<T> => {
      const next = sideEffectWriteChain.then(work, work);
      sideEffectWriteChain = next.then(() => undefined, () => undefined);
      return next;
    };
    const persistSideEffect = async (phase: "intent" | "receipt", effect: ToolSideEffect, result?: ToolResult): Promise<void> => {
      await serializeSideEffectWrite(async () => {
        const current = this.store.getById(input.executionId);
        if (!current) throw new DurableExecutionNotFoundError(input.executionId);
        const metadata = result?.metadata ?? {};
        const externalId = typeof metadata.externalId === "string"
          ? metadata.externalId
          : typeof metadata.receiptId === "string" ? metadata.receiptId : undefined;
        const receiptContentSummary = result
          ? `${effect.contentSummary}; result=${JSON.stringify(result.content ?? result.error ?? "").slice(0, 800)}`
          : effect.contentSummary;
        const record = phase === "intent"
          ? this.store.recordSideEffectIntent({
              executionId: input.executionId,
              stepId: step.id,
              attemptId: claimed.attempt.id,
              processOwnerId: this.processOwnerId,
              expectedVersion: current.version,
              sideEffectClass: effect.sideEffectClass,
              idempotencyKey: effect.idempotencyKey,
              targetSummary: effect.targetSummary,
              contentSummary: effect.contentSummary
            })
          : this.store.recordSideEffectReceipt({
              executionId: input.executionId,
              stepId: step.id,
              attemptId: claimed.attempt.id,
              processOwnerId: this.processOwnerId,
              expectedVersion: current.version,
              sideEffectClass: effect.sideEffectClass,
              idempotencyKey: effect.idempotencyKey,
              targetSummary: effect.targetSummary,
              contentSummary: receiptContentSummary,
              externalId,
              payload: result ? { ok: result.ok, error: result.error } : undefined
            });
        expectedVersion = this.store.getById(input.executionId)!.version;
        momLog("durableExecution", "side_effect_recorded", {
          executionId: input.executionId,
          stepId: step.id,
          attemptId: claimed.attempt.id,
          phase,
          toolName: effect.toolId,
          sideEffectClass: effect.sideEffectClass,
          idempotencyKey: effect.idempotencyKey,
          recordId: record.id
        });
      });
    };

    try {
      const attemptHooks: DurableAttemptHooks = {
        onRunnerEvent: async (runnerEvent) => {
          if (runnerEvent.type === "tool_execution_start" || runnerEvent.type === "tool_execution_end") {
            momLog("durableExecution", "attempt_tool", {
              executionId: input.executionId,
              stepId: step.id,
              toolName: runnerEvent.toolName,
              phase: runnerEvent.type
            });
          }
        },
        onToolSideEffectPreflight: (effect) => persistSideEffect("intent", effect),
        onToolSideEffectReceipt: (effect, result) => persistSideEffect("receipt", effect, result),
        consumeDurableApproval: async (request: ToolApprovalConsumptionRequest) => serializeSideEffectWrite(() => {
          const current = this.store.getDetail(input.executionId);
          if (!current) throw new DurableExecutionNotFoundError(input.executionId);
          const approval = [...current.approvals]
            .reverse()
            .find((item) => item.status === "approved" && item.backend === request.backend && item.actionKey === request.actionKey);
          if (!approval) return false;
          const selectedScope = approval.selectedScope === "session" || approval.selectedScope === "persistent" ? approval.selectedScope : "once";
          const consumed = this.store.consumeApprovedApproval({
            executionId: input.executionId,
            approvalId: approval.id,
            expectedVersion: current.execution.version,
            processOwnerId: this.processOwnerId
          });
          if (!consumed) return false;
          expectedVersion = this.store.getById(input.executionId)!.version;
          momLog("durableExecution", "approval_consumed", {
            executionId: input.executionId,
            attemptId: claimed.attempt.id,
            approvalId: approval.id,
            requestId: approval.requestId,
            scope: selectedScope,
            backend: request.backend
          });
          return selectedScope;
        }),
        onApprovalRequest: async (request: ToolApprovalRequest) => {
          const current = this.store.getById(input.executionId);
          if (!current) throw new DurableExecutionNotFoundError(input.executionId);
          const prompt = request.prompt;
          const existing = this.store.getDetail(input.executionId)?.approvals.find((item) => item.requestId === request.requestId);
          const approval = this.store.recordApprovalRequest({
            executionId: input.executionId,
            attemptId: claimed.attempt.id,
            expectedVersion: current.version,
            processOwnerId: this.processOwnerId,
            requestId: request.requestId,
            backend: request.backend,
            actionKey: [prompt.request.toolId, prompt.request.command, prompt.request.approvalMode].filter(Boolean).join(":"),
            toolId: prompt.request.toolId,
            title: prompt.title,
            summary: prompt.body,
            options: prompt.options.map((option) => option.id)
          });
          expectedVersion = this.store.getById(input.executionId)!.version;
          momLog("durableExecution", "approval_recorded", {
            executionId: input.executionId,
            attemptId: claimed.attempt.id,
            approvalId: approval.id,
            requestId: approval.requestId,
            repeatCount: approval.repeatCount,
            backend: approval.backend
          });
          if (!existing && manager.sendInternalNotice && sourceChatId) {
            const notice = [
              `${prompt.title} · ${current.shortHandle}`,
              prompt.body,
              `Options: ${prompt.options.map((option) => option.label).join(" / ")}`,
              `Use /durable approve ${current.shortHandle} [once|session|persistent], or /durable reject ${current.shortHandle}.`
            ].join("\n\n");
            try {
              await manager.sendInternalNotice(sourceChatId, notice, {
                kind: "durable-approval",
                filename
              });
            } catch (cause) {
              momWarn("durableExecution", "approval_source_notice_failed", {
                executionId: input.executionId,
                sourceChannel: detail.execution.sourceChannel,
                sourceChatId,
                error: cause instanceof Error ? cause.message : String(cause)
              });
            }
          }
          return "defer";
        }
      };
      const attemptResult = await manager.runDurableAttempt(inbound, attemptHooks);
      const result = attemptResult.result;
      if (attemptResult.contextSessionId) {
        this.store.setAttemptContextSession(input.executionId, claimed.attempt.id, this.processOwnerId, attemptResult.contextSessionId);
      }

      if (attemptResult.approval || result.stopReason === "waiting_for_approval") {
        expectedVersion = this.store.getById(input.executionId)!.version;
        const approval = attemptResult.approval
          ? this.store.getDetail(input.executionId)!.approvals.find((item) => item.requestId === attemptResult.approval!.requestId)
          : undefined;
        const approvalReason = approval
          ? `${approval.title}\n${approval.summary}${approval.repeatCount > 1 ? `\nRepeated approval request #${approval.repeatCount}.` : ""}`
          : "The attempt is waiting for approval before it can continue.";
        this.store.finishAttempt({
          executionId: input.executionId,
          attemptId: claimed.attempt.id,
          expectedVersion,
          processOwnerId: this.processOwnerId,
          status: "waiting",
          nextExecutionStatus: "waiting_for_approval",
          reason: approvalReason,
          tokensUsed: result.usage?.totalTokens
        });
      } else if (result.stopReason === "stop") {
        this.store.completeStep({
          executionId: input.executionId,
          stepId: step.id,
          expectedVersion,
          processOwnerId: this.processOwnerId,
          outputSummary: "Agent attempt returned; acceptance verification is still required.",
          evidenceSummary: "Verifier pending."
        });
        expectedVersion = this.store.getById(input.executionId)!.version;
        this.store.finishAttempt({
          executionId: input.executionId,
          attemptId: claimed.attempt.id,
          expectedVersion,
          processOwnerId: this.processOwnerId,
          status: "completed",
          nextExecutionStatus: "verifying",
          reason: "Attempt completed; acceptance verification is pending.",
          tokensUsed: result.usage?.totalTokens
        });
        this.coordinator.ensureQueuedEvents(detail.execution.ownerId);
      } else {
        this.store.finishAttempt({
          executionId: input.executionId,
          attemptId: claimed.attempt.id,
          expectedVersion,
          processOwnerId: this.processOwnerId,
          status: "failed",
          nextExecutionStatus: "recovery_required",
          reason: result.errorMessage ?? `Durable attempt stopped with ${result.stopReason}.`,
          tokensUsed: result.usage?.totalTokens
        });
        this.coordinator.ensureQueuedEvents(detail.execution.ownerId);
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      momWarn("durableExecution", "attempt_failed", { executionId: input.executionId, filename, error: message });
      try {
        this.store.finishAttempt({
          executionId: input.executionId,
          attemptId: claimed.attempt.id,
          expectedVersion,
          processOwnerId: this.processOwnerId,
          status: "failed",
          nextExecutionStatus: "recovery_required",
          reason: message
        });
      } catch (finishCause) {
        momWarn("durableExecution", "attempt_failure_persist_failed", {
          executionId: input.executionId,
          error: finishCause instanceof Error ? finishCause.message : String(finishCause)
        });
      }
      this.coordinator.ensureQueuedEvents(detail.execution.ownerId);
    }
    return { kind: "durable-execution" };
  }

  private async prepareRecovery(
    detail: NonNullable<ReturnType<DurableExecutionStore["getDetail"]>>,
    filename: string
  ): Promise<{ kind: "continue"; expectedVersion: number } | { kind: "stopped" }> {
    const step = detail.steps.find((item) =>
      item.planVersion === detail.execution.currentPlanVersion
      && (item.status === "uncertain" || item.status === "running")
    );
    if (!step || step.sideEffectClass === "pure" || step.sideEffectClass === "idempotent") {
      return { kind: "continue", expectedVersion: detail.execution.version };
    }

    if (step.sideEffectClass === "non_idempotent") {
      this.openRecoveryDecision(detail, step, "This step may already have changed external state and cannot be retried automatically.", filename);
      return { kind: "stopped" };
    }

    const probeKey = step.idempotencyKey ?? step.id;
    const probe = this.options.queryableProbes?.[probeKey];
    if (!probe) {
      this.openRecoveryDecision(detail, step, "This queryable step has no external-state probe, so the runtime cannot safely decide whether it already completed.", filename);
      return { kind: "stopped" };
    }

    const intent = [...detail.sideEffects]
      .reverse()
      .find((item) => item.stepId === step.id && item.phase === "intent");
    let result: DurableQueryableProbeResult;
    try {
      result = await probe({ execution: detail.execution, step, intent });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      this.openRecoveryDecision(detail, step, `The external-state probe failed: ${message}`, filename);
      return { kind: "stopped" };
    }

    if (result.status === "unknown") {
      this.openRecoveryDecision(detail, step, result.summary || "The external-state probe could not determine whether the action completed.", filename);
      return { kind: "stopped" };
    }

    const reconciled = this.store.reconcileQueryableStep({
      executionId: detail.execution.id,
      stepId: step.id,
      expectedVersion: detail.execution.version,
      outcome: result.status,
      summary: result.summary,
      referenceId: result.referenceId ?? `queryable-probe:${probeKey}`,
      externalId: result.externalId
    });
    const refreshed = this.store.getDetail(detail.execution.id)!;
    if (result.status === "completed" && !refreshed.steps.some((item) => item.planVersion === refreshed.execution.currentPlanVersion && item.status !== "completed" && item.status !== "skipped")) {
      this.store.transitionStatus(reconciled.id, reconciled.version, "verifying", {
        waitingReason: "Queryable recovery confirmed the external action; acceptance verification is pending."
      });
      this.coordinator.ensureQueuedEvents(detail.execution.ownerId);
      momLog("durableExecution", "queryable_recovery_completed", { executionId: detail.execution.id, stepId: step.id, filename });
      return { kind: "stopped" };
    }
    const queued = this.store.transitionStatus(reconciled.id, reconciled.version, "queued", {
      waitingReason: undefined,
      lastError: undefined
    });
    this.coordinator.ensureQueuedEvents(detail.execution.ownerId);
    momLog("durableExecution", "queryable_recovery_retry_queued", {
      executionId: detail.execution.id,
      stepId: step.id,
      filename,
      status: result.status,
      version: queued.version
    });
    return { kind: "stopped" };
  }

  private openRecoveryDecision(
    detail: NonNullable<ReturnType<DurableExecutionStore["getDetail"]>>,
    step: ExecutionStep,
    reason: string,
    filename: string
  ): void {
    const question = `Recovery review required for “${step.title}”. ${reason} Choose retry only after checking the external system.`;
    const decision = this.store.openRecoveryDecision({
      executionId: detail.execution.id,
      expectedVersion: detail.execution.version,
      question,
      options: ["retry_after_recovery_review"]
    });
    momLog("durableExecution", "recovery_review_required", {
      executionId: detail.execution.id,
      stepId: step.id,
      decisionId: decision.id,
      sideEffectClass: step.sideEffectClass,
      filename
    });
  }

  private async verify(detail: NonNullable<ReturnType<DurableExecutionStore["getDetail"]>>, filename: string): Promise<void> {
    const runId = `durable-verifier-${randomUUID()}`;
    let claimed: ReturnType<DurableExecutionStore["claimAttempt"]>;
    try {
      claimed = this.store.claimAttempt({
        executionId: detail.execution.id,
        expectedVersion: detail.execution.version,
        processOwnerId: this.processOwnerId,
        runId,
        contextSessionId: `verifier:${detail.execution.id}:${detail.execution.version}`,
        leaseDurationMs: this.leaseDurationMs,
        countTowardsAttemptBudget: false
      });
    } catch (cause) {
      if (!(cause instanceof DurableExecutionBudgetError)) throw cause;
      const current = this.store.getById(detail.execution.id);
      if (current && current.version === detail.execution.version && current.status === "verifying") {
        this.store.transitionStatus(detail.execution.id, detail.execution.version, "partial", { lastError: cause.message });
      }
      momWarn("durableExecution", "budget_exhausted_before_verification", {
        executionId: detail.execution.id,
        reason: cause.message,
        filename
      });
      return;
    }
    let expectedVersion = claimed.execution.version;
    try {
      const current = this.store.getDetail(detail.execution.id)!;
      const criteria = current.acceptanceCriteria.filter((criterion) => criterion.planVersion === current.execution.currentPlanVersion);
      for (const criterion of criteria) {
        if (criterion.userEdited) continue;
        const checked = deterministicCriterionResult(criterion, current);
        let evidenceRefId: string | undefined;
        if (checked.result !== "unproven") {
          const evidence = this.store.addEvidence({
            executionId: detail.execution.id,
            attemptId: claimed.attempt.id,
            referenceType: "durable-verifier",
            referenceId: `${criterion.id}:${runId}`,
            summary: checked.summary
          });
          evidenceRefId = evidence.id;
        }
        this.store.recordAcceptanceResult({
          executionId: detail.execution.id,
          criterionId: criterion.id,
          expectedVersion,
          processOwnerId: this.processOwnerId,
          result: checked.result,
          evidenceRefId
        });
        expectedVersion = this.store.getById(detail.execution.id)!.version;
      }

      const verified = this.store.getDetail(detail.execution.id)!;
      const required = verified.acceptanceCriteria.filter((criterion) => criterion.planVersion === verified.execution.currentPlanVersion && criterion.required);
      const failed = required.some((criterion) => criterion.result === "failed");
      const unproven = required.some((criterion) => criterion.result === "unproven");
      if (!failed && unproven) {
        const decision = this.store.openDecision({
          executionId: detail.execution.id,
          expectedVersion,
          processOwnerId: this.processOwnerId,
          question: "Please confirm whether the requested goal is satisfied, or continue the execution for another attempt.",
          options: ["confirm_completion", "continue_work"]
        });
        momLog("durableExecution", "verification_waiting_for_user", {
          executionId: detail.execution.id,
          decisionId: decision.id,
          filename
        });
        this.coordinator.ensureQueuedEvents(detail.execution.ownerId);
        return;
      }
      const nextExecutionStatus = failed ? "partial" : "completed";
      const reason = failed
        ? "A required acceptance criterion failed."
        : "All required acceptance criteria have deterministic evidence or an explicit user confirmation.";
      this.store.finishAttempt({
        executionId: detail.execution.id,
        attemptId: claimed.attempt.id,
        expectedVersion,
        processOwnerId: this.processOwnerId,
        status: "completed",
        nextExecutionStatus,
        reason
      });
      this.coordinator.ensureQueuedEvents(detail.execution.ownerId);
      momLog("durableExecution", "verification_finished", { executionId: detail.execution.id, filename, status: nextExecutionStatus });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      momWarn("durableExecution", "verification_failed", { executionId: detail.execution.id, filename, error: message });
      try {
        this.store.finishAttempt({
          executionId: detail.execution.id,
          attemptId: claimed.attempt.id,
          expectedVersion,
          processOwnerId: this.processOwnerId,
          status: "failed",
          nextExecutionStatus: "recovery_required",
          waitingKind: "recovery",
          reason: message
        });
      } catch (finishCause) {
        momWarn("durableExecution", "verification_failure_persist_failed", {
          executionId: detail.execution.id,
          error: finishCause instanceof Error ? finishCause.message : String(finishCause)
        });
      }
    }
  }
}
