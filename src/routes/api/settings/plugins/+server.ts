import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { readPluginsConfig, updatePluginsConfig } from "$lib/server/settings/handlers/plugins";

export const GET: RequestHandler = async () => {
  const runtime = getRuntime();
  return json({
    ok: true,
    catalog: runtime.pluginCatalog,
    plugins: readPluginsConfig(runtime)
  });
};

export const PUT: RequestHandler = async ({ request }) => {
  let body: { plugins?: Record<string, unknown> } | Record<string, unknown>;
  try {
    body = (await request.json()) as { plugins?: Record<string, unknown> } | Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const pluginsPatch = (body && typeof body === "object" && "plugins" in body)
    ? (body as { plugins: Record<string, unknown> }).plugins
    : body as Record<string, unknown>;

  if (!pluginsPatch || typeof pluginsPatch !== "object") {
    return json({ ok: false, error: "plugins payload must be an object" }, { status: 400 });
  }

  try {
    const plugins = updatePluginsConfig(getRuntime(), pluginsPatch);
    return json({ ok: true, plugins });
  } catch (error: any) {
    return json({ ok: false, error: error.message || String(error) }, { status: 400 });
  }
};
