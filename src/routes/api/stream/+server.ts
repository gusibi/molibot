import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { ConversationActivityCollector } from "$lib/server/app/conversationActivity";
import { buildSubagentDiagnostic } from "$lib/server/agent/subagentProgress";
import type { ChannelInboundMessage, FileAttachment, RunnerUiEvent } from "$lib/server/agent/core/types";
import { sanitizeRuntimeThinkingLevel } from "$lib/server/settings";
import {
  sanitizeWebProfileId,
  sanitizeWebUserId,
  toWebExternalUserId
} from "$lib/server/web/identity";
import { resolveRuntimeContext } from "$lib/server/web/runtimeContext";
import { resolveWorkspaceId } from "$lib/server/workspaces/store";
import { saveWebResponseAttachment } from "$lib/server/web/attachments";
import type { ConversationAttachment } from "$lib/shared/types/message";
import { resolveProjectContext } from "$lib/server/projects/context";
import { parseStreamRequest, type ParsedStreamRequest } from "./request";

function inferMediaType(file: File): FileAttachment["mediaType"] {
  const type = file.type.toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("video/")) return "video";
  return "file";
}

function writeEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  event: string,
  data: unknown
): void {
  // The client may have gone away mid-run (stop button, window close, network
  // drop). enqueue() then throws — swallowing it keeps the run loop alive so
  // the final transcript persistence below still happens; losing the live
  // event is harmless because the client reloads the transcript anyway.
  try {
    controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  } catch {
    // stream already closed/cancelled
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
  const conversationId = String(body.conversationId ?? "").trim() || undefined;
  const thinkingLevel = sanitizeRuntimeThinkingLevel(body.thinkingLevel);
  const projectResult = resolveProjectContext(body.projectId);
  if (!projectResult.ok) {
    return new Response(JSON.stringify({ ok: false, error: projectResult.error }), {
      status: projectResult.status,
      headers: { "Content-Type": "application/json" }
    });
  }
  const project = projectResult.project;

  if (!message && body.files.length === 0) {
    return new Response(JSON.stringify({ ok: false, error: "Empty message." }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  const runtime = getRuntime();
  const workspaceId = resolveWorkspaceId();
  const externalUserId = toWebExternalUserId(userId, profileId);
  const conversation = runtime.sessions.getOrCreateConversation(
    "web",
    externalUserId,
    conversationId,
    { projectId: project?.id }
  );

  const { store, pool } = resolveRuntimeContext({ profileId, projectId: project?.id });
  // Project conversations may originate on a channel bot (e.g. Feishu); keying
  // the runner by the conversation's own externalUserId reopens that exact
  // agent context instead of forking a Web-keyed copy.
  const runnerChatId = project ? conversation.externalUserId : externalUserId;
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
  const ts = `${Date.now() / 1000}`;
  const attachments: FileAttachment[] = [];
  const imageContents: ChannelInboundMessage["imageContents"] = [];
  for (const file of body.files) {
    const bytes = Buffer.from(await file.arrayBuffer());
    const mediaType = inferMediaType(file);
    const saved = store.saveAttachment(runnerChatId, file.name || "upload.bin", ts, bytes, {
      mediaType,
      mimeType: file.type || undefined
    });
    attachments.push(saved);
    if (mediaType === "image") {
      imageContents.push({
        type: "image",
        mimeType: file.type || "image/jpeg",
        data: bytes.toString("base64")
      });
    }
  }
  const inboundText = message || "(attachment)";
  const sessionAttachments: ConversationAttachment[] = attachments.map((attachment) => ({
    original: attachment.original,
    local: attachment.local,
    mediaType: attachment.mediaType,
    mimeType: attachment.mimeType,
    size: attachment.size
  }));
  runtime.sessions.appendMessage(conversation.id, "user", inboundText, {
    attachments: sessionAttachments,
    contextBacked: true
  });

  request.signal.addEventListener(
    "abort",
    () => {
      if (runner.isRunning()) runner.abort();
    },
    { once: true }
  );

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      void (async () => {
        let finalText = "";
        let thinkingText = "";
        let responseModel = "";
        const threadNotes: string[] = [];
        const diagnostics: string[] = [];
        const responseAttachments: ConversationAttachment[] = [];
        const activityCollector = new ConversationActivityCollector();
        // Guards the transcript against a double assistant message: the catch
        // block's partial-persistence must not fire once the success path has
        // already appended.
        let assistantPersisted = false;

        try {
          const result = await runner.run({
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
            project: project ? {
              id: project.id,
              name: project.name,
              rootPath: project.rootPath,
              instructions: project.instructions,
              sandboxEnabled: project.sandboxEnabled,
              toolProgress: project.toolProgress,
              showReasoning: project.showReasoning,
              runLogNotice: project.runLogNotice,
              scratchDir: store.getScratchDir(runnerChatId)
            } : undefined,
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
                thinkingText = "";
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

          const assistantText =
            finalText.trim() ||
            threadNotes.at(-1) ||
            result.errorMessage ||
            "(empty response)";

          if (result.stopReason !== "waiting_for_approval") {
            runtime.sessions.appendMessage(conversation.id, "assistant", assistantText, {
              attachments: responseAttachments,
              activities: activityCollector.finalSnapshot(),
              model: responseModel || undefined,
              contextBacked: true
            });
            assistantPersisted = true;
          }
          writeEvent(controller, encoder, "done", {
            ok: true,
            response: assistantText,
            conversationId: conversation.id,
            profileId,
            stopReason: result.stopReason,
            diagnostics: [...diagnostics, ...threadNotes],
            thinkingText
          });
        } catch (error) {
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
                { attachments: responseAttachments, activities, model: responseModel || undefined, contextBacked: true }
              );
            }
          } catch {
            // best-effort persistence; the SSE error below still reaches the client
          }
          writeEvent(controller, encoder, "error", { ok: false, error: messageText });
        } finally {
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
