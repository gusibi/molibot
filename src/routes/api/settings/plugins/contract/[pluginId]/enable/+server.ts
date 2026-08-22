import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime.js";
import { isValidPluginId } from "$lib/server/plugins/contract/paths.js";

/**
 * Toggles enablement for a contract plugin in RuntimeSettings.
 */
export const PUT: RequestHandler = async ({ params, request }) => {
  const pluginId = params.pluginId;
  if (!isValidPluginId(pluginId)) {
    return json({ ok: false, error: "Invalid plugin id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const enabled = Boolean((body as any)?.enabled);
  const runtime = getRuntime();
  const current = runtime.getSettings();
  const prevEntries = current.plugins.entries ?? {};
  const existing = prevEntries[pluginId] ?? { enabled: false };
  runtime.updateSettings({
    plugins: {
      ...current.plugins,
      entries: {
        ...prevEntries,
        [pluginId]: {
          ...existing,
          enabled
        }
      }
    }
  });

  return json({
    ok: true,
    pluginId,
    enabled
  });
};
