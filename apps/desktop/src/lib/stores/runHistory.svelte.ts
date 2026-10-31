// Run history dashboard — state + orchestration.
import { loadDesktopRunHistory } from "../api";
import type { DesktopRunHistoryItem } from "@molibot/desktop-contract";
import { session } from "./session.svelte";

export const runHistoryStore = $state({
  runHistory: [] as DesktopRunHistoryItem[],
  query: "",
  outcome: "all" as "all" | "success" | "partial" | "failed",
  loaded: false,
  error: "",
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

let inFlight: { endpoint: string; promise: Promise<void> } | null = null;

export function loadRunHistory(endpoint: string): Promise<void> {
  if (inFlight?.endpoint === endpoint) return inFlight.promise;
  const generation = ++runHistoryStore.generation;
  if (runHistoryStore.endpoint !== endpoint) {
    runHistoryStore.runHistory = [];
    runHistoryStore.loaded = false;
    runHistoryStore.page = 1;
    runHistoryStore.botId = "all";
  }
  runHistoryStore.endpoint = endpoint;
  runHistoryStore.loading = !runHistoryStore.loaded;
  runHistoryStore.refreshing = runHistoryStore.loaded;
  runHistoryStore.error = "";
  const promise = (async () => {
    try {
      const items = await loadDesktopRunHistory(endpoint);
      if (generation !== runHistoryStore.generation) return;
      runHistoryStore.runHistory = items;
      runHistoryStore.loaded = true;
    } catch (cause) {
      if (generation !== runHistoryStore.generation) return;
      runHistoryStore.error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (generation === runHistoryStore.generation) {
        runHistoryStore.loading = false;
        runHistoryStore.refreshing = false;
        inFlight = null;
      }
    }
  })();
  inFlight = { endpoint, promise };
  return promise;
}

export function refreshRunHistory(): void {
  if (session.endpoint) {
    void loadRunHistory(session.endpoint);
  }
}
