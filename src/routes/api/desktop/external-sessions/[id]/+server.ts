import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { buildDesktopExternalTranscript } from "$lib/server/app/desktopExternalSessions";
import type { DesktopExternalTranscriptResponse } from "$lib/shared/desktop";

export const GET: RequestHandler = async ({ params }) => {
  const id = params.id;
  if (!id) {
    return json({ ok: false, error: "Session ID is required" }, { status: 400 });
  }

  const { sessions } = getRuntime();
  const conversation = sessions.getExternalSession(id);
  if (!conversation) {
    return json({ ok: false, error: "Session not found" }, { status: 404 });
  }

  const messages = sessions.listMessages(id, 1000);
  const payload: DesktopExternalTranscriptResponse = {
    ok: true,
    transcript: buildDesktopExternalTranscript(conversation, messages)
  };
  return json(payload, { headers: { "Cache-Control": "no-store" } });
};
