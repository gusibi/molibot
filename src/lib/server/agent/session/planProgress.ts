import type { ConversationPlan } from "$lib/shared/types/message.js";
import type { PlanProgressUpdate } from "../tools/updatePlan.js";

export function applyPlanProgress(plan: ConversationPlan, update: PlanProgressUpdate): ConversationPlan {
  const ids = new Set(plan.steps.map((step) => step.id));
  if (update.steps.some((step) => !ids.has(step.id))) throw new Error("Unknown plan step.");
  if (new Set(update.steps.map((step) => step.id)).size !== update.steps.length) throw new Error("Duplicate plan step.");
  const steps = plan.steps.map((step) => ({ ...step, status: update.steps.find((item) => item.id === step.id)?.status ?? step.status }));
  if (steps.filter((step) => step.status === "in_progress").length > 1) throw new Error("Only one current plan step is supported.");
  if (["completed", "waiting_review"].includes(update.status) && steps.some((step) => step.status !== "completed")) {
    throw new Error("Finish all plan steps before reporting completion or review.");
  }
  return { ...plan, steps, status: update.status, progressSummary: update.summary, updatedAt: new Date().toISOString() };
}

export function finishPlanTurn(plan: ConversationPlan, stopReason: string): ConversationPlan {
  if (["completed", "waiting_review", "blocked", "waiting_for_user"].includes(plan.status)) return plan;
  return { ...plan, updatedAt: new Date().toISOString(), status: stopReason === "waiting_for_approval" ? "waiting_for_approval" : "paused" };
}
