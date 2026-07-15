import type { TraceFactRecord } from "$lib/server/agent/hooks/traceStore.js";
import type {
  DesktopAgentActivityItem,
  DesktopSubagentActivityItem,
  DesktopTraceEntityRow,
  DesktopTraceFact,
  DesktopTraceFactType,
  DesktopTraceModelRow,
  DesktopTraceRange,
  DesktopTraceSkillRow,
  DesktopTraceSummary,
  DesktopTraceToolRow,
  DesktopTraceTotals
} from "$lib/shared/desktop";
import type { RuntimeSettings } from "$lib/server/settings/schema";

const KNOWN_RANGES: DesktopTraceRange[] = ["today", "yesterday", "last7Days", "last30Days"];
const KNOWN_FACT_TYPES: DesktopTraceFactType[] = ["all", "run", "model_call", "tool_call", "skill_usage", "subagent_task", "runtime_notice", "approval", "input_enrichment"];

export interface DesktopTraceQuery {
  range: DesktopTraceRange;
  factType: DesktopTraceFactType;
  botId: string;
  channel: string;
  chatId: string;
  sessionId: string;
  runId: string;
  sourceLimit: number;
  page: number;
  pageSize: number;
}

export function sanitizeDesktopTraceRange(input: unknown): DesktopTraceRange {
  const value = String(input ?? "").trim();
  return KNOWN_RANGES.includes(value as DesktopTraceRange) ? value as DesktopTraceRange : "today";
}

export function sanitizeDesktopTraceQuery(input: Partial<Record<keyof DesktopTraceQuery, unknown>>): DesktopTraceQuery {
  const factType = String(input.factType ?? "all").trim() as DesktopTraceFactType;
  return {
    range: sanitizeDesktopTraceRange(input.range),
    factType: KNOWN_FACT_TYPES.includes(factType) ? factType : "all",
    botId: String(input.botId ?? "").trim(),
    channel: String(input.channel ?? "").trim(),
    chatId: String(input.chatId ?? "").trim(),
    sessionId: String(input.sessionId ?? "").trim(),
    runId: String(input.runId ?? "").trim(),
    sourceLimit: Math.max(1000, Math.min(10000, Math.round(Number(input.sourceLimit) || 5000))),
    page: Math.max(1, Math.round(Number(input.page) || 1)),
    pageSize: Math.max(10, Math.min(100, Math.round(Number(input.pageSize) || 20)))
  };
}

function safeString(value: string | undefined, fallback = "unknown"): string {
  return String(value ?? "").trim() || fallback;
}

function localDateKey(value: string | Date, timeZone: string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function shiftDateKey(dateKey: string, deltaDays: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + deltaDays)).toISOString().slice(0, 10);
}

export function resolveDesktopTraceWindow(range: DesktopTraceRange, timeZone: string): { startDate: string; endDate: string } {
  const today = localDateKey(new Date(), timeZone);
  if (range === "today") return { startDate: today, endDate: today };
  if (range === "yesterday") {
    const yesterday = shiftDateKey(today, -1);
    return { startDate: yesterday, endDate: yesterday };
  }
  return { startDate: shiftDateKey(today, range === "last7Days" ? -6 : -29), endDate: today };
}

function averageDuration(facts: TraceFactRecord[]): number {
  const durations = facts.map((fact) => fact.durationMs).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return durations.length > 0 ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : 0;
}

function skillLevel(fact: TraceFactRecord): "triggered" | "loaded" | "executed" {
  const level = String(fact.payload?.level ?? "").trim();
  if (level === "executed") return "executed";
  if (level === "loaded") return "loaded";
  return "triggered";
}

export function computeDesktopTraceTotals(facts: TraceFactRecord[]): DesktopTraceTotals {
  const toolFacts = facts.filter((fact) => fact.factType === "tool_call");
  const modelFacts = facts.filter((fact) => fact.factType === "model_call");
  const skillFacts = facts.filter((fact) => fact.factType === "skill_usage");
  const executedToolFacts = toolFacts.filter((fact) => fact.status === "success" || fact.status === "error");
  return {
    facts: facts.length,
    toolCalls: toolFacts.length,
    executedToolCalls: executedToolFacts.length,
    modelCalls: modelFacts.length,
    distinctTools: new Set(toolFacts.map((fact) => safeString(fact.name))).size,
    skillUsages: skillFacts.length,
    executedSkills: skillFacts.filter((fact) => skillLevel(fact) === "executed").length,
    distinctSkills: new Set(skillFacts.map((fact) => safeString(fact.name))).size,
    bots: new Set(facts.map((fact) => safeString(fact.botId))).size,
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
}

function buildToolRows(facts: TraceFactRecord[]): DesktopTraceToolRow[] {
  const rows = new Map<string, DesktopTraceToolRow & { durationSum: number; durationCount: number }>();
  for (const fact of facts.filter((item) => item.factType === "tool_call")) {
    const name = safeString(fact.name);
    const row = rows.get(name) ?? { name, calls: 0, executedCalls: 0, success: 0, error: 0, blocked: 0, avgDurationMs: 0, durationSum: 0, durationCount: 0 };
    row.calls += 1;
    if (fact.status === "success" || fact.status === "error") row.executedCalls += 1;
    if (fact.status === "success") row.success += 1;
    if (fact.status === "error") row.error += 1;
    if (fact.status === "blocked") row.blocked += 1;
    if (typeof fact.durationMs === "number") { row.durationSum += fact.durationMs; row.durationCount += 1; }
    rows.set(name, row);
  }
  return [...rows.values()].map(({ durationSum, durationCount, ...row }) => ({ ...row, avgDurationMs: durationCount ? Math.round(durationSum / durationCount) : 0 })).sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name));
}

function buildSkillRows(facts: TraceFactRecord[]): DesktopTraceSkillRow[] {
  const rows = new Map<string, DesktopTraceSkillRow & { runIds: Set<string>; durationSum: number; durationCount: number }>();
  for (const fact of facts.filter((item) => item.factType === "skill_usage")) {
    const name = safeString(fact.name);
    const row = rows.get(name) ?? { name, scope: safeString(String(fact.payload?.scope ?? "")), calls: 0, triggered: 0, loaded: 0, executed: 0, runs: 0, avgDurationMs: 0, lastAt: fact.updatedAt, runIds: new Set(), durationSum: 0, durationCount: 0 };
    row.calls += 1;
    row[skillLevel(fact)] += 1;
    row.runIds.add(fact.runId);
    if (typeof fact.durationMs === "number") { row.durationSum += fact.durationMs; row.durationCount += 1; }
    if (fact.updatedAt > row.lastAt) row.lastAt = fact.updatedAt;
    rows.set(name, row);
  }
  return [...rows.values()].map(({ runIds, durationSum, durationCount, ...row }) => ({ ...row, runs: runIds.size, avgDurationMs: durationCount ? Math.round(durationSum / durationCount) : 0 })).sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name));
}

function buildModelRows(facts: TraceFactRecord[]): DesktopTraceModelRow[] {
  const rows = new Map<string, DesktopTraceModelRow & { durationSum: number; durationCount: number }>();
  for (const fact of facts.filter((item) => item.factType === "model_call")) {
    const provider = safeString(fact.provider);
    const model = safeString(fact.model);
    const api = safeString(fact.api);
    const id = `${provider}::${model}::${api}`;
    const row = rows.get(id) ?? { id, provider, model, api, requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, avgDurationMs: 0, durationSum: 0, durationCount: 0 };
    row.requests += 1;
    row.inputTokens += fact.inputTokens ?? 0;
    row.outputTokens += fact.outputTokens ?? 0;
    row.cacheReadTokens += fact.cacheReadTokens ?? 0;
    row.cacheWriteTokens += fact.cacheWriteTokens ?? 0;
    row.totalTokens += fact.totalTokens ?? 0;
    if (typeof fact.durationMs === "number") { row.durationSum += fact.durationMs; row.durationCount += 1; }
    rows.set(id, row);
  }
  return [...rows.values()].map(({ durationSum, durationCount, ...row }) => ({ ...row, avgDurationMs: durationCount ? Math.round(durationSum / durationCount) : 0 })).sort((a, b) => b.requests - a.requests || a.model.localeCompare(b.model));
}

type EntityAccumulator = DesktopTraceEntityRow & { runIds: Set<string>; tools: Set<string> };

function buildEntityRows(facts: TraceFactRecord[], kind: "bot" | "chat" | "session" | "run"): DesktopTraceEntityRow[] {
  const rows = new Map<string, EntityAccumulator>();
  for (const fact of facts) {
    const id = kind === "bot" ? safeString(fact.botId) : kind === "chat" ? `${fact.channel}:${fact.chatId}` : kind === "session" ? fact.sessionId : fact.runId;
    const label = kind === "chat" ? fact.chatId : id;
    const secondary = kind === "bot" ? fact.channel : kind === "chat" ? fact.channel : kind === "run" ? fact.sessionId : "";
    const row = rows.get(id) ?? { id, label, secondary, runs: 0, toolCalls: 0, modelCalls: 0, distinctTools: 0, totalTokens: 0, lastAt: fact.updatedAt, runIds: new Set(), tools: new Set() };
    row.runIds.add(fact.runId);
    if (fact.factType === "tool_call") { row.toolCalls += 1; row.tools.add(safeString(fact.name)); }
    if (fact.factType === "model_call") { row.modelCalls += 1; row.totalTokens += fact.totalTokens ?? 0; }
    if (fact.updatedAt > row.lastAt) row.lastAt = fact.updatedAt;
    rows.set(id, row);
  }
  return [...rows.values()].map(({ runIds, tools, ...row }) => ({ ...row, runs: runIds.size, distinctTools: tools.size })).sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

function projectFact(fact: TraceFactRecord): DesktopTraceFact {
  return {
    id: fact.id,
    factType: fact.factType,
    runId: fact.runId,
    channel: fact.channel,
    botId: safeString(fact.botId),
    chatId: fact.chatId,
    sessionId: fact.sessionId,
    name: safeString(fact.name, ""),
    provider: safeString(fact.provider, ""),
    model: safeString(fact.model, ""),
    api: safeString(fact.api, ""),
    status: fact.status,
    durationMs: fact.durationMs ?? 0,
    inputTokens: fact.inputTokens ?? 0,
    outputTokens: fact.outputTokens ?? 0,
    cacheReadTokens: fact.cacheReadTokens ?? 0,
    cacheWriteTokens: fact.cacheWriteTokens ?? 0,
    totalTokens: fact.totalTokens ?? 0,
    updatedAt: fact.updatedAt
  };
}

export function buildDesktopTraceSummary(timeZone: string, rawQuery: Partial<DesktopTraceQuery>, sourceFacts: TraceFactRecord[]): DesktopTraceSummary {
  const query = sanitizeDesktopTraceQuery(rawQuery);
  const window = resolveDesktopTraceWindow(query.range, timeZone);
  const windowFacts = sourceFacts.filter((fact) => {
    const day = localDateKey(fact.createdAt, timeZone);
    return day >= window.startDate && day <= window.endDate;
  });
  const filtered = windowFacts.filter((fact) => {
    if (query.factType !== "all" && fact.factType !== query.factType) return false;
    if (query.botId && fact.botId !== query.botId) return false;
    if (query.channel && fact.channel !== query.channel) return false;
    if (query.chatId && fact.chatId !== query.chatId) return false;
    if (query.sessionId && fact.sessionId !== query.sessionId) return false;
    if (query.runId && fact.runId !== query.runId) return false;
    return true;
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const start = (query.page - 1) * query.pageSize;
  return {
    timezone: timeZone,
    generatedAt: new Date().toISOString(),
    range: query.range,
    window,
    filters: { factType: query.factType, botId: query.botId, channel: query.channel, chatId: query.chatId, sessionId: query.sessionId, runId: query.runId, sourceLimit: query.sourceLimit },
    options: {
      bots: [...new Set(windowFacts.map((fact) => safeString(fact.botId)))].sort(),
      channels: [...new Set(windowFacts.map((fact) => fact.channel))].sort()
    },
    totals: computeDesktopTraceTotals(filtered),
    rankings: {
      tools: buildToolRows(filtered),
      skills: buildSkillRows(filtered),
      models: buildModelRows(filtered),
      bots: buildEntityRows(filtered, "bot"),
      chats: buildEntityRows(filtered, "chat"),
      sessions: buildEntityRows(filtered, "session"),
      runs: buildEntityRows(filtered, "run")
    },
    facts: { items: filtered.slice(start, start + query.pageSize).map(projectFact), total: filtered.length, page: query.page, pageSize: query.pageSize }
  };
}

const TERMINAL_ACTIVITY_WINDOW_MS = 10_000;
const ACTIVE_ACTIVITY_STALE_MS = 12 * 60_000;

export function buildDesktopAgentActivity(settings: RuntimeSettings, facts: TraceFactRecord[], nowMs = Date.now()): DesktopAgentActivityItem[] {
  const botDetails = new Map<string, { agentId: string; name: string }>();
  for (const [channel, group] of Object.entries(settings.channels ?? {})) {
    for (const instance of group.instances ?? []) {
      const agentId = String(instance.agentId ?? "").trim() || "default";
      botDetails.set(`${channel}:${instance.id}`, { agentId, name: instance.name || instance.id });
    }
  }
  const latestByAgent = new Map<string, DesktopAgentActivityItem>();
  const runs = facts.filter((fact) => fact.factType === "run" && fact.botId).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  for (const fact of runs) {
    const bot = botDetails.get(`${fact.channel}:${fact.botId}`);
    const agentId = bot?.agentId ?? "default";
    if (!agentId || latestByAgent.has(agentId)) continue;
    const terminal = fact.status !== "started" && fact.status !== "waiting";
    const finishedAt = fact.finishedAt ?? fact.updatedAt;
    if (terminal && nowMs - Date.parse(finishedAt) > TERMINAL_ACTIVITY_WINDOW_MS) continue;
    if (!terminal) {
      const latestRunUpdate = facts.reduce((latest, candidate) => candidate.runId === fact.runId ? Math.max(latest, Date.parse(candidate.updatedAt)) : latest, Date.parse(fact.updatedAt));
      if (!Number.isFinite(latestRunUpdate) || nowMs - latestRunUpdate > ACTIVE_ACTIVITY_STALE_MS) continue;
    }
    const subagents: DesktopSubagentActivityItem[] = facts.filter((candidate) => candidate.factType === "subagent_task" && candidate.runId === fact.runId).flatMap((candidate) => {
      const subagentTerminal = candidate.status !== "started" && candidate.status !== "waiting";
      const subagentFinishedAt = candidate.finishedAt ?? candidate.updatedAt;
      if (subagentTerminal && nowMs - Date.parse(subagentFinishedAt) > TERMINAL_ACTIVITY_WINDOW_MS) return [];
      return [{
        id: candidate.factId,
        name: candidate.name || "subagent",
        status: candidate.status === "started" || candidate.status === "waiting" ? "working" as const : candidate.status === "success" ? "completed" as const : "error" as const,
        startedAt: candidate.startedAt ?? candidate.createdAt,
        finishedAt: subagentTerminal ? subagentFinishedAt : ""
      }];
    });
    latestByAgent.set(agentId, {
      agentId,
      status: fact.status === "started" || fact.status === "waiting" ? "working" : fact.status === "success" ? "completed" : "error",
      runId: fact.runId,
      channel: fact.channel,
      botId: fact.botId ?? "",
      botName: bot?.name || fact.botId || "",
      taskPreview: typeof fact.payload.taskPreview === "string" ? fact.payload.taskPreview : "",
      startedAt: fact.startedAt ?? fact.createdAt,
      finishedAt: terminal ? finishedAt : "",
      subagents
    });
  }
  return [...latestByAgent.values()];
}
