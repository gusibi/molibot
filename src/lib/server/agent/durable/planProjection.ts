import type { ConversationPlan } from "$lib/shared/types/message.js";
import type { DurableExecutionDetail } from "./types.js";

const TERMINAL_FAILURES = new Set(["partial", "failed", "cancelled", "recovery_required"]);
const STEP_FAILURES = new Set(["blocked", "failed", "uncertain"]);

/** Projects the Durable aggregate back into its originating Session Plan card. */
export function projectDurableConversationPlan(
  plan: ConversationPlan,
  durable: DurableExecutionDetail
): ConversationPlan {
  const currentSteps = durable.steps
    .filter((step) => step.planVersion === durable.execution.currentPlanVersion)
    .sort((left, right) => left.index - right.index);
  const terminalFailure = TERMINAL_FAILURES.has(durable.execution.status);
  return {
    ...plan,
    status: durable.execution.status === "completed"
      ? "completed"
      : terminalFailure
        ? "blocked"
        : "executing",
    steps: plan.steps.map((step, index) => {
      const durableStep = currentSteps[index];
      if (!durableStep) return step;
      const status = durableStep.status === "completed" || durableStep.status === "skipped"
        ? "completed"
        : durableStep.status === "running"
          ? "in_progress"
          : terminalFailure || STEP_FAILURES.has(durableStep.status)
            ? "blocked"
            : "pending";
      return { ...step, status };
    })
  };
}
