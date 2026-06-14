import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { SqliteTraceStore } from "$lib/server/agent/hooks/traceStore.js";

type TimeRange = "today" | "yesterday" | "last7Days" | "last30Days";

function localDateKey(value: string | Date, timeZone: string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function shiftDateKey(dateKey: string, deltaDays: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return shifted.toISOString().slice(0, 10);
}

function resolveWindow(range: TimeRange, timeZone: string): { startDate: string; endDate: string } {
  const today = localDateKey(new Date(), timeZone);
  if (range === "yesterday") {
    const yesterday = shiftDateKey(today, -1);
    return { startDate: yesterday, endDate: yesterday };
  }
  if (range === "last7Days") return { startDate: shiftDateKey(today, -6), endDate: today };
  if (range === "last30Days") return { startDate: shiftDateKey(today, -29), endDate: today };
  return { startDate: today, endDate: today };
}

export const GET: RequestHandler = async ({ url }) => {
  const runtime = getRuntime();
  const settings = runtime.getSettings();
  const timezone = settings.timezone;

  const range = (url.searchParams.get("range") || "today") as TimeRange;
  const factType = url.searchParams.get("factType") || "all";
  const botId = String(url.searchParams.get("botId") ?? "").trim();
  const sessionId = String(url.searchParams.get("sessionId") ?? "").trim();
  const runId = String(url.searchParams.get("runId") ?? "").trim();
  const channel = String(url.searchParams.get("channel") ?? "").trim();
  const chatId = String(url.searchParams.get("chatId") ?? "").trim();

  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.max(1, Number(url.searchParams.get("pageSize")) || 20);

  const window = resolveWindow(range, timezone);

  const candidateStart = shiftDateKey(window.startDate, -1) + "T00:00:00.000Z";
  const candidateEnd = shiftDateKey(window.endDate, 1) + "T23:59:59.999Z";

  const store = new SqliteTraceStore();
  try {
    const db = store.getDatabase();
    
    const conditions: string[] = ["created_at >= ?", "created_at <= ?"];
    const params: any[] = [candidateStart, candidateEnd];

    if (factType !== "all") {
      conditions.push("fact_type = ?");
      params.push(factType);
    }
    if (botId) {
      conditions.push("bot_id = ?");
      params.push(botId);
    }
    if (channel) {
      conditions.push("channel = ?");
      params.push(channel);
    }
    if (chatId) {
      conditions.push("chat_id = ?");
      params.push(chatId);
    }
    if (sessionId) {
      conditions.push("session_id = ?");
      params.push(sessionId);
    }
    if (runId) {
      conditions.push("run_id = ?");
      params.push(runId);
    }

    const whereClause = conditions.join(" AND ");
    
    const rows = db.prepare(`
      SELECT id, fact_type, run_id, fact_id, channel, bot_id, chat_id, session_id, workspace_id,
        name, provider, model, api, status, started_at, finished_at, duration_ms,
        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens, blocked_by, error_preview,
        args_preview, result_preview, payload_json, created_at, updated_at
      FROM agent_trace_facts
      WHERE ${whereClause}
      ORDER BY seq DESC
    `).all(...params) as any[];

    const allCandidates = rows.map((row) => ({
      id: row.id,
      factType: row.fact_type,
      runId: row.run_id,
      factId: row.fact_id,
      channel: row.channel,
      botId: row.bot_id || undefined,
      chatId: row.chat_id,
      sessionId: row.session_id,
      workspaceId: row.workspace_id || undefined,
      name: row.name || undefined,
      provider: row.provider || undefined,
      model: row.model || undefined,
      api: row.api || undefined,
      status: row.status,
      startedAt: row.started_at || undefined,
      finishedAt: row.finished_at || undefined,
      durationMs: row.duration_ms !== null ? Number(row.duration_ms) : undefined,
      inputTokens: row.input_tokens !== null ? Number(row.input_tokens) : undefined,
      outputTokens: row.output_tokens !== null ? Number(row.output_tokens) : undefined,
      cacheReadTokens: row.cache_read_tokens !== null ? Number(row.cache_read_tokens) : undefined,
      cacheWriteTokens: row.cache_write_tokens !== null ? Number(row.cache_write_tokens) : undefined,
      totalTokens: row.total_tokens !== null ? Number(row.total_tokens) : undefined,
      blockedBy: row.blocked_by || undefined,
      errorPreview: row.error_preview || undefined,
      argsPreview: row.args_preview || undefined,
      resultPreview: row.result_preview || undefined,
      payload: JSON.parse(row.payload_json) as Record<string, any>,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));

    const filtered = allCandidates.filter((fact) => {
      const day = localDateKey(fact.createdAt, timezone);
      return day >= window.startDate && day <= window.endDate;
    });

    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const data = filtered.slice(start, start + pageSize);

    return json({ ok: true, data, total });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  } finally {
    store.close();
  }
};
