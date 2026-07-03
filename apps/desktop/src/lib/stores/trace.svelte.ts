// Trace dashboard — state + orchestration.
import { loadDesktopTrace } from "../api";
import type { DesktopTraceRange, DesktopTraceSummary } from "@molibot/desktop-contract";
import { session, setError } from "./session.svelte";

export const TRACE_RANGES: DesktopTraceRange[] = ["today", "yesterday", "last7Days", "last30Days"];

export const traceStore = $state({
  trace: null as DesktopTraceSummary | null,
  loading: false,
  endpoint: "",
  range: "today" as DesktopTraceRange
});

export function traceRangeLabel(range: DesktopTraceRange, copy: typeof session.text): string {
  if (range === "today") return copy.usageWindow_today;
  if (range === "yesterday") return copy.usageWindow_yesterday;
  if (range === "last7Days") return copy.usageWindow_last7Days;
  return copy.usageWindow_last30Days;
}

export async function loadTrace(endpoint: string): Promise<void> {
  traceStore.loading = true;
  session.error = "";
  try {
    traceStore.trace = await loadDesktopTrace(endpoint, traceStore.range);
    traceStore.endpoint = endpoint;
  } catch (cause) {
    setError(cause);
  } finally {
    traceStore.loading = false;
  }
}

export async function changeTraceRange(value: DesktopTraceRange): Promise<void> {
  traceStore.range = value;
  if (session.endpoint) void loadTrace(session.endpoint);
}
