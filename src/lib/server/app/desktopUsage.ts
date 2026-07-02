import type { UsageStatsResponse } from "$lib/server/usage/tracker";
import type {
  DesktopUsageDailyPoint,
  DesktopUsageSummary,
  DesktopUsageTotals,
  DesktopUsageWindow
} from "$lib/shared/desktop";

const WINDOW_LABELS = ["today", "yesterday", "last7Days", "last30Days"] as const;

function pickTotals(totals: UsageStatsResponse["totals"]): DesktopUsageTotals {
  return {
    requests: totals.requests,
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    cacheReadTokens: totals.cacheReadTokens,
    cacheWriteTokens: totals.cacheWriteTokens,
    totalTokens: totals.totalTokens
  };
}

/**
 * Maps the shared usage stats into a credential-safe Desktop summary: only
 * token/request counts and date windows. The per-model and per-bot breakdowns
 * (which carry provider/model names and bot ids) and the raw records are
 * dropped — the Desktop usage card only needs aggregate totals.
 */
export function buildDesktopUsageSummary(stats: UsageStatsResponse): DesktopUsageSummary {
  const windows: DesktopUsageWindow[] = WINDOW_LABELS.map((label) => {
    const window = stats.windows[label];
    return {
      label,
      startDate: window.startDate,
      endDate: window.endDate,
      ...pickTotals(window.totals)
    };
  });

  // Project the shared daily buckets into a credential-safe trend series: the
  // bucket key becomes the date, per-model/per-bot detail is dropped. Buckets
  // arrive oldest → newest, which the trend chart renders left → right.
  const daily: DesktopUsageDailyPoint[] = stats.breakdowns.daily.map((point) => ({
    date: point.bucket,
    ...pickTotals(point.totals)
  }));

  return {
    timezone: stats.timezone,
    generatedAt: stats.generatedAt,
    totals: pickTotals(stats.totals),
    windows,
    daily
  };
}
