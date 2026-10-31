import assert from "node:assert/strict";
import test from "node:test";
import type { AiUsageRecord, UsageStatsResponse, UsageTotals } from "$lib/server/usage/tracker";
import { buildDesktopUsageSummary, desktopUsageFromRecords, sanitizeDesktopUsageQuery } from "./desktopUsage";

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
  { ts: "2026-06-28T08:00:00.000Z", channel: "web", botId: "alpha", provider: "anthropic", model: "claude-a", api: "messages", inputTokens: 100, outputTokens: 20, cacheReadTokens: 80, cacheWriteTokens: 0, totalTokens: 200, sessionId: "s-20260628-aaaa" },
  { ts: "2026-06-28T09:00:00.000Z", channel: "web", botId: "beta", provider: "openai", model: "gpt-b", api: "responses", inputTokens: 50, outputTokens: 30, cacheReadTokens: 0, cacheWriteTokens: 10, totalTokens: 90, sessionId: "s-20260628-bbbb" },
  { ts: "2026-06-27T08:00:00.000Z", channel: "feishu", botId: "alpha", provider: "anthropic", model: "claude-a", api: "messages", inputTokens: 70, outputTokens: 10, cacheReadTokens: 20, cacheWriteTokens: 0, totalTokens: 100, sessionId: "s-20260628-aaaa" },
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
    range: "today",
    modelId: "all",
    agentId: "all",
    botId: "alpha",
    channel: "all",
    page: 1,
    pageSize: 100
  });
});

test("usage ranks recorded Agents separately from Bots and keeps missing attribution explicit", () => {
  const stats = fixture();
  stats.records = stats.records.map((record, i) => ({ ...record, agentId: i === 0 ? "researcher" : undefined }));
  const summary = buildDesktopUsageSummary(stats, { range: "today" });
  assert.deepEqual(summary.rankings.agents.map(row => [row.id, row.totalTokens]), [["researcher", 200], ["unknown", 90]]);
  assert.equal(summary.rankings.bots[0].id, "alpha");
  assert.equal(summary.records.items[0].agentId, undefined);
  assert.equal(summary.records.items[1].agentId, "researcher");
});

test("one model using two APIs stays one model ranking while API totals remain separate", () => {
  const stats = fixture();
  stats.records = [records[0], { ...records[0], api: "responses" }];
  const summary = buildDesktopUsageSummary(stats, { range: "today" });
  assert.equal(summary.rankings.models.length, 1);
  assert.equal(summary.rankings.models[0].requests, 2);
  assert.equal(summary.rankings.models[0].totalTokens, 400);
  assert.equal(summary.rankings.apis.length, 2);
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

// Session-dimension accounting: only records carrying a conversation id group
// into the sessions ranking — non-session AI calls (telegram row) stay out.
test("buildDesktopUsageSummary ranks usage per session within the selected window", () => {
  const summary = buildDesktopUsageSummary(fixture(), { range: "last7Days", modelId: "all", botId: "all", channel: "all", page: 1, pageSize: 20 });

  assert.deepEqual(summary.rankings.sessions, [
    { id: "s-20260628-aaaa", label: "s-20260628-aaaa", requests: 2, inputTokens: 170, outputTokens: 30, cacheReadTokens: 100, cacheWriteTokens: 0, totalTokens: 300 },
    { id: "s-20260628-bbbb", label: "s-20260628-bbbb", requests: 1, inputTokens: 50, outputTokens: 30, cacheReadTokens: 0, cacheWriteTokens: 10, totalTokens: 90 }
  ]);

  const today = buildDesktopUsageSummary(fixture(), { range: "today", modelId: "all", botId: "all", channel: "all", page: 1, pageSize: 20 });
  assert.deepEqual(today.rankings.sessions.map((row) => row.id), ["s-20260628-aaaa", "s-20260628-bbbb"]);
});

test("activity covers a timezone-aligned year while cumulative totals include retained older records", () => {
  const sample = (ts: string, totalTokens: number, extra = {}) => ({ ...records[0], ts, totalTokens, ...extra });
  const summary = desktopUsageFromRecords([
    sample('2024-01-01T00:00:00Z', 900),
    sample('2026-06-26T16:30:00Z', 10),
    sample('2026-06-27T16:30:00Z', 20),
    sample('2026-06-27T17:30:00Z', 30),
    sample('2026-06-29T00:00:00Z', 1000)
  ], 'Asia/Shanghai', { range: 'today' }, new Date('2026-06-28T12:00:00Z'));
  assert.equal(summary.activity.days.length, 365);
  assert.equal(summary.activity.days.at(-1)?.date, '2026-06-28');
  assert.equal(summary.activity.days.at(-1)?.requests, 2);
  assert.equal(summary.activity.recordedTokens, 960);
  assert.equal(summary.activity.activeDays, 2);
  assert.equal(summary.activity.currentStreak, 2);
  assert.equal(summary.activity.longestStreak, 2);
  assert.equal(summary.activity.peakDailyTokens, 900);
  assert.equal(summary.activity.averageRequestsPerActiveDay, 1.5);
});

test("activity respects dimension filters, counts zero-token requests and leaves an empty ledger at zero", () => {
  const sample = { ...records[0], ts: '2026-06-27T10:00:00Z', totalTokens: 0, sessionId: undefined, appId: 'notes', channel: 'miniapp', agentId: 'research' };
  const now = new Date('2026-06-28T10:00:00Z');
  const summary = desktopUsageFromRecords([sample, { ...sample, agentId: 'other' }], 'UTC', { range: 'today', agentId: 'research' }, now);
  assert.equal(summary.totals.requests, 0);
  assert.equal(summary.activity.currentStreak, 1, 'yesterday keeps an ongoing streak until today ends');
  assert.equal(summary.activity.requests, 1);
  assert.equal(summary.activity.activeDays, 1);
  assert.equal(summary.activity.scenarios[0]?.id, 'miniapp');
  assert.equal(summary.activity.scenarios[0]?.requests, 1);
  const empty = desktopUsageFromRecords([], 'UTC', {}, now).activity;
  assert.equal(empty.currentStreak, 0);
  assert.equal(empty.longestStreak, 0);
  assert.equal(empty.averageRequestsPerActiveDay, 0);
  assert.equal(empty.coverageStart, null);
});

test("activity streaks cross leap days and frequency rankings sort by requests rather than tokens", () => {
  const base = { ...records[0], agentId: 'single', ts: '2024-02-28T12:00:00Z', totalTokens: 10000 };
  const summary = desktopUsageFromRecords([
    base,
    { ...base, ts: '2024-02-29T12:00:00Z', totalTokens: 1, channel: 'miniapp', appId: 'notes', agentId: 'frequent' },
    { ...base, ts: '2024-03-01T12:00:00Z', totalTokens: 1, channel: 'miniapp', appId: 'notes', agentId: 'frequent' }
  ], 'America/New_York', {}, new Date('2024-03-01T18:00:00Z'));
  assert.equal(summary.activity.days.length, 365);
  assert.equal(summary.activity.currentStreak, 3);
  assert.equal(summary.activity.longestStreak, 3);
  assert.deepEqual(summary.activity.scenarios.map(row => [row.id, row.requests]), [['miniapp', 2], ['conversation', 1]]);
  assert.equal(summary.activity.agents[0]?.id, 'frequent');
  assert.equal(summary.activity.channels[0]?.id, 'miniapp');
  assert.equal(summary.activity.scenarios.reduce((n, row) => n + row.requests, 0), summary.activity.requests);
});
