import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { steerWebRunner } from "$lib/server/web/runtimeContext";
import { getRuntime } from "$lib/server/app/runtime";
import { kanbanConversationSendAction } from "$lib/server/app/kanbanConversation.js";

interface SteerBody {
  profileId?: string;
  conversationId?: string;
  userId?: string;
  text?: string;
  mode?: string;
}

/**
 * Inject a message into the conversation's running turn (the Web/Desktop
 * counterpart of the channels' `/steer`). `delivered: false` means the turn had
 * already finished, and the caller should keep the message in its own queue.
 */
export const POST: RequestHandler = async ({ request }) => {
  let body: SteerBody;
  try {
    body = (await request.json()) as SteerBody;
  } catch {
    return json({ ok: false, error: "Invalid request body" }, { status: 400 });
  }

  const conversationId = String(body.conversationId ?? "").trim();
  if (!conversationId) {
    return json({ ok: false, error: "conversationId is required" }, { status: 400 });
  }
  const text = String(body.text ?? "").trim();
  if (!text) {
    return json({ ok: false, error: "text is required" }, { status: 400 });
  }
  // Member child sessions of a kanban task are read-only views: reject here so
  // the caller surfaces an error instead of queueing a message that can never
  // be delivered (spec 执行形态修订 切片③).
  const runtime = getRuntime();
  const childProjectId = runtime.sessions.getConversationProjectId(conversationId);
  const targetConversation = childProjectId
    ? runtime.sessions.getProjectConversation(childProjectId, conversationId)
    : null;
  const conversationOwner = childProjectId ? null : runtime.sessions.getWebConversationOwner(conversationId);
  const candidate = targetConversation
    ?? (conversationOwner ? runtime.sessions.getConversationById(conversationId, "web", conversationOwner) : null);
  if (candidate && kanbanConversationSendAction(candidate).kind === "read_only") {
    return json({ ok: false, error: "成员子会话是任务的只读视图，请在主任务会话中沟通。" }, { status: 409 });
  }

  const result = steerWebRunner({
    profileId: body.profileId ?? "",
    userId: body.userId,
    conversationId,
    text,
    mode: body.mode === "follow_up" ? "follow_up" : "steer"
  });
  return json({ ok: true, delivered: result.delivered });
};
