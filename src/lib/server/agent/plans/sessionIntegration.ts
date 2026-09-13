import type { ConversationPlan } from "$lib/shared/types/message.js";
import { PlanService } from "./service.js";
import type { PlanTaskInput } from "$lib/server/agent/durable/types.js";

const DEFAULT_OWNER_ID = "owner";

/** The two-layer task envelope for an `exitPlan` proposal, which arrives as flat steps. */
export function planTasksFromConversationPlan(plan: ConversationPlan): PlanTaskInput[] {
  const steps = plan.steps.map((step) => ({ title: step.text.trim() })).filter((step) => step.title.length > 0);
  if (steps.length === 0) return [];
  return [{ title: plan.title.trim() || "Plan", steps }];
}

/**
 * Persists a freshly proposed Session plan as a Durable Execution so it is
 * findable before approval. Idempotent by `plan.id`; a persistence failure is
 * logged and leaves the chat turn intact rather than dropping the answer.
 */
export function ensureSessionPlanRecord(input: {
  plan?: ConversationPlan;
  ownerId?: string;
  botId: string;
  sourceChannel?: string;
  sourceChatId?: string;
  sourceUiSessionId?: string;
  sourceProjectId?: string;
}, service = new PlanService()): ConversationPlan | undefined {
  const plan = input.plan;
  if (!plan || plan.status !== "proposed" || plan.durableExecutionId) return plan;
  const tasks = planTasksFromConversationPlan(plan);
  if (tasks.length === 0) return plan;
  try {
    const detail = service.create({
      planId: plan.id,
      ownerId: input.ownerId ?? DEFAULT_OWNER_ID,
      botId: input.botId,
      title: plan.title,
      summary: plan.summary,
      tasks,
      sourceChannel: input.sourceChannel ?? "web",
      sourceChatId: input.sourceChatId,
      sourceUiSessionId: input.sourceUiSessionId,
      sourceProjectId: input.sourceProjectId
    });
    return { ...plan, durableExecutionId: detail.execution.id };
  } catch (error) {
    console.error(`[plans] failed to save Session plan ${plan.id}`, error);
    return plan;
  }
}

/**
 * First approval binds the accepted content version. Edits made before approval
 * are applied as a new version first, so the executed content is exactly what
 * the owner approved. Execution itself runs as an ordinary Session turn — this
 * never starts the Durable runtime.
 */
export function applyApprovedPlanContent(input: {
  plan: ConversationPlan;
  ownerId?: string;
}, service = new PlanService()): ConversationPlan {
  const plan = input.plan;
  if (!plan.durableExecutionId) return plan;
  const ownerId = input.ownerId ?? DEFAULT_OWNER_ID;
  const detail = service.read(ownerId, plan.durableExecutionId);
  const desiredSteps = plan.steps.map((step) => step.text.trim()).filter(Boolean);
  const currentTitles = detail.tasks.flatMap((task) => task.steps.map((step) => step.title));
  const contentChanged = plan.title.trim() !== detail.meta.title
    || plan.summary.trim() !== detail.meta.summary
    || desiredSteps.join("\n") !== currentTitles.join("\n");
  if (contentChanged && desiredSteps.length > 0) {
    service.replaceContent({
      executionId: plan.durableExecutionId,
      ownerId,
      expectedVersion: detail.execution.version,
      reason: "accepted plan content",
      author: "user",
      title: plan.title,
      summary: plan.summary,
      tasks: [{ title: plan.title.trim() || "Plan", steps: desiredSteps.map((title) => ({ title })) }]
    });
  }
  return plan;
}
