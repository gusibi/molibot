import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime.js";
import { buildDesktopMiniAppsPayload } from "$lib/server/app/desktopMiniApps.js";
import type { MiniAppHost } from "$lib/server/miniapps/host.js";
import { getMiniAppHost } from "$lib/server/miniapps/registry.js";

/**
 * Clears a Mini App's sidebar badge because the owner opened its panel.
 *
 * Only *clearing* is exposed. Setting a badge is the app's business (`ctx.badge`
 * on the server side) — if the WebView could set one too there would be two
 * writers for one value and no way to tell which is current.
 *
 * Answers with the whole catalog rather than `{ ok: true }` so the sidebar
 * applies one authoritative snapshot instead of locally guessing that its own
 * request succeeded and drifting when it did not.
 */

interface BadgeRouteOptions {
  host: MiniAppHost;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

export async function _handleMiniAppBadgeClearRequest(
  request: Request,
  options: BadgeRouteOptions
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { ok: false, error: "Request body must be JSON.", code: "invalid_input" });
  }

  const appId = (body as Record<string, unknown> | null)?.appId;
  if (typeof appId !== "string" || !appId) {
    return json(400, { ok: false, error: "appId is required.", code: "invalid_input" });
  }

  // Deliberately not an error for an unknown id: clearing a badge that is
  // already gone is the desired end state, and the owner cannot act on the
  // difference.
  options.host.clearBadge(appId);
  return json(200, { ok: true, ...buildDesktopMiniAppsPayload(options.host) });
}

export const POST: RequestHandler = async ({ request }) => {
  try {
    getRuntime();
    return _handleMiniAppBadgeClearRequest(request, { host: getMiniAppHost() });
  } catch (cause) {
    return json(500, { ok: false, error: cause instanceof Error ? cause.message : String(cause) });
  }
};
