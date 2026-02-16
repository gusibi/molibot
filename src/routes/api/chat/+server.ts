import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/runtime";

interface ChatBody {
  userId?: string;
  message?: string;
  conversationId?: string;
}

export const POST: RequestHandler = async ({ request }) => {
  let body: ChatBody;
  try {
    body = (await request.json()) as ChatBody;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const userId = body.userId?.trim() || "web-anonymous";
  const message = body.message?.trim() || "";
  const conversationId = body.conversationId?.trim() || undefined;

  const { router } = getRuntime();
  const result = await router.handle({
    channel: "web",
    externalUserId: userId,
    content: message,
    conversationId
  });

  if (!result.ok) {
    return json({ ok: false, error: result.error }, { status: 400 });
  }

  const { sessions } = getRuntime();
  const conv = sessions.getOrCreateConversation("web", userId, conversationId);

  return json({ ok: true, response: result.response, conversationId: conv.id });
};
