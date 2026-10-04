import { runBackgroundConversation } from "$lib/server/app/backgroundConversation.js";
import type { MomRuntimeStore } from "$lib/server/agent/session/store.js";
import type { ChannelRunnerPoolLike } from "$lib/server/agent/core/runnerPool.js";
import type { ChannelInboundMessage } from "$lib/server/agent/core/types.js";
import { getTurnOrchestrator } from "$lib/server/agent/core/turnOrchestrator.js";
import { SessionStore } from "$lib/server/sessions/store.js";
import { buildRunnerProjectContext, getConversationProject } from "$lib/server/projects/context.js";
import {
  retryApprovalAutoResume,
  APPROVAL_AUTO_RESUME_RETRY_DELAY_MS,
  APPROVAL_AUTO_RESUME_RETRY_MAX_ATTEMPTS
} from "$lib/server/channels/shared/approvalAutoResume.js";

export interface ResumeSuspendedBrokerApprovalInput {
  scopeId: string;
  sessionId: string;
  requestId: string;
  status: "approved" | "rejected";
  toolName?: string;
  store: MomRuntimeStore;
  pool: ChannelRunnerPoolLike;
  channel?: string;
  sessionStore?: SessionStore;
  onWarn?: (code: string, meta: Record<string, unknown>) => void;
  runContinuation?: (message: ChannelInboundMessage) => Promise<void>;
}

/** Wake the original native owner after a scoped decision; committed tool results remain unchanged. */
export async function resumeSuspendedBrokerApproval(
  input: ResumeSuspendedBrokerApprovalInput
): Promise<boolean> {
  const { scopeId, sessionId, requestId, store, pool, channel = "web" } = input;
  const sessions = input.sessionStore ?? new SessionStore();

  const orchestrator = getTurnOrchestrator();
  const waitingRun = orchestrator.getWaitingApprovalRun(sessionId);

  if (!waitingRun) {
    // No suspended run in this session: either the run was already active inline
    // (the inline waiter will pick up the grant) or it was already settled.
    return false;
  }

  const suspension = store.readLatestRuntimeEvent(scopeId, "PI_APPROVAL_SUSPENDED", sessionId)?.details;
  if (!suspension || suspension.requestId !== requestId || suspension.runId !== waitingRun.id
      || typeof suspension.userId !== "string") return false;

  const messageId = Date.now();
  const ts = `${Date.now() / 1000}`;

  void retryApprovalAutoResume({
    run: async () => {
      if (orchestrator.getWaitingApprovalRun(sessionId)?.id !== waitingRun.id) return;
      const message: ChannelInboundMessage = {
        chatId: scopeId, workspaceId: "personal", chatType: "private", messageId,
        userId: suspension.userId as string, userName: suspension.userId as string,
        text: "", ts, attachments: [], imageContents: [], sessionId, runId: waitingRun.id,
        ...(typeof suspension.budgetId === "string" ? { budgetId: suspension.budgetId } : {}), isEvent: true
      };
      if (input.runContinuation) { await input.runContinuation(message); return; }
      const project = getConversationProject(sessions, sessionId);
      const scratchDir = store.getScratchDir(scopeId);
      await runBackgroundConversation(pool.get(scopeId, sessionId), {
        channel,
        workspaceDir: store.getWorkspaceDir(),
        chatDir: store.getChatDir(scopeId),
        project: buildRunnerProjectContext(project, scratchDir),
        modelKeyOverride: project?.modelKey,
        message,
      }, sessions);
    },
    maxAttempts: APPROVAL_AUTO_RESUME_RETRY_MAX_ATTEMPTS,
    delayMs: APPROVAL_AUTO_RESUME_RETRY_DELAY_MS,
    onWarn: (warningCode, meta) => {
      if (warningCode === "approval_auto_resume_retrying" && meta.attempt !== 1 && meta.attempt % 60 !== 0) {
        return;
      }
      input.onWarn?.(warningCode, { scopeId, sessionId, requestId, ...meta });
    },
    onRetryExhausted: () => {
      sessions.appendMessage(
        sessionId,
        "assistant",
        "Approval resolved, but the session is busy. Send any message to continue the task."
      );
    }
  });

  return true;
}
