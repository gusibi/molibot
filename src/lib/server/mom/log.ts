interface LogData {
  [key: string]: unknown;
}

const VERBOSE = process.env.MOM_LOG_VERBOSE === "1";

const KEY_LOG_EVENTS = new Set<string>([
  // adapter lifecycle
  "apply",
  "allowed_chat_ids_loaded",
  "adapter_started",
  "adapter_stopped",
  "events_watcher_started",
  "events_watcher_stopped",
  // inbound and execution
  "message_received",
  "message_logged",
  "queue_enqueue",
  "process_start",
  "process_runner_done",
  "process_end",
  // runner critical path
  // "run_start",
  // "model_selected",
  // "api_key_resolve",
  // "llm_stream_start",
  // "prompt_start",
  // "assistant_message_end",
  // "prompt_end",
  // "final_text_evaluated",
  // "final_empty_response",
  // "run_end",
]);

function shouldLog(event: string): boolean {
  if (VERBOSE) return true;
  return KEY_LOG_EVENTS.has(event);
}

function safe(value: unknown): unknown {
  if (typeof value === "string") {
    if (value.length > 400)
      return `${value.slice(0, 400)}...(len=${value.length})`;
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((v) => safe(v));
  }
  if (!value || typeof value !== "object") return value;

  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = safe(v);
  }
  return out;
}

export function createRunId(chatId: string, messageId: number): string {
  return `${chatId}-${messageId}-${Date.now().toString(36)}`;
}

export function momLog(scope: string, event: string, data: LogData = {}): void {
  if (!shouldLog(event)) return;

  const safeData = safe(data) as Record<string, unknown>;
  const payload = {
    ts: new Date().toISOString(),
    scope,
    event,
    ...safeData,
  };

  console.log(`[mom-t] ${JSON.stringify(payload)}`);
}

export function momWarn(
  scope: string,
  event: string,
  data: LogData = {},
): void {
  const safeData = safe(data) as Record<string, unknown>;
  const payload = {
    ts: new Date().toISOString(),
    scope,
    event,
    ...safeData,
  };

  console.warn(`[mom-t] ${JSON.stringify(payload)}`);
}

export function momError(
  scope: string,
  event: string,
  data: LogData = {},
): void {
  const safeData = safe(data) as Record<string, unknown>;
  const payload = {
    ts: new Date().toISOString(),
    scope,
    event,
    ...safeData,
  };

  console.error(`[mom-t] ${JSON.stringify(payload)}`);
}
