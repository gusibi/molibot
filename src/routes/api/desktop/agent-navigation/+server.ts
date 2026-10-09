import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime.js";
import { sanitizeDesktopNavigation } from "$lib/server/settings/sanitize.js";
import { requireEnabledAgent } from "$lib/server/sessions/sessionAgentService.js";

export const GET: RequestHandler = async () => {
  const settings = getRuntime().getSettings();
  return json({ ok: true, navigation: settings.desktopNavigation, defaultAgentId: settings.defaultAgentId }, { headers: { "Cache-Control": "no-store" } });
};
export const PUT: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json();
    const runtime = getRuntime();
    const patch = body.defaultAgentId !== undefined
      ? { defaultAgentId: requireEnabledAgent(runtime.getSettings(), String(body.defaultAgentId)).id }
      : { desktopNavigation: sanitizeDesktopNavigation(body.navigation) };
    const settings = runtime.updateSettings(patch);
    return json({ ok: true, navigation: settings.desktopNavigation, defaultAgentId: settings.defaultAgentId });
  } catch (cause) { return json({ ok: false, error: cause instanceof Error ? cause.message : String(cause) }, { status: 400 }); }
};
