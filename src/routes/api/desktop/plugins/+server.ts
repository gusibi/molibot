import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { buildDesktopPluginsSettings, buildDesktopPluginsSummary } from "$lib/server/app/desktopPlugins";
import type { DesktopPluginsResponse, DesktopPluginsUpdateRequest } from "$lib/shared/desktop";
import { getProjectStore } from "$lib/server/projects/store";

function projectOptions(): Array<{ value: string; label: string }> {
  return getProjectStore().list().map((project) => ({ value: project.id, label: project.name }));
}

export const GET: RequestHandler = async () => {
  const runtime = getRuntime();
  const summary = buildDesktopPluginsSummary(runtime.pluginCatalog, runtime.getSettings(), projectOptions());
  const payload: DesktopPluginsResponse = { ok: true, summary };
  return json(payload, { headers: { "Cache-Control": "no-store" } });
};

export const PUT: RequestHandler = async ({ request }) => {
  try {
    const runtime = getRuntime();
    const body = await request.json() as DesktopPluginsUpdateRequest;
    const updated = runtime.updateSettings({ plugins: buildDesktopPluginsSettings(runtime.getSettings(), runtime.pluginCatalog, body) });
    return json({ ok: true, summary: buildDesktopPluginsSummary(runtime.pluginCatalog, updated, projectOptions()) } satisfies DesktopPluginsResponse);
  } catch (cause) {
    return json({ ok: false, error: cause instanceof Error ? cause.message : String(cause) }, { status: 400 });
  }
};
