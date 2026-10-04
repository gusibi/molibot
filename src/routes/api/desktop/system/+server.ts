import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { readDesktopSystem, updateDesktopSystem } from "$lib/server/app/desktopSystem";

export const GET: RequestHandler = () => {
  return json({ ok: true, config: readDesktopSystem(getRuntime()) }, { headers: { "Cache-Control": "no-store" } });
};

export const PATCH: RequestHandler = async ({ request }) => {
  try {
    const input = await request.json();
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Expected a system settings object.");
    return json({ ok: true, config: await updateDesktopSystem(getRuntime(), input) });
  } catch (cause) {
    return json({ ok: false, error: cause instanceof Error ? cause.message : String(cause) }, { status: 400 });
  }
};
