import type { RequestHandler } from "./$types";
import { handleMiniAppRequest } from "$lib/server/miniapps/httpRoute.js";

/**
 * `/miniapps/<app-id>/<rest>` — UI assets, and `api/…` for the app's own HTTP
 * handler. All methods land on the same function so the host can answer an
 * unsupported method for an asset path with 405 rather than a route miss.
 */
const handle: RequestHandler = ({ params, request }) =>
  handleMiniAppRequest(params.appId, params.path ?? "", request);

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
