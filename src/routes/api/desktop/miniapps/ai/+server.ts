import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime.js";
import type { DesktopMiniAppAiSettings, DesktopMiniAppAiSettingsResponse } from "$lib/shared/desktop.js";

function payload(runtime: ReturnType<typeof getRuntime>, settings: DesktopMiniAppAiSettings): DesktopMiniAppAiSettingsResponse {
  return { ok: true, settings, usage: runtime.usageTracker.getMiniAppUsageLast30Days(runtime.settings.timezone) };
}

export const GET: RequestHandler = async () => {
  const runtime = getRuntime();
  return json(payload(runtime, runtime.settings.plugins.miniApps.ai), { headers: { "cache-control": "no-store" } });
};

export const PATCH: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => null) as Partial<DesktopMiniAppAiSettings> | null;
  if (!body || (body.textModelKey !== undefined && typeof body.textModelKey !== "string") ||
    (body.transcriptionModelKey !== undefined && typeof body.transcriptionModelKey !== "string")) {
    return json({ ok: false, error: "Model keys must be strings." }, { status: 400 });
  }
  const runtime = getRuntime();
  const current = runtime.settings.plugins.miniApps;
  const next = runtime.updateSettings({
    plugins: {
      ...runtime.settings.plugins,
      miniApps: {
        ...current,
        ai: {
          textModelKey: body.textModelKey === undefined ? current.ai.textModelKey : body.textModelKey.trim(),
          transcriptionModelKey: body.transcriptionModelKey === undefined
            ? current.ai.transcriptionModelKey
            : body.transcriptionModelKey.trim()
        }
      }
    }
  } as Parameters<typeof runtime.updateSettings>[0]);
  return json(payload(runtime, next.plugins.miniApps.ai));
};
