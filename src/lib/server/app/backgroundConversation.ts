import type { MomContext, RunnerLike } from "$lib/server/agent/core/types.js";
import type { SessionStore } from "$lib/server/sessions/store.js";
import { ConversationActivityCollector } from "$lib/server/app/conversationActivity.js";

/** Background turns persist one context-backed answer; progress stays in activities. */
export async function runBackgroundConversation(
  runner: Pick<RunnerLike, "run">,
  context: Pick<MomContext, "channel" | "message" | "workspaceDir" | "chatDir" | "project" | "modelKeyOverride">,
  sessions: Pick<SessionStore, "appendMessage">
) {
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
  if (result.stopReason !== "waiting_for_approval") {
    sessions.appendMessage(context.message.sessionId!, "assistant", answer.trim() || result.errorMessage || "", {
      durationMs: Date.now() - startedAt,
      contextBacked: true,
      sourceEntryId: result.assistantSourceEntryId,
      activities: activities.finalSnapshot(),
      model
    });
  }
  return result;
}
