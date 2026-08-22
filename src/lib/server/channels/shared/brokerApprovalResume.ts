import type { MomRuntimeStore } from "$lib/server/agent/session/store.js";
import type { ChannelRunnerPoolLike } from "$lib/server/agent/core/runnerPool.js";
import { getTurnOrchestrator } from "$lib/server/agent/core/turnOrchestrator.js";
import { SessionStore } from "$lib/server/sessions/store.js";
import {
  retryApprovalAutoResume,
  APPROVAL_AUTO_RESUME_RETRY_DELAY_MS,
  APPROVAL_AUTO_RESUME_RETRY_MAX_ATTEMPTS
} from "$lib/server/channels/shared/approvalAutoResume.js";

/**
 * Replaces the suspended "waiting for user approval" toolResult in the session's
 * persisted message transcript with an explicit outcome instruction for the
 * model.
 *
 * Symmetrical to `rewriteApprovalToolResultInContext` for Host Bash:
 * - On approval, tells the model the user granted permission and to re-issue
 *   the original tool call now. The second call will hit the newly recorded
 *   grant in `ApprovalBroker.checkGrant` and execute directly without asking.
 * - On rejection, tells the model the user declined and not to retry.
 *
 * Matches by `details.approvalRequestId` first (unambiguous), falling back to
 * matching a `waiting_for_approval` toolResult when only one is pending.
 */
export function rewriteBrokerApprovalToolResultInContext(
  messages: any[],
  requestId: string,
  status: "approved" | "rejected",
  toolName = "tool"
): boolean {
  if (!Array.isArray(messages)) return false;

  const renderedOutput = status === "approved"
    ? `[Runtime Notice] The user approved the execution of ${toolName} (request ${requestId}). Please re-issue your intended tool call now; it will proceed without requiring further approval.`
    : `[Runtime Notice] The user rejected the execution of ${toolName} (request ${requestId}). Do not retry this tool call; inform the user and proceed with alternative approaches if available.`;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg && msg.role === "toolResult") {
      const detailsReqId = msg.details?.approvalRequestId ?? msg.metadata?.approvalRequestId;
      const textContent = Array.isArray(msg.content)
        ? msg.content.map((c: any) => c?.text ?? "").join(" ")
        : String(msg.content ?? "");
      const isWaitingForApproval = textContent.includes("waiting for user approval")
        || textContent.includes("Waiting for user approval")
        || msg.metadata?.status === "waiting_for_approval";

      if (detailsReqId === requestId || (!detailsReqId && isWaitingForApproval)) {
        msg.content = [{ type: "text", text: renderedOutput }];
        msg.isError = status === "rejected";
        return true;
      }
    }
  }
  return false;
}

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
}

/**
 * Resumes an agent turn that suspended cleanly on `waiting_for_approval` after
 * the user resolved the corresponding ApprovalBroker request out-of-band.
 *
 * Behavior:
 * 1. Checks `TurnOrchestrator` to see if this session actually has a
 *    `waiting_for_approval` run row (if the run is still actively waiting
 *    inline within the 30s handshake window, the inline poll will claim it
 *    and this returns early).
 * 2. Rewrites the suspended `toolResult` in the persisted transcript.
 * 3. Resets the runner pool entry for this session so the next run picks up the
 *    rewritten history.
 * 4. Runs an empty-message continuation turn through `retryApprovalAutoResume`.
 *    The `TurnOrchestrator.prepareTurn` query (line 197) reclaims the
 *    suspended run row under the same `runId`, so the new turn is a true
 *    continuation rather than an orphaned duplicate.
 */
export async function resumeSuspendedBrokerApproval(
  input: ResumeSuspendedBrokerApprovalInput
): Promise<boolean> {
  const { scopeId, sessionId, requestId, status, toolName, store, pool, channel = "web" } = input;
  const sessions = input.sessionStore ?? new SessionStore();

  const orchestrator = getTurnOrchestrator();
  const db = orchestrator.getDb();
  const waitingRun = db
    .prepare("SELECT id, started_at FROM runs WHERE session_id = ? AND status = 'waiting_for_approval' ORDER BY started_at DESC LIMIT 1")
    .get(sessionId) as { id: string; started_at: string } | undefined;

  if (!waitingRun) {
    // No suspended run in this session: either the run was already active inline
    // (the inline waiter will pick up the grant) or it was already settled.
    return false;
  }

  const messages = store.loadContext(scopeId, sessionId);
  const rewritten = rewriteBrokerApprovalToolResultInContext(messages, requestId, status, toolName);
  if (!rewritten) {
    return false;
  }

  store.saveContext(scopeId, messages, sessionId);
  pool.reset(scopeId, sessionId);

  const messageId = Date.now();
  const ts = `${Date.now() / 1000}`;

  void retryApprovalAutoResume({
    run: async () => {
      await pool.get(scopeId, sessionId).run({
        channel,
        workspaceDir: store.getWorkspaceDir(),
        chatDir: store.getChatDir(scopeId),
        message: {
          chatId: scopeId,
          workspaceId: "personal",
          chatType: "private",
          messageId,
          userId: scopeId,
          userName: scopeId,
          text: "",
          ts,
          attachments: [],
          imageContents: [],
          sessionId,
          runId: waitingRun.id,
          isEvent: true
        },
        respond: async (text: string) => {
          if (text.trim()) {
            sessions.appendMessage(sessionId, "assistant", text);
          }
        },
        replaceMessage: async (text: string) => {
          if (text.trim()) {
            sessions.appendMessage(sessionId, "assistant", text);
          }
        },
        respondInThread: async (text: string) => {
          if (text.trim()) {
            sessions.appendMessage(sessionId, "assistant", text);
          }
        },
        setTyping: async () => {},
        setWorking: async () => {},
        deleteMessage: async () => {},
        uploadFile: async () => {}
      });
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
