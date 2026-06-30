import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { SqliteTraceStore } from "$lib/server/agent/hooks/traceStore.js";
import {
  buildDesktopTraceSummary,
  sanitizeDesktopTraceRange
} from "$lib/server/app/desktopTrace";
import type { DesktopTraceResponse } from "$lib/shared/desktop";

export const GET: RequestHandler = async ({ url }) => {
  const runtime = getRuntime();
  const timeZone = runtime.getSettings().timezone;
  const range = sanitizeDesktopTraceRange(url.searchParams.get("range"));
  const limit = Math.max(1, Math.min(10000, Number(url.searchParams.get("limit") ?? 5000) || 5000));

  const store = new SqliteTraceStore();
  try {
    const facts = store.listRecentFacts(limit);
    const summary = buildDesktopTraceSummary(timeZone, range, facts);
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
