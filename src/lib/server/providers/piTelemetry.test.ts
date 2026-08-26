import assert from "node:assert/strict";
import test from "node:test";
import { DefaultHookManager } from "$lib/server/agent/hooks/manager.js";
import { TraceRecorderHook } from "$lib/server/agent/hooks/traceRecorderHook.js";
import { SqliteTraceStore } from "$lib/server/agent/hooks/traceStore.js";
import type { HookContext } from "$lib/server/agent/hooks/types.js";
import { createPiTelemetryContext } from "$lib/server/providers/piTelemetry.js";
import { streamWithPiRuntime } from "$lib/server/providers/piRuntime.js";

const hookContext: HookContext = {
  runId: "run-telemetry",
  channel: "web",
  botId: "bot-1",
  chatId: "chat-1",
  sessionId: "session-1"
};

test("Pi telemetry spans stay correlated with the existing run and model attempt trace", async () => {
  const store = new SqliteTraceStore(":memory:");
  const manager = new DefaultHookManager();
  manager.register(new TraceRecorderHook(store));
  const telemetry = createPiTelemetryContext({
    hookManager: manager,
    getHookContext: () => hookContext,
    getModelAttemptId: () => "run-telemetry:0:0:1"
  });

  await telemetry.startSpan({
    name: "pi.ai.request",
    attributes: {
      "pi.ai.operation": "stream",
      "pi.ai.provider": "openai",
      "pi.ai.model": "gpt-5",
      "pi.ai.api": "openai-responses",
      "pi.ai.streaming": true
    }
  }, async (span) => {
    span.setAttributes({
      "pi.ai.response.stop_reason": "stop",
      "pi.ai.usage.input_tokens": 12,
      "pi.ai.usage.output_tokens": 7
    });
  });
  await manager.flush({ timeoutMs: 1000, runId: hookContext.runId });

  const events = store.listByRunId(hookContext.runId);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.stage, "model.telemetry");
  assert.equal(events[0]?.payload.spanName, "pi.ai.request");
  assert.equal(events[0]?.payload.modelAttemptId, "run-telemetry:0:0:1");
  assert.equal(events[0]?.payload.provider, "openai");
  assert.equal(events[0]?.payload.inputTokens, 12);

  store.close();
});

test("telemetry wrapping preserves a terminal stream error when provider setup throws", async () => {
  const manager = new DefaultHookManager();
  const telemetry = createPiTelemetryContext({
    hookManager: manager,
    getHookContext: () => hookContext,
    getModelAttemptId: () => "run-telemetry:0:0:2"
  });
  const stream = streamWithPiRuntime({
    id: "unsupported",
    name: "Unsupported",
    api: "pi-messages",
    provider: "custom",
    baseUrl: "https://example.test",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000,
    maxTokens: 100
  }, { messages: [] }, { telemetryContext: telemetry });

  const result = await stream.result();
  assert.equal(result.stopReason, "error");
  assert.match(result.errorMessage ?? "", /Unsupported custom model API/);
});

test("a rejected telemetry callback is recorded as an error even without an error value", async () => {
  const store = new SqliteTraceStore(":memory:");
  const manager = new DefaultHookManager();
  manager.register(new TraceRecorderHook(store));
  const telemetry = createPiTelemetryContext({
    hookManager: manager,
    getHookContext: () => hookContext,
    getModelAttemptId: () => "run-telemetry:0:0:3"
  });

  await assert.rejects(telemetry.startSpan({ name: "pi.ai.request" }, () => Promise.reject()));
  await manager.flush({ timeoutMs: 1000, runId: hookContext.runId });

  const event = store.listByRunId(hookContext.runId)[0];
  assert.equal(event?.stage, "model.telemetry");
  assert.equal(event?.payload.status, "error");
  store.close();
});
