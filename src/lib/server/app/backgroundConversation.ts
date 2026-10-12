import type { MomContext, RunResult, RunnerLike } from "$lib/server/agent/core/types.js";
import type { SessionStore } from "$lib/server/sessions/store.js";
import { ConversationActivityCollector } from "$lib/server/app/conversationActivity.js";

/** Background turns persist one context-backed answer; progress stays in activities. */
export async function runBackgroundConversation(
  runner: Pick<RunnerLike, "run">,
  context: Pick<MomContext, "channel" | "message" | "workspaceDir" | "chatDir" | "project" | "modelKeyOverride" | "deliveryTarget">,
  sessions: Pick<SessionStore, "appendMessage"> & Partial<Pick<SessionStore, "listMessageMetadata">>
): Promise<RunResult & { answer: string; recorded: boolean }> {
  const activities = new ConversationActivityCollector();
  let answer = "";
  let model: string | undefined;
  const startedAt = Date.now();
  const result = await runner.run({
    ...context,
    respond: async (text, shouldLog = true) => { if (shouldLog) answer += text; },
    replaceMessage: async (text) => { answer = text; },
    respondInThread: async () => {},
    beginContinuationResponse: async () => { answer = ""; },
    onRunnerEvent: async (event) => {
      activities.record(event);
      if (event.type === "thinking_config" || event.type === "payload") {
        model = [event.provider, event.model].filter(Boolean).join("/");
      }
    },
    setTyping: async () => {},
    setWorking: async () => {},
    deleteMessage: async () => {},
    uploadFile: async () => {}
  });
  if (result.stopReason === "waiting_for_approval") return { ...result, answer: "", recorded: false };
  const content = answer.trim() || result.errorMessage || "";
  const sessionId = context.message.sessionId!;
  // Recovery re-projects committed native entries. A source identity already
  // persisted means this answer was recorded before the interruption; recording
  // it again would show the same result twice.
  const duplicate = Boolean(result.assistantSourceEntryId)
    && (sessions.listMessageMetadata?.(sessionId) ?? []).some((message) => message.sourceEntryId === result.assistantSourceEntryId);
  if (duplicate) return { ...result, answer: content, recorded: false };
  sessions.appendMessage(sessionId, "assistant", content, {
    durationMs: Date.now() - startedAt,
    contextBacked: true,
    sourceEntryId: result.assistantSourceEntryId,
    activities: activities.finalSnapshot(),
    model
  });
  return { ...result, answer: content, recorded: true };
}
