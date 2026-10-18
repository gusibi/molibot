import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { SqliteTraceStore } from "$lib/server/agent/hooks/traceStore.js";
import {
  buildDesktopTraceSummary,
  resolveDesktopTraceWindow,
  sanitizeDesktopTraceQuery
} from "$lib/server/app/desktopTrace";
import type { DesktopTraceResponse } from "$lib/shared/desktop";

export const GET: RequestHandler = async ({ url }) => {
  const runtime = getRuntime();
  const timeZone = runtime.getSettings().timezone;
  const query = sanitizeDesktopTraceQuery({
    range: url.searchParams.get("range"),
    factType: url.searchParams.get("factType"),
    botId: url.searchParams.get("botId"),
    channel: url.searchParams.get("channel"),
    chatId: url.searchParams.get("chatId"),
    sessionId: url.searchParams.get("sessionId"),
    runId: url.searchParams.get("runId"),
    agentId: url.searchParams.get("agentId"),
    modelId: url.searchParams.get("modelId"),
    page: url.searchParams.get("page"),
    pageSize: url.searchParams.get("pageSize")
  });

  const store = new SqliteTraceStore();
  try {
    const window = resolveDesktopTraceWindow(query.range, timeZone);
    const facts = store.listAnalyticsFacts(window.startDate, window.endDate, timeZone);
    const summary = buildDesktopTraceSummary(timeZone, query, facts);
    const names = new Map(runtime.getSettings().agents.map(agent => [agent.id, agent.name]));
    for (const row of [...summary.rankings.agents, ...summary.options.agents]) row.label = names.get(row.id) ?? row.id;
    const payload: DesktopTraceResponse = { ok: true, summary };
    return json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  } finally {
    store.close();
  }
};
