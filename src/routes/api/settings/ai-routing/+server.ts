import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { readAiRoutingConfig, updateAiRoutingConfig } from "$lib/server/settings/handlers/aiRouting";

export const GET: RequestHandler = async () => {
  try {
    const config = readAiRoutingConfig(getRuntime());
    return json({ ok: true, ...config });
  } catch (error: any) {
    return json({ ok: false, error: error.message || String(error) }, { status: 500 });
  }
};

export const PUT: RequestHandler = async ({ request }) => {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const config = updateAiRoutingConfig(getRuntime(), body);
    return json({ ok: true, ...config });
  } catch (error: any) {
    return json({ ok: false, error: error.message || String(error) }, { status: 400 });
  }
};
