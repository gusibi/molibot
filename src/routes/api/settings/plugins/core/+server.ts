import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime.js";
import { listCoreSettingsPlugins } from "$lib/server/plugins/coreSettings.js";

export const GET: RequestHandler = () => {
  const runtime = getRuntime();
  return json({ ok: true, items: listCoreSettingsPlugins(runtime.getSettings()) });
};
