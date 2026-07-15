import { loadDesktopTrace, type DesktopTraceQuery } from "../api";
import type { DesktopTraceFactType, DesktopTraceRange, DesktopTraceSummary } from "@molibot/desktop-contract";
import { session, setError } from "./session.svelte";

export const TRACE_RANGES: DesktopTraceRange[] = ["today", "yesterday", "last7Days", "last30Days"];
export const TRACE_FACT_TYPES: DesktopTraceFactType[] = ["all", "run", "tool_call", "model_call", "skill_usage", "subagent_task", "runtime_notice", "approval", "input_enrichment"];

export const traceStore = $state({
  trace: null as DesktopTraceSummary | null,
  loading: false,
  refreshing: false,
  endpoint: "",
  generation: 0,
  query: {
    range: "today" as DesktopTraceRange,
    factType: "all" as DesktopTraceFactType,
    botId: "",
    channel: "",
    chatId: "",
    sessionId: "",
    runId: "",
    sourceLimit: 5000,
    page: 1,
    pageSize: 20
  } satisfies DesktopTraceQuery
});

export function traceRangeLabel(range: DesktopTraceRange, copy: typeof session.text): string {
  if (range === "today") return copy.usageWindow_today;
  if (range === "yesterday") return copy.usageWindow_yesterday;
  if (range === "last7Days") return copy.usageWindow_last7Days;
  return copy.usageWindow_last30Days;
}

export async function loadTrace(endpoint: string): Promise<void> {
  const generation = ++traceStore.generation;
  traceStore.loading = !traceStore.trace;
  traceStore.refreshing = Boolean(traceStore.trace);
  session.error = "";
  try {
    const trace = await loadDesktopTrace(endpoint, { ...traceStore.query });
    if (generation !== traceStore.generation) return;
    traceStore.trace = trace;
    traceStore.endpoint = endpoint;
  } catch (cause) {
    if (generation !== traceStore.generation) return;
    setError(cause);
  } finally {
    if (generation === traceStore.generation) {
      traceStore.loading = false;
      traceStore.refreshing = false;
    }
  }
}

export function updateTraceQuery(patch: Partial<DesktopTraceQuery>, resetPage = true): void {
  Object.assign(traceStore.query, patch);
  if (resetPage && patch.page === undefined) traceStore.query.page = 1;
  if (session.endpoint) void loadTrace(session.endpoint);
}

export function resetTraceFilters(): void {
  Object.assign(traceStore.query, { factType: "all", botId: "", channel: "", chatId: "", sessionId: "", runId: "", sourceLimit: 5000, page: 1 });
  if (session.endpoint) void loadTrace(session.endpoint);
}
