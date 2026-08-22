import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime.js";
import { isCoreSettingsPluginId, setCoreSettingsPluginEnabled } from "$lib/server/plugins/coreSettings.js";

export const PUT: RequestHandler = async ({ params, request }) => {
  if (!isCoreSettingsPluginId(params.pluginId)) {
    return json({ ok: false, error: "Unknown built-in plugin" }, { status: 404 });
  }
  let body: { enabled?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.enabled !== "boolean") {
    return json({ ok: false, error: "enabled must be a boolean" }, { status: 400 });
  }
  const plugins = setCoreSettingsPluginEnabled(getRuntime(), params.pluginId, body.enabled);
  return json({ ok: true, enabled: params.pluginId === "memory" ? plugins.memory.enabled : plugins.memory.dailyMaterials.enabled });
};
