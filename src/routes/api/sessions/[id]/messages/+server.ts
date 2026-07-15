import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { sanitizeWebProfileId } from "$lib/server/web/identity";
import {
  getRuntimeContextForConversation,
  resolveRunnerChatId
} from "$lib/server/web/runtimeContext";
import { truncateConversationProjection } from "$lib/server/web/conversationProjection.js";

/**
 * Edit-and-resend: drops the message identified by `fromMessageId` and every
 * message that follows it in the conversation. The desktop composer calls this
 * before re-sending an edited user turn so the transcript stays coherent
 * instead of accumulating duplicate user/assistant pairs. Works for both Web
 * bot conversations and Project conversations - `getRuntimeContextForConversation`
 * picks the right runner pool and `truncateMessagesFrom` resolves storage by id.
 */
export const DELETE: RequestHandler = async ({ params, url, request }) => {
  const id = params.id;
  if (!id) {
    return json({ ok: false, error: "Session ID is required" }, { status: 400 });
  }
  const fromMessageId = String(url.searchParams.get("fromMessageId") ?? "").trim();
  if (!fromMessageId) {
    return json({ ok: false, error: "fromMessageId is required" }, { status: 400 });
  }

  let body: { profileId?: string } = {};
  try {
    body = (await request.json().catch(() => null)) as { profileId?: string } | null ?? {};
  } catch {
    body = {};
  }
  const profileId = sanitizeWebProfileId(body.profileId ?? url.searchParams.get("profileId") ?? "");
  if (!profileId) {
    return json({ ok: false, error: "profileId is required" }, { status: 400 });
  }

  const { sessions } = getRuntime();
  const { pool } = getRuntimeContextForConversation(profileId, id);
  const runner = pool.get(resolveRunnerChatId(id, ""), id);
  if (runner.isRunning()) {
    return json({ ok: false, error: "Cannot edit a session while it is running" }, { status: 409 });
  }

  let removed: number;
  try {
    removed = truncateConversationProjection({ profileId, conversationId: id, fromMessageId });
  } catch (cause) {
    const code = (cause as Error & { code?: string }).code;
    const message = cause instanceof Error ? cause.message : String(cause);
    if (code === "MESSAGE_NOT_FOUND") {
      // 422 tells the client the request was structurally valid but the
      // referenced message id isn't part of this transcript - usually a
      // stale client state (e.g. a `pending-...` optimistic id left over
      // from a failed reload). The client reloads the session and asks the
      // user to retry.
      return json({ ok: false, error: message }, { status: 422 });
    }
    if (code === "SESSION_NOT_FOUND") {
      return json({ ok: false, error: message }, { status: 404 });
    }
    return json({ ok: false, error: message }, { status: 500 });
  }
  return json({ ok: true, removed });
};
