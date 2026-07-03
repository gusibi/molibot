// Usage dashboard — state + orchestration.
import { loadDesktopUsage } from "../api";
import type { DesktopUsageSummary } from "@molibot/desktop-contract";
import { session, setError } from "./session.svelte";

export const usageStore = $state({
  usage: null as DesktopUsageSummary | null,
  loading: false,
  endpoint: ""
});

export function usageWindowLabel(label: "today" | "yesterday" | "last7Days" | "last30Days", copy: typeof session.text): string {
  if (label === "today") return copy.usageWindow_today;
  if (label === "yesterday") return copy.usageWindow_yesterday;
  if (label === "last7Days") return copy.usageWindow_last7Days;
  return copy.usageWindow_last30Days;
}

export async function loadUsage(endpoint: string): Promise<void> {
  usageStore.endpoint = endpoint;
  usageStore.loading = true;
  session.error = "";
  try {
    usageStore.usage = await loadDesktopUsage(endpoint);
  } catch (cause) {
    usageStore.endpoint = "";
    setError(cause);
  } finally {
    usageStore.loading = false;
  }
}
