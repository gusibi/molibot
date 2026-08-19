import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { getMiniAppHost } from "$lib/server/miniapps/registry.js";
import { miniAppErrorResponse } from "$lib/server/miniapps/host.js";
import { isValidMiniAppId } from "$lib/server/miniapps/paths.js";
import { MiniAppError } from "$lib/server/miniapps/types.js";
import type { MiniAppHost } from "$lib/server/miniapps/host.js";

/**
 * The Mini App HTTP surface: `/miniapps/<app-id>/…`.
 *
 * Two things live here rather than in the route files, because both routes need
 * them and neither may skip one:
 *
 * - **The proxy gate.** These endpoints are reachable on loopback, so any web
 *   page could otherwise scan for the port and drive an app's API. Requiring a
 *   custom request header forces a CORS preflight for cross-origin callers, and
 *   nothing here returns CORS permission, so the preflight fails. The Tauri
 *   transport adapter sets the header on every forwarded request. This defends
 *   against browser pages, not against other local processes.
 * - **The document CSP.** An app's HTML gets a restrictive policy from the host,
 *   not from the app: same-origin resources only, no object, no form action off
 *   origin, no `<base>` rewriting.
 */

export const MINIAPP_PROXY_HEADER = "x-molibot-miniapp-proxy";
export const MINIAPP_PROXY_VALUE = "v1";

/**
 * Origins allowed to frame a Mini App document. The packaged Tauri app and the
 * fixed desktop dev origin — never a wildcard, and never a loopback range.
 */
const FRAME_ANCESTORS = ["'self'", "tauri://localhost", "http://tauri.localhost", "https://tauri.localhost", "http://localhost:1420"];

function documentCsp(): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${FRAME_ANCESTORS.join(" ")}`
  ].join("; ");
}

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

/**
 * True when the request carries the transport adapter's marker. Checked before
 * the app id so a port-scanning page learns nothing about what is installed.
 */
function hasProxyHeader(request: Request): boolean {
  return request.headers.get(MINIAPP_PROXY_HEADER) === MINIAPP_PROXY_VALUE;
}

export interface MiniAppRouteOptions {
  /** Test seam. Production resolves the process-wide host. */
  host?: MiniAppHost;
}

/**
 * Handles one request under `/miniapps/<appId>/<rest>`.
 *
 * `rest` is the path after the app id, with no leading slash. A `rest` starting
 * with `api/` reaches the app's HTTP handler; anything else is a UI asset.
 */
export async function handleMiniAppRequest(
  appId: string,
  rest: string,
  request: Request,
  options: MiniAppRouteOptions = {}
): Promise<Response> {
  if (!hasProxyHeader(request)) {
    return jsonError(403, "Mini App routes are only reachable through the Molibot desktop transport.");
  }
  if (!isValidMiniAppId(appId)) {
    return jsonError(400, "Invalid Mini App id.");
  }

  const host = options.host ?? getMiniAppHost();

  if (rest === "api" || rest.startsWith("api/")) {
    const apiPath = rest.slice("api".length);
    return host.handleHttp(appId, request, apiPath);
  }

  if (request.method !== "GET") {
    return jsonError(405, `Method ${request.method} is not allowed for Mini App assets.`);
  }

  let asset: { filePath: string; contentType: string };
  try {
    asset = host.resolveUiAsset(appId, rest);
  } catch (cause) {
    return miniAppErrorResponse(cause instanceof MiniAppError ? cause : new MiniAppError("Asset not found.", "not_found"));
  }

  const headers: Record<string, string> = {
    "content-type": asset.contentType,
    // App code is replaced by directory swap + restart; a cached asset would
    // silently keep serving the previous build.
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  };
  if (asset.contentType.startsWith("text/html")) {
    headers["content-security-policy"] = documentCsp();
  }

  const stream = Readable.toWeb(createReadStream(asset.filePath)) as ReadableStream;
  return new Response(stream, { status: 200, headers });
}
