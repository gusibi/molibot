import { createHash } from "node:crypto";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ConversationActivity, ConversationMessage } from "$lib/shared/types/message.js";
import type { SessionStore, UiMessageMetadata } from "$lib/server/sessions/store.js";
import { MomRuntimeStore } from "$lib/server/agent/session/store.js";
import { createPersistedUserMessage, zeroAssistantUsage } from "$lib/server/agent/core/runnerHelpers.js";
import { classifyTurnRetention } from "$lib/server/sessions/retentionPolicy.js";
import { agentWorkspaceDir } from "$lib/server/sessions/agentStorage.js";
import { projectRuntimeWorkspaceDir } from "$lib/server/projects/runtimeCache.js";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import type { DurableExecution, PlanBinding } from "./types.js";
import { publishLiveConversation, type LiveConversationMessage } from "./liveResponse.js";
import { projectConversationMessages } from "$lib/server/app/conversationProjection.js";
import { momWarn } from "$lib/server/agent/common/log.js";

interface LiveResponse {
  sessions: SessionStore;
  row: UiMessageMetadata;
  snapshot: { runId: string; text: string; thinking: string };
  publishTimer?: ReturnType<typeof setTimeout>;
  persistTimer?: ReturnType<typeof setTimeout>;
}
const liveResponses = new Map<string, LiveResponse>();
function liveKey(executionId: string): string { return JSON.stringify([storagePaths.dataDir, executionId]); }

export function liveResponseMessage(row: UiMessageMetadata, snapshot = row.liveResponse): LiveConversationMessage {
  const content = snapshot?.text ?? row.content ?? "";
  const thinking = snapshot?.thinking ?? row.thinking;
  return { ...row, content, thinking, stopReason: "running", resultKind: content ? "partial" : "none", steps: [
    ...(thinking ? [{ id: `${row.id}-thinking`, kind: "thinking" as const, content: thinking }] : []),
    ...(row.activities ?? []).map(activity => ({ id: `${row.id}-${activity.key}`, kind: "activity" as const, activity })),
    ...(content ? [{ id: `${row.id}-text`, kind: "result" as const, content }] : [])
  ] };
}

export function currentLiveConversationMessages(sessionId?: string): LiveConversationMessage[] {
  return [...liveResponses.values()]
    .filter(state => !sessionId || state.row.conversationId === sessionId)
    .map(state => liveResponseMessage(state.row, state.snapshot));
}

export function overlayLiveConversationMessages<T extends LiveConversationMessage>(messages: T[]): T[] {
  const liveById = new Map(currentLiveConversationMessages().map(message => [message.id, message]));
  return messages.map(message => {
    if (message.stopReason !== "running") return message;
    const live = liveById.get(message.id);
    if (!live) return message;
    return { ...message, ...live };
  });
}

function flushLiveResponse(state: LiveResponse): void {
  clearTimeout(state.persistTimer);
  state.persistTimer = undefined;
  try { state.sessions.updateConversationMessage(state.row.conversationId, state.row.id, { liveResponse: state.snapshot, stopReason: "running" }); }
  catch (error) { momWarn("durableExecution", "live_response_checkpoint_failed", { error: String(error) }); }
}

/** Streams actual model deltas; disk checkpoints are bounded independently of display updates. */
export function updateDurableConversationOutput(sessions: SessionStore, execution: DurableExecution, runId: string, field: "text" | "thinking", delta: string): void {
  if (!execution.sourceUiSessionId || !delta) return;
  const key = liveKey(execution.id);
  let state = liveResponses.get(key);
  if (!state || state.snapshot.runId !== runId) {
    if (state) endDurableConversationOutput(execution.id, state.snapshot.runId);
    const row = sessions.listMessageMetadata(execution.sourceUiSessionId).find(message => message.activities?.some(activity => activity.key === `durable-response:${execution.id}`));
    if (!row) return;
    const saved = row.liveResponse;
    state = { sessions, row, snapshot: saved?.runId === runId ? { ...saved } : { runId, text: saved?.text ?? "", thinking: saved?.thinking ?? row.thinking ?? "" } };
    liveResponses.set(key, state);
  }
  state.snapshot[field] += delta;
  if (!state.publishTimer) state.publishTimer = setTimeout(() => {
    state!.publishTimer = undefined;
    publishLiveConversation(liveResponseMessage(state!.row, state!.snapshot));
  }, 16);
  if (!state.persistTimer) state.persistTimer = setTimeout(() => flushLiveResponse(state!), 200);
}

export function endDurableConversationOutput(executionId: string, runId: string): void {
  const key = liveKey(executionId);
  const state = liveResponses.get(key);
  if (!state || state.snapshot.runId !== runId) return;
  clearTimeout(state.publishTimer);
  flushLiveResponse(state);
  publishLiveConversation(liveResponseMessage(state.row, state.snapshot));
  liveResponses.delete(key);
}

export interface DurableAttemptDelivery {
  execution: DurableExecution;
  binding?: PlanBinding;
  sessionId: string;
  runId: string;
  text: string;
}

/** Background execution uses the same response row and process disclosure as a foreground turn. */
export function ensureDurableConversationResponse(sessions: SessionStore, execution: DurableExecution, chinese = false): string | undefined {
  const sessionId = execution.sourceUiSessionId;
  if (!sessionId) return;
  const key = `durable-response:${execution.id}`;
  const existing = sessions.listMessageMetadata(sessionId).find(message => message.activities?.some(activity => activity.key === key));
  if (existing) return existing.id;
  const message = sessions.appendMessage(sessionId, "assistant", "", {
    retention: classifyTurnRetention(execution.goal),
    activities: [{ key, kind: "note", label: chinese ? "处理中" : "Processing", state: "running", startedAt: execution.createdAt }]
  });
  sessions.updateConversationMessage(sessionId, message.id, { stopReason: "running", resultKind: "none" });
  return message.id;
}

export function updateDurableConversationProgress(sessions: SessionStore, execution: DurableExecution, activities: ConversationActivity[]): void {
  if (!execution.sourceUiSessionId) return;
  const response = sessions.listMessageMetadata(execution.sourceUiSessionId).find(message => message.activities?.some(activity => activity.key === `durable-response:${execution.id}`));
  if (!response) return;
  const merged = new Map(response.activities?.map(activity => [activity.key, activity]));
  for (const activity of activities) merged.set(activity.key, activity);
  sessions.updateConversationMessage(execution.sourceUiSessionId, response.id, { activities: [...merged.values()] });
  const state = liveResponses.get(liveKey(execution.id));
  if (state) { state.row = { ...state.row, activities: [...merged.values()] }; publishLiveConversation(liveResponseMessage(state.row, state.snapshot)); }
}

/** Transfer ownership of the input only after its Agent entry is committed. */
export function persistDurableConversationInput(store: MomRuntimeStore, sessions: SessionStore, chatId: string, message: ConversationMessage): void {
  const sourceEntryId = store.appendContextMessage(chatId, createPersistedUserMessage(message.content, message.createdAt), message.conversationId, {
    retention: message.retention, sourceId: `durable-input:${message.id}`
  });
  sessions.recordMessageSourceEntries(message.conversationId, [{ id: message.id, sourceEntryId }]);
  sessions.markMessagesContextBacked(message.conversationId, [message.id]);
}

/** A committed result can be delivered again after a crash without duplicating the answer. */
export function deliverDurableAttempt(
  sessions: SessionStore,
  input: DurableAttemptDelivery
): void {
  const id = input.sessionId;
  const project = sessions.getConversationProjectId(id);
  const owner = sessions.getWebConversationOwner(id);
  const target = project ? sessions.getProjectConversation(project, id) : owner ? sessions.getConversationById(id, "web", owner) : null;
  if (!target) return;
  const sourceId = `durable-plan:${input.execution.id}:${input.runId}`;
  const sourceEntryId = `source-${createHash("sha256").update(sourceId).digest("hex")}`;
  if (sessions.listMessageMetadata(id).some(message => message.sourceEntryId === sourceEntryId || message.sourceEntryId === sourceId)) return;
  if (!project && !target.agentId) throw new Error("The receiving conversation has no Agent identity.");
  const workspace = project ? projectRuntimeWorkspaceDir(project) : agentWorkspaceDir(storagePaths.dataDir, target.agentId!);
  const store = new MomRuntimeStore(workspace);
  const chatId = target.externalUserId;
  const retention = classifyTurnRetention(input.execution.goal);
  const existing = store.listSessionMessageEntries(chatId, id).find(entry => entry.id === sourceEntryId);
  if (!existing) store.appendContextMessage(chatId, {
    role: "assistant", content: [{ type: "text", text: input.text }],
    usage: zeroAssistantUsage(), timestamp: Date.now()
  } as AgentMessage, id, { runId: input.runId, sourceId, delivery: "final", retention });
  const response = sessions.listMessageMetadata(id).find(message => message.activities?.some(activity => activity.key === `durable-response:${input.execution.id}`));
  if (response) {
    const live = liveResponses.get(liveKey(input.execution.id));
    const snapshot = live?.snapshot ?? response.liveResponse;
    const previousText = snapshot?.text ?? response.liveResponse?.text ?? "";
    const deliveredThinking = snapshot?.thinking ?? response.liveResponse?.thinking ?? response.thinking ?? "";
    const deliveredText = previousText && input.text !== previousText && !input.text.startsWith(previousText)
      ? `${previousText}\n\n${input.text}`
      : input.text;
    sessions.updateConversationMessage(id, response.id, {
      sourceEntryId, contextBacked: true, stopReason: "stop", resultKind: "final",
      liveResponse: { runId: `delivered:${input.runId}`, text: deliveredText, thinking: deliveredThinking },
      thinking: deliveredThinking,
      activities: response.activities?.map(activity => activity.key === `durable-response:${input.execution.id}`
        ? { ...activity, state: "success", finishedAt: new Date().toISOString() } : activity)
    });
    if (live) {
      clearTimeout(live.publishTimer);
      clearTimeout(live.persistTimer);
      liveResponses.delete(liveKey(input.execution.id));
    }
    const projected = projectConversationMessages({ conversationId: id, entries: store.listSessionMessageEntries(chatId, id), metadata: sessions.listMessageMetadata(id) });
    const message = projected.messages.find(message => message.id === response.id);
    if (message) publishLiveConversation(message);
  } else sessions.appendMessage(id, "assistant", input.text, { sourceEntryId, contextBacked: true, retention });
}
