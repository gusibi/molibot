import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { SqliteTraceStore, type TraceFactRecord, type TraceFactType } from "$lib/server/agent/hooks/traceStore.js";

type TimeRange = "today" | "yesterday" | "last7Days" | "last30Days";
type FactTypeFilter = "all" | TraceFactType;

interface TraceTotals {
  facts: number;
  toolCalls: number;
  executedToolCalls: number;
  modelCalls: number;
  distinctTools: number;
  bots: number;
  channels: number;
  chats: number;
  sessions: number;
  runs: number;
  failedTools: number;
  blockedTools: number;
  totalTokens: number;
  avgToolDurationMs: number;
  avgModelDurationMs: number;
}

interface ToolSummary {
  name: string;
  calls: number;
  executedCalls: number;
  success: number;
  error: number;
  blocked: number;
  avgDurationMs: number;
}

interface ModelSummary {
  id: string;
  provider: string;
  model: string;
  api: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  avgDurationMs: number;
}

interface BotSummary {
  botId: string;
  channels: number;
  chats: number;
  sessions: number;
  runs: number;
  toolCalls: number;
  modelCalls: number;
  distinctTools: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  lastAt: string;
}

interface SessionSummary {
  sessionId: string;
  runs: number;
  toolCalls: number;
  modelCalls: number;
  distinctTools: number;
  totalTokens: number;
  lastAt: string;
}

interface RunSummary {
  runId: string;
  sessionId: string;
  toolCalls: number;
  modelCalls: number;
  distinctTools: number;
  totalTokens: number;
  lastAt: string;
}

interface ChatSummary {
  id: string;
  channel: string;
  chatId: string;
  sessions: number;
  runs: number;
  toolCalls: number;
  modelCalls: number;
  distinctTools: number;
  totalTokens: number;
  lastAt: string;
}

const timeRanges = new Set<TimeRange>(["today", "yesterday", "last7Days", "last30Days"]);
const factTypes = new Set<FactTypeFilter>(["all", "tool_call", "model_call"]);

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

function averageDuration(records: TraceFactRecord[]): number {
  const durations = records
    .map((record) => record.durationMs)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (durations.length === 0) return 0;
  return Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length);
}

function safeString(value: string | undefined, fallback: string): string {
  const trimmed = String(value ?? "").trim();
  return trimmed || fallback;
}

function buildStats(facts: TraceFactRecord[]) {
  const toolFacts = facts.filter((fact) => fact.factType === "tool_call");
  const modelFacts = facts.filter((fact) => fact.factType === "model_call");
  const executedToolFacts = toolFacts.filter((fact) => fact.status === "success" || fact.status === "error");

  const totals: TraceTotals = {
    facts: facts.length,
    toolCalls: toolFacts.length,
    executedToolCalls: executedToolFacts.length,
    modelCalls: modelFacts.length,
    distinctTools: new Set(toolFacts.map((fact) => safeString(fact.name, "unknown"))).size,
    bots: new Set(facts.map((fact) => safeString(fact.botId, "unknown"))).size,
    channels: new Set(facts.map((fact) => fact.channel)).size,
    chats: new Set(facts.map((fact) => `${fact.channel}:${fact.chatId}`)).size,
    sessions: new Set(facts.map((fact) => fact.sessionId)).size,
    runs: new Set(facts.map((fact) => fact.runId)).size,
    failedTools: toolFacts.filter((fact) => fact.status === "error").length,
    blockedTools: toolFacts.filter((fact) => fact.status === "blocked").length,
    totalTokens: modelFacts.reduce((sum, fact) => sum + (fact.totalTokens ?? 0), 0),
    avgToolDurationMs: averageDuration(executedToolFacts),
    avgModelDurationMs: averageDuration(modelFacts.filter((fact) => fact.status === "success" || fact.status === "error"))
  };

  const tools = new Map<string, ToolSummary & { durationSum: number; durationCount: number }>();
  for (const fact of toolFacts) {
    const name = safeString(fact.name, "unknown");
    const row = tools.get(name) ?? {
      name,
      calls: 0,
      executedCalls: 0,
      success: 0,
      error: 0,
      blocked: 0,
      avgDurationMs: 0,
      durationSum: 0,
      durationCount: 0
    };
    row.calls += 1;
    if (fact.status === "success" || fact.status === "error") row.executedCalls += 1;
    if (fact.status === "success") row.success += 1;
    if (fact.status === "error") row.error += 1;
    if (fact.status === "blocked") row.blocked += 1;
    if (typeof fact.durationMs === "number") {
      row.durationSum += fact.durationMs;
      row.durationCount += 1;
    }
    tools.set(name, row);
  }

  const models = new Map<string, ModelSummary & { durationSum: number; durationCount: number }>();
  for (const fact of modelFacts) {
    const provider = safeString(fact.provider, "unknown");
    const model = safeString(fact.model, "unknown");
    const api = safeString(fact.api, "unknown");
    const id = `${provider}::${model}::${api}`;
    const row = models.get(id) ?? {
      id,
      provider,
      model,
      api,
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      avgDurationMs: 0,
      durationSum: 0,
      durationCount: 0
    };
    row.requests += 1;
    row.inputTokens += fact.inputTokens ?? 0;
    row.outputTokens += fact.outputTokens ?? 0;
    row.cacheReadTokens += fact.cacheReadTokens ?? 0;
    row.cacheWriteTokens += fact.cacheWriteTokens ?? 0;
    row.totalTokens += fact.totalTokens ?? 0;
    if (typeof fact.durationMs === "number") {
      row.durationSum += fact.durationMs;
      row.durationCount += 1;
    }
    models.set(id, row);
  }

  const sessions = new Map<string, SessionSummary & { runIds: Set<string>; tools: Set<string> }>();
  const runs = new Map<string, RunSummary & { tools: Set<string> }>();
  const chats = new Map<string, ChatSummary & { sessionIds: Set<string>; runIds: Set<string>; tools: Set<string> }>();
  const bots = new Map<string, BotSummary & { channelsSet: Set<string>; chatIds: Set<string>; sessionIds: Set<string>; runIds: Set<string>; tools: Set<string> }>();
  for (const fact of facts) {
    const botId = safeString(fact.botId, "unknown");
    const bot = bots.get(botId) ?? {
      botId,
      channels: 0,
      chats: 0,
      sessions: 0,
      runs: 0,
      toolCalls: 0,
      modelCalls: 0,
      distinctTools: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      lastAt: fact.updatedAt,
      channelsSet: new Set<string>(),
      chatIds: new Set<string>(),
      sessionIds: new Set<string>(),
      runIds: new Set<string>(),
      tools: new Set<string>()
    };
    bot.channelsSet.add(fact.channel);
    bot.chatIds.add(`${fact.channel}:${fact.chatId}`);
    bot.sessionIds.add(fact.sessionId);
    bot.runIds.add(fact.runId);
    if (fact.factType === "tool_call") {
      bot.toolCalls += 1;
      bot.tools.add(safeString(fact.name, "unknown"));
    } else {
      bot.modelCalls += 1;
      bot.inputTokens += fact.inputTokens ?? 0;
      bot.outputTokens += fact.outputTokens ?? 0;
      bot.cacheReadTokens += fact.cacheReadTokens ?? 0;
      bot.cacheWriteTokens += fact.cacheWriteTokens ?? 0;
      bot.totalTokens += fact.totalTokens ?? 0;
    }
    if (fact.updatedAt > bot.lastAt) bot.lastAt = fact.updatedAt;
    bots.set(botId, bot);

    const chatKey = `${fact.channel}:${fact.chatId}`;
    const chat = chats.get(chatKey) ?? {
      id: chatKey,
      channel: fact.channel,
      chatId: fact.chatId,
      sessions: 0,
      runs: 0,
      toolCalls: 0,
      modelCalls: 0,
      distinctTools: 0,
      totalTokens: 0,
      lastAt: fact.updatedAt,
      sessionIds: new Set<string>(),
      runIds: new Set<string>(),
      tools: new Set<string>()
    };
    chat.sessionIds.add(fact.sessionId);
    chat.runIds.add(fact.runId);
    if (fact.factType === "tool_call") {
      chat.toolCalls += 1;
      chat.tools.add(safeString(fact.name, "unknown"));
    } else {
      chat.modelCalls += 1;
      chat.totalTokens += fact.totalTokens ?? 0;
    }
    if (fact.updatedAt > chat.lastAt) chat.lastAt = fact.updatedAt;
    chats.set(chatKey, chat);

    const session = sessions.get(fact.sessionId) ?? {
      sessionId: fact.sessionId,
      runs: 0,
      toolCalls: 0,
      modelCalls: 0,
      distinctTools: 0,
      totalTokens: 0,
      lastAt: fact.updatedAt,
      runIds: new Set<string>(),
      tools: new Set<string>()
    };
    session.runIds.add(fact.runId);
    if (fact.factType === "tool_call") {
      session.toolCalls += 1;
      session.tools.add(safeString(fact.name, "unknown"));
    } else {
      session.modelCalls += 1;
      session.totalTokens += fact.totalTokens ?? 0;
    }
    if (fact.updatedAt > session.lastAt) session.lastAt = fact.updatedAt;
    sessions.set(fact.sessionId, session);

    const run = runs.get(fact.runId) ?? {
      runId: fact.runId,
      sessionId: fact.sessionId,
      toolCalls: 0,
      modelCalls: 0,
      distinctTools: 0,
      totalTokens: 0,
      lastAt: fact.updatedAt,
      tools: new Set<string>()
    };
    if (fact.factType === "tool_call") {
      run.toolCalls += 1;
      run.tools.add(safeString(fact.name, "unknown"));
    } else {
      run.modelCalls += 1;
      run.totalTokens += fact.totalTokens ?? 0;
    }
    if (fact.updatedAt > run.lastAt) run.lastAt = fact.updatedAt;
    runs.set(fact.runId, run);
  }

  return {
    totals,
    tools: Array.from(tools.values())
      .map(({ durationSum, durationCount, ...row }) => ({
        ...row,
        avgDurationMs: durationCount > 0 ? Math.round(durationSum / durationCount) : 0
      }))
      .sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name)),
    models: Array.from(models.values())
      .map(({ durationSum, durationCount, ...row }) => ({
        ...row,
        avgDurationMs: durationCount > 0 ? Math.round(durationSum / durationCount) : 0
      }))
      .sort((a, b) => b.requests - a.requests || a.model.localeCompare(b.model)),
    bots: Array.from(bots.values())
      .map(({ channelsSet, chatIds, sessionIds, runIds, tools, ...row }) => ({
        ...row,
        channels: channelsSet.size,
        chats: chatIds.size,
        sessions: sessionIds.size,
        runs: runIds.size,
        distinctTools: tools.size
      }))
      .sort((a, b) => b.lastAt.localeCompare(a.lastAt)),
    chats: Array.from(chats.values())
      .map(({ sessionIds, runIds, tools, ...row }) => ({
        ...row,
        sessions: sessionIds.size,
        runs: runIds.size,
        distinctTools: tools.size
      }))
      .sort((a, b) => b.lastAt.localeCompare(a.lastAt)),
    sessions: Array.from(sessions.values())
      .map(({ runIds, tools, ...row }) => ({
        ...row,
        runs: runIds.size,
        distinctTools: tools.size
      }))
      .sort((a, b) => b.lastAt.localeCompare(a.lastAt)),
    runs: Array.from(runs.values())
      .map(({ tools, ...row }) => ({
        ...row,
        distinctTools: tools.size
      }))
      .sort((a, b) => b.lastAt.localeCompare(a.lastAt))
  };
}

export const GET: RequestHandler = async ({ url }) => {
  const runtime = getRuntime();
  const settings = runtime.getSettings();
  const timezone = settings.timezone;
  const rangeParam = url.searchParams.get("range") as TimeRange | null;
  const factTypeParam = url.searchParams.get("factType") as FactTypeFilter | null;
  const range = rangeParam && timeRanges.has(rangeParam) ? rangeParam : "today";
  const factType = factTypeParam && factTypes.has(factTypeParam) ? factTypeParam : "all";
  const botId = String(url.searchParams.get("botId") ?? "").trim();
  const sessionId = String(url.searchParams.get("sessionId") ?? "").trim();
  const runId = String(url.searchParams.get("runId") ?? "").trim();
  const channel = String(url.searchParams.get("channel") ?? "").trim();
  const chatId = String(url.searchParams.get("chatId") ?? "").trim();
  const limit = Math.max(1, Math.min(10000, Number(url.searchParams.get("limit") ?? 5000) || 5000));
  const window = resolveWindow(range, timezone);

  const store = new SqliteTraceStore();
  try {
    const facts = store.listRecentFacts(limit).filter((fact) => {
      const day = localDateKey(fact.createdAt, timezone);
      if (day < window.startDate || day > window.endDate) return false;
      if (factType !== "all" && fact.factType !== factType) return false;
      if (botId && fact.botId !== botId) return false;
      if (channel && fact.channel !== channel) return false;
      if (chatId && fact.chatId !== chatId) return false;
      if (sessionId && fact.sessionId !== sessionId) return false;
      if (runId && fact.runId !== runId) return false;
      return true;
    });
    const stats = buildStats(facts);

    return json({
      ok: true,
      trace: {
        timezone,
        generatedAt: new Date().toISOString(),
        range,
        window,
        filters: { factType, botId, channel, chatId, sessionId, runId, limit },
        sourceLimit: limit,
        facts: facts.slice(0, 200),
        ...stats
      }
    });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  } finally {
    store.close();
  }
};
