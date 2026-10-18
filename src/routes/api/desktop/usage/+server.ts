import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { desktopUsageFromRecords, sanitizeDesktopUsageQuery } from "$lib/server/app/desktopUsage";
import type { DesktopUsageResponse } from "$lib/shared/desktop";

export const GET: RequestHandler = async ({ url }) => {
  const runtime = getRuntime();
  const settings = runtime.getSettings();
  const query = sanitizeDesktopUsageQuery({
    agentId: url.searchParams.get("agentId"),
    range: url.searchParams.get("range"),
    modelId: url.searchParams.get("modelId"),
    botId: url.searchParams.get("botId"),
    channel: url.searchParams.get("channel"),
    page: url.searchParams.get("page"),
    pageSize: url.searchParams.get("pageSize")
  });
  const summary = desktopUsageFromRecords(runtime.usageTracker.list(), settings.timezone, query);
  const names = new Map(settings.agents.map(agent => [agent.id, agent.name]));
  for (const row of [...summary.rankings.agents, ...summary.options.agents]) row.label = names.get(row.id) ?? row.id;
  const payload: DesktopUsageResponse = { ok: true, summary };
  return json(payload, { headers: { "Cache-Control": "no-store" } });
};
