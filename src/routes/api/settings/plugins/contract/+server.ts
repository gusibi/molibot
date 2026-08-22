import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime.js";
import { getPluginContractCatalog } from "$lib/server/plugins/contract/catalog.js";

/**
 * Lists all installable contract plugins.
 */
export const GET: RequestHandler = async () => {
  const runtime = getRuntime();
  const settings = runtime.getSettings();
  const catalog = getPluginContractCatalog();
  const items = catalog.listPlugins(settings);

  return json({
    ok: true,
    items
  });
};
