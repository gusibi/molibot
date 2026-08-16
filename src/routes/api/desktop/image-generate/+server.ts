import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import {
  buildDesktopMediaGenerateInput,
  buildDesktopMediaGenerateSummary,
  isDesktopMediaGenerateUpdateRequest
} from "$lib/server/app/desktopMediaGenerate";
import { sanitizeImageGenerateSettings } from "$lib/server/settings/sanitize";
import type { DesktopImageGenerateResponse, DesktopMediaGenerateUpdateRequest } from "$lib/shared/desktop";

const BUILTIN_IMAGE_ENGINE_IDS = new Set(["agnes", "openai", "openai-chat", "modelscope", "google", "volcengine"]);

export const GET: RequestHandler = async () => {
  const runtime = getRuntime();
  const summary = buildDesktopMediaGenerateSummary(runtime.getSettings().imageGenerate);
  const payload: DesktopImageGenerateResponse = { ok: true, summary };
  return json(payload, { headers: { "Cache-Control": "no-store" } });
};

export const PATCH: RequestHandler = async ({ request }) => {
  let body: DesktopMediaGenerateUpdateRequest;
  try { body = (await request.json()) as DesktopMediaGenerateUpdateRequest; }
  catch { return json({ ok: false, error: "Invalid JSON body" }, { status: 400 }); }
  if (!isDesktopMediaGenerateUpdateRequest(body)) {
    return json({ ok: false, error: "Invalid image generation settings" }, { status: 400 });
  }
  const runtime = getRuntime();
  const current = runtime.getSettings().imageGenerate;
  const imageGenerate = sanitizeImageGenerateSettings(buildDesktopMediaGenerateInput(current, body, BUILTIN_IMAGE_ENGINE_IDS), current);
  const updated = runtime.updateSettings({ imageGenerate });
  const payload: DesktopImageGenerateResponse = { ok: true, summary: buildDesktopMediaGenerateSummary(updated.imageGenerate) };
  return json(payload, { headers: { "Cache-Control": "no-store" } });
};
