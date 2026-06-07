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

interface RunTraceState {
  startedAt: string;
  eventCount: number;
}

interface FactStartState {
  id: string;
  startedAt: string;
}

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

function factKey(factType: TraceFactType, runId: string, factId: string): string {
  return `${factType}:${runId}:${factId}`;
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
    "run.started",
    "run.finished",
    "model.call.before",
    "model.call.after",
    "tool.call.before",
    "tool.call.after",
    "tool.call.error",
    "tool.call.blocked",
    "skill.selected",
    "skill.loaded",
    "runtime.notice"
  ];

  private readonly runStates = new Map<string, RunTraceState>();
  private readonly factStarts = new Map<string, FactStartState>();

  constructor(private readonly store = new SqliteTraceStore()) {}

  handle(event: HookEvent): void {
    const state = this.runStates.get(event.context.runId) ?? {
      startedAt: event.timestamp,
      eventCount: 0
    };
    state.eventCount += 1;
    this.runStates.set(event.context.runId, state);

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
      for (const key of Array.from(this.factStarts.keys())) {
        if (key.includes(`:${event.context.runId}:`)) {
          this.factStarts.delete(key);
        }
      }
    }
  }

  getActiveRunCountForTest(): number {
    return this.runStates.size;
  }

  private recordFact(event: HookEvent): void {
    if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) return;
    const payload = event.payload as Record<string, unknown>;
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
    }
  }

  private recordToolFact(
    event: HookEvent,
    payload: Record<string, unknown>,
    status: TraceFactRecord["status"]
  ): void {
    const toolName = stringField(payload, "toolName") ?? "unknown";
    const toolCallId = stringField(payload, "toolCallId") ?? `${toolName}:${event.timestamp}`;
    const key = factKey("tool_call", event.context.runId, toolCallId);
    const existing = this.factStarts.get(key);
    const startedAt = existing?.startedAt ?? (status === "started" ? event.timestamp : undefined);
    const finishedAt = status === "started" ? undefined : event.timestamp;
    const id = existing?.id ?? randomUUID();
    if (status === "started") {
      this.factStarts.set(key, { id, startedAt: event.timestamp });
    } else {
      this.factStarts.delete(key);
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
    const key = factKey("model_call", event.context.runId, modelAttemptId);
    const existing = this.factStarts.get(key);
    const startedAt = existing?.startedAt ?? (status === "started" ? event.timestamp : undefined);
    const finishedAt = status === "started" ? undefined : event.timestamp;
    const id = existing?.id ?? randomUUID();
    if (status === "started") {
      this.factStarts.set(key, { id, startedAt: event.timestamp });
    } else {
      this.factStarts.delete(key);
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
