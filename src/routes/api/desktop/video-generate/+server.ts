import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { buildDesktopMediaGenerateInput, buildDesktopMediaGenerateSummary } from "$lib/server/app/desktopMediaGenerate";
import { sanitizeVideoGenerateSettings } from "$lib/server/settings/sanitize";
import type { DesktopMediaGenerateUpdateRequest, DesktopVideoGenerateResponse } from "$lib/shared/desktop";

export const GET: RequestHandler = async () => {
  const runtime = getRuntime();
  const summary = buildDesktopMediaGenerateSummary(runtime.getSettings().videoGenerate);
  const payload: DesktopVideoGenerateResponse = { ok: true, summary };
  return json(payload, { headers: { "Cache-Control": "no-store" } });
};

export const PATCH: RequestHandler = async ({ request }) => {
  let body: DesktopMediaGenerateUpdateRequest;
  try { body = (await request.json()) as DesktopMediaGenerateUpdateRequest; }
  catch { return json({ ok: false, error: "Invalid JSON body" }, { status: 400 }); }
  const runtime = getRuntime();
  const current = runtime.getSettings().videoGenerate;
  const videoGenerate = sanitizeVideoGenerateSettings(buildDesktopMediaGenerateInput(current, body), current);
  const updated = runtime.updateSettings({ videoGenerate });
  const payload: DesktopVideoGenerateResponse = { ok: true, summary: buildDesktopMediaGenerateSummary(updated.videoGenerate) };
  return json(payload, { headers: { "Cache-Control": "no-store" } });
};
