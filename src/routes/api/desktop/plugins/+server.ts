import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { buildDesktopPluginsSettings, buildDesktopPluginsSummary } from "$lib/server/app/desktopPlugins";
import type { DesktopPluginsResponse, DesktopPluginsUpdateRequest } from "$lib/shared/desktop";

export const GET: RequestHandler = async () => {
  const runtime = getRuntime();
  const summary = buildDesktopPluginsSummary(runtime.pluginCatalog, runtime.getSettings());
  const payload: DesktopPluginsResponse = { ok: true, summary };
  return json(payload, { headers: { "Cache-Control": "no-store" } });
};

export const PUT: RequestHandler = async ({ request }) => {
  try {
    const runtime = getRuntime();
    const body = await request.json() as DesktopPluginsUpdateRequest;
    const updated = runtime.updateSettings({ plugins: buildDesktopPluginsSettings(runtime.getSettings(), runtime.pluginCatalog, body) });
    return json({ ok: true, summary: buildDesktopPluginsSummary(runtime.pluginCatalog, updated) } satisfies DesktopPluginsResponse);
  } catch (cause) {
    return json({ ok: false, error: cause instanceof Error ? cause.message : String(cause) }, { status: 400 });
  }
};
