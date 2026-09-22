import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { testAdaptiveThinkingConnection } from "$lib/server/settings/handlers/adaptiveThinking.js";

export const POST: RequestHandler = async ({ request }) => {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  try {
    const result = await testAdaptiveThinkingConnection(body);
    return json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ ok: false, error: message }, { status: /required|Host|key|URL|configuration/i.test(message) ? 400 : 502 });
  }
};
