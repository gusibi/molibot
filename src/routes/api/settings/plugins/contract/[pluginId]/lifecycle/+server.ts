import fs from "node:fs";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime.js";
import { getPluginConfigStore } from "$lib/server/plugins/contract/configStore.js";
import { isValidPluginId, pluginCacheDir, pluginConfigDir, pluginDataDir, pluginPackageDir } from "$lib/server/plugins/contract/paths.js";

/**
 * Handles explicit lifecycle actions for a plugin:
 * - uninstall: removes package and cache, retains config & data by default
 * - delete-config: deletes `config/<id>`
 * - delete-data: deletes `data/<id>`
 * - clear-cache: deletes `cache/<id>`
 */
export const POST: RequestHandler = async ({ params, request }) => {
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

  const action = String((body as any)?.action ?? "").trim();
  const configStore = getPluginConfigStore();
  const runtime = getRuntime();

  switch (action) {
    case "uninstall": {
      // 1. Remove enabled entry from RuntimeSettings
      const current = runtime.getSettings();
      const nextEntries = { ...(current.plugins.entries ?? {}) };
      delete nextEntries[pluginId];
      runtime.updateSettings({
        plugins: {
          ...current.plugins,
          entries: nextEntries
        }
      });

      // 2. Clear cache
      configStore.clearCacheDir(pluginId);

      // 3. Remove package directory
      const pkgDir = pluginPackageDir(pluginId);
      if (pkgDir) {
        try {
          fs.rmSync(pkgDir, { recursive: true, force: true });
        } catch (cause) {
          const msg = cause instanceof Error ? cause.message : String(cause);
          return json({ ok: false, error: `Could not remove package: ${msg}` }, { status: 500 });
        }
      }

      return json({ ok: true, action: "uninstalled" });
    }

    case "delete-config": {
      const ok = configStore.deleteConfigDir(pluginId);
      return json({ ok, action: "config-deleted" });
    }

    case "delete-data": {
      const ok = configStore.deleteDataDir(pluginId);
      return json({ ok, action: "data-deleted" });
    }

    case "clear-cache": {
      const ok = configStore.clearCacheDir(pluginId);
      return json({ ok, action: "cache-cleared" });
    }

    default:
      return json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
  }
};
