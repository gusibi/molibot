import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { readVideoGenerateConfig, updateVideoGenerateConfig } from "$lib/server/settings/handlers/mediaGenerates";

export const GET: RequestHandler = async () => {
  try {
    const value = readVideoGenerateConfig(getRuntime());
    return json({ ok: true, value }, { headers: { "Cache-Control": "no-store" } });
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
    const raw = body && typeof body === "object" && "value" in body ? body.value : body;
    const value = updateVideoGenerateConfig(getRuntime(), raw);
    return json({ ok: true, value }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
};
