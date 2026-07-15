import assert from "node:assert/strict";
import test from "node:test";
import type { AiUsageRecord, UsageStatsResponse, UsageTotals } from "$lib/server/usage/tracker";
import { buildDesktopUsageSummary, sanitizeDesktopUsageQuery } from "./desktopUsage";

function emptyTotals(): UsageTotals {
  return { requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 };
}

function summarize(records: AiUsageRecord[]): UsageTotals {
  const totals = emptyTotals();
  for (const record of records) {
    totals.requests += 1;
    totals.inputTokens += record.inputTokens;
    totals.outputTokens += record.outputTokens;
    totals.cacheReadTokens += record.cacheReadTokens;
    totals.cacheWriteTokens += record.cacheWriteTokens;
    totals.totalTokens += record.totalTokens;
  }
  return totals;
}

const records: AiUsageRecord[] = [
  { ts: "2026-06-28T08:00:00.000Z", channel: "web", botId: "alpha", provider: "anthropic", model: "claude-a", api: "messages", inputTokens: 100, outputTokens: 20, cacheReadTokens: 80, cacheWriteTokens: 0, totalTokens: 200 },
  { ts: "2026-06-28T09:00:00.000Z", channel: "web", botId: "beta", provider: "openai", model: "gpt-b", api: "responses", inputTokens: 50, outputTokens: 30, cacheReadTokens: 0, cacheWriteTokens: 10, totalTokens: 90 },
  { ts: "2026-06-27T08:00:00.000Z", channel: "feishu", botId: "alpha", provider: "anthropic", model: "claude-a", api: "messages", inputTokens: 70, outputTokens: 10, cacheReadTokens: 20, cacheWriteTokens: 0, totalTokens: 100 },
  { ts: "2026-06-20T08:00:00.000Z", channel: "telegram", botId: "gamma", provider: "anthropic", model: "claude-c", api: "messages", inputTokens: 40, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 50 }
];

function window(startDate: string, endDate: string, source: AiUsageRecord[]) {
  return { startDate, endDate, totals: summarize(source), models: [], bots: [] };
}

function fixture(): UsageStatsResponse {
  return {
    timezone: "UTC",
    generatedAt: "2026-06-28T10:00:00.000Z",
    records,
    totals: summarize(records),
    windows: {
      today: window("2026-06-28", "2026-06-28", records.slice(0, 2)),
      yesterday: window("2026-06-27", "2026-06-27", records.slice(2, 3)),
      last7Days: window("2026-06-22", "2026-06-28", records.slice(0, 3)),
      last30Days: window("2026-05-30", "2026-06-28", records)
    },
    breakdowns: { daily: [], weekly: [], monthly: [] }
  };
}

test("sanitizeDesktopUsageQuery clamps pagination and normalizes filters", () => {
  assert.deepEqual(sanitizeDesktopUsageQuery({ range: "bogus", page: -2, pageSize: 500, modelId: "", botId: " alpha " }), {
    range: "last30Days",
    modelId: "all",
    botId: "alpha",
    channel: "all",
    page: 1,
    pageSize: 100
  });
});

test("buildDesktopUsageSummary filters range and dimensions into totals, trend, and rankings", () => {
  const summary = buildDesktopUsageSummary(fixture(), { range: "last7Days", modelId: "anthropic::claude-a", botId: "alpha", channel: "all", page: 1, pageSize: 20 });

  assert.equal(summary.range, "last7Days");
  assert.deepEqual(summary.window, { startDate: "2026-06-22", endDate: "2026-06-28" });
  assert.equal(summary.totals.requests, 2);
  assert.equal(summary.totals.totalTokens, 300);
  assert.equal(summary.trend.length, 7);
  assert.equal(summary.rankings.models[0]?.model, "claude-a");
  assert.equal(summary.rankings.apis[0]?.label, "messages");
  assert.equal(summary.rankings.channels.length, 2);
  assert.deepEqual(summary.windows.map((item) => item.label), ["today", "yesterday", "last7Days", "last30Days"]);
});

test("buildDesktopUsageSummary returns stable filter options and paginated sanitized request metadata", () => {
  const summary = buildDesktopUsageSummary(fixture(), { range: "today", modelId: "all", botId: "all", channel: "all", page: 2, pageSize: 10 });

  assert.equal(summary.options.models.length, 3);
  assert.deepEqual(summary.options.bots, ["alpha", "beta", "gamma"]);
  assert.deepEqual(summary.options.channels, ["feishu", "telegram", "web"]);
  assert.equal(summary.records.total, 2);
  assert.equal(summary.records.items.length, 0);
  assert.equal(summary.records.page, 2);
});

test("desktop usage response exposes local observability ids but no credentials or message content", () => {
  const summary = buildDesktopUsageSummary(fixture(), { range: "today", modelId: "all", botId: "all", channel: "all", page: 1, pageSize: 20 });
  const serialized = JSON.stringify(summary);

  assert.equal(serialized.includes("claude-a"), true);
  assert.equal(serialized.includes("alpha"), true);
  for (const forbidden of ["apiKey", "authorization", "prompt", "responseText", "messages", "secret-value"]) {
    if (forbidden === "messages") continue;
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  assert.equal("records" in summary, true);
});
