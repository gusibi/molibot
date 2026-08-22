import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime.js";
import { getPluginContractCatalog } from "$lib/server/plugins/contract/catalog.js";
import { getPluginConfigStore } from "$lib/server/plugins/contract/configStore.js";
import { readMolibotPluginManifest } from "$lib/server/plugins/contract/manifest.js";
import { isValidPluginId, pluginPackageDir } from "$lib/server/plugins/contract/paths.js";

/**
 * Saves non-secret settings values and/or secrets patch for a plugin.
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

  const payload = body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};

  const runtime = getRuntime();
  const catalog = getPluginContractCatalog();
  const detail = catalog.getPluginDetail(pluginId, runtime.getSettings());
  if (detail === null || !detail.manifest) {
    return json({ ok: false, error: "Plugin not found or invalid" }, { status: 404 });
  }

  const packageDir = pluginPackageDir(pluginId);
  const validated = packageDir === null ? null : readMolibotPluginManifest(packageDir, pluginId);
  if (validated === null || !validated.ok) {
    return json({ ok: false, error: "Plugin manifest is invalid" }, { status: 400 });
  }

  const configStore = getPluginConfigStore();
  const schemaVersion = detail.manifest.config.schemaVersion;

  // 1. If values provided, write them
  if (payload.values && typeof payload.values === "object" && !Array.isArray(payload.values)) {
    const values = payload.values as Record<string, unknown>;
    const validator = validated.value.settingsValidator;
    const writeRes = await configStore.writeConfig(pluginId, schemaVersion, values, {
      validate: validator === null
        ? undefined
        : (candidate) => validator(candidate)
          ? null
          : `Plugin settings are invalid: ${(validator.errors ?? [])
              .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
              .join("; ")}`
    });
    if (!writeRes.ok) {
      return json({ ok: false, error: writeRes.error.message }, { status: 400 });
    }
  }

  // 2. If secrets patch provided (replace or clear), apply it
  if (payload.secrets && typeof payload.secrets === "object" && !Array.isArray(payload.secrets)) {
    const patch = payload.secrets as { replace?: Record<string, string>; clear?: string[] };
    const secRes = await configStore.writeSecrets(pluginId, patch);
    if (!secRes.ok) {
      return json({ ok: false, error: secRes.error.message }, { status: 400 });
    }
  }

  const secretsPresence = configStore.listSecrets(pluginId);
  const readRes = configStore.readConfig(pluginId, schemaVersion);

  return json({
    ok: true,
    settingsValues: readRes.status === "ok" ? readRes.values : {},
    secretsPresence
  });
};
