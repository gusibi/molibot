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
    updatedAt: durable.execution.updatedAt,
    status: durable.execution.status === "running" ? "executing"
      : durable.execution.status === "waiting_for_user" && durable.steps.every((step) => step.planVersion !== durable.execution.currentPlanVersion || ["completed", "skipped"].includes(step.status)) ? "waiting_review"
      : durable.execution.status === "planned" ? "accepted"
      : (durable.execution.status === "partial" || durable.execution.status === "recovery_required") ? "blocked"
      : durable.execution.status,
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
