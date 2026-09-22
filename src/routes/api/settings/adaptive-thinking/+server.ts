import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime.js";
import {
  readAdaptiveThinkingConfig,
  testAdaptiveThinkingConnection,
  updateAdaptiveThinkingConfig
} from "$lib/server/settings/handlers/adaptiveThinking.js";

export const GET: RequestHandler = async () => {
  try {
    return json({ ok: true, ...readAdaptiveThinkingConfig(getRuntime()) });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
};
export const PUT: RequestHandler = async ({ request }) => {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  try {
    return json({ ok: true, ...updateAdaptiveThinkingConfig(getRuntime(), body) });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
};
