import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime.js";
import { invokePluginSettingsAction } from "$lib/server/plugins/contract/actionHost.js";
import { isValidPluginId } from "$lib/server/plugins/contract/paths.js";

/**
 * Dispatches a plugin settings runtime action.
 */
export const POST: RequestHandler = async ({ params, request }) => {
  const pluginId = params.pluginId;
  const action = params.actionName;

  if (!isValidPluginId(pluginId) || !action) {
    return json({ ok: false, error: "Invalid parameters" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const input = (body as any)?.input;
  const runtime = getRuntime();
  const settings = runtime.getSettings();

  const result = await invokePluginSettingsAction({
    pluginId,
    action,
    input,
    settings
  });

  return json(result, { status: result.ok ? 200 : 400 });
};
