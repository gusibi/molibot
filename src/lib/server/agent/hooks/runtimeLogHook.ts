import { momError, momLog, momWarn } from "$lib/server/agent/common/log.js";
import type { HookEvent, HookStage, RuntimeHook } from "$lib/server/agent/hooks/types.js";

type LogFn = (scope: string, event: string, data?: Record<string, unknown>) => void;

interface RuntimeLogHookOptions {
  log?: LogFn;
  warn?: LogFn;
  error?: LogFn;
}

function payloadObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return input as Record<string, unknown>;
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
  return undefined;
}

function boolField(source: Record<string, unknown>, key: string): boolean | undefined {
  const value = source[key];
  return typeof value === "boolean" ? value : undefined;
}

export class RuntimeLogHook implements RuntimeHook {
  readonly id = "built-in:runtime-log";
  readonly name = "Runtime Log";
  readonly kind = "observe" as const;
  readonly priority = 90;
  readonly stages: HookStage[] = [
    "run.beforeStart",
    "run.finished",
    "tool.call.before",
    "tool.call.after",
    "tool.call.error",
    "tool.call.blocked",
    "skill.selected",
    "skill.loaded",
    "runtime.notice"
  ];

  private readonly log: LogFn;
  private readonly warn: LogFn;
  private readonly error: LogFn;

  constructor(options: RuntimeLogHookOptions = {}) {
    this.log = options.log ?? momLog;
    this.warn = options.warn ?? momWarn;
    this.error = options.error ?? momError;
  }

  handle(event: HookEvent): void {
    const payload = payloadObject(event.payload);
    if (event.stage === "run.beforeStart") {
      this.log("runner", "run_start", {
        runId: event.context.runId,
        workspaceId: event.context.workspaceId,
        chatId: event.context.chatId,
        sessionId: event.context.sessionId,
        messageId: numberField(payload, "messageId"),
        textLength: numberField(payload, "textLength"),
        attachments: numberField(payload, "attachmentCount"),
        images: numberField(payload, "imageCount"),
        isEvent: boolField(payload, "isEvent")
      });
      return;
    }

    if (event.stage === "run.finished") {
      const errorMessage = stringField(payload, "errorMessage");
      this.log("runner", "run_end", {
        runId: event.context.runId,
        chatId: event.context.chatId,
        stopReason: stringField(payload, "stopReason"),
        status: stringField(payload, "status"),
        durationMs: numberField(payload, "durationMs"),
        hasError: Boolean(errorMessage)
      });
      return;
    }

    if (event.stage === "tool.call.before") {
      const toolName = stringField(payload, "toolName") ?? "unknown";
      this.log("runner", "tool_start", {
        runId: event.context.runId,
        chatId: event.context.chatId,
        tool: toolName,
        displayName: stringField(payload, "displayName"),
        label: stringField(payload, "label") ?? toolName
      });
      return;
    }

    if (event.stage === "tool.call.after" || event.stage === "tool.call.error") {
      const toolName = stringField(payload, "toolName") ?? "unknown";
      this.log("runner", "tool_end", {
        runId: event.context.runId,
        chatId: event.context.chatId,
        tool: toolName,
        displayName: stringField(payload, "displayName"),
        isError: event.stage === "tool.call.error",
        resultPreview: stringField(payload, "resultPreview")
      });
      return;
    }

    if (event.stage === "tool.call.blocked") {
      const toolName = stringField(payload, "toolName") ?? "unknown";
      this.warn("runner", "tool_call_blocked", {
        chatId: event.context.chatId,
        sessionId: event.context.sessionId,
        tool: toolName,
        displayName: stringField(payload, "displayName"),
        label: stringField(payload, "label"),
        blockedBy: stringField(payload, "blockedBy"),
        reason: stringField(payload, "reason")
      });
      return;
    }

    if (event.stage === "skill.selected" || event.stage === "skill.loaded") {
      this.log("runner", event.stage.replace(/\./g, "_"), {
        runId: event.context.runId,
        chatId: event.context.chatId,
        name: stringField(payload, "name"),
        scope: stringField(payload, "scope")
      });
      return;
    }

    if (event.stage === "runtime.notice") {
      const severity = stringField(payload, "severity") ?? "info";
      const data = {
        runId: event.context.runId,
        chatId: event.context.chatId,
        code: stringField(payload, "code"),
        message: stringField(payload, "message")
      };
      if (severity === "error") {
        this.error("runner", "runtime_notice", data);
        return;
      }
      if (severity === "warn" || severity === "warning") {
        this.warn("runner", "runtime_notice", data);
        return;
      }
      this.log("runner", "runtime_notice", data);
    }
  }
}
