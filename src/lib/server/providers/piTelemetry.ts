import type {
  SpanAttributes,
  SpanOptions,
  SpanStatus,
  TelemetryContext,
  TelemetrySpan
} from "@earendil-works/pi-telemetry";
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
export function createPiTelemetryContext(options: PiTelemetryContextOptions): TelemetrySpan {
  let nextSpanId = 0;
  const spanIds = new WeakMap<TelemetryContext, string>();

  const start = <T>(parentId: string | undefined, spanOptions: SpanOptions, callback: (span: TelemetrySpan) => T | Promise<T>): Promise<T> => {
    const hookContext = options.getHookContext();
    const modelAttemptId = options.getModelAttemptId();
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

    const links: { spanId: string; attributes: Record<string, unknown> }[] = [];
    const addLink: TelemetrySpan["addLink"] = link => {
      const spanId = spanIds.get(link.context);
      if (!state.settled && spanId) links.push({ spanId, attributes: copyAttributes(link.attributes) });
    };
    const span: TelemetrySpan = {
      addLink,
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

    spanIds.set(span, state.id);
    for (const link of spanOptions.links ?? []) addLink(link);

    const settle = (failed: boolean, failure?: unknown): void => {
      if (state.settled) return;
      if (failed && !hasExplicitStatus) state.status = errorStatus(failure);
      state.settled = true;
      if (!hookContext) return;
      const attributes = state.attributes;
      // Pi Models uses its schema's short attribute names; direct provider streams use host names.
      const input = attributes["pi.ai.usage.input_tokens"] ?? attributes["usage.input"];
      const output = attributes["pi.ai.usage.output_tokens"] ?? attributes["usage.output"];
      const cacheRead = attributes["pi.ai.usage.cache_read_tokens"] ?? attributes["usage.cache_read"];
      const cacheWrite = attributes["pi.ai.usage.cache_write_tokens"] ?? attributes["usage.cache_write"];
      const total = [input, output, cacheRead, cacheWrite];
      const stop = attributes["pi.ai.response.stop_reason"] ?? attributes.stop;
      const provider = attributes["pi.ai.provider"] ?? attributes.provider;
      const model = attributes["pi.ai.model"] ?? attributes.model;
      const api = attributes["pi.ai.api"] ?? attributes.api;
      const usage = {
        input,
        output,
        cacheRead,
        cacheWrite,
        totalTokens: attributes["pi.ai.usage.total_tokens"] ?? (total.every((value): value is number => typeof value === "number") ? total.reduce((sum, value) => sum + value, 0) : undefined)
      };
      try {
        options.hookManager.emit("model.telemetry", hookContext, {
          ...attributes,
          spanName: state.name,
          spanId: state.id,
          parentSpanId: state.parentId,
          ...(links.length ? { links } : {}),
          modelAttemptId,
          provider: typeof provider === "string" ? provider : undefined,
          model: typeof model === "string" ? model : undefined,
          api: typeof api === "string" ? api : undefined,
          stopReason: stop === "toolUse" ? "tool_use" : typeof stop === "string" ? stop : undefined,
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
    addLink: () => {},
    addEvent: () => {},
    setAttributes: () => {},
    setStatus: () => {},
    startSpan: (spanOptions, callback) => start(undefined, spanOptions, callback)
  };
}
