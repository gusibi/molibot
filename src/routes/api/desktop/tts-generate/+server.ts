import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { buildDesktopTtsSummary, updateDesktopTtsSettings } from "$lib/server/app/desktopTtsGenerate";
import type { DesktopTtsResponse, DesktopTtsUpdateRequest } from "$lib/shared/desktop";

export const GET: RequestHandler = async () => {
  const runtime = getRuntime();
  const summary = buildDesktopTtsSummary(runtime.getSettings().ttsGenerate);
  const payload: DesktopTtsResponse = { ok: true, summary };
  return json(payload, { headers: { "Cache-Control": "no-store" } });
};

export const PATCH: RequestHandler = async ({ request }) => {
  let body: DesktopTtsUpdateRequest;
  try { body = (await request.json()) as DesktopTtsUpdateRequest; }
  catch { return json({ ok: false, error: "Invalid JSON body" }, { status: 400 }); }
  const runtime = getRuntime();
  const updated = runtime.updateSettings({ ttsGenerate: updateDesktopTtsSettings(runtime.getSettings().ttsGenerate, body) });
  const payload: DesktopTtsResponse = { ok: true, summary: buildDesktopTtsSummary(updated.ttsGenerate) };
  return json(payload, { headers: { "Cache-Control": "no-store" } });
};
