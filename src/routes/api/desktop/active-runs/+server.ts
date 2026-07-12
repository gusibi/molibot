import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { SqliteTraceStore } from "$lib/server/agent/hooks/traceStore.js";
import { buildDesktopActiveRuns, type ActiveRunnerSnapshot } from "$lib/server/app/desktopActiveRuns";
import type { DesktopActiveRunActionResponse, DesktopActiveRunsResponse } from "$lib/shared/desktop";

function snapshots(): ActiveRunnerSnapshot[] {
  const runtime = getRuntime();
  const rows: ActiveRunnerSnapshot[] = [];
  for (const [channel, managers] of runtime.channelManagers) {
    for (const [botId, manager] of managers) {
      for (const run of manager.snapshotRuns?.() ?? []) rows.push({ channel, botId, ...run });
    }
  }
  return rows;
}

export const GET: RequestHandler = async () => {
  const runtime = getRuntime();
  const store = new SqliteTraceStore();
  try {
    const payload: DesktopActiveRunsResponse = { ok: true, generatedAt: new Date().toISOString(), items: buildDesktopActiveRuns(runtime.getSettings(), store.listRecentFacts(1000), snapshots()) };
    return json(payload, { headers: { "Cache-Control": "no-store" } });
  } finally { store.close(); }
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => null) as { runId?: string } | null;
  const runId = String(body?.runId ?? "").trim();
  if (!runId) return json({ ok: false, error: "runId is required" }, { status: 400 });
  const runtime = getRuntime();
  const store = new SqliteTraceStore();
  try {
    const fact = store.listFactsByRunId(runId).find((item) => item.factType === "run" && (item.status === "started" || item.status === "waiting"));
    if (!fact) return json({ ok: false, error: "Active Trace run not found" }, { status: 404 });
    const manager = fact.botId ? runtime.channelManagers.get(fact.channel)?.get(fact.botId) : undefined;
    const isLive = Boolean(manager?.snapshotRuns?.().some((item) => item.chatId === fact.chatId && item.sessionId === fact.sessionId));
    if (isLive) {
      const stopped = manager?.abortRun?.(fact.chatId, fact.sessionId, "Stopped manually from Trace controls.").aborted;
      if (!stopped) return json({ ok: false, error: "Runner could not be stopped" }, { status: 409 });
      const payload: DesktopActiveRunActionResponse = { ok: true, result: "stopped" };
      return json(payload);
    }
    const now = new Date().toISOString();
    store.upsertFact({ ...fact, status: "aborted", finishedAt: now, durationMs: Math.max(0, Date.parse(now) - Date.parse(fact.startedAt || fact.createdAt)), updatedAt: now, payload: { ...fact.payload, clearedFromTrace: true } });
    const payload: DesktopActiveRunActionResponse = { ok: true, result: "cleared" };
    return json(payload);
  } finally { store.close(); }
};
