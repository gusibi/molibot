import { DurableExecutionCoordinator } from "$lib/server/agent/durable/coordinator.js";
import { describeExecutionHistory } from "$lib/server/agent/session/executionHistory.js";
import { applyPlanProgress, finishPlanTurn } from "$lib/server/agent/session/planProgress.js";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { ConversationActivityCollector } from "$lib/server/app/conversationActivity";
import { buildSubagentDiagnostic } from "$lib/server/agent/subagentProgress";
import type { ChannelInboundMessage, FileAttachment, RunnerUiEvent } from "$lib/server/agent/core/types";
import { sanitizeOptionalRuntimeThinkingLevel } from "$lib/server/settings";
import {
  sanitizeWebProfileId,
  sanitizeWebUserId,
  resolveWebDurableBotId
} from "$lib/server/web/identity";
import { resolveRuntimeContext, resolveRunnerChatId, resolveWebConversationIdentity } from "$lib/server/web/runtimeContext";
import { resolveWorkspaceId } from "$lib/server/workspaces/store";
import { resolveWebInboundFileMeta, saveWebResponseAttachment } from "$lib/server/web/attachments";
import type { ConversationAttachment, ConversationPlan } from "$lib/shared/types/message";
import { classifyTurnRetention } from "$lib/server/sessions/retentionPolicy";
import { buildRunnerProjectContext, resolveProjectContext } from "$lib/server/projects/context";
import { parseStreamRequest, type ParsedStreamRequest } from "./request";
import { isChineseLocale } from "$lib/server/agent/commands/i18n.js";
import {
  activateDurableExecution,
  formatDurableActivationAcknowledgement
} from "$lib/server/agent/durable/activation.js";
import { DurableExecutionQuotaError } from "$lib/server/agent/durable/types.js";
import { tryAutoSummarizeConversationTitleAsync, hasDefaultConversationTitle } from "$lib/server/sessions/titleSummarizer.js";

function writeEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  event: string,
  data: unknown
): boolean {
  // The client may have gone away mid-run (stop button, window close, network
  // drop). enqueue() then throws — swallowing it keeps the run loop alive so
  // the final transcript persistence below still happens; losing the live
  // event is harmless because the client reloads the transcript anyway.
  try {
    controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    return true;
  } catch {
    // stream already closed/cancelled
    return false;
  }
}

/**
 * SSE heartbeat while a run is in flight. A long tool (the default execution
 * ceiling is now an hour) can legitimately produce minutes of silence, and a
 * half-open connection produces silence forever: without a heartbeat the
 * client cannot tell "busy" from "dead" and its idle watchdog would either
 * false-positive on real work or never fire on a hung stream. 20s keeps the
 * connection warm through proxies and stays far under the client's watchdog.
 */
const STREAM_HEARTBEAT_INTERVAL_MS = 20_000;

function startStreamHeartbeat(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder
): () => void {
  const timer = setInterval(() => {
    if (!writeEvent(controller, encoder, "ping", { t: Date.now() })) clearInterval(timer);
  }, STREAM_HEARTBEAT_INTERVAL_MS);
  return () => clearInterval(timer);
}

/**
 * Before the terminal `done`/`error` frame, re-emit every activity the run is
 * leaving in a non-terminal state as an explicit error card. Persistence has
 * always closed these (`finalSnapshot`); the live stream never did, so a tool
 * or delegation aborted without its own `tool_execution_end` kept a spinner
 * running on the client forever - "output complete, still thinking" (issue
 * class: interrupted-turn activity cards never converge).
 */
function streamClosedActivities(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  collector: ConversationActivityCollector
): void {
  for (const activity of collector.closeRunningActivities()) {
    writeEvent(controller, encoder, "runner_event", {
      diagnostic: "",
      activity
    });
  }
}

function buildRunnerDiagnostic(event: RunnerUiEvent): string | null {
  if (event.type === "thinking_config") {
    return [
      `thinking_requested=${event.requestedThinkingLevel}`,
      `thinking_effective=${event.effectiveThinkingLevel}`,
      `reasoning_supported=${String(event.reasoningSupported)}`,
      `provider=${event.provider}`,
      `model=${event.model}`
    ].join(", ");
  }
  if (event.type === "payload") {
    return [
      `payload_provider=${event.provider}`,
      `payload_model=${event.model}`,
      `payload_api=${event.api}`,
      event.summary
    ].join(", ");
  }
  if (event.type === "tool_execution_start") {
    return `tool_start=${event.displayName ?? event.toolName}, label=${event.label}`;
  }
  if (event.type === "tool_execution_end") {
    const summary = event.summary.replace(/\s+/g, " ").trim();
    const preview = summary.length > 160 ? `${summary.slice(0, 159)}…` : summary;
    return [
      `tool_end=${event.displayName ?? event.toolName}`,
      `status=${event.isError ? "error" : "ok"}`,
      preview ? `summary=${preview}` : ""
    ].filter(Boolean).join(", ");
  }
  if (event.type === "durable_preflight") {
    return `durable_preflight=tier:${event.sideEffectClass}, mode=${event.mode}, index=${event.preflightIndex}, reason=${event.reason}`;
  }
  if (event.type === "subagent_execution") {
    return buildSubagentDiagnostic(event);
  }
  return null;
}

export const POST: RequestHandler = async ({ request }) => {
  let body: ParsedStreamRequest;
  try {
    body = await parseStreamRequest(request);
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "Invalid request body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  const userId = sanitizeWebUserId(body.userId);
  const profileId = sanitizeWebProfileId(body.profileId);
  const message = String(body.message ?? "").trim();
  const resumePlanId = String(body.resumePlanId ?? "").trim();
  const conversationId = String(body.conversationId ?? "").trim() || undefined;
  const thinkingLevel = sanitizeOptionalRuntimeThinkingLevel(body.thinkingLevel);
  const projectResult = resolveProjectContext(body.projectId);
  if (!projectResult.ok) {
    return new Response(JSON.stringify({ ok: false, error: projectResult.error }), {
      status: projectResult.status,
      headers: { "Content-Type": "application/json" }
    });
  }
  const project = projectResult.project;

  if (!message && body.files.length === 0 && !resumePlanId) {
    return new Response(JSON.stringify({ ok: false, error: "Empty message." }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  const runtime = getRuntime();
  const workspaceId = resolveWorkspaceId();
  // Act under the conversation's own identity (same rule as /api/chat): the
  // caller's derived identity would miss conversations created by another Web
  // surface and silently continue or create a different session.
  const identity = resolveWebConversationIdentity({ profileId, userId, conversationId });
  const externalUserId = identity.externalUserId;
  const conversation = runtime.sessions.getOrCreateConversation(
    "web",
    externalUserId,
    conversationId,
    { projectId: project?.id }
  );
  const { store, pool } = resolveRuntimeContext({ profileId: identity.profileId, projectId: project?.id });
  // The runner is always keyed by the conversation's own identity (project or
  // Web owner) so the turn reopens the exact agent context that wrote this
  // session's history instead of forking a caller-keyed copy.
  const runnerChatId = resolveRunnerChatId(conversation.id, externalUserId);
  const runner = pool.get(runnerChatId, conversation.id);
  if (runner.isRunning()) {
    return new Response(
      JSON.stringify({ ok: false, error: "Already working. Please wait for current response to finish." }),
      {
        status: 409,
        headers: { "Content-Type": "application/json" }
      }
    );
  }
  const acceptedPlan = resumePlanId
    ? runtime.sessions.updateConversationPlan(conversation.id, resumePlanId, (plan) => plan)
    : null;
  if (resumePlanId && (!acceptedPlan || !["accepted", "executing"].includes(acceptedPlan.status))) {
      return new Response(JSON.stringify({ ok: false, error: "Accepted plan not found." }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      });
  }
  const ts = `${Date.now() / 1000}`;
  const attachments: FileAttachment[] = [];
  const imageContents: ChannelInboundMessage["imageContents"] = [];
  for (const file of body.files) {
    const bytes = Buffer.from(await file.arrayBuffer());
    const meta = resolveWebInboundFileMeta(file);
    const saved = store.saveAttachment(runnerChatId, file.name || "upload.bin", ts, bytes, meta);
    attachments.push(saved);
    // Keyed off the saved attachment, like the channel intakes: `isImage` and
    // `imageContents` must never disagree, or the vision path sees one image
    // and the model sees a different attachment list.
    if (saved.isImage) {
      imageContents.push({
        type: "image",
        mimeType: saved.mimeType || "image/jpeg",
        data: bytes.toString("base64")
      });
    }
  }
  const sessionPlan = acceptedPlan ?? runtime.sessions.listMessages(conversation.id)
    .map((entry) => entry.plan).filter((plan): plan is ConversationPlan => Boolean(plan && !["proposed", "rejected", "cancelled"].includes(plan.status) && !plan.durableExecutionId)).at(-1);
  const linkedPlan = runtime.sessions.listMessages(conversation.id).map((entry) => entry.plan).filter((plan) => plan?.durableExecutionId).at(-1);
  const coordinator = linkedPlan ? new DurableExecutionCoordinator() : undefined;
  const linkedExecution = coordinator && linkedPlan?.durableExecutionId ? coordinator.inspect("owner", linkedPlan.durableExecutionId) : undefined;
  const executionHistory = linkedExecution ? describeExecutionHistory(linkedExecution, conversation.id) : undefined;
  const evidenceManager = linkedExecution ? runtime.channelManagers.get(linkedExecution.execution.sourceChannel)?.get(linkedExecution.execution.botId) : undefined;
  const inboundText = acceptedPlan
    ? `执行已批准的计划：${acceptedPlan.title}\n${acceptedPlan.summary}\n${acceptedPlan.steps.map((step) => `${step.id}: ${step.text}`).join("\n")}`
    : message || "(attachment)";
  const turnRetention = classifyTurnRetention(inboundText);
  const sessionAttachments: ConversationAttachment[] = attachments.map((attachment) => ({
    original: attachment.original,
    local: attachment.local,
    mediaType: attachment.mediaType,
    mimeType: attachment.mimeType,
    size: attachment.size
  }));
  // Retry gate, not a first-turn gate (see /api/chat): retry while the title is
  // still the default; the summarizer's own title check protects renames.
  const shouldSummarizeTitle = !resumePlanId && hasDefaultConversationTitle(conversation.title);
  {
    runtime.sessions.appendMessage(conversation.id, "user", inboundText, {
      attachments: sessionAttachments,
      contextBacked: true,
      retention: turnRetention
    });
  }

  request.signal.addEventListener(
    "abort",
    () => {
      if (runner.isRunning()) runner.abort();
    },
    { once: true }
  );

  const encoder = new TextEncoder();

  const durableBotId = resolveWebDurableBotId(profileId, runtime.channelManagers);
  let durable;
  try {
    durable = sessionPlan || linkedExecution ? null : activateDurableExecution({
          message: inboundText,
          mode: body.durableMode,
          ownerId: "owner",
          botId: durableBotId,
          sourceChannel: "web",
          sourceChatId: runnerChatId,
          sourceUiSessionId: conversation.id,
          sourceProjectId: project?.id
        });
  } catch (error) {
    if (error instanceof DurableExecutionQuotaError) {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const message = "Unfinished durable-execution quota reached. Finish or cancel an existing task before starting another automatic task.";
          writeEvent(controller, encoder, "token", { delta: message });
          writeEvent(controller, encoder, "done", {
            ok: false,
            error: message,
            conversationId: conversation.id,
            profileId,
            stopReason: "error",
            thinkingText: ""
          });
          controller.close();
        }
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive"
        },
        status: 429
      });
    }
    throw error;
  }
  if (durable) {
    const response = formatDurableActivationAcknowledgement(
      durable.item,
      isChineseLocale(runtime.getSettings().locale)
    );
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        writeEvent(controller, encoder, "token", { delta: response });
        writeEvent(controller, encoder, "done", {
          ok: true,
          response,
          conversationId: conversation.id,
          profileId,
          stopReason: "stop",
          durableExecution: durable.item,
          diagnostics: [`activation=${durable.decision.activationPath}`, `reason=${durable.decision.reason}`],
          thinkingText: ""
        });
        controller.close();
      }
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive"
      }
    });
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (shouldSummarizeTitle) {
        void tryAutoSummarizeConversationTitleAsync({
          conversationId: conversation.id,
          channel: "web",
          externalUserId,
          firstUserMessage: inboundText,
          onTitleUpdated: (newTitle) => {
            writeEvent(controller, encoder, "session_title_updated", {
              conversationId: conversation.id,
              title: newTitle
            });
          }
        });
      }

      void (async () => {
        let finalText = "";
        let thinkingText = "";
        let responseModel = "";
        const threadNotes: string[] = [];
        const diagnostics: string[] = [];
        const responseAttachments: ConversationAttachment[] = [];
        const activityCollector = new ConversationActivityCollector();
        let planProposal: ConversationPlan | undefined;
        // Guards the transcript against a double assistant message: the catch
        // block's partial-persistence must not fire once the success path has
        // already appended.
        let assistantPersisted = false;

        const stopHeartbeat = startStreamHeartbeat(controller, encoder);

        try {
          if (sessionPlan && !["completed", "waiting_review"].includes(sessionPlan.status)) {
            runtime.sessions.updateConversationPlan(conversation.id, sessionPlan.id, (plan) => ({ ...plan, status: "executing", updatedAt: new Date().toISOString() }));
            writeEvent(controller, encoder, "plan_progress", { ...sessionPlan, status: "executing", updatedAt: new Date().toISOString() });
          }
          const result = await runner.run({
            executionHistory,
            readDurableEvidence: linkedExecution && coordinator ? async (evidenceId) => coordinator.readEvidence("owner", linkedExecution.execution.id, evidenceId, evidenceManager?.readDurableRunDetail?.bind(evidenceManager)) : undefined,
            sessionPlanProgress: sessionPlan ? {
              description: JSON.stringify(sessionPlan.steps),
              update: async (update) => {
                const plan = runtime.sessions.updateConversationPlan(conversation.id, sessionPlan.id, (current) => applyPlanProgress(current, update));
                if (!plan) throw new Error("Session plan no longer exists.");
                writeEvent(controller, encoder, "plan_progress", plan);
              }
            } : undefined,
            channel: "web",
            workspaceDir: store.getWorkspaceDir(),
            chatDir: store.getChatDir(runnerChatId),
            thinkingLevelOverride: thinkingLevel,
            // Per-session model resolution: an explicit per-turn `modelKey` (the
            // live composer selection) wins; otherwise fall back to the session's
            // persisted `conversation.modelKey`, then the project default, then
            // global. This keeps each session on its own model even after a
            // restart or when the turn originates from a channel bot.
            modelKeyOverride: String(body.modelKey ?? conversation.modelKey ?? project?.modelKey ?? "").trim() || undefined,
            project: buildRunnerProjectContext(project, store.getScratchDir(runnerChatId)),
            message: {
              chatId: runnerChatId,
              workspaceId,
              chatType: "private",
              messageId: Date.now(),
              userId: externalUserId,
              userName: userId,
              text: inboundText,
              ts,
              attachments,
              imageContents,
              sessionId: conversation.id
            },
            respond: async (text, shouldLog = true) => {
              if (shouldLog) {
                finalText = finalText ? `${finalText}${text}` : text;
                writeEvent(controller, encoder, "token", { delta: text });
                return;
              }
              writeEvent(controller, encoder, "status", { text });
            },
            replaceMessage: async (text) => {
              finalText = text;
              writeEvent(controller, encoder, "replace", { text });
            },
            beginContinuationResponse: async (partialText, notice) => {
              const finalized = [partialText.trim(), notice.trim()].filter(Boolean).join("\n\n");
              if (finalized) {
                writeEvent(controller, encoder, "replace", { text: finalized });
              }
              finalText = "";
              writeEvent(controller, encoder, "continuation", { notice });
            },
            respondInThread: async (text) => {
              const trimmed = text.trim();
              if (trimmed) threadNotes.push(trimmed);
              writeEvent(controller, encoder, "thread_note", { text });
            },
            setTyping: async (isTyping) => {
              if (isTyping) {
                writeEvent(controller, encoder, "status", { text: "Thinking..." });
              }
            },
            setWorking: async (isWorking) => {
              writeEvent(controller, encoder, "working", { isWorking });
            },
            deleteMessage: async () => {
              writeEvent(controller, encoder, "deleted", { ok: true });
            },
            uploadFile: async (filePath, title) => {
              const attachment = saveWebResponseAttachment({
                store,
                externalUserId: runnerChatId,
                filePath,
                title,
                ts
              });
              responseAttachments.push(attachment);
              writeEvent(controller, encoder, "attachment", attachment);
            },
            onRunnerEvent: async (event) => {
              const diagnostic = buildRunnerDiagnostic(event);
              if (diagnostic) diagnostics.push(diagnostic);

              if (event.type === "thinking_config") {
                responseModel = [event.provider, event.model].filter(Boolean).join("/");
                writeEvent(controller, encoder, "thinking_config", event);
                return;
              }
              if (event.type === "payload") {
                if (!responseModel) responseModel = [event.provider, event.model].filter(Boolean).join("/");
                writeEvent(controller, encoder, "payload", event);
                return;
              }
              if (event.type === "durable_preflight") {
                writeEvent(controller, encoder, "runner_event", { diagnostic: diagnostic ?? "", activity: undefined, preflight: event });
                return;
              }
              if (event.type === "plan_proposal") {
                planProposal = event.plan;
                writeEvent(controller, encoder, "plan_proposal", event.plan);
                return;
              }
              if (event.type === "tool_execution_start" || event.type === "tool_execution_end" || event.type === "subagent_execution") {
                const activity = activityCollector.record(event);
                writeEvent(controller, encoder, "runner_event", {
                  diagnostic: diagnostic ?? "",
                  activity
                });
                if (event.type === "tool_execution_end" && event.hostBashApproval) {
                  writeEvent(controller, encoder, "host_bash_approval", event.hostBashApproval);
                }
                return;
              }
              if (event.type !== "assistant_message_event") return;

              if (event.event.type === "thinking_start") {
                if (thinkingText.trim()) {
                  thinkingText += "\n\n";
                }
                writeEvent(controller, encoder, "thinking_state", { phase: "start" });
                return;
              }
              if (event.event.type === "thinking_delta") {
                thinkingText += event.event.delta;
                writeEvent(controller, encoder, "thinking_delta", { delta: event.event.delta });
                return;
              }
              if (event.event.type === "thinking_end") {
                writeEvent(controller, encoder, "thinking_state", {
                  phase: "end",
                  length: thinkingText.length
                });
                return;
              }
              if (event.event.type === "text_delta") {
                finalText += event.event.delta;
                writeEvent(controller, encoder, "token", { delta: event.event.delta });
              }
            }
          });

          if (sessionPlan) {
            const plan = runtime.sessions.updateConversationPlan(conversation.id, sessionPlan.id, (current) => finishPlanTurn(current, result.stopReason));
            writeEvent(controller, encoder, "plan_progress", plan);
          }
          const assistantText =
            finalText.trim() ||
            threadNotes.at(-1) ||
            result.errorMessage ||
            "(empty response)";

          // Terminal activity frames first (mutating the collector), so the
          // persisted finalSnapshot and the streamed cards agree.
          streamClosedActivities(controller, encoder, activityCollector);
          if (result.stopReason !== "waiting_for_approval") {
            runtime.sessions.appendMessage(conversation.id, "assistant", assistantText, {
              attachments: responseAttachments,
              activities: activityCollector.finalSnapshot(),
              plan: planProposal,
              model: responseModel || undefined,
              contextBacked: true,
              sourceEntryId: result.assistantSourceEntryId,
              retention: turnRetention
            });
            assistantPersisted = true;
          }
          writeEvent(controller, encoder, "done", {
            ok: true,
            response: planProposal ? "" : assistantText,
            conversationId: conversation.id,
            profileId,
            stopReason: result.stopReason,
            diagnostics: [...diagnostics, ...threadNotes],
            thinkingText
          });
        } catch (error) {
          if (sessionPlan) {
            const plan = runtime.sessions.updateConversationPlan(conversation.id, sessionPlan.id, (current) => finishPlanTurn(current, "error"));
            writeEvent(controller, encoder, "plan_progress", plan);
          }
          const messageText = error instanceof Error ? error.message : String(error);
          // Never drop what the run already produced: persist the partial
          // answer + tool timeline so the transcript survives the failure and
          // a follow-up "继续" has visible anchors.
          try {
            const partial = finalText.trim() || threadNotes.at(-1) || "";
            const activities = activityCollector.finalSnapshot();
            if (!assistantPersisted && (partial || activities.length > 0 || responseAttachments.length > 0)) {
              const notice = `⚠️ 本次回复在生成过程中中断，上面是已生成的部分。错误：${messageText}`;
              runtime.sessions.appendMessage(
                conversation.id,
                "assistant",
                partial ? `${partial}\n\n${notice}` : notice,
                { attachments: responseAttachments, activities, model: responseModel || undefined, contextBacked: true, retention: turnRetention }
              );
            }
          } catch {
            // best-effort persistence; the SSE error below still reaches the client
          }
          streamClosedActivities(controller, encoder, activityCollector);
          writeEvent(controller, encoder, "error", { ok: false, error: messageText });
        } finally {
          stopHeartbeat();
          try {
            controller.close();
          } catch {
            // already closed/cancelled
          }
        }
      })();
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    }
  });
};
