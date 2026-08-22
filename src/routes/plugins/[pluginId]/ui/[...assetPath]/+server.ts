import type { RequestHandler } from "@sveltejs/kit";
import { handlePluginUiRequest } from "$lib/server/plugins/contract/uiRoute.js";

/**
 * Serves plugin UI assets for custom-mode plugins under `/plugins/[pluginId]/ui/*`.
 */
export const GET: RequestHandler = async ({ params }) => {
  const pluginId = params.pluginId;
  const assetPath = params.assetPath ?? "index.html";
  return handlePluginUiRequest(pluginId, assetPath);
};
