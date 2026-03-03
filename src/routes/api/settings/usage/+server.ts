import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";

export const GET: RequestHandler = async () => {
  const runtime = getRuntime();
  const settings = runtime.getSettings();
  const stats = runtime.usageTracker.getStats(settings.timezone);
  return json({ ok: true, stats });
};
