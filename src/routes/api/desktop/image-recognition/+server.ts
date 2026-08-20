import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import {
  buildDesktopImageRecognitionSummary,
  buildImageRecognitionSettingsInput,
  isDesktopImageRecognitionUpdateRequest
} from "$lib/server/app/desktopImageRecognition.js";
import { getRuntime } from "$lib/server/app/runtime.js";
import { sanitizeImageRecognitionSettings } from "$lib/server/settings/sanitize.js";
import type {
  DesktopImageRecognitionResponse,
  DesktopImageRecognitionUpdateRequest
} from "$lib/shared/desktop.js";

export const GET: RequestHandler = async () => {
  const settings = getRuntime().getSettings();
  const payload: DesktopImageRecognitionResponse = {
    ok: true,
    summary: buildDesktopImageRecognitionSummary(settings)
  };
  return json(payload, { headers: { "Cache-Control": "no-store" } });
};

export const PATCH: RequestHandler = async ({ request }) => {
  let body: DesktopImageRecognitionUpdateRequest;
  try { body = await request.json() as DesktopImageRecognitionUpdateRequest; }
  catch { return json({ ok: false, error: "Invalid JSON body" }, { status: 400 }); }
  if (!isDesktopImageRecognitionUpdateRequest(body)) {
    return json({ ok: false, error: "Invalid image recognition settings" }, { status: 400 });
  }
  const runtime = getRuntime();
  const current = runtime.getSettings();
  const imageRecognition = sanitizeImageRecognitionSettings(
    buildImageRecognitionSettingsInput(body),
    current.imageRecognition
  );
  const updated = runtime.updateSettings({ imageRecognition });
  const payload: DesktopImageRecognitionResponse = {
    ok: true,
    summary: buildDesktopImageRecognitionSummary(updated)
  };
  return json(payload, { headers: { "Cache-Control": "no-store" } });
};
