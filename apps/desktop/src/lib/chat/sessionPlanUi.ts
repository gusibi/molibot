import { writable } from "svelte/store";
import type { DesktopConversationPlan, DesktopDurableExecutionStatus } from "@molibot/desktop-contract";

export const sessionPlanProgress = writable<Record<string, DesktopConversationPlan>>({});
export const sessionPlanInspector = writable<{
  plan: DesktopConversationPlan;
  complete: () => void;
} | null>(null);

export function publishSessionPlan(plan: DesktopConversationPlan): void {
  sessionPlanProgress.update((plans) => ({ ...plans, [plan.id]: plan }));
}

const finishedExecutionStatuses = new Set(["partial", "completed", "failed", "cancelled"]);

/** Work that still needs execution, recovery, approval, or final review. */
export function isOpenDurableExecution(item: {
  execution: { status: DesktopDurableExecutionStatus };
}): boolean {
  return !finishedExecutionStatuses.has(item.execution.status);
}

/** Items that still represent work, approval, or recovery—not finished review. */
export function isActiveDurableExecution(item: {
  execution: { status: DesktopDurableExecutionStatus };
  projection: { waiting?: { kind?: string } };
}): boolean {
  return isOpenDurableExecution(item)
    && item.projection.waiting?.kind !== "review";
}
