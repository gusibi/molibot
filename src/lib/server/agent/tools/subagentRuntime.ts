import { DEFAULT_RUN_BUDGET, RunBudget, type RunBudgetLimits, type RunBudgetSnapshot } from "$lib/server/agent/core/runtimeBudget.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";

/**
 * Default wall-clock ceiling for a single delegated subagent run. The parent
 * runner already bounds the overall turn; this keeps an individual subagent
 * from hanging indefinitely (e.g. a model that stalls mid-stream) without a
 * structured stop reason bubbling back to the parent.
 */
export const DEFAULT_SUBAGENT_DEADLINE_MS = 10 * 60 * 1000;

export type SubagentStopKind = "budget_exceeded" | "timeout";

export interface SubagentStopReason {
  kind: SubagentStopKind;
  reason: string;
}

export interface SubagentGuardResult {
  ok: boolean;
  reason?: string;
}

/**
 * Resolve the per-subagent budget limits. Subagents reuse the same RunBudget
 * limits as the parent turn so operators only configure one budget; falls back
 * to DEFAULT_RUN_BUDGET when settings omit it.
 */
export function resolveSubagentBudgetLimits(settings: RuntimeSettings): RunBudgetLimits {
  const configured = settings.budget;
  return {
    maxToolCalls: configured?.maxToolCalls ?? DEFAULT_RUN_BUDGET.maxToolCalls,
    maxToolFailures: configured?.maxToolFailures ?? DEFAULT_RUN_BUDGET.maxToolFailures,
    maxModelAttempts: configured?.maxModelAttempts ?? DEFAULT_RUN_BUDGET.maxModelAttempts
  };
}

export interface SubagentExecutionGuardOptions {
  limits: RunBudgetLimits;
  deadlineMs?: number;
  now?: () => number;
}

/**
 * Composes the parent runner's {@link RunBudget} with a wall-clock deadline and
 * exposes a single structured stop reason. This is the runtime-control layer the
 * subagent previously lacked: tool/model budget interruption plus a time ceiling.
 */
export class SubagentExecutionGuard {
  private readonly budget: RunBudget;
  private readonly deadlineMs?: number;
  private readonly now: () => number;
  private readonly startedAt: number;
  private stop: SubagentStopReason | undefined;

  constructor(options: SubagentExecutionGuardOptions) {
    this.budget = new RunBudget(options.limits);
    this.deadlineMs = options.deadlineMs;
    this.now = options.now ?? Date.now;
    this.startedAt = this.now();
  }

  beforeToolCall(): SubagentGuardResult {
    const deadline = this.checkDeadline();
    if (!deadline.ok) return deadline;
    const result = this.budget.tryStartTool();
    if (!result.ok) {
      this.recordBudgetStop();
    }
    return result;
  }

  recordToolResult(isError: boolean): SubagentGuardResult {
    const result = this.budget.recordToolResult(isError);
    if (!result.ok) {
      this.recordBudgetStop();
    }
    return result;
  }

  beforeModelCall(): SubagentGuardResult {
    const deadline = this.checkDeadline();
    if (!deadline.ok) return deadline;
    const result = this.budget.tryRecordModelAttempt();
    if (!result.ok) {
      this.recordBudgetStop();
    }
    return result;
  }

  checkDeadline(): SubagentGuardResult {
    if (this.deadlineMs === undefined) return { ok: true };
    const elapsed = this.now() - this.startedAt;
    if (elapsed >= this.deadlineMs) {
      const reason = `Subagent exceeded its time budget (deadline ${this.deadlineMs}ms, elapsed ${elapsed}ms).`;
      this.stop ??= { kind: "timeout", reason };
      return { ok: false, reason };
    }
    return { ok: true };
  }

  /** Milliseconds left until the deadline (clamped at 0), or undefined if none. */
  remainingMs(): number | undefined {
    if (this.deadlineMs === undefined) return undefined;
    return Math.max(0, this.deadlineMs - (this.now() - this.startedAt));
  }

  getStopReason(): SubagentStopReason | undefined {
    return this.stop;
  }

  snapshot(): RunBudgetSnapshot {
    return this.budget.snapshot();
  }

  private recordBudgetStop(): void {
    const reason = this.budget.getExceededReason();
    if (reason && !this.stop) {
      this.stop = { kind: "budget_exceeded", reason };
    }
  }
}

/**
 * Decide whether a failed subagent attempt should be retried on the next model
 * candidate. Only a plain model-call error is worth retrying: budget/timeout
 * stops, success, user abort, and approval waits must be returned as-is (a
 * different model cannot help, and retrying would waste budget or drop state).
 */
export function shouldFallbackToNextModel(result: {
  stopReason: string;
  runtimeStopKind?: SubagentStopKind;
}): boolean {
  if (result.runtimeStopKind) return false;
  return result.stopReason === "error";
}

export interface DeadlineScheduler {
  setTimer: (callback: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
}

const defaultDeadlineScheduler: DeadlineScheduler = {
  setTimer: (callback, ms) => setTimeout(callback, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
};

/**
 * Arm an independent timer that fires `onExpire` once the guard's wall-clock
 * deadline elapses, regardless of session activity. This covers the case where
 * a subagent's `session.prompt` hangs with no further events: the event-driven
 * {@link evaluateSubagentEvent} check would never run, so a standalone timer is
 * required to actually abort an idle/stalled run. Returns a clear function that
 * MUST be called in a `finally` so a completed attempt cancels the timer.
 */
export function armSubagentDeadline(
  guard: SubagentExecutionGuard,
  onExpire: () => void,
  scheduler: DeadlineScheduler = defaultDeadlineScheduler
): () => void {
  const remaining = guard.remainingMs();
  if (remaining === undefined) return () => {};
  const handle = scheduler.setTimer(onExpire, remaining);
  return () => scheduler.clearTimer(handle);
}

export interface SubagentEvaluation {
  abort: boolean;
  reason?: string;
}

/**
 * Map a pi-coding-agent session event onto the guard. Returns whether the
 * subagent session should be aborted, and the structured reason if so. Wiring
 * this into `session.subscribe` gives subagents the same budget/deadline
 * interruption the parent runner already enforces via its tool hooks.
 */
export function evaluateSubagentEvent(
  guard: SubagentExecutionGuard,
  event: { type?: string; message?: { role?: string }; isError?: boolean; [key: string]: unknown }
): SubagentEvaluation {
  let result: SubagentGuardResult = { ok: true };

  if (event.type === "tool_execution_start") {
    result = guard.beforeToolCall();
  } else if (event.type === "tool_execution_end") {
    result = guard.recordToolResult(Boolean(event.isError));
  } else if (event.type === "message_start" && event.message?.role === "assistant") {
    result = guard.beforeModelCall();
  } else {
    result = guard.checkDeadline();
  }

  return result.ok ? { abort: false } : { abort: true, reason: result.reason };
}
