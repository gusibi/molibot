import type {
  SpanAttributes,
  SpanOptions,
  SpanStatus,
  TelemetryContext,
  TelemetrySpan
} from "@earendil-works/pi-agent-core";
import type { HookContext, HookManager } from "$lib/server/agent/hooks/types.js";

export interface PiTelemetryContextOptions {
  hookManager: HookManager;
  getHookContext: () => HookContext | undefined;
  getModelAttemptId: () => string | undefined;
}

interface SpanState {
  id: string;
  parentId?: string;
  name: string;
  attributes: Record<string, unknown>;
  status: SpanStatus;
  startedAtMs: number;
  settled: boolean;
}

function copyAttributes(attributes?: SpanAttributes): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(attributes ?? {}).filter(([, value]) => value !== undefined)
  );
}

function errorStatus(error: unknown): SpanStatus {
  return error instanceof Error
    ? { status: "error", error: { name: error.name, message: error.message } }
    : { status: "error" };
}

/** Adapts Pi's explicit telemetry spans into Molibot's existing run Trace. */
export function createPiTelemetryContext(options: PiTelemetryContextOptions): TelemetryContext {
  let nextSpanId = 0;

  const start = <T>(parentId: string | undefined, spanOptions: SpanOptions, callback: (span: TelemetrySpan) => T | Promise<T>): Promise<T> => {
    const state: SpanState = {
      id: `pi-span-${++nextSpanId}`,
      parentId,
      name: spanOptions.name,
      attributes: copyAttributes(spanOptions.attributes),
      status: { status: "ok" },
      startedAtMs: Date.now(),
      settled: false
    };

    let hasExplicitStatus = false;

    const span: TelemetrySpan = {
      startSpan: (childOptions, childCallback) => start(state.id, childOptions, childCallback),
      addEvent: () => {},
      setAttributes: (attributes) => {
        if (!state.settled) Object.assign(state.attributes, copyAttributes(attributes));
      },
      setStatus: (status) => {
        if (!state.settled) {
          state.status = status;
          hasExplicitStatus = true;
        }
      }
    };

    const settle = (failed: boolean, failure?: unknown): void => {
      if (state.settled) return;
      if (failed && !hasExplicitStatus) state.status = errorStatus(failure);
      state.settled = true;
      const hookContext = options.getHookContext();
      if (!hookContext) return;
      const attributes = state.attributes;
      const usage = {
        input: attributes["pi.ai.usage.input_tokens"],
        output: attributes["pi.ai.usage.output_tokens"],
        cacheRead: attributes["pi.ai.usage.cache_read_tokens"],
        cacheWrite: attributes["pi.ai.usage.cache_write_tokens"],
        totalTokens: attributes["pi.ai.usage.total_tokens"]
      };
      try {
        options.hookManager.emit("model.telemetry", hookContext, {
          ...attributes,
          spanName: state.name,
          spanId: state.id,
          parentSpanId: state.parentId,
          modelAttemptId: options.getModelAttemptId(),
          provider: typeof attributes["pi.ai.provider"] === "string" ? attributes["pi.ai.provider"] : undefined,
          model: typeof attributes["pi.ai.model"] === "string" ? attributes["pi.ai.model"] : undefined,
          api: typeof attributes["pi.ai.api"] === "string" ? attributes["pi.ai.api"] : undefined,
          stopReason: typeof attributes["pi.ai.response.stop_reason"] === "string"
            ? attributes["pi.ai.response.stop_reason"]
            : undefined,
          inputTokens: usage.input,
          outputTokens: usage.output,
          durationMs: Date.now() - state.startedAtMs,
          usage,
          status: state.status.status,
          errorName: state.status.status === "error" ? state.status.error?.name : undefined,
          errorMessage: state.status.status === "error" ? state.status.error?.message : undefined
        });
      } catch {
        // Telemetry is passive and must never change the provider request result.
      }
    };

    let result: T | Promise<T>;
    try {
      result = callback(span);
    } catch (error) {
      settle(true, error);
      return Promise.reject(error);
    }
    return Promise.resolve(result).then(
      (value) => {
        settle(false);
        return value;
      },
      (error) => {
        settle(true, error);
        throw error;
      }
    );
  };

  return {
    startSpan: (spanOptions, callback) => start(undefined, spanOptions, callback)
  };
}
