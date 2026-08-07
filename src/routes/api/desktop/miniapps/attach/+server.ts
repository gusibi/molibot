import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime.js";
import type { MiniAppHost } from "$lib/server/miniapps/host.js";
import { getMiniAppHost } from "$lib/server/miniapps/registry.js";
import { MiniAppError } from "$lib/server/miniapps/types.js";

/**
 * Reads one file out of a Mini App's own data directory so the desktop can turn
 * it into a composer attachment (bridge v2 `composer.attach`).
 *
 * Why a route rather than the WebView reading the path directly: the WebView
 * must never learn a host path, and the app's dataDir is not something the
 * custom protocol serves. The panel sends the app-relative locator it was given
 * by its own iframe, and the host — the only party that knows where that
 * directory really is — resolves and proves containment.
 *
 * Read-only by construction: nothing here writes, and the only reachable bytes
 * are inside the requesting app's dataDir.
 */

/** Matches the composer's own practical ceiling for a single pasted file. */
export const _MAX_BRIDGE_ATTACH_BYTES = 32 * 1024 * 1024;

interface AttachRouteOptions {
  host: MiniAppHost;
  maxBytes?: number;
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

export async function _handleMiniAppAttachRequest(
  request: Request,
  options: AttachRouteOptions
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { ok: false, error: "Request body must be JSON.", code: "invalid_input" });
  }

  const raw = (body ?? {}) as Record<string, unknown>;
  const appId = raw.appId;
  const filePath = raw.path;
  // Validated before anything touches the filesystem (pitfall #26d).
  if (typeof appId !== "string" || !appId) {
    return json(400, { ok: false, error: "appId is required.", code: "invalid_input" });
  }
  if (typeof filePath !== "string" || !filePath) {
    return json(400, { ok: false, error: "path is required.", code: "invalid_input" });
  }

  try {
    const file = options.host.readDataFile(appId, filePath, options.maxBytes ?? _MAX_BRIDGE_ATTACH_BYTES);
    return json(200, {
      ok: true,
      name: file.name,
      // Base64 because the desktop rebuilds a `File` in the WebView; the raw
      // bytes never become a URL the page could be navigated to.
      base64: file.bytes.toString("base64")
    });
  } catch (cause) {
    if (cause instanceof MiniAppError) {
      const status = cause.code === "not_found"
        ? 404
        : cause.code === "disabled" || cause.code === "forbidden"
          ? 403
          : cause.code === "load_failed"
            ? 503
            : 400;
      return json(status, { ok: false, error: cause.message, code: cause.code });
    }
    return json(500, { ok: false, error: "Mini App attachment failed.", code: "load_failed" });
  }
}

export const POST: RequestHandler = async ({ request }) => {
  getRuntime();
  return _handleMiniAppAttachRequest(request, { host: getMiniAppHost() });
};
