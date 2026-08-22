import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime.js";
import { getPluginContractCatalog } from "$lib/server/plugins/contract/catalog.js";
import { isValidPluginId } from "$lib/server/plugins/contract/paths.js";

/**
 * Gets full details for a single contract plugin.
 */
export const GET: RequestHandler = async ({ params }) => {
  const pluginId = params.pluginId;
  if (!isValidPluginId(pluginId)) {
    return json({ ok: false, error: "Invalid plugin id" }, { status: 400 });
  }

  const runtime = getRuntime();
  const settings = runtime.getSettings();
  const catalog = getPluginContractCatalog();
  const detail = catalog.getPluginDetail(pluginId, settings);

  if (detail === null) {
    return json({ ok: false, error: "Plugin not found" }, { status: 404 });
  }

  return json({
    ok: true,
    detail
  });
};
