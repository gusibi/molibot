import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { forkSession } from "$lib/server/web/sessionFork.js";

export const POST: RequestHandler = async ({ params, request }) => {
  const sourceSessionId = String(params.id ?? "").trim();
  const body = await request.json().catch(() => null) as {
    profileId?: unknown;
    userId?: unknown;
    fromMessageId?: unknown;
    requestId?: unknown;
  } | null;
  const profileId = String(body?.profileId ?? "").trim();
  const userId = String(body?.userId ?? "").trim();
  const fromMessageId = String(body?.fromMessageId ?? "").trim();
  const requestId = String(body?.requestId ?? "").trim();
  if (!sourceSessionId || !profileId || !fromMessageId || !requestId || requestId.length > 128) {
    return json({ ok: false, error: "sessionId, profileId, fromMessageId, and requestId are required" }, { status: 400 });
  }

  try {
    const result = forkSession({ profileId, userId, sourceSessionId, fromMessageId, requestId });
    if (result.status === "not_found") {
      return json({ ok: false, error: "Session not found" }, { status: 404 });
    }
    if (result.status === "running") {
      return json({ ok: false, error: "Cannot fork a Session while it is running" }, { status: 409 });
    }
    if (result.status === "message_not_found" || result.status === "invalid_fork_point") {
      return json({ ok: false, error: "The selected user message is no longer available" }, { status: 422 });
    }
    const conversation = result.conversation;
    return json({
      ok: true,
      reused: result.status === "existing",
      session: {
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        parentSessionId: conversation.parentSessionId,
        forkedFromMessageId: conversation.forkedFromMessageId
      }
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = (error as Error & { code?: string }).code;
    if (code === "MESSAGE_NOT_FOUND" || code === "INVALID_FORK_POINT") {
      return json({ ok: false, error: "The selected user message is no longer available" }, { status: 422 });
    }
    if (code === "SESSION_NOT_FOUND") {
      return json({ ok: false, error: "Session not found" }, { status: 404 });
    }
    return json({ ok: false, error: "Failed to fork Session" }, { status: 500 });
  }
};
