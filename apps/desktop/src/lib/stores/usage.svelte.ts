import { loadDesktopUsage, type DesktopUsageQuery } from "../api";
import type { DesktopUsageRange, DesktopUsageSummary } from "@molibot/desktop-contract";
import { session } from "./session.svelte";

export const USAGE_RANGES: DesktopUsageRange[] = ["today", "yesterday", "last7Days", "last30Days"];

export const usageStore = $state({
  usage: null as DesktopUsageSummary | null,
  loading: false,
  refreshing: false,
  error: "",
  endpoint: "",
  generation: 0,
  query: {
    range: "today" as DesktopUsageRange,
    modelId: "all",
    agentId: "all",
    botId: "all",
    channel: "all",
    page: 1,
    pageSize: 20
  } satisfies DesktopUsageQuery
});

export function usageWindowLabel(label: DesktopUsageRange, copy: typeof session.text): string {
  if (label === "today") return copy.usageWindow_today;
  if (label === "yesterday") return copy.usageWindow_yesterday;
  if (label === "last7Days") return copy.usageWindow_last7Days;
  return copy.usageWindow_last30Days;
}

export async function loadUsage(endpoint: string): Promise<void> {
  const generation = ++usageStore.generation;
  usageStore.loading = !usageStore.usage;
  usageStore.refreshing = Boolean(usageStore.usage);
  usageStore.error = "";
  try {
    const usage = await loadDesktopUsage(endpoint, { ...usageStore.query });
    if (generation !== usageStore.generation) return;
    usageStore.usage = usage;
    usageStore.endpoint = endpoint;
  } catch (cause) {
    if (generation !== usageStore.generation) return;
    usageStore.endpoint = "";
    usageStore.error = cause instanceof Error ? cause.message : String(cause);
  } finally {
    if (generation === usageStore.generation) {
      usageStore.loading = false;
      usageStore.refreshing = false;
    }
  }
}

export function updateUsageQuery(patch: Partial<DesktopUsageQuery>, resetPage = true): void {
  Object.assign(usageStore.query, patch);
  if (resetPage && patch.page === undefined) usageStore.query.page = 1;
  if (session.endpoint) void loadUsage(session.endpoint);
}

export function resetUsageFilters(): void {
  usageStore.query.modelId = "all";
  usageStore.query.agentId = "all";
  usageStore.query.botId = "all";
  usageStore.query.channel = "all";
  usageStore.query.page = 1;
  if (session.endpoint) void loadUsage(session.endpoint);
}
