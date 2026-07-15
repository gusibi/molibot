import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { buildDesktopModelRoutingPatch, buildDesktopModelRoutingSettings } from "$lib/server/app/desktopModels";
import { getRuntime } from "$lib/server/app/runtime";
import { updateAiRoutingConfig } from "$lib/server/settings/handlers/aiRouting";
import type { DesktopModelRoutingResponse, DesktopModelRoutingUpdateRequest } from "$lib/shared/desktop";

export const GET: RequestHandler = async () => {
  const runtime = getRuntime();
  const payload: DesktopModelRoutingResponse = { ok: true, routing: buildDesktopModelRoutingSettings(runtime.getSettings()) };
  return json(payload, { headers: { "Cache-Control": "no-store" } });
};

export const PATCH: RequestHandler = async ({ request }) => {
  let body: DesktopModelRoutingUpdateRequest;
  try {
    body = (await request.json()) as DesktopModelRoutingUpdateRequest;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  try {
    const runtime = getRuntime();
    const shaped = buildDesktopModelRoutingPatch(runtime.getSettings(), body);
    updateAiRoutingConfig(runtime, shaped as Record<string, unknown>);
    const updated = runtime.getSettings();
    const payload: DesktopModelRoutingResponse = { ok: true, routing: buildDesktopModelRoutingSettings(updated) };
    return json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
};
