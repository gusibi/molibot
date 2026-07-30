import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { steerWebRunner } from "$lib/server/web/runtimeContext";

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

  const result = steerWebRunner({
    profileId: body.profileId ?? "",
    userId: body.userId,
    conversationId,
    text,
    mode: body.mode === "follow_up" ? "follow_up" : "steer"
  });
  return json({ ok: true, delivered: result.delivered });
};
