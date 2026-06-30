import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { buildDesktopWebSearchSummary, updateDesktopWebSearchSettings } from "$lib/server/app/desktopWebSearch";
import type { DesktopWebSearchResponse, DesktopWebSearchUpdateRequest } from "$lib/shared/desktop";

export const GET: RequestHandler = async () => {
  const runtime = getRuntime();
  const summary = buildDesktopWebSearchSummary(runtime.getSettings().webSearch);
  const payload: DesktopWebSearchResponse = { ok: true, summary };
  return json(payload, { headers: { "Cache-Control": "no-store" } });
};

export const PATCH: RequestHandler = async ({ request }) => {
  let body: DesktopWebSearchUpdateRequest;
  try { body = (await request.json()) as DesktopWebSearchUpdateRequest; }
  catch { return json({ ok: false, error: "Invalid JSON body" }, { status: 400 }); }
  const runtime = getRuntime();
  const updated = runtime.updateSettings({ webSearch: updateDesktopWebSearchSettings(runtime.getSettings().webSearch, body) });
  const payload: DesktopWebSearchResponse = { ok: true, summary: buildDesktopWebSearchSummary(updated.webSearch) };
  return json(payload, { headers: { "Cache-Control": "no-store" } });
};
