import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { buildDesktopModelRoutingPatch, buildDesktopModelRoutingSettings } from "$lib/server/app/desktopModels";
import { getRuntime } from "$lib/server/app/runtime";
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
  const runtime = getRuntime();
  const updated = runtime.updateSettings(buildDesktopModelRoutingPatch(runtime.getSettings(), body));
  const payload: DesktopModelRoutingResponse = { ok: true, routing: buildDesktopModelRoutingSettings(updated) };
  return json(payload, { headers: { "Cache-Control": "no-store" } });
};
