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

export const DEFAULT_RUN_BUDGET: RunBudgetLimits = {
  maxToolCalls: 24,
  maxToolFailures: 6,
  maxModelAttempts: 6
};

export class RunBudget {
  private toolCalls = 0;
  private toolFailures = 0;
  private modelAttempts = 0;

  constructor(private readonly limits: RunBudgetLimits = DEFAULT_RUN_BUDGET) {}

  tryStartTool(): ToolBudgetResult {
    if (this.toolCalls >= this.limits.maxToolCalls) {
      return {
        ok: false,
        reason: `Run budget exceeded: too many tool calls (${this.toolCalls}/${this.limits.maxToolCalls}). Stop and give the best final answer with current evidence.`
      };
    }
    this.toolCalls += 1;
    return { ok: true };
  }

  recordToolResult(isError: boolean): ToolBudgetResult {
    if (isError) {
      this.toolFailures += 1;
      if (this.toolFailures >= this.limits.maxToolFailures) {
        return {
          ok: false,
          reason: `Run budget exceeded: too many tool failures (${this.toolFailures}/${this.limits.maxToolFailures}). Stop retrying and switch to a safer fallback or report the limitation clearly.`
        };
      }
    }
    return { ok: true };
  }

  tryRecordModelAttempt(): ToolBudgetResult {
    if (this.modelAttempts >= this.limits.maxModelAttempts) {
      return {
        ok: false,
        reason: `Run budget exceeded: too many model attempts (${this.modelAttempts}/${this.limits.maxModelAttempts}).`
      };
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
}
