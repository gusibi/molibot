import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { resolve } from "node:path";
import { config } from "$lib/server/app/env";
import { buildDesktopExternalSessionsSummary } from "$lib/server/app/desktopExternalSessions";
import { listExternalSessionsFromContexts } from "$lib/server/app/externalSessionsFromContexts";
import type { DesktopExternalSessionsResponse } from "$lib/shared/desktop";

export const GET: RequestHandler = async () => {
  const sessions = listExternalSessionsFromContexts(resolve(config.dataDir));
  const payload: DesktopExternalSessionsResponse = {
    ok: true,
    summary: buildDesktopExternalSessionsSummary(sessions)
  };
  return json(payload, { headers: { "Cache-Control": "no-store" } });
};
