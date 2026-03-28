interface LogData {
  [key: string]: unknown;
}

const VERBOSE = process.env.MOM_LOG_VERBOSE === "1";
const PRETTY = process.env.MOM_LOG_PRETTY === "1";

const KEY_LOG_EVENTS = new Set<string>([
  // adapter lifecycle
  "apply",
  "allowed_chat_ids_loaded",
  "adapter_started",
  "adapter_stopped",
  "events_watcher_started",
  "events_watcher_stopped",
  "system_prompt_preview_written",
  // inbound and execution
  "message_received",
  "message_logged",
  "queue_enqueue",
  "process_start",
  "process_runner_done",
  "process_end",
  // weixin outbound delivery
  "outbound_text_attempt",
  "outbound_text_success",
  "sendmessage_attempt",
  "sendmessage_retry",
  "sendmessage_success",
  "runner_thinking_config",
  "runner_payload_reasoning",
  // stt observability
  "audio_route_decision",
  "voice_transcription_target",
  "voice_transcription_success",
  "image_fallback_decision",
  "image_analysis_target",
  "image_analysis_success",
  // runner critical path
  "run_start",
  "model_selected",
  "api_key_resolve",
  "llm_request_sent",
  "llm_first_token",
  "llm_stream_start",
  "prompt_start",
  "assistant_message_end",
  "prompt_end",
  "final_text_evaluated",
  "final_empty_response",
  "run_end",
  // tool and channel
  "tool_start",
  "tool_end",
  "channel_sending_start",
]);

const EVENT_EMOJIS: Record<string, string> = {
  apply: "⚙️",
  adapter_started: "🚀",
  adapter_stopped: "🛑",
  message_received: "📥",
  process_start: "🎬",
  run_start: "🏃",
  model_selected: "🤖",
  llm_request_sent: "📡",
  llm_first_token: "⏱️",
  llm_stream_start: "🌊",
  prompt_start: "💬",
  prompt_end: "⏹️",
  assistant_message_end: "✅",
  tool_start: "🛠️",
  tool_end: "📦",
  channel_sending_start: "📤",
  process_end: "🏁",
  error: "❌",
  warn: "⚠️",
};

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

function formatPretty(scope: string, event: string, data: Record<string, unknown>): string {
  const ts = new Date().toLocaleTimeString();
  const emoji = EVENT_EMOJIS[event] || "🔹";
  const runId = data.runId ? ` [${String(data.runId).slice(-8)}]` : "";
  const chatId = data.chatId ? ` @${data.chatId}` : "";
  
  let summary = "";
  if (event === "run_start") {
    summary = ` Run starting: msgId=${data.messageId} textLen=${data.textLength}`;
  } else if (event === "model_selected") {
    summary = ` Model: ${data.modelProvider}/${data.modelId} (${data.modelApi})`;
  } else if (event === "prompt_start") {
    summary = ` Prompting LLM (len=${data.promptLength})`;
  } else if (event === "assistant_message_end") {
    summary = ` Finished. StopReason=${data.stopReason} Tokens=${(data.usage as any)?.totalTokens || 0}`;
  } else if (event === "tool_start") {
    summary = ` Tool: ${data.label || data.tool}`;
  } else if (event === "message_received") {
    summary = ` Received: ${data.chatId} textLen=${data.textLength}`;
  } else if (event === "llm_request_sent") {
    summary = ` Request sent to ${data.modelId}`;
  } else if (event === "llm_first_token") {
    summary = ` First token received after ${data.latency}ms`;
  } else {
    const keys = Object.keys(data).filter(k => k !== "runId" && k !== "chatId");
    if (keys.length > 0) {
      summary = ` ${JSON.stringify(safe(data))}`;
    }
  }

  return `\x1b[90m[${ts}]\x1b[0m ${emoji} \x1b[1m[${scope}]\x1b[0m\x1b[36m${runId}\x1b[0m\x1b[33m${chatId}\x1b[0m \x1b[32m${event}\x1b[0m${summary}`;
}

function shouldLog(event: string): boolean {
  if (VERBOSE) return true;
  return KEY_LOG_EVENTS.has(event);
}

export function createRunId(chatId: string, messageId: number): string {
  return `${chatId}-${messageId}-${Date.now().toString(36)}`;
}

export function momLog(scope: string, event: string, data: LogData = {}): void {
  if (!shouldLog(event)) return;

  const safeData = safe(data) as Record<string, unknown>;
  if (PRETTY) {
    console.log(formatPretty(scope, event, safeData));
    return;
  }

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
  if (PRETTY) {
    console.warn(formatPretty(scope, event, { ...safeData, event_override: "warn" }));
    return;
  }

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
  if (PRETTY) {
    console.error(formatPretty(scope, event, { ...safeData, event_override: "error" }));
    return;
  }

  const payload = {
    ts: new Date().toISOString(),
    scope,
    event,
    ...safeData,
  };

  console.error(`[mom-t] ${JSON.stringify(payload)}`);
}
