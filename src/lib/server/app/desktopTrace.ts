import type { TraceFactRecord } from "$lib/server/agent/hooks/traceStore.js";
import type {
  DesktopTraceRange,
  DesktopTraceSummary,
  DesktopTraceTotals
} from "$lib/shared/desktop";

const KNOWN_RANGES: readonly DesktopTraceRange[] = ["today", "yesterday", "last7Days", "last30Days"];

/** Sanitizes the trace time-range query to one of the four supported windows. */
export function sanitizeDesktopTraceRange(input: unknown): DesktopTraceRange {
  const value = String(input ?? "").trim();
  return (KNOWN_RANGES as readonly string[]).includes(value) ? (value as DesktopTraceRange) : "today";
}

function safeString(value: string | undefined, fallback: string): string {
  const trimmed = String(value ?? "").trim();
  return trimmed || fallback;
}

function localDateKey(value: string | Date, timeZone: string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function shiftDateKey(dateKey: string, deltaDays: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + deltaDays)).toISOString().slice(0, 10);
}

/** Resolves a trace range to a [startDate, endDate] window in the given timezone. */
export function resolveDesktopTraceWindow(
  range: DesktopTraceRange,
  timeZone: string
): { startDate: string; endDate: string } {
  const today = localDateKey(new Date(), timeZone);
  if (range === "today") return { startDate: today, endDate: today };
  if (range === "yesterday") {
    const yesterday = shiftDateKey(today, -1);
    return { startDate: yesterday, endDate: yesterday };
  }
  const days = range === "last7Days" ? 7 : 30;
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) keys.push(shiftDateKey(today, -i));
  return { startDate: keys[0], endDate: keys[keys.length - 1] };
}

function averageDuration(facts: TraceFactRecord[]): number {
  const withDuration = facts.filter((fact) => typeof fact.durationMs === "number");
  if (withDuration.length === 0) return 0;
  const sum = withDuration.reduce((total, fact) => total + (fact.durationMs ?? 0), 0);
  return Math.round(sum / withDuration.length);
}

function skillExecuted(fact: TraceFactRecord): boolean {
  const level = String((fact.payload as Record<string, unknown>)?.level ?? "").trim();
  return level === "executed";
}

/**
 * Computes the credential-safe aggregate totals for a set of trace facts. Only
 * counts and averages are derived — the facts themselves (which carry tool
 * args/result previews, error previews, and payloads that may contain user or
 * command content) never leave this function.
 */
export function computeDesktopTraceTotals(facts: TraceFactRecord[]): DesktopTraceTotals {
  const toolFacts = facts.filter((fact) => fact.factType === "tool_call");
  const modelFacts = facts.filter((fact) => fact.factType === "model_call");
  const skillFacts = facts.filter((fact) => fact.factType === "skill_usage");
  const executedToolFacts = toolFacts.filter((fact) => fact.status === "success" || fact.status === "error");

  return {
    facts: facts.length,
    toolCalls: toolFacts.length,
    executedToolCalls: executedToolFacts.length,
    modelCalls: modelFacts.length,
    distinctTools: new Set(toolFacts.map((fact) => safeString(fact.name, "unknown"))).size,
    skillUsages: skillFacts.length,
    executedSkills: skillFacts.filter((fact) => skillExecuted(fact)).length,
    distinctSkills: new Set(skillFacts.map((fact) => safeString(fact.name, "unknown"))).size,
    bots: new Set(facts.map((fact) => safeString(fact.botId, "unknown"))).size,
    channels: new Set(facts.map((fact) => fact.channel)).size,
    chats: new Set(facts.map((fact) => `${fact.channel}:${fact.chatId}`)).size,
    sessions: new Set(facts.map((fact) => fact.sessionId)).size,
    runs: new Set(facts.map((fact) => fact.runId)).size,
    failedTools: toolFacts.filter((fact) => fact.status === "error").length,
    blockedTools: toolFacts.filter((fact) => fact.status === "blocked").length,
    totalTokens: modelFacts.reduce((sum, fact) => sum + (fact.totalTokens ?? 0), 0),
    avgToolDurationMs: averageDuration(executedToolFacts),
    avgModelDurationMs: averageDuration(modelFacts.filter((fact) => fact.status === "success" || fact.status === "error"))
  };
}

export function buildDesktopTraceSummary(
  timeZone: string,
  range: DesktopTraceRange,
  facts: TraceFactRecord[]
): DesktopTraceSummary {
  return {
    timezone: timeZone,
    generatedAt: new Date().toISOString(),
    range,
    window: resolveDesktopTraceWindow(range, timeZone),
    totals: computeDesktopTraceTotals(facts)
  };
}
