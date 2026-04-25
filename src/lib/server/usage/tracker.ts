import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { storagePaths } from "../infra/db/storage.js";

export interface AiUsageRecord {
  ts: string;
  channel: string;
  botId: string;
  provider: string;
  model: string;
  api: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
}

export interface UsageTotals {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
}

interface BucketSummary {
  bucket: string;
  startDate?: string;
  endDate?: string;
  totals: UsageTotals;
  models: ModelUsageSummary[];
  bots: BotUsageSummary[];
}

interface ModelUsageSummary extends UsageTotals {
  provider: string;
  model: string;
  api: string;
}

interface WindowSummary {
  startDate: string;
  endDate: string;
  totals: UsageTotals;
  models: ModelUsageSummary[];
  bots: BotUsageSummary[];
}

interface BotUsageSummary extends UsageTotals {
  botId: string;
}

export interface UsageStatsResponse {
  timezone: string;
  generatedAt: string;
  records: AiUsageRecord[];
  totals: UsageTotals;
  windows: {
    today: WindowSummary;
    yesterday: WindowSummary;
    last7Days: WindowSummary;
    last30Days: WindowSummary;
  };
  breakdowns: {
    daily: BucketSummary[];
    weekly: BucketSummary[];
    monthly: BucketSummary[];
  };
}

function emptyTotals(): UsageTotals {
  return {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0
  };
}

function addTotals(target: UsageTotals, record: Pick<AiUsageRecord, "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens" | "totalTokens">): void {
  target.requests += 1;
  target.inputTokens += record.inputTokens;
  target.outputTokens += record.outputTokens;
  target.cacheReadTokens += record.cacheReadTokens;
  target.cacheWriteTokens += record.cacheWriteTokens;
  target.totalTokens += record.totalTokens;
}

function toInt(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

function localDateParts(date: Date, timeZone: string): { year: number; month: number; day: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = fmt.formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value ?? "0");
  const month = Number(parts.find((part) => part.type === "month")?.value ?? "0");
  const day = Number(parts.find((part) => part.type === "day")?.value ?? "0");
  return { year, month, day };
}

function dateKeyFromParts(parts: { year: number; month: number; day: number }): string {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function localDateKey(date: Date, timeZone: string): string {
  return dateKeyFromParts(localDateParts(date, timeZone));
}

function shiftDateKey(dateKey: string, deltaDays: number): string {
  const [year, month, day] = dateKey.split("-").map((value) => Number(value));
  const shifted = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return shifted.toISOString().slice(0, 10);
}

function buildDateRange(endDate: string, days: number): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    out.push(shiftDateKey(endDate, -i));
  }
  return out;
}

function isoWeekStart(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map((value) => Number(value));
  const current = new Date(Date.UTC(year, month - 1, day));
  const weekday = current.getUTCDay();
  const diff = weekday === 0 ? -6 : 1 - weekday;
  current.setUTCDate(current.getUTCDate() + diff);
  return current.toISOString().slice(0, 10);
}

function monthKey(dateKey: string): string {
  return dateKey.slice(0, 7);
}

function summarizeRecords(records: AiUsageRecord[]): { totals: UsageTotals; models: ModelUsageSummary[]; bots: BotUsageSummary[] } {
  const totals = emptyTotals();
  const modelMap = new Map<string, ModelUsageSummary>();
  const botMap = new Map<string, BotUsageSummary>();

  for (const record of records) {
    addTotals(totals, record);
    const key = `${record.provider}::${record.model}::${record.api}`;
    let row = modelMap.get(key);
    if (!row) {
      row = {
        provider: record.provider,
        model: record.model,
        api: record.api,
        ...emptyTotals()
      };
      modelMap.set(key, row);
    }
    addTotals(row, record);

    const normalizedBotId = String(record.botId ?? "").trim() || "unknown";
    let botRow = botMap.get(normalizedBotId);
    if (!botRow) {
      botRow = {
        botId: normalizedBotId,
        ...emptyTotals()
      };
      botMap.set(normalizedBotId, botRow);
    }
    addTotals(botRow, record);
  }

  const models = Array.from(modelMap.values()).sort((a, b) => {
    if (b.totalTokens !== a.totalTokens) return b.totalTokens - a.totalTokens;
    return `${a.provider}/${a.model}`.localeCompare(`${b.provider}/${b.model}`);
  });

  const bots = Array.from(botMap.values()).sort((a, b) => {
    if (b.totalTokens !== a.totalTokens) return b.totalTokens - a.totalTokens;
    return a.botId.localeCompare(b.botId);
  });

  return { totals, models, bots };
}

function bucketize(
  records: AiUsageRecord[],
  keys: string[],
  getBucket: (record: AiUsageRecord) => string,
  meta?: (bucket: string) => { startDate?: string; endDate?: string }
): BucketSummary[] {
  const grouped = new Map<string, AiUsageRecord[]>();
  for (const key of keys) {
    grouped.set(key, []);
  }
  for (const record of records) {
    const bucket = getBucket(record);
    if (!grouped.has(bucket)) grouped.set(bucket, []);
    grouped.get(bucket)?.push(record);
  }

  return Array.from(grouped.entries()).map(([bucket, bucketRecords]) => {
    const summary = summarizeRecords(bucketRecords);
    const info = meta ? meta(bucket) : {};
    return {
      bucket,
      startDate: info.startDate,
      endDate: info.endDate,
      totals: summary.totals,
      models: summary.models,
      bots: summary.bots
    };
  });
}

export class AiUsageTracker {
  private readonly usageDir: string;
  private readonly usageFile: string;

  constructor() {
    this.usageDir = path.join(storagePaths.dataDir, "usage");
    this.usageFile = path.join(this.usageDir, "ai-usage.jsonl");
  }

  record(input: {
    channel: string;
    botId?: string;
    provider: string;
    model: string;
    api?: string;
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    totalTokens?: number;
  }): void {
    const record: AiUsageRecord = {
      ts: new Date().toISOString(),
      channel: String(input.channel ?? "").trim() || "unknown",
      botId: String(input.botId ?? "").trim() || "unknown",
      provider: String(input.provider ?? "").trim() || "unknown",
      model: String(input.model ?? "").trim() || "unknown",
      api: String(input.api ?? "").trim() || "unknown",
      inputTokens: toInt(input.inputTokens),
      outputTokens: toInt(input.outputTokens),
      cacheReadTokens: toInt(input.cacheReadTokens),
      cacheWriteTokens: toInt(input.cacheWriteTokens),
      totalTokens: toInt(input.totalTokens)
    };

    if (record.totalTokens === 0) {
      record.totalTokens =
        record.inputTokens +
        record.outputTokens +
        record.cacheReadTokens +
        record.cacheWriteTokens;
    }

    mkdirSync(this.usageDir, { recursive: true });
    appendFileSync(this.usageFile, `${JSON.stringify(record)}\n`, "utf8");
  }

  list(): AiUsageRecord[] {
    if (!existsSync(this.usageFile)) return [];
    const raw = readFileSync(this.usageFile, "utf8");
    const rows = raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    const out: AiUsageRecord[] = [];
    for (const line of rows) {
      try {
        const parsed = JSON.parse(line) as Partial<AiUsageRecord>;
        if (!parsed.ts || !parsed.provider || !parsed.model) continue;
        out.push({
          ts: String(parsed.ts),
          channel: String(parsed.channel ?? "unknown"),
          botId: String((parsed as { botId?: string }).botId ?? "unknown"),
          provider: String(parsed.provider),
          model: String(parsed.model),
          api: String(parsed.api ?? "unknown"),
          inputTokens: toInt(parsed.inputTokens),
          outputTokens: toInt(parsed.outputTokens),
          cacheReadTokens: toInt(parsed.cacheReadTokens),
          cacheWriteTokens: toInt(parsed.cacheWriteTokens),
          totalTokens: toInt(parsed.totalTokens)
        });
      } catch {
        // ignore malformed lines
      }
    }
    return out.sort((a, b) => a.ts.localeCompare(b.ts));
  }

  getStats(timeZone: string): UsageStatsResponse {
    const records = this.list();
    const enriched = records.map((record) => ({
      ...record,
      localDate: localDateKey(new Date(record.ts), timeZone)
    }));

    const today = localDateKey(new Date(), timeZone);
    const yesterday = shiftDateKey(today, -1);
    const last7Keys = buildDateRange(today, 7);
    const last30Keys = buildDateRange(today, 30);

    const allSummary = summarizeRecords(records);

    const byDate = (keys: string[]): AiUsageRecord[] => {
      const allowed = new Set(keys);
      return enriched.filter((record) => allowed.has(record.localDate)).map(({ localDate: _localDate, ...record }) => record);
    };

    const todaySummary = summarizeRecords(byDate([today]));
    const yesterdaySummary = summarizeRecords(byDate([yesterday]));
    const last7Summary = summarizeRecords(byDate(last7Keys));
    const last30Summary = summarizeRecords(byDate(last30Keys));

    const daily = bucketize(records, last30Keys, (record) => localDateKey(new Date(record.ts), timeZone));

    const weekKeys = Array.from(new Set(last30Keys.map((key) => isoWeekStart(key))));
    const weekly = bucketize(
      records.filter((record) => last30Keys.includes(localDateKey(new Date(record.ts), timeZone))),
      weekKeys,
      (record) => isoWeekStart(localDateKey(new Date(record.ts), timeZone)),
      (bucket) => ({ startDate: bucket, endDate: shiftDateKey(bucket, 6) })
    );

    const monthKeys = Array.from(new Set(last30Keys.map((key) => monthKey(key))));
    const monthly = bucketize(
      records.filter((record) => last30Keys.includes(localDateKey(new Date(record.ts), timeZone))),
      monthKeys,
      (record) => monthKey(localDateKey(new Date(record.ts), timeZone))
    );

    return {
      timezone: timeZone,
      generatedAt: new Date().toISOString(),
      records: byDate(last30Keys),
      totals: allSummary.totals,
      windows: {
        today: {
          startDate: today,
          endDate: today,
          totals: todaySummary.totals,
          models: todaySummary.models,
          bots: todaySummary.bots
        },
        yesterday: {
          startDate: yesterday,
          endDate: yesterday,
          totals: yesterdaySummary.totals,
          models: yesterdaySummary.models,
          bots: yesterdaySummary.bots
        },
        last7Days: {
          startDate: last7Keys[0],
          endDate: last7Keys[last7Keys.length - 1],
          totals: last7Summary.totals,
          models: last7Summary.models,
          bots: last7Summary.bots
        },
        last30Days: {
          startDate: last30Keys[0],
          endDate: last30Keys[last30Keys.length - 1],
          totals: last30Summary.totals,
          models: last30Summary.models,
          bots: last30Summary.bots
        }
      },
      breakdowns: {
        daily,
        weekly,
        monthly
      }
    };
  }
}
