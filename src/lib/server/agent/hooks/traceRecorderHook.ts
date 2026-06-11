import { randomUUID } from "node:crypto";
import type { HookEvent, HookStage, RuntimeHook } from "$lib/server/agent/hooks/types.js";
import { SqliteTraceStore, type TraceFactRecord, type TraceFactType } from "$lib/server/agent/hooks/traceStore.js";

const SENSITIVE_KEYS = new Set([
  "apiKey",
  "api_key",
  "authorization",
  "cookie",
  "credentials",
  "secret",
  "token",
  "password",
  "fullPrompt",
  "fullText",
  "fileContent"
]);

function sanitizePayload(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key)) continue;
    if (typeof value === "string" && value.length > 1000) {
      out[key] = `${value.slice(0, 1000)}...[truncated]`;
      continue;
    }
    if (value && typeof value === "object") {
      out[key] = Array.isArray(value) ? `[array:${value.length}]` : "[object]";
      continue;
    }
    out[key] = value;
  }
  return out;
}

interface FactStartState {
  id: string;
  startedAt: string;
}

interface RunTraceState {
  startedAt: string;
  eventCount: number;
  lastEventAtMs: number;
  facts: Map<string, FactStartState>;
}

// Runs that never receive run.finished (crash, lost abort) must not leak
// state forever; anything idle beyond this window is swept.
const RUN_STATE_TTL_MS = 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

function stringField(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function numberField(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function usageTokens(input: unknown): {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
} {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const usage = input as Record<string, unknown>;
  const inputTokens = numberField(usage, "inputTokens") ?? numberField(usage, "input") ?? numberField(usage, "prompt_tokens");
  const outputTokens = numberField(usage, "outputTokens") ?? numberField(usage, "output") ?? numberField(usage, "completion_tokens");
  const cacheReadTokens = numberField(usage, "cacheReadTokens") ?? numberField(usage, "cacheRead") ?? numberField(usage, "cache_read_tokens");
  const cacheWriteTokens = numberField(usage, "cacheWriteTokens") ?? numberField(usage, "cacheWrite") ?? numberField(usage, "cache_write_tokens");
  const explicitTotal = numberField(usage, "totalTokens") ?? numberField(usage, "total") ?? numberField(usage, "total_tokens");
  const computedTotal =
    (inputTokens ?? 0) + (outputTokens ?? 0) + (cacheReadTokens ?? 0) + (cacheWriteTokens ?? 0);
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens: explicitTotal ?? (computedTotal > 0 ? computedTotal : undefined)
  };
}

function factKey(factType: TraceFactType, factId: string): string {
  return `${factType}:${factId}`;
}

function durationMs(startedAt: string | undefined, finishedAt: string | undefined): number | undefined {
  if (!startedAt || !finishedAt) return undefined;
  const duration = Date.parse(finishedAt) - Date.parse(startedAt);
  return Number.isFinite(duration) && duration >= 0 ? duration : undefined;
}

export class TraceRecorderHook implements RuntimeHook {
  readonly id = "built-in:trace-recorder";
  readonly name = "Trace Recorder";
  readonly kind = "observe" as const;
  readonly priority = 10;
  readonly stages: HookStage[] = [
    "run.beforeStart",
    "run.started",
    "run.finished",
    "input.enrich.before",
    "input.enrich.after",
    "model.call.before",
    "model.call.after",
    "tool.call.before",
    "tool.call.after",
    "tool.call.error",
    "tool.call.blocked",
    "skill.selected",
    "skill.loaded",
    "approval.requested",
    "approval.resolved",
    "subagent.task.before",
    "subagent.task.after",
    "runtime.notice"
  ];

  private readonly runStates = new Map<string, RunTraceState>();
  private lastSweepAtMs = 0;

  constructor(private readonly store = new SqliteTraceStore()) {}

  private runState(runId: string, timestamp: string): RunTraceState {
    let state = this.runStates.get(runId);
    if (!state) {
      state = {
        startedAt: timestamp,
        eventCount: 0,
        lastEventAtMs: Date.now(),
        facts: new Map()
      };
      this.runStates.set(runId, state);
    }
    return state;
  }

  private sweepStaleRuns(nowMs: number): void {
    if (nowMs - this.lastSweepAtMs < SWEEP_INTERVAL_MS) return;
    this.lastSweepAtMs = nowMs;
    for (const [runId, state] of this.runStates) {
      if (nowMs - state.lastEventAtMs > RUN_STATE_TTL_MS) {
        this.runStates.delete(runId);
      }
    }
  }

  handle(event: HookEvent): void {
    const nowMs = Date.now();
    this.sweepStaleRuns(nowMs);
    const state = this.runState(event.context.runId, event.timestamp);
    state.eventCount += 1;
    state.lastEventAtMs = nowMs;

    this.store.append({
      id: randomUUID(),
      runId: event.context.runId,
      stage: event.stage,
      channel: event.context.channel,
      botId: event.context.botId,
      chatId: event.context.chatId,
      sessionId: event.context.sessionId,
      workspaceId: event.context.workspaceId,
      createdAt: event.timestamp,
      payload: sanitizePayload(event.payload)
    });
    this.recordFact(event);

    if (event.stage === "run.finished") {
      this.runStates.delete(event.context.runId);
    }
  }

  getActiveRunCountForTest(): number {
    return this.runStates.size;
  }

  private recordFact(event: HookEvent): void {
    if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) return;
    const payload = event.payload as Record<string, unknown>;
    if (event.stage === "run.beforeStart" || event.stage === "run.started") {
      this.recordRunFact(event, payload, "started");
      return;
    }
    if (event.stage === "run.finished") {
      this.recordRunFact(event, payload, this.runStatus(payload));
      return;
    }
    if (event.stage === "input.enrich.before") {
      this.recordGenericFact(event, payload, "input_enrichment", "input", "input", "started");
      return;
    }
    if (event.stage === "input.enrich.after") {
      this.recordGenericFact(event, payload, "input_enrichment", "input", "input", "success");
      return;
    }
    if (event.stage === "tool.call.before") {
      this.recordToolFact(event, payload, "started");
      return;
    }
    if (event.stage === "tool.call.after") {
      this.recordToolFact(event, payload, "success");
      return;
    }
    if (event.stage === "tool.call.error") {
      this.recordToolFact(event, payload, "error");
      return;
    }
    if (event.stage === "tool.call.blocked") {
      this.recordToolFact(event, payload, "blocked");
      return;
    }
    if (event.stage === "model.call.before") {
      this.recordModelFact(event, payload, "started");
      return;
    }
    if (event.stage === "model.call.after") {
      this.recordModelFact(event, payload, "success");
      return;
    }
    if (event.stage === "skill.selected") {
      this.recordSkillFact(event, payload, "started");
      return;
    }
    if (event.stage === "skill.loaded") {
      this.recordSkillFact(event, payload, "success");
      return;
    }
    if (event.stage === "approval.requested") {
      const requestId = stringField(payload, "requestId") ?? stringField(payload, "approvalId") ?? event.timestamp;
      this.recordGenericFact(event, payload, "approval", requestId, stringField(payload, "displayName") ?? stringField(payload, "toolId") ?? "approval", "waiting");
      return;
    }
    if (event.stage === "approval.resolved") {
      const requestId = stringField(payload, "requestId") ?? stringField(payload, "approvalId") ?? event.timestamp;
      const decision = stringField(payload, "decision") ?? stringField(payload, "status");
      this.recordGenericFact(
        event,
        payload,
        "approval",
        requestId,
        stringField(payload, "displayName") ?? stringField(payload, "toolId") ?? "approval",
        decision === "approved" || decision === "success" ? "success" : decision === "rejected" || decision === "blocked" ? "blocked" : "error"
      );
      return;
    }
    if (event.stage === "subagent.task.before") {
      this.recordSubagentTaskFact(event, payload, "started");
      return;
    }
    if (event.stage === "subagent.task.after") {
      this.recordSubagentTaskFact(event, payload, this.subagentStatus(payload));
      return;
    }
    if (event.stage === "runtime.notice") {
      const code = stringField(payload, "code") ?? event.timestamp;
      const severity = stringField(payload, "severity") ?? "info";
      this.recordGenericFact(
        event,
        payload,
        "runtime_notice",
        code,
        code,
        severity === "error" ? "error" : severity === "warn" || severity === "warning" ? "warning" : "info"
      );
    }
  }

  private runStatus(payload: Record<string, unknown>): TraceFactRecord["status"] {
    const status = stringField(payload, "status") ?? stringField(payload, "stopReason");
    if (status === "success" || status === "stop") return "success";
    if (status === "aborted") return "aborted";
    if (status === "waiting_for_approval" || status === "waiting") return "waiting";
    return "error";
  }

  private subagentStatus(payload: Record<string, unknown>): TraceFactRecord["status"] {
    const stopReason = stringField(payload, "stopReason");
    if (!stopReason || stopReason === "stop") return "success";
    if (stopReason === "aborted") return "aborted";
    if (stopReason === "waiting_for_approval") return "waiting";
    return "error";
  }

  private recordRunFact(
    event: HookEvent,
    payload: Record<string, unknown>,
    status: TraceFactRecord["status"]
  ): void {
    this.recordGenericFact(event, payload, "run", event.context.runId, event.context.sessionId, status, {
      startedAt: status === "started" ? event.timestamp : this.runStates.get(event.context.runId)?.startedAt,
      finishedAt: status === "started" ? undefined : event.timestamp,
      durationMs: numberField(payload, "durationMs")
    });
  }

  private recordSkillFact(
    event: HookEvent,
    payload: Record<string, unknown>,
    status: TraceFactRecord["status"]
  ): void {
    const name = stringField(payload, "name") ?? "unknown";
    const scope = stringField(payload, "scope") ?? "unknown";
    const filePath = stringField(payload, "filePath");
    this.recordGenericFact(event, payload, "skill_usage", filePath ?? `${scope}:${name}`, name, status);
  }

  private recordSubagentTaskFact(
    event: HookEvent,
    payload: Record<string, unknown>,
    status: TraceFactRecord["status"]
  ): void {
    const agent = stringField(payload, "agent") ?? "unknown";
    const taskIndex = numberField(payload, "taskIndex") ?? 0;
    const factId = `${agent}:${taskIndex}`;
    this.recordGenericFact(event, payload, "subagent_task", factId, agent, status);
  }

  private recordGenericFact(
    event: HookEvent,
    payload: Record<string, unknown>,
    factType: TraceFactType,
    factId: string,
    name: string,
    status: TraceFactRecord["status"],
    timing: { startedAt?: string; finishedAt?: string; durationMs?: number } = {}
  ): void {
    const facts = this.runState(event.context.runId, event.timestamp).facts;
    const key = factKey(factType, factId);
    const existing = facts.get(key);
    const startedAt = timing.startedAt ?? existing?.startedAt ?? (status === "started" ? event.timestamp : undefined);
    const finishedAt = timing.finishedAt ?? (status === "started" ? undefined : event.timestamp);
    const id = existing?.id ?? randomUUID();
    if (status === "started" || status === "waiting") {
      facts.set(key, { id, startedAt: startedAt ?? event.timestamp });
    } else {
      facts.delete(key);
    }

    this.store.upsertFact({
      id,
      factType,
      runId: event.context.runId,
      factId,
      channel: event.context.channel,
      botId: event.context.botId,
      chatId: event.context.chatId,
      sessionId: event.context.sessionId,
      workspaceId: event.context.workspaceId,
      name,
      status,
      startedAt,
      finishedAt,
      durationMs: timing.durationMs ?? durationMs(startedAt, finishedAt),
      errorPreview: status === "error" ? stringField(payload, "errorMessage") ?? stringField(payload, "message") : undefined,
      resultPreview: stringField(payload, "resultPreview") ?? stringField(payload, "message"),
      payload: sanitizePayload(payload),
      createdAt: startedAt ?? event.timestamp,
      updatedAt: event.timestamp
    });
  }

  private recordToolFact(
    event: HookEvent,
    payload: Record<string, unknown>,
    status: TraceFactRecord["status"]
  ): void {
    const toolName = stringField(payload, "toolName") ?? "unknown";
    const toolCallId = stringField(payload, "toolCallId") ?? `${toolName}:${event.timestamp}`;
    const facts = this.runState(event.context.runId, event.timestamp).facts;
    const key = factKey("tool_call", toolCallId);
    const existing = facts.get(key);
    const startedAt = existing?.startedAt ?? (status === "started" ? event.timestamp : undefined);
    const finishedAt = status === "started" ? undefined : event.timestamp;
    const id = existing?.id ?? randomUUID();
    if (status === "started") {
      facts.set(key, { id, startedAt: event.timestamp });
    } else {
      facts.delete(key);
    }

    this.store.upsertFact({
      id,
      factType: "tool_call",
      runId: event.context.runId,
      factId: toolCallId,
      channel: event.context.channel,
      botId: event.context.botId,
      chatId: event.context.chatId,
      sessionId: event.context.sessionId,
      workspaceId: event.context.workspaceId,
      name: toolName,
      status,
      startedAt,
      finishedAt,
      durationMs: durationMs(startedAt, finishedAt),
      blockedBy: stringField(payload, "blockedBy"),
      errorPreview: status === "error" ? stringField(payload, "resultPreview") : undefined,
      argsPreview: stringField(payload, "argsPreview"),
      resultPreview: stringField(payload, "resultPreview"),
      payload: sanitizePayload(payload),
      createdAt: startedAt ?? event.timestamp,
      updatedAt: event.timestamp
    });
  }

  private recordModelFact(
    event: HookEvent,
    payload: Record<string, unknown>,
    status: TraceFactRecord["status"]
  ): void {
    const modelAttemptId = stringField(payload, "modelAttemptId")
      ?? String(numberField(payload, "modelCallSeq") ?? event.timestamp);
    const facts = this.runState(event.context.runId, event.timestamp).facts;
    const key = factKey("model_call", modelAttemptId);
    const existing = facts.get(key);
    const startedAt = existing?.startedAt ?? (status === "started" ? event.timestamp : undefined);
    const finishedAt = status === "started" ? undefined : event.timestamp;
    const id = existing?.id ?? randomUUID();
    if (status === "started") {
      facts.set(key, { id, startedAt: event.timestamp });
    } else {
      facts.delete(key);
    }
    const tokens = usageTokens(payload.usage);

    this.store.upsertFact({
      id,
      factType: "model_call",
      runId: event.context.runId,
      factId: modelAttemptId,
      channel: event.context.channel,
      botId: event.context.botId,
      chatId: event.context.chatId,
      sessionId: event.context.sessionId,
      workspaceId: event.context.workspaceId,
      name: stringField(payload, "model"),
      provider: stringField(payload, "provider"),
      model: stringField(payload, "model"),
      api: stringField(payload, "api"),
      status,
      startedAt,
      finishedAt,
      durationMs: durationMs(startedAt, finishedAt),
      inputTokens: tokens.inputTokens,
      outputTokens: tokens.outputTokens,
      cacheReadTokens: tokens.cacheReadTokens,
      cacheWriteTokens: tokens.cacheWriteTokens,
      totalTokens: tokens.totalTokens,
      payload: sanitizePayload(payload),
      createdAt: startedAt ?? event.timestamp,
      updatedAt: event.timestamp
    });
  }
}
