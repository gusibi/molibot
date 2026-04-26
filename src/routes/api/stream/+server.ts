import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import type { RunnerUiEvent } from "$lib/server/agent/types";
import { sanitizeRuntimeThinkingLevel } from "$lib/server/settings";
import {
  sanitizeWebProfileId,
  sanitizeWebUserId,
  toWebExternalUserId
} from "$lib/server/web/identity";
import { getWebRuntimeContext } from "$lib/server/web/runtimeContext";

interface StreamBody {
  userId?: string;
  message?: string;
  conversationId?: string;
  profileId?: string;
  thinkingLevel?: string;
}

function writeEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  event: string,
  data: unknown
): void {
  controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
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
  return null;
}

export const POST: RequestHandler = async ({ request }) => {
  let body: StreamBody;
  try {
    body = (await request.json()) as StreamBody;
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

  if (!message) {
    return new Response(JSON.stringify({ ok: false, error: "Empty message." }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  const runtime = getRuntime();
  const externalUserId = toWebExternalUserId(userId, profileId);
  const conversation = runtime.sessions.getOrCreateConversation(
    "web",
    externalUserId,
    conversationId
  );

  const { store, pool } = getWebRuntimeContext(profileId);
  const runner = pool.get(externalUserId, conversation.id);
  if (runner.isRunning()) {
    return new Response(
      JSON.stringify({ ok: false, error: "Already working. Please wait for current response to finish." }),
      {
        status: 409,
        headers: { "Content-Type": "application/json" }
      }
    );
  }
  runtime.sessions.appendMessage(conversation.id, "user", message);

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
        const threadNotes: string[] = [];
        const diagnostics: string[] = [];
        const ts = `${Date.now() / 1000}`;

        try {
          const result = await runner.run({
            channel: "web",
            workspaceDir: store.getWorkspaceDir(),
            chatDir: store.getChatDir(externalUserId),
            thinkingLevelOverride: thinkingLevel,
            message: {
              chatId: externalUserId,
              chatType: "private",
              messageId: Date.now(),
              userId: externalUserId,
              userName: userId,
              text: message,
              ts,
              attachments: [],
              imageContents: [],
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
            uploadFile: async () => {},
            onRunnerEvent: async (event) => {
              const diagnostic = buildRunnerDiagnostic(event);
              if (diagnostic) diagnostics.push(diagnostic);

              if (event.type === "thinking_config") {
                writeEvent(controller, encoder, "thinking_config", event);
                return;
              }
              if (event.type === "payload") {
                writeEvent(controller, encoder, "payload", event);
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

          runtime.sessions.appendMessage(conversation.id, "assistant", assistantText);
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
          writeEvent(controller, encoder, "error", { ok: false, error: messageText });
        } finally {
          controller.close();
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
