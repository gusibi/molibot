import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";

export const GET: RequestHandler = async () => {
  const runtime = getRuntime();
  return json({
    ok: true,
    catalog: runtime.pluginCatalog
  });
};
