// Run history dashboard — state + orchestration.
import { loadDesktopRunHistory } from "../api";
import type { DesktopRunHistoryItem } from "@molibot/desktop-contract";
import { session, setError } from "./session.svelte";

export const runHistoryStore = $state({
  runHistory: [] as DesktopRunHistoryItem[],
  query: "",
  botId: "all",
  page: 1,
  pageSize: 20,
  loading: false,
  refreshing: false,
  endpoint: "",
  generation: 0
});

export function runHistoryOutcomeLabel(outcome: "success" | "partial" | "failed", copy: typeof session.text): string {
  if (outcome === "success") return copy.runHistoryOutcome_success;
  if (outcome === "partial") return copy.runHistoryOutcome_partial;
  return copy.runHistoryOutcome_failed;
}

export async function loadRunHistory(endpoint: string, options?: { refresh?: boolean }): Promise<void> {
  const generation = ++runHistoryStore.generation;
  const isInitial = runHistoryStore.runHistory.length === 0;
  if (isInitial && !options?.refresh) {
    runHistoryStore.loading = true;
  } else {
    runHistoryStore.refreshing = true;
  }
  session.error = "";
  try {
    const items = await loadDesktopRunHistory(endpoint);
    if (generation !== runHistoryStore.generation) return;
    runHistoryStore.runHistory = items;
    runHistoryStore.endpoint = endpoint;
  } catch (cause) {
    if (generation !== runHistoryStore.generation) return;
    setError(cause);
  } finally {
    if (generation === runHistoryStore.generation) {
      runHistoryStore.loading = false;
      runHistoryStore.refreshing = false;
    }
  }
}

export function refreshRunHistory(): void {
  if (session.endpoint) {
    void loadRunHistory(session.endpoint, { refresh: true });
  }
}
