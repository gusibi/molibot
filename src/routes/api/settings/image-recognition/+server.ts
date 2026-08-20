import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { listImageRecognitionModels } from "$lib/server/app/desktopImageRecognition.js";
import {
  readImageRecognitionConfig,
  updateImageRecognitionConfig
} from "$lib/server/settings/handlers/mediaGenerates.js";

export const GET: RequestHandler = async () => {
  try {
    const settings = getRuntime().getSettings();
    return json({
      ok: true,
      value: readImageRecognitionConfig(getRuntime()),
      models: listImageRecognitionModels(settings),
      adapterTypes: ["api"],
      plannedAdapterTypes: ["cli"]
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
};

export const PUT: RequestHandler = async ({ request }) => {
  let body: { value?: unknown } | undefined;
  try {
    body = await request.json() as { value?: unknown };
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  try {
    const value = updateImageRecognitionConfig(getRuntime(), body?.value);
    return json({ ok: true, value }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
};
