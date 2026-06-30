import assert from "node:assert/strict";
import test from "node:test";
import type { UsageStatsResponse } from "$lib/server/usage/tracker";
import { buildDesktopUsageSummary } from "./desktopUsage";

function totals(requests: number, tokens: number): UsageStatsResponse["totals"] {
  return {
    requests,
    inputTokens: tokens,
    outputTokens: tokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: tokens * 2
  };
}

function fixture(): UsageStatsResponse {
  return {
    timezone: "Asia/Shanghai",
    generatedAt: "2026-06-28T00:00:00.000Z",
    records: [
      { ts: "2026-06-28T00:00:00.000Z", channel: "web", botId: "default", provider: "private", model: "private-model", api: "chat", inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 15 }
    ],
    totals: totals(100, 500),
    windows: {
      today: { startDate: "2026-06-28", endDate: "2026-06-28", totals: totals(10, 50), models: [], bots: [] },
      yesterday: { startDate: "2026-06-27", endDate: "2026-06-27", totals: totals(5, 25), models: [], bots: [] },
      last7Days: { startDate: "2026-06-22", endDate: "2026-06-28", totals: totals(40, 200), models: [], bots: [] },
      last30Days: { startDate: "2026-05-30", endDate: "2026-06-28", totals: totals(100, 500), models: [], bots: [] }
    },
    breakdowns: { daily: [], weekly: [], monthly: [] }
  };
}

test("buildDesktopUsageSummary maps totals and the four time windows in order", () => {
  const summary = buildDesktopUsageSummary(fixture());

  assert.equal(summary.timezone, "Asia/Shanghai");
  assert.equal(summary.totals.requests, 100);
  assert.equal(summary.totals.totalTokens, 1000);

  assert.deepEqual(
    summary.windows.map((window) => window.label),
    ["today", "yesterday", "last7Days", "last30Days"]
  );
  assert.equal(summary.windows[0].requests, 10);
  assert.equal(summary.windows[3].startDate, "2026-05-30");
});

test("buildDesktopUsageSummary drops per-model, per-bot breakdowns and raw records", () => {
  const summary = buildDesktopUsageSummary(fixture());
  const serialized = JSON.stringify(summary);

  // Aggregate totals and window labels are kept.
  assert.equal(serialized.includes("totalTokens"), true);
  assert.equal(serialized.includes("last7Days"), true);
  // Provider/model names, bot ids, and raw records must not leak.
  assert.equal(serialized.includes("private-model"), false);
  assert.equal(serialized.includes('"botId"'), false);
  assert.equal(serialized.includes('"records"'), false);
  assert.equal(serialized.includes("breakdowns"), false);
});
