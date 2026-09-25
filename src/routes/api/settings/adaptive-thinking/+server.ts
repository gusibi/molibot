import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime.js";
import {
  readAdaptiveThinkingConfig,
  readAvailableDecisionModelIds,
  updateAdaptiveThinkingConfig
} from "$lib/server/settings/handlers/adaptiveThinking.js";

export const GET: RequestHandler = async () => {
  try {
    const runtime = getRuntime();
    const config = readAdaptiveThinkingConfig(runtime);
    const availableDecisionModelIds = await readAvailableDecisionModelIds(runtime);
    const autoAvailable = config.enabled && availableDecisionModelIds.includes(config.selectedDecisionModelId);
    return json({ ok: true, ...config, availableDecisionModelIds, autoAvailable });
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
    const runtime = getRuntime();
    const config = updateAdaptiveThinkingConfig(runtime, body);
    const availableDecisionModelIds = await readAvailableDecisionModelIds(runtime);
    const autoAvailable = config.enabled && availableDecisionModelIds.includes(config.selectedDecisionModelId);
    return json({ ok: true, ...config, availableDecisionModelIds, autoAvailable });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
};
