import type { AiUsageRecord, UsageStatsResponse } from "$lib/server/usage/tracker";
import type {
  DesktopUsageDailyPoint,
  DesktopUsageDimensionRow,
  DesktopUsageModelRow,
  DesktopUsageRange,
  DesktopUsageRecord,
  DesktopUsageSummary,
  DesktopUsageTotals,
  DesktopUsageTrendPoint,
  DesktopUsageWindow
} from "$lib/shared/desktop";

const WINDOW_LABELS: DesktopUsageRange[] = ["today", "yesterday", "last7Days", "last30Days"];

export interface DesktopUsageQuery {
  range: DesktopUsageRange;
  modelId: string;
  botId: string;
  channel: string;
  page: number;
  pageSize: number;
}

export function sanitizeDesktopUsageRange(input: unknown): DesktopUsageRange {
  const value = String(input ?? "").trim();
  return WINDOW_LABELS.includes(value as DesktopUsageRange) ? value as DesktopUsageRange : "last30Days";
}

export function sanitizeDesktopUsageQuery(input: Partial<Record<keyof DesktopUsageQuery, unknown>>): DesktopUsageQuery {
  return {
    range: sanitizeDesktopUsageRange(input.range),
    modelId: String(input.modelId ?? "all").trim() || "all",
    botId: String(input.botId ?? "all").trim() || "all",
    channel: String(input.channel ?? "all").trim() || "all",
    page: Math.max(1, Math.round(Number(input.page) || 1)),
    pageSize: Math.max(10, Math.min(100, Math.round(Number(input.pageSize) || 20)))
  };
}

function emptyTotals(): DesktopUsageTotals {
  return { requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 };
}

function addRecord(target: DesktopUsageTotals, record: AiUsageRecord): void {
  target.requests += 1;
  target.inputTokens += record.inputTokens;
  target.outputTokens += record.outputTokens;
  target.cacheReadTokens += record.cacheReadTokens;
  target.cacheWriteTokens += record.cacheWriteTokens;
  target.totalTokens += record.totalTokens;
}

function summarize(records: AiUsageRecord[]): DesktopUsageTotals {
  const totals = emptyTotals();
  for (const record of records) addRecord(totals, record);
  return totals;
}

function localDateKey(value: string | Date, timeZone: string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function localHour(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", hourCycle: "h23", hour12: false }).format(new Date(value));
}

function shiftDateKey(dateKey: string, deltaDays: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + deltaDays)).toISOString().slice(0, 10);
}

function dateRange(startDate: string, endDate: string): string[] {
  const keys: string[] = [];
  for (let cursor = startDate; cursor <= endDate; cursor = shiftDateKey(cursor, 1)) keys.push(cursor);
  return keys;
}

function modelId(record: AiUsageRecord): string {
  return `${record.provider}::${record.model}`;
}

function passesDimensions(record: AiUsageRecord, query: DesktopUsageQuery): boolean {
  if (query.modelId !== "all" && modelId(record) !== query.modelId) return false;
  if (query.botId !== "all" && record.botId !== query.botId) return false;
  if (query.channel !== "all" && record.channel !== query.channel) return false;
  return true;
}

function recordsInWindow(records: AiUsageRecord[], startDate: string, endDate: string, timeZone: string): AiUsageRecord[] {
  return records.filter((record) => {
    const day = localDateKey(record.ts, timeZone);
    return day >= startDate && day <= endDate;
  });
}

function buildTrend(records: AiUsageRecord[], startDate: string, endDate: string, timeZone: string, range: DesktopUsageRange): DesktopUsageTrendPoint[] {
  const hourly = range === "today" || range === "yesterday";
  const points = new Map<string, DesktopUsageTrendPoint>();
  if (hourly) {
    for (let hour = 0; hour < 24; hour += 1) {
      const hh = String(hour).padStart(2, "0");
      points.set(`${startDate} ${hh}`, { key: `${startDate} ${hh}`, label: `${hh}:00`, ...emptyTotals() });
    }
  } else {
    for (const day of dateRange(startDate, endDate)) points.set(day, { key: day, label: day.slice(5), ...emptyTotals() });
  }
  for (const record of records) {
    const day = localDateKey(record.ts, timeZone);
    const key = hourly ? `${day} ${localHour(record.ts, timeZone)}` : day;
    const point = points.get(key);
    if (point) addRecord(point, record);
  }
  return [...points.values()];
}

function rankedDimensions(records: AiUsageRecord[], getValue: (record: AiUsageRecord) => string): DesktopUsageDimensionRow[] {
  const rows = new Map<string, DesktopUsageDimensionRow>();
  for (const record of records) {
    const value = getValue(record) || "unknown";
    const row = rows.get(value) ?? { id: value, label: value, ...emptyTotals() };
    addRecord(row, record);
    rows.set(value, row);
  }
  return [...rows.values()].sort((a, b) => b.totalTokens - a.totalTokens || a.label.localeCompare(b.label));
}

function rankedModels(records: AiUsageRecord[]): DesktopUsageModelRow[] {
  const rows = new Map<string, DesktopUsageModelRow>();
  for (const record of records) {
    const id = `${record.provider}::${record.model}::${record.api}`;
    const row = rows.get(id) ?? { id, provider: record.provider, model: record.model, api: record.api, ...emptyTotals() };
    addRecord(row, record);
    rows.set(id, row);
  }
  return [...rows.values()].sort((a, b) => b.totalTokens - a.totalTokens || a.model.localeCompare(b.model));
}

function projectRecord(record: AiUsageRecord): DesktopUsageRecord {
  return {
    ts: record.ts,
    channel: record.channel,
    botId: record.botId || "unknown",
    provider: record.provider,
    model: record.model,
    api: record.api,
    requests: 1,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    cacheReadTokens: record.cacheReadTokens,
    cacheWriteTokens: record.cacheWriteTokens,
    totalTokens: record.totalTokens
  };
}

export function buildDesktopUsageSummary(stats: UsageStatsResponse, rawQuery: Partial<DesktopUsageQuery> = {}): DesktopUsageSummary {
  const query = sanitizeDesktopUsageQuery(rawQuery);
  const dimensionRecords = stats.records.filter((record) => passesDimensions(record, query));
  const selectedWindow = stats.windows[query.range];
  const filtered = recordsInWindow(dimensionRecords, selectedWindow.startDate, selectedWindow.endDate, stats.timezone)
    .sort((a, b) => b.ts.localeCompare(a.ts));
  const windows: DesktopUsageWindow[] = WINDOW_LABELS.map((label) => {
    const window = stats.windows[label];
    return { label, startDate: window.startDate, endDate: window.endDate, ...summarize(recordsInWindow(dimensionRecords, window.startDate, window.endDate, stats.timezone)) };
  });
  const dailyWindow = stats.windows.last30Days;
  const dailyMap = new Map<string, DesktopUsageDailyPoint>();
  for (const day of dateRange(dailyWindow.startDate, dailyWindow.endDate)) dailyMap.set(day, { date: day, ...emptyTotals() });
  for (const record of recordsInWindow(dimensionRecords, dailyWindow.startDate, dailyWindow.endDate, stats.timezone)) {
    const point = dailyMap.get(localDateKey(record.ts, stats.timezone));
    if (point) addRecord(point, record);
  }
  const start = (query.page - 1) * query.pageSize;
  const models = new Map(stats.records.map((record) => [modelId(record), `${record.provider} / ${record.model}`]));

  return {
    timezone: stats.timezone,
    generatedAt: stats.generatedAt,
    range: query.range,
    window: { startDate: selectedWindow.startDate, endDate: selectedWindow.endDate },
    filters: { modelId: query.modelId, botId: query.botId, channel: query.channel },
    options: {
      models: [...models].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label)),
      bots: [...new Set(stats.records.map((record) => record.botId || "unknown"))].sort(),
      channels: [...new Set(stats.records.map((record) => record.channel || "unknown"))].sort()
    },
    totals: summarize(filtered),
    windows,
    daily: [...dailyMap.values()],
    trend: buildTrend(filtered, selectedWindow.startDate, selectedWindow.endDate, stats.timezone, query.range),
    rankings: {
      models: rankedModels(filtered),
      apis: rankedDimensions(filtered, (record) => record.api),
      bots: rankedDimensions(filtered, (record) => record.botId),
      channels: rankedDimensions(filtered, (record) => record.channel)
    },
    records: { items: filtered.slice(start, start + query.pageSize).map(projectRecord), total: filtered.length, page: query.page, pageSize: query.pageSize }
  };
}
