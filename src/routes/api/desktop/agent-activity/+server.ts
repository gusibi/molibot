import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { SqliteTraceStore } from "$lib/server/agent/hooks/traceStore.js";
import { buildDesktopAgentActivity } from "$lib/server/app/desktopTrace";
import type { DesktopAgentActivityResponse } from "$lib/shared/desktop";

export const GET: RequestHandler = async () => {
  const runtime = getRuntime();
  const store = new SqliteTraceStore();
  try {
    const payload: DesktopAgentActivityResponse = {
      ok: true,
      generatedAt: new Date().toISOString(),
      items: buildDesktopAgentActivity(runtime.getSettings(), store.listRecentFacts(500))
    };
    return json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  } finally {
    store.close();
  }
};
