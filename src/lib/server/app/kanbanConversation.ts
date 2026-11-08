import { getDurableExecutionStore } from "$lib/server/agent/durable/store.js";
import { steerKanbanRound } from "$lib/server/agent/durable/kanbanSteer.js";
import { persistDurableConversationInput } from "$lib/server/agent/durable/conversation.js";
import { PlanService } from "$lib/server/agent/plans/service.js";
import { MomRuntimeStore } from "$lib/server/agent/session/store.js";
import { agentWorkspaceDir } from "$lib/server/sessions/agentStorage.js";
import { projectRuntimeWorkspaceDir } from "$lib/server/projects/runtimeCache.js";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import type { SessionStore } from "$lib/server/sessions/store.js";
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

/**
 * Appends a user message to the task's visible conversation and context-backs
 * it, so the session reads as one continuous dialogue with each round's
 * assistant reply paired to its preceding user turn.
 */
export function appendTaskConversationMessage(
  sessions: SessionStore,
  conversation: { id: string; externalUserId: string; agentId?: string | null },
  projectId: string,
  text: string
): void {
  const message = sessions.appendMessage(conversation.id, "user", text);
  try {
    persistDurableConversationInput(
      new MomRuntimeStore(projectId ? projectRuntimeWorkspaceDir(projectId) : agentWorkspaceDir(storagePaths.dataDir, conversation.agentId ?? "")),
      sessions,
      conversation.externalUserId,
      message
    );
  } catch { /* the visible message is already recorded; context backing is best-effort */ }
}

/** Resolves a Kanban task's visible UI session (if any) and appends + context-backs a user input. */
export function appendKanbanTaskInput(sessions: SessionStore, executionId: string, text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  const execution = getDurableExecutionStore().getById(executionId);
  const sessionId = execution?.sourceUiSessionId?.trim();
  if (!sessionId) return;
  const projectId = sessions.getConversationProjectId(sessionId) ?? "";
  const owner = projectId ? "" : sessions.getWebConversationOwner(sessionId) ?? "";
  const conversation = projectId
    ? sessions.getProjectConversation(projectId, sessionId)
    : owner
      ? sessions.getConversationById(sessionId, "web", owner)
      : null;
  if (conversation) {
    appendTaskConversationMessage(sessions, conversation, projectId, trimmed);
  }
}

/** Live steering first; with no running round the text queues as a pending input. */
export function sendToKanbanTask(executionId: string, text: string): { delivered: boolean } {
  if (steerKanbanRound(executionId, text)) return { delivered: true };
  new PlanService().answerKanbanTask({ ownerId: "owner", executionId, text });
  return { delivered: false };
}
