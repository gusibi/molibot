import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";

const KEY_MAP: Record<string, string> = {
  "web-search": "webSearch",
  "webSearch": "webSearch",
  "settings_web_search": "webSearch",
  
  "image-generate": "imageGenerate",
  "imageGenerate": "imageGenerate",
  "settings_image_generate": "imageGenerate",
  
  "video-generate": "videoGenerate",
  "videoGenerate": "videoGenerate",
  "settings_video_generate": "videoGenerate",
  
  "sandbox": "toolSandbox",
  "toolSandbox": "toolSandbox",
  "settings_sandbox": "toolSandbox"
};

export const GET: RequestHandler = async ({ params }) => {
  const { key } = params;
  const runtimeKey = KEY_MAP[key ?? ""];
  if (!runtimeKey) {
    return json({ ok: false, error: `Invalid key: ${key}` }, { status: 400 });
  }

  const runtime = getRuntime();
  try {
    const settings = runtime.getSettings();
    const value = settings[runtimeKey as keyof typeof settings];
    return json({ ok: true, key: runtimeKey, value });
  } catch (error: any) {
    return json({ ok: false, error: error.message || String(error) }, { status: 500 });
  }
};

export const PUT: RequestHandler = async ({ params, request }) => {
  const { key } = params;
  const runtimeKey = KEY_MAP[key ?? ""];
  if (!runtimeKey) {
    return json({ ok: false, error: `Invalid key: ${key}` }, { status: 400 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  // Value can be inside body.value, body[runtimeKey], or body itself
  let value: any;
  if (body.value !== undefined) {
    value = body.value;
  } else if (body[runtimeKey] !== undefined) {
    value = body[runtimeKey];
  } else {
    value = body;
  }

  const runtime = getRuntime();
  try {
    const patch = { [runtimeKey]: value };
    const updated = runtime.updateSettings(patch);
    const updatedValue = updated[runtimeKey as keyof typeof updated];
    return json({ ok: true, key: runtimeKey, value: updatedValue });
  } catch (error: any) {
    return json({ ok: false, error: error.message || String(error) }, { status: 500 });
  }
};

export const POST = PUT;
export const PATCH = PUT;
