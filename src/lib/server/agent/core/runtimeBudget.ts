export interface RunBudgetLimits {
  maxToolCalls: number;
  maxToolFailures: number;
  maxModelAttempts: number;
}

export interface RunBudgetSnapshot {
  toolCalls: number;
  toolFailures: number;
  modelAttempts: number;
}

export interface ToolBudgetResult {
  ok: boolean;
  reason?: string;
}

/**
 * Which limit ran out. Callers must branch on this rather than on substrings of
 * `exceededReason` — the reason text is user-facing prose and has already been
 * reworded once while a `.includes("too many tool calls")` check silently kept
 * pointing at the old wording.
 */
export type RunBudgetExceededKind = "toolCalls" | "toolFailures" | "modelAttempts";

export const DEFAULT_RUN_BUDGET: RunBudgetLimits = {
  maxToolCalls: 24,
  maxToolFailures: 6,
  maxModelAttempts: 6
};

/**
 * Failure budget implied by a tool-call budget, for owners who raised the
 * latter and never knew the former existed.
 *
 * The two limits are one policy — "how much room does a run get" — but only
 * `maxToolCalls` is discoverable. Raising it to 100 while the failure budget
 * stayed at 6 meant a long run still died on its sixth failed call, which is
 * not what the owner asked for. Keeps the shipped 6/24 ratio and never goes
 * below the default.
 */
export function deriveToolFailureBudget(maxToolCalls: number): number {
  const ratio = DEFAULT_RUN_BUDGET.maxToolFailures / DEFAULT_RUN_BUDGET.maxToolCalls;
  return Math.max(DEFAULT_RUN_BUDGET.maxToolFailures, Math.min(100, Math.round(maxToolCalls * ratio)));
}

/**
 * User-facing account of why a run stopped early.
 *
 * `exceededReason` is written for the model — it is an instruction ("stop
 * retrying and switch to a safer fallback"), which reads as nonsense in a chat
 * bubble. This is the version a person should see, and it names the failing
 * tools so the next attempt has somewhere to start.
 */
export function buildBudgetStopUserMessage(input: {
  kind: RunBudgetExceededKind | undefined;
  snapshot: RunBudgetSnapshot;
  limits: RunBudgetLimits;
  failedToolNames?: string[];
}): string {
  if (input.kind === "toolFailures") {
    const tools = [...new Set(input.failedToolNames ?? [])].slice(0, 4).join("、");
    return [
      `本轮运行因连续 ${input.snapshot.toolFailures} 次工具失败被中止（上限 ${input.limits.maxToolFailures}）。`,
      tools ? `失败的工具：${tools}。` : "",
      "上方的运行记录里保留了每一步的结果；调整思路后可以直接让我继续。"
    ].filter(Boolean).join("");
  }
  if (input.kind === "toolCalls") {
    return `本轮运行达到工具调用上限（${input.snapshot.toolCalls}/${input.limits.maxToolCalls}）后停止。上方保留了已完成的步骤，可以让我继续。`;
  }
  if (input.kind === "modelAttempts") {
    return `本轮运行达到模型重试上限（${input.snapshot.modelAttempts}/${input.limits.maxModelAttempts}）后停止。请稍后重试，或检查模型配置。`;
  }
  return "本轮运行被运行预算中止。上方保留了已完成的步骤。";
}

export class RunBudget {
  private toolCalls = 0;
  private toolFailures = 0;
  private modelAttempts = 0;
  private exceededReason: string | undefined;
  private exceededKind: RunBudgetExceededKind | undefined;

  constructor(private readonly limits: RunBudgetLimits = DEFAULT_RUN_BUDGET) {}

  private exceed(kind: RunBudgetExceededKind, reason: string): ToolBudgetResult {
    this.exceededReason = reason;
    this.exceededKind = kind;
    return { ok: false, reason };
  }

  tryStartTool(): ToolBudgetResult {
    // Once any budget is blown, no further tool may start. Refusing here (the
    // caller turns this into a blocked tool result and strips the tool list) is
    // what lets the model wind the turn down on its own; the alternative —
    // aborting the in-flight request — kills the answer it was about to give.
    if (this.exceededReason) return { ok: false, reason: this.exceededReason };
    if (this.toolCalls >= this.limits.maxToolCalls) {
      return this.exceed(
        "toolCalls",
        `Run budget exceeded: too many tool calls (${this.toolCalls}/${this.limits.maxToolCalls}). Stop and give the best final answer with current evidence.`
      );
    }
    this.toolCalls += 1;
    return { ok: true };
  }

  recordToolResult(isError: boolean): ToolBudgetResult {
    if (isError) {
      this.toolFailures += 1;
      if (this.toolFailures >= this.limits.maxToolFailures) {
        return this.exceed(
          "toolFailures",
          `Run budget exceeded: too many tool failures (${this.toolFailures}/${this.limits.maxToolFailures}). Stop retrying and switch to a safer fallback or report the limitation clearly.`
        );
      }
    }
    return { ok: true };
  }

  tryRecordModelAttempt(): ToolBudgetResult {
    if (this.modelAttempts >= this.limits.maxModelAttempts) {
      return this.exceed(
        "modelAttempts",
        `Run budget exceeded: too many model attempts (${this.modelAttempts}/${this.limits.maxModelAttempts}).`
      );
    }
    this.modelAttempts += 1;
    return { ok: true };
  }

  snapshot(): RunBudgetSnapshot {
    return {
      toolCalls: this.toolCalls,
      toolFailures: this.toolFailures,
      modelAttempts: this.modelAttempts
    };
  }

  limitsSnapshot(): RunBudgetLimits {
    return { ...this.limits };
  }

  getExceededReason(): string | undefined {
    return this.exceededReason;
  }

  getExceededKind(): RunBudgetExceededKind | undefined {
    return this.exceededKind;
  }
}
