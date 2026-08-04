interface LogData {
  [key: string]: unknown;
}

export type MomLogLevel = "info" | "warn" | "error";

export interface MomLogPayload extends LogData {
  ts: string;
  level: MomLogLevel;
  scope: string;
  category: string;
  event: string;
  schemaVersion: 1;
}

const VERBOSE = process.env.MOM_LOG_VERBOSE === "1";
const PRETTY = process.env.MOM_LOG_PRETTY !== "0";

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
  "image_analysis_request",
  "image_analysis_success",
  // runner critical path
  "run_start",
  "model_selected",
  "api_key_resolve",
  "llm_request_sent",
  "llm_first_token",
  "llm_first_token_timeout",
  "llm_stream_start",
  "model_attempt_retryable_error",
  "model_attempt_failed",
  "active_model_missing_api_key",
  "assistant_error_message",
  "empty_response_retry",
  "prompt_start",
  "assistant_message_end",
  "prompt_end",
  "final_text_evaluated",
  "final_empty_response",
  "run_end",
  "subagent_start",
  "subagent_task_start",
  "subagent_task_end",
  "subagent_end",
  "subagent_model_resolved",
  "subagent_llm_call_start",
  "subagent_llm_call_end",
  "subagent_tool_start",
  "subagent_tool_end",
  "subagent_model_fallback",
  "subagent_budget_abort",
  "subagent_deadline_timeout",
  "subagent_prompt_error",
  "skill_draft_subagent_start",
  "skill_draft_subagent_end",
  // tool and channel
  "tool_start",
  "tool_end",
  "channel_sending_start",
  "skill_search_start",
  "skill_search_local_result",
  "skill_search_api_result",
  "skill_search_end",
  // third-party pi extensions (startup visibility: what actually loaded)
  "pi_extensions_loaded",
  "pi_extensions_reloaded",
  "pi_extension_installed",
  "pi_extension_uninstalled",
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
  subagent_start: "🧩",
  subagent_task_start: "🧭",
  subagent_task_end: "📎",
  subagent_end: "🏁",
  tool_start: "🛠️",
  tool_end: "📦",
  channel_sending_start: "📤",
  process_end: "🏁",
  error: "❌",
  warn: "⚠️",
};

const ANSI = {
  reset: "\x1b[0m",
  dim: "\x1b[90m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
};

function color(text: string, ansi: string): string {
  return `${ansi}${text}${ANSI.reset}`;
}

function formatTimestamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function eventColor(event: string): string {
  if (event.includes("error") || event.includes("failed")) return ANSI.red;
  if (event.includes("warn")) return ANSI.yellow;
  if (event.endsWith("_start") || event === "apply" || event.includes("enqueue")) return ANSI.blue;
  if (event.endsWith("_end") || event.includes("success") || event === "adapter_started") return ANSI.green;
  if (event.includes("retry")) return ANSI.magenta;
  return ANSI.cyan;
}

function stringifyValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || value == null) return String(value);
  return JSON.stringify(value);
}

interface SummaryField {
  key: string;
  text: string;
}

function summarizeEvent(event: string, data: Record<string, unknown>): SummaryField[] {
  if (event === "system_prompt_preview_written") {
    return [
      { key: "botId", text: `bot=${stringifyValue(data.botId)}` },
      { key: "sessionId", text: `session=${stringifyValue(data.sessionId)}` },
      { key: "chatId", text: `chat=${stringifyValue(data.chatId)}` },
      { key: "promptLength", text: `prompt=${stringifyValue(data.promptLength)}` },
      { key: "filePath", text: `file=${stringifyValue(data.filePath)}` },
    ];
  }
  if (event === "message_received") {
    return [
      { key: "chatId", text: `chat=${stringifyValue(data.chatId)}` },
      { key: "messageId", text: `msg=${stringifyValue(data.messageId)}` },
      { key: "textLength", text: `text=${stringifyValue(data.textLength)}` },
    ];
  }
  if (event === "run_start") {
    return [
      { key: "runId", text: `run=${stringifyValue(data.runId)}` },
      { key: "chatId", text: `chat=${stringifyValue(data.chatId)}` },
      { key: "messageId", text: `msg=${stringifyValue(data.messageId)}` },
      { key: "textLength", text: `text=${stringifyValue(data.textLength)}` },
    ];
  }
  if (event === "model_selected") {
    return [
      { key: "runId", text: `run=${stringifyValue(data.runId)}` },
      { key: "modelProvider", text: `model=${stringifyValue(data.modelProvider)}/${stringifyValue(data.modelId)}` },
      { key: "modelApi", text: `api=${stringifyValue(data.modelApi)}` },
    ];
  }
  if (event === "tool_start" || event === "tool_end") {
    return [
      { key: "runId", text: `run=${stringifyValue(data.runId)}` },
      { key: data.label ? "label" : "tool", text: `tool=${stringifyValue(data.label ?? data.tool)}` },
    ];
  }
  if (event === "llm_first_token") {
    return [
      { key: "runId", text: `run=${stringifyValue(data.runId)}` },
      { key: "latency", text: `latency=${stringifyValue(data.latency)}ms` },
    ];
  }
  if (event === "assistant_message_end") {
    const usage = data.usage as { totalTokens?: unknown } | undefined;
    return [
      { key: "runId", text: `run=${stringifyValue(data.runId)}` },
      { key: "stopReason", text: `stop=${stringifyValue(data.stopReason)}` },
      { key: "usage", text: `tokens=${stringifyValue(usage?.totalTokens ?? 0)}` },
    ];
  }
  if (event === "subagent_start") {
    return [
      { key: "chatId", text: `chat=${stringifyValue(data.chatId)}` },
      { key: "mode", text: `mode=${stringifyValue(data.mode)}` },
      { key: "taskCount", text: `tasks=${stringifyValue(data.taskCount)}` },
    ];
  }
  if (event === "subagent_task_start") {
    return [
      { key: "chatId", text: `chat=${stringifyValue(data.chatId)}` },
      { key: "agent", text: `agent=${stringifyValue(data.agent)}` },
      { key: "taskIndex", text: `step=${stringifyValue(data.taskIndex)}/${stringifyValue(data.taskCount)}` },
      { key: "mode", text: `mode=${stringifyValue(data.mode)}` },
    ];
  }
  if (event === "subagent_task_end") {
    return [
      { key: "chatId", text: `chat=${stringifyValue(data.chatId)}` },
      { key: "agent", text: `agent=${stringifyValue(data.agent)}` },
      { key: "taskIndex", text: `step=${stringifyValue(data.taskIndex)}/${stringifyValue(data.taskCount)}` },
      { key: "stopReason", text: `stop=${stringifyValue(data.stopReason)}` },
      { key: "model", text: `model=${stringifyValue(data.model ?? "")}` },
      { key: "usageTotal", text: `tokens=${stringifyValue(data.usageTotal ?? 0)}` },
    ];
  }
  if (event === "subagent_end") {
    return [
      { key: "chatId", text: `chat=${stringifyValue(data.chatId)}` },
      { key: "mode", text: `mode=${stringifyValue(data.mode)}` },
      { key: "taskCount", text: `tasks=${stringifyValue(data.taskCount)}` },
      { key: "hasFailure", text: `failed=${stringifyValue(data.hasFailure)}` },
    ];
  }
  return [];
}

function formatKeyValues(data: Record<string, unknown>, skipKeys: string[]): string[] {
  return Object.entries(data)
    .filter(([key]) => !skipKeys.includes(key))
    .map(([key, value]) => `${key}=${stringifyValue(value)}`);
}

const SENSITIVE_LOG_KEYS = new Set([
  "apikey",
  "authorization",
  "cookie",
  "credentials",
  "password",
  "secret",
  "token",
  "accesstoken",
  "refreshtoken",
  "clientsecret",
  "privatekey"
]);

function normalizedLogKey(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function isSensitiveLogKey(value: string): boolean {
  const key = normalizedLogKey(value);
  return SENSITIVE_LOG_KEYS.has(key)
    || key.endsWith("password")
    || key.endsWith("secret")
    || key.endsWith("cookie")
    || key.endsWith("credential")
    || (key.endsWith("token") && !key.endsWith("tokens"));
}

function redactString(value: string): string {
  let next = value.replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi, "$1[REDACTED]");
  next = next.replace(/(bearer\s+)[A-Za-z0-9._~+\/-]{8,}/gi, "$1[REDACTED]");
  if (/^https?:\/\//i.test(next)) {
    try {
      const url = new URL(next);
      for (const key of Array.from(url.searchParams.keys())) {
        if (isSensitiveLogKey(key)) {
          url.searchParams.set(key, "[REDACTED]");
        }
      }
      next = url.toString();
    } catch {
      // Leave malformed URLs to the generic text redaction above.
    }
  }
  return next;
}

function safe(value: unknown, key = "", depth = 0): unknown {
  if (isSensitiveLogKey(key)) return "[REDACTED]";
  if (typeof value === "string") {
    const redacted = redactString(value);
    if (redacted.length > 400)
      return `${redacted.slice(0, 400)}...(len=${redacted.length})`;
    return redacted;
  }
  if (Array.isArray(value)) {
    return depth >= 8 ? `[array:${value.length}]` : value.slice(0, 20).map((v) => safe(v, "", depth + 1));
  }
  if (!value || typeof value !== "object") return value;
  if (depth >= 8) return "[object]";

  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = safe(v, k, depth + 1);
  }
  return out;
}

function categoryForEvent(scope: string, event: string): string {
  const normalized = event.toLowerCase();
  if (
    normalized.startsWith("llm_")
    || normalized.startsWith("model_")
    || normalized.startsWith("assistant_")
    || normalized === "api_key_resolve"
    || normalized === "empty_response_retry"
  ) return "llm";
  if (normalized.startsWith("subagent_") || normalized.startsWith("skill_draft_subagent_")) return "subagent";
  if (normalized.startsWith("tool_") || normalized.includes("host_bash")) return "tool";
  if (normalized.includes("approval")) return "approval";
  if (normalized.includes("sandbox")) return "sandbox";
  if (normalized.includes("queue") || normalized.includes("lease")) return "queue";
  if (normalized.includes("prompt") || normalized.includes("context") || normalized.includes("compact")) return "context";
  if (normalized.startsWith("skill_")) return "skill";
  if (normalized.includes("message") || normalized.includes("send") || normalized.includes("outbound")) return "delivery";
  if (["runner", "taskScheduler", "eventLease"].includes(scope)) return "runtime";
  if (["telegram", "feishu", "qq", "weixin", "web"].includes(scope)) return "channel";
  return "service";
}

function inferredStatus(event: string): string | undefined {
  const normalized = event.toLowerCase();
  if (normalized.includes("blocked") || normalized.includes("denied")) return "blocked";
  if (normalized.includes("timeout")) return "timeout";
  if (normalized.includes("retry")) return "retrying";
  if (normalized.includes("failed") || normalized.includes("failure") || normalized.includes("error")) return "error";
  if (normalized.endsWith("_start") || normalized.endsWith("_started")) return "started";
  if (normalized.endsWith("_end") || normalized.endsWith("_success") || normalized.endsWith("_completed")) return "success";
  return undefined;
}

export function buildMomLogPayload(
  level: MomLogLevel,
  scope: string,
  event: string,
  data: LogData = {},
  now: Date = new Date()
): MomLogPayload {
  const safeData = safe(data) as Record<string, unknown>;
  const status = safeData.status ?? inferredStatus(event);
  return {
    ...safeData,
    ts: now.toISOString(),
    level,
    scope,
    category: categoryForEvent(scope, event),
    event,
    schemaVersion: 1,
    ...(status ? { status } : {})
  } as MomLogPayload;
}

export function formatMomPrettyLine(
  scope: string,
  event: string,
  data: Record<string, unknown>,
  now: Date = new Date(),
): string {
  const ts = formatTimestamp(now);
  const emoji = EVENT_EMOJIS[event] || "🔹";
  const summary = summarizeEvent(event, data);
  const extra = formatKeyValues(
    data,
    summary.map((entry) => entry.key),
  );
  const tail = [...summary.map((entry) => entry.text), ...extra].filter(Boolean).join(" ");

  return [
    color("[mom-t]", ANSI.bold),
    color(ts, ANSI.dim),
    color(scope, ANSI.yellow),
    color(`${emoji} ${event}`, eventColor(event)),
    tail,
  ]
    .filter(Boolean)
    .join(" ");
}

function shouldLog(event: string): boolean {
  if (VERBOSE) return true;
  return KEY_LOG_EVENTS.has(event);
}

export function isMomLogEventEnabled(event: string): boolean {
  return shouldLog(event);
}

export function createRunId(chatId: string, messageId: number): string {
  return `${chatId}-${messageId}-${Date.now().toString(36)}`;
}

/**
 * Writing a log line must never be able to end the process.
 *
 * When the desktop supervisor's stdout pipe goes away, `console.log` throws
 * `EPIPE` *synchronously* from inside whatever was being logged. That escaped as
 * an uncaughtException and killed the runtime mid-run twice in one day, each
 * time leaving a scheduled task stuck at "running". Losing a log line is an
 * acceptable outcome; losing the service is not.
 */
function writeLogLine(write: (line: string) => void, line: string): void {
  try {
    write(line);
  } catch {
    // Nothing to fall back to — the sink we would report this on is the one
    // that just failed.
  }
}

export function momLog(scope: string, event: string, data: LogData = {}): void {
  if (!shouldLog(event)) return;

  const safeData = safe(data) as Record<string, unknown>;
  if (PRETTY) {
    writeLogLine((line) => console.log(line), formatMomPrettyLine(scope, event, safeData));
    return;
  }

  const payload = buildMomLogPayload("info", scope, event, safeData);

  writeLogLine((line) => console.log(line), `[mom-t] ${JSON.stringify(payload)}`);
}

export function momWarn(
  scope: string,
  event: string,
  data: LogData = {},
): void {
  const safeData = safe(data) as Record<string, unknown>;
  if (PRETTY) {
    writeLogLine((line) => console.warn(line), formatMomPrettyLine(scope, event, safeData));
    return;
  }

  const payload = buildMomLogPayload("warn", scope, event, safeData);

  writeLogLine((line) => console.warn(line), `[mom-t] ${JSON.stringify(payload)}`);
}

export function momError(
  scope: string,
  event: string,
  data: LogData = {},
): void {
  const safeData = safe(data) as Record<string, unknown>;
  if (PRETTY) {
    writeLogLine((line) => console.error(line), formatMomPrettyLine(scope, event, safeData));
    return;
  }

  const payload = buildMomLogPayload("error", scope, event, safeData);

  writeLogLine((line) => console.error(line), `[mom-t] ${JSON.stringify(payload)}`);
}
