import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { resolveDesktopSessionFilePath } from "$lib/server/app/desktopConversations.js";

/**
 * Returns the filesystem path where the session is stored.
 */
export const GET: RequestHandler = async ({ url }) => {
  const sessionId = String(url.searchParams.get("sessionId") ?? "").trim();
  const projectId = String(url.searchParams.get("projectId") ?? "").trim() || undefined;

  if (!sessionId) {
    return json({ ok: false, error: "sessionId is required" }, { status: 400 });
  }

  const path = resolveDesktopSessionFilePath(sessionId, projectId);
  if (!path) {
    return json({ ok: false, error: "Session file path not found" }, { status: 404 });
  }

  return json({ ok: true, path }, { headers: { "Cache-Control": "no-store" } });
};
