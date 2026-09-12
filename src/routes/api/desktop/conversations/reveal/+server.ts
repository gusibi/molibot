import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { revealDesktopSessionPath } from "$lib/server/app/desktopConversations.js";

/**
 * Reveals the session's storage file in Finder on macOS.
 */
export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => null)) as {
    sessionId?: unknown;
    projectId?: unknown;
  } | null;

  const sessionId = String(body?.sessionId ?? "").trim();
  const projectId = String(body?.projectId ?? "").trim() || undefined;

  if (!sessionId) {
    return json({ ok: false, error: "sessionId is required" }, { status: 400 });
  }

  const result = revealDesktopSessionPath(sessionId, projectId);
  if (!result.ok) {
    return json({ ok: false, error: result.error ?? "Failed to reveal session file", path: result.path }, { status: 400 });
  }

  return json({ ok: true, path: result.path }, { headers: { "Cache-Control": "no-store" } });
};
