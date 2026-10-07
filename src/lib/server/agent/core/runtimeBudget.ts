export interface RunBudgetLimits {
  maxToolCalls: number;
  maxToolFailures: number;
  /** Failed-generation retry limit. */
  maxModelAttempts: number;
}

export interface RunBudgetSnapshot {
  toolCalls: number;
  toolFailures: number;
  modelFailures: number;
  modelTurns: number;
}

export interface RunBudgetState extends RunBudgetSnapshot {
  limits: RunBudgetLimits;
  exceededReason?: string;
  exceededKind?: RunBudgetExceededKind;
}

export interface RunBudgetPersistence {
  read(): RunBudgetState;
  mutate(kind: "tool" | "result" | "model" | "modelTurn", sourceId: string | undefined, isError: boolean | undefined,
    work: (state: RunBudgetState) => { state: RunBudgetState; result: ToolBudgetResult }): ToolBudgetResult;
  close(): void;
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
export type RunBudgetExceededKind = "toolCalls" | "toolFailures" | "modelFailures";

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
  if (input.kind === "modelFailures") {
    return `本轮运行达到模型重试上限（${input.snapshot.modelFailures}/${input.limits.maxModelAttempts}）后停止。请稍后重试，或检查模型配置。`;
  }
  return "本轮运行被运行预算中止。上方保留了已完成的步骤。";
}

export class RunBudget {
  private toolCalls = 0;
  private toolFailures = 0;
  private modelFailures = 0;
  private modelTurns = 0;
  private exceededReason: string | undefined;
  private exceededKind: RunBudgetExceededKind | undefined;

  constructor(private limits: RunBudgetLimits = DEFAULT_RUN_BUDGET,
    private readonly persistence?: RunBudgetPersistence) {
  }

  private persisted(kind: "tool" | "result" | "model" | "modelTurn", sourceId: string | undefined,
    isError: boolean | undefined, work: () => ToolBudgetResult): ToolBudgetResult {
    return this.persistence!.mutate(kind, sourceId, isError, state => {
      this.limits = state.limits;
      this.toolCalls = state.toolCalls;
      this.toolFailures = state.toolFailures;
      this.modelFailures = state.modelFailures;
      this.modelTurns = state.modelTurns;
      this.exceededKind = state.exceededKind;
      this.exceededReason = state.exceededReason;
      const result = work();
      return { result, state: {
        limits: this.limits, toolCalls: this.toolCalls, toolFailures: this.toolFailures,
        modelFailures: this.modelFailures, modelTurns: this.modelTurns, exceededKind: this.exceededKind, exceededReason: this.exceededReason
      } };
    });
  }

  close(): void { this.persistence?.close(); }

  private exceed(kind: RunBudgetExceededKind, reason: string): ToolBudgetResult {
    this.exceededReason = reason;
    this.exceededKind = kind;
    return { ok: false, reason };
  }

  tryStartTool(sourceId?: string): ToolBudgetResult {
    return this.persistence ? this.persisted("tool", sourceId, undefined, () => this.startTool()) : this.startTool();
  }

  private startTool(): ToolBudgetResult {
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

  recordToolResult(isError: boolean, sourceId?: string): ToolBudgetResult {
    return this.persistence ? this.persisted("result", sourceId, isError, () => this.toolResult(isError)) : this.toolResult(isError);
  }

  private toolResult(isError: boolean): ToolBudgetResult {
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

  /** Record one failed generation; successful rounds do not spend retries. */
  tryRecordModelFailure(sourceId?: string): ToolBudgetResult {
    return this.persistence ? this.persisted("model", sourceId, undefined, () => this.modelFailure()) : this.modelFailure();
  }

  private modelFailure(): ToolBudgetResult {
    if (this.modelFailures >= this.limits.maxModelAttempts) {
      return this.exceed(
        "modelFailures",
        `Run budget exceeded: too many model failures (${this.modelFailures}/${this.limits.maxModelAttempts}).`
      );
    }
    this.modelFailures += 1;
    return { ok: true };
  }

  tryStartModelTurn(sourceId?: string): ToolBudgetResult {
    return this.persistence ? this.persisted("modelTurn", sourceId, undefined, () => this.modelTurn()) : this.modelTurn();
  }

  private modelTurn(): ToolBudgetResult {
    if (this.exceededReason) return { ok: false, reason: this.exceededReason };
    this.modelTurns += 1;
    return { ok: true };
  }

  snapshot(): RunBudgetSnapshot {
    const state = this.persistence?.read();
    if (state) return { toolCalls: state.toolCalls, toolFailures: state.toolFailures, modelFailures: state.modelFailures, modelTurns: state.modelTurns };
    return {
      toolCalls: this.toolCalls,
      toolFailures: this.toolFailures,
      modelFailures: this.modelFailures,
      modelTurns: this.modelTurns
    };
  }

  limitsSnapshot(): RunBudgetLimits {
    return { ...(this.persistence?.read().limits ?? this.limits) };
  }

  getExceededReason(): string | undefined {
    return this.persistence ? this.persistence.read().exceededReason : this.exceededReason;
  }

  getExceededKind(): RunBudgetExceededKind | undefined {
    return this.persistence ? this.persistence.read().exceededKind : this.exceededKind;
  }
}
