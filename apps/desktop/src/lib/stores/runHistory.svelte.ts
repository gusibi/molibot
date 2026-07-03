// Run history dashboard — state + orchestration.
import { loadDesktopRunHistory } from "../api";
import type { DesktopRunHistoryItem } from "@molibot/desktop-contract";
import { session, setError } from "./session.svelte";

export const runHistoryStore = $state({
  runHistory: [] as DesktopRunHistoryItem[],
  query: "",
  loading: false,
  endpoint: ""
});

export function runHistoryOutcomeLabel(outcome: "success" | "partial" | "failed", copy: typeof session.text): string {
  if (outcome === "success") return copy.runHistoryOutcome_success;
  if (outcome === "partial") return copy.runHistoryOutcome_partial;
  return copy.runHistoryOutcome_failed;
}

export async function loadRunHistory(endpoint: string): Promise<void> {
  runHistoryStore.endpoint = endpoint;
  runHistoryStore.loading = true;
  session.error = "";
  try {
    runHistoryStore.runHistory = await loadDesktopRunHistory(endpoint);
  } catch (cause) {
    runHistoryStore.endpoint = "";
    setError(cause);
  } finally {
    runHistoryStore.loading = false;
  }
}
