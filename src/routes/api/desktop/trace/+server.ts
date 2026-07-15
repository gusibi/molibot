import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { SqliteTraceStore } from "$lib/server/agent/hooks/traceStore.js";
import {
  buildDesktopTraceSummary,
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
    sourceLimit: url.searchParams.get("sourceLimit"),
    page: url.searchParams.get("page"),
    pageSize: url.searchParams.get("pageSize")
  });

  const store = new SqliteTraceStore();
  try {
    const facts = store.listRecentFacts(query.sourceLimit);
    const summary = buildDesktopTraceSummary(timeZone, query, facts);
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
