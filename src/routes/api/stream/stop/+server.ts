import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { sanitizeWebProfileId, sanitizeWebUserId } from "$lib/server/web/identity";
import { stopWebRunner, waitForWebRunnerIdle } from "$lib/server/web/runtimeContext";

interface StopBody {
  recoveryRunId?: string;
  profileId?: string;
  conversationId?: string;
  userId?: string;
}

export const POST: RequestHandler = async ({ request }) => {
  let body: StopBody;
  try {
    body = (await request.json()) as StopBody;
  } catch {
    return json({ ok: false, error: "Invalid request body" }, { status: 400 });
  }

  const profileId = sanitizeWebProfileId(body.profileId);
  const userId = sanitizeWebUserId(body.userId);
  const conversationId = String(body.conversationId ?? "").trim();
  if (!conversationId) {
    return json({ ok: false, error: "conversationId is required" }, { status: 400 });
  }

  if (body.recoveryRunId !== undefined && (typeof body.recoveryRunId !== "string" || !body.recoveryRunId.trim())) {
    return json({ ok: false, error: "recoveryRunId must be a non-empty string" }, { status: 400 });
  }
  const result = stopWebRunner({ profileId, userId, conversationId, recoveryRunId: body.recoveryRunId });
  if (result.stopped) {
    await waitForWebRunnerIdle({ profileId, userId, conversationId });
  }
  return json({ ok: true, stopped: result.stopped });
};
