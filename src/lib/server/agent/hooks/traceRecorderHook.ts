import { randomUUID } from "node:crypto";
import type { HookEvent, HookStage, RuntimeHook } from "$lib/server/agent/hooks/types.js";
import { SqliteTraceStore } from "$lib/server/agent/hooks/traceStore.js";

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
      chatId: event.context.chatId,
      sessionId: event.context.sessionId,
      workspaceId: event.context.workspaceId,
      createdAt: event.timestamp,
      payload: sanitizePayload(event.payload)
    });

    if (event.stage === "run.finished") {
      this.runStates.delete(event.context.runId);
    }
  }

  getActiveRunCountForTest(): number {
    return this.runStates.size;
  }
}
