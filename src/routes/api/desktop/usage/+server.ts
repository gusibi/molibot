import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { buildDesktopUsageSummary, sanitizeDesktopUsageQuery } from "$lib/server/app/desktopUsage";
import type { DesktopUsageResponse } from "$lib/shared/desktop";

export const GET: RequestHandler = async ({ url }) => {
  const runtime = getRuntime();
  const stats = runtime.usageTracker.getStats(runtime.getSettings().timezone);
  const query = sanitizeDesktopUsageQuery({
    range: url.searchParams.get("range"),
    modelId: url.searchParams.get("modelId"),
    botId: url.searchParams.get("botId"),
    channel: url.searchParams.get("channel"),
    page: url.searchParams.get("page"),
    pageSize: url.searchParams.get("pageSize")
  });
  const payload: DesktopUsageResponse = { ok: true, summary: buildDesktopUsageSummary(stats, query) };
  return json(payload, { headers: { "Cache-Control": "no-store" } });
};
