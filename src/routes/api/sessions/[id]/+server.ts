import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/runtime";

export const GET: RequestHandler = async ({ params, url }) => {
  const id = params.id;
  const userId = url.searchParams.get("userId")?.trim() || "web-anonymous";
  if (!id) {
    return json({ ok: false, error: "Session ID is required" }, { status: 400 });
  }

  const { sessions } = getRuntime();
  const conversation = sessions.getConversationById(id, "web", userId);
  if (!conversation) {
    return json({ ok: false, error: "Session not found" }, { status: 404 });
  }

  const messages = sessions.listMessages(id, 1000);
  return json({
    ok: true,
    session: {
      id: conversation.id,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      messages
    }
  });
};
