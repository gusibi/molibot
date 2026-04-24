import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import {
  buildModelOptions,
  currentModelKey,
  parseModelRoute,
  switchModelSelection,
  type ModelRoute
} from "$lib/server/settings/modelSwitch";

interface SwitchBody {
  route?: string;
  selector?: string;
}

const ROUTES: ModelRoute[] = ["text", "vision", "stt", "tts"];

export const GET: RequestHandler = async () => {
  const settings = getRuntime().getSettings();
  return json({
    ok: true,
    routes: Object.fromEntries(
      ROUTES.map((route) => [
        route,
        {
          currentKey: currentModelKey(settings, route),
          options: buildModelOptions(settings, route).map((option) => ({
            key: option.key,
            label: option.label
          }))
        }
      ])
    )
  });
};

export const POST: RequestHandler = async ({ request }) => {
  let body: SwitchBody;
  try {
    body = (await request.json()) as SwitchBody;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const selector = String(body.selector ?? "").trim();
  if (!selector) {
    return json({ ok: false, error: "selector is required" }, { status: 400 });
  }

  const route = parseModelRoute(String(body.route ?? "").trim()) ?? "text";
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

  return json({
    ok: true,
    route: result.route,
    selectedKey: result.selected.key,
    selectedLabel: result.selected.label,
    settings: result.settings
  });
};
