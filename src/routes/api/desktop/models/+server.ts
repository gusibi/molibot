import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { buildDesktopModelState, sanitizeDesktopModelRoute } from "$lib/server/app/desktopModels";
import { getRuntime } from "$lib/server/app/runtime";
import { switchModelSelection } from "$lib/server/settings/modelSwitch";

export const GET: RequestHandler = async ({ url }) => {
  const route = sanitizeDesktopModelRoute(url.searchParams.get("route"));
  const runtime = getRuntime();
  return json({ ok: true, route, model: buildDesktopModelState(runtime.getSettings(), route) }, {
    headers: { "Cache-Control": "no-store" }
  });
};

export const POST: RequestHandler = async ({ request }) => {
  let body: { selector?: string; route?: string };
  try {
    body = (await request.json()) as { selector?: string; route?: string };
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const selector = String(body.selector ?? "").trim();
  if (!selector) {
    return json({ ok: false, error: "selector is required" }, { status: 400 });
  }

  const route = sanitizeDesktopModelRoute(body.route);
  const runtime = getRuntime();
  const result = switchModelSelection({
    settings: runtime.getSettings(),
    route,
    selector,
    updateSettings: runtime.updateSettings
  });
  if (!result) {
    return json({ ok: false, error: `Invalid model selector: ${selector}` }, { status: 400 });
  }

  return json({ ok: true, route, model: buildDesktopModelState(result.settings, route) });
};
