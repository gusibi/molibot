import type { RequestHandler } from "./$types";
import { handleMiniAppRequest } from "$lib/server/miniapps/httpRoute.js";

/** `/miniapps/<app-id>` and `/miniapps/<app-id>/` — the app's UI entry document. */
export const GET: RequestHandler = ({ params, request }) =>
  handleMiniAppRequest(params.appId, "", request);
