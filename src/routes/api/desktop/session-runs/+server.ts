import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { listDesktopSessionRuns } from "$lib/server/app/desktopConversations.js";
import type { DesktopSessionRunsResponse } from "$lib/shared/desktop.js";

/**
 * Active session-run status for reconnect recovery (plan §11.3). Returns every
 * running / waiting-for-approval run from the runtime `runs` table with its
 * resolved Web profile id. Status is sourced from persisted runtime state and
 * the approval broker — never from Desktop process memory — so a restarted
 * Desktop can rebuild the true running/waiting/failed picture rather than
 * guessing from its own (now-empty) controller registry.
 */
export const GET: RequestHandler = async () => {
  const result = listDesktopSessionRuns();
  const payload: DesktopSessionRunsResponse = { ok: true, runs: result.runs };
  return json(payload, { headers: { "Cache-Control": "no-store" } });
};
