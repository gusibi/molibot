import { json } from "@sveltejs/kit";
import type { ImageContent } from "@earendil-works/pi-ai";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { recognizeImage } from "$lib/server/agent/imageRecognition/imageRecognition.js";
import { sanitizeImageRecognitionSettings } from "$lib/server/settings/sanitize.js";

const MAX_TEST_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export const POST: RequestHandler = async ({ request }) => {
  try {
    const form = await request.formData();
    const image = form.get("image");
    if (!(image instanceof File)) return json({ ok: false, error: "image is required" }, { status: 400 });
    if (!ALLOWED_MIME_TYPES.has(image.type)) return json({ ok: false, error: "Unsupported image type" }, { status: 400 });
    if (image.size <= 0 || image.size > MAX_TEST_IMAGE_BYTES) {
      return json({ ok: false, error: "Image must be between 1 byte and 10 MB" }, { status: 400 });
    }

    const runtime = getRuntime();
    const settings = runtime.getSettings();
    const rawConfig = JSON.parse(String(form.get("value") || "{}"));
    const imageRecognition = sanitizeImageRecognitionSettings(rawConfig, settings.imageRecognition);
    const engineId = String(form.get("engineId") || "auto").trim();
    const testSettings = {
      ...settings,
      imageRecognition: {
        ...imageRecognition,
        defaultEngine: engineId === "auto" ? "auto" as const : engineId
      }
    };
    const bytes = Buffer.from(await image.arrayBuffer());
    const content: ImageContent = { type: "image", mimeType: image.type, data: bytes.toString("base64") };
    const result = await recognizeImage({
      channel: "settings",
      settings: testSettings,
      image: content,
      prompt: String(form.get("prompt") || "").trim() || undefined,
      label: image.name
    });
    return json({ ok: true, result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
};
