import { getDurableExecutionStore } from "$lib/server/agent/durable/store.js";
import { steerKanbanRound } from "$lib/server/agent/durable/kanbanSteer.js";
import { PlanService } from "$lib/server/agent/plans/service.js";
import type { DurableExecutionStatus } from "$lib/server/agent/durable/types.js";

/**
 * How a user send into a kanban task conversation should be routed
 * (spec 执行形态修订: 任务会话与普通对话一致，插话即纠正；子会话只读).
 * Terminal tasks fall back to a normal conversation turn (主会话保留可回溯).
 */
const KANBAN_STEERABLE_STATUSES: ReadonlySet<DurableExecutionStatus> = new Set([
  "planned", "queued", "running", "verifying", "waiting_for_user", "waiting_for_approval", "paused", "recovery_required"
]);

export type KanbanConversationSendAction =
  | { kind: "read_only" }
  | { kind: "steer"; executionId: string }
  | { kind: "normal" };

export function kanbanConversationSendAction(conversation: { id: string; origin?: string | null; parentSessionId?: string | null }): KanbanConversationSendAction {
  if (conversation.origin !== "kanban") return { kind: "normal" };
  if (conversation.parentSessionId) return { kind: "read_only" };
  const store = getDurableExecutionStore();
  const executionId = store.kanban.getExecutionIdByUiSession(conversation.id);
  if (!executionId) return { kind: "normal" };
  const execution = store.getById(executionId);
  if (!execution || !KANBAN_STEERABLE_STATUSES.has(execution.status)) return { kind: "normal" };
  return { kind: "steer", executionId };
}

/** Live steering first; with no running round the text queues as a pending input. */
export function sendToKanbanTask(executionId: string, text: string): { delivered: boolean } {
  if (steerKanbanRound(executionId, text)) return { delivered: true };
  new PlanService().answerKanbanTask({ ownerId: "owner", executionId, text });
  return { delivered: false };
}
