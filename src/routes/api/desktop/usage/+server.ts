import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { buildDesktopUsageSummary } from "$lib/server/app/desktopUsage";
import type { DesktopUsageResponse } from "$lib/shared/desktop";

export const GET: RequestHandler = async () => {
  const runtime = getRuntime();
  const stats = runtime.usageTracker.getStats(runtime.getSettings().timezone);
  const payload: DesktopUsageResponse = { ok: true, summary: buildDesktopUsageSummary(stats) };
  return json(payload, { headers: { "Cache-Control": "no-store" } });
};
