import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { buildDesktopExternalSessionsSummary } from "$lib/server/app/desktopExternalSessions";
import type { DesktopExternalSessionsResponse } from "$lib/shared/desktop";

export const GET: RequestHandler = async () => {
  const runtime = getRuntime();
  const sessions = runtime.sessions.listExternalSessions();
  const payload: DesktopExternalSessionsResponse = {
    ok: true,
    summary: buildDesktopExternalSessionsSummary(sessions)
  };
  return json(payload, { headers: { "Cache-Control": "no-store" } });
};
