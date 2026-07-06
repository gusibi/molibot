import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { resolve } from "node:path";
import { config } from "$lib/server/app/env";
import { buildDesktopExternalTranscript } from "$lib/server/app/desktopExternalSessions";
import { readExternalTranscriptFromContexts } from "$lib/server/app/externalSessionsFromContexts";
import type { DesktopExternalTranscriptResponse } from "$lib/shared/desktop";

export const GET: RequestHandler = async ({ params }) => {
  const id = params.id;
  if (!id) {
    return json({ ok: false, error: "Session ID is required" }, { status: 400 });
  }

  const session = readExternalTranscriptFromContexts(resolve(config.dataDir), id);
  if (!session) {
    return json({ ok: false, error: "Session not found" }, { status: 404 });
  }

  const payload: DesktopExternalTranscriptResponse = {
    ok: true,
    transcript: buildDesktopExternalTranscript(session.conversation, session.messages)
  };
  return json(payload, { headers: { "Cache-Control": "no-store" } });
};
