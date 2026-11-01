import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { createModels, createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { getPiModels } from "./piRegistry.js";
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
  }, { messages: [] }, { telemetry });

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


test("Pi telemetry provides a parent span and accepts native request attributes", async () => {
  const store = new SqliteTraceStore(":memory:");
  const manager = new DefaultHookManager();
  manager.register(new TraceRecorderHook(store));
  let usage: unknown;
  manager.register({ id: "native-usage", stages: ["model.telemetry"], kind: "observe",
    handle: event => { usage = (event.payload as { usage: unknown }).usage; } });
  const telemetry = createPiTelemetryContext({ hookManager: manager,
    getHookContext: () => hookContext, getModelAttemptId: () => "native-attempt" });
  assert.equal(typeof telemetry.addLink, "function");
  assert.equal(typeof telemetry.setAttributes, "function");
  await telemetry.startSpan({ name: "pi.ai.request", attributes: { provider: "fixture", model: "model", api: "openai-completions" } }, async span => {
    span.addLink({ context: telemetry });
    span.setAttributes({ stop: "toolUse", "usage.input": 12, "usage.output": 7,
      "usage.cache_read": 3, "usage.cache_write": 1 });
  });
  await manager.flush({ timeoutMs: 1000, runId: hookContext.runId });
  const events = store.listByRunId(hookContext.runId);
  assert.equal(events.length, 1);
  assert.equal(events[0].payload.provider, "fixture");
  assert.equal(events[0].payload.model, "model");
  assert.equal(events[0].payload.stopReason, "tool_use");
  assert.equal(events[0].payload.inputTokens, 12);
  assert.deepEqual(usage, { input: 12, output: 7, cacheRead: 3, cacheWrite: 1, totalTokens: 23 });
  store.close();
});


test("native Models emits exactly one request span through the production stream adapter", { timeout: 5000 }, async () => {
  const store = new SqliteTraceStore(":memory:");
  const manager = new DefaultHookManager();
  manager.register(new TraceRecorderHook(store));
  const model = getPiModels().getModels("openai")[0];
  assert.ok(model);
  const models = createModels();
  const stream = () => {
    const events = createAssistantMessageEventStream();
    events.push({ type: "done", reason: "stop", message: { role: "assistant", api: model.api,
      provider: model.provider, model: model.id, content: [{ type: "text", text: "fixture" }],
      timestamp: Date.now(), stopReason: "stop", usage: { input: 4, output: 2, cacheRead: 0, cacheWrite: 0,
        totalTokens: 6, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } });
    events.end();
    return events;
  };
  models.setProvider({ id: model.provider, name: "Fixture", getModels: () => [model], stream, streamSimple: stream,
    auth: { apiKey: { name: "Fixture", resolve: async () => ({ auth: { apiKey: "fixture" } }) } } });
  const replacement = mock.method(getPiModels(), "streamSimple", (...args: Parameters<typeof models.streamSimple>) => models.streamSimple(...args));
  let recorded!: () => void;
  const observed = new Promise<void>(resolve => { recorded = resolve; });
  manager.register({ id: "native-finished", stages: ["model.telemetry"], kind: "observe", handle: () => { recorded(); } });
  try {
    const telemetry = createPiTelemetryContext({ hookManager: manager,
      getHookContext: () => hookContext, getModelAttemptId: () => "native-models" });
    const result = await streamWithPiRuntime(model, { messages: [] }, { telemetry, apiKey: "fixture" }).result();
    assert.equal(result.stopReason, "stop", result.errorMessage);
    await observed;
    await manager.flush({ timeoutMs: 1000, runId: hookContext.runId });
    const events = store.listByRunId(hookContext.runId);
    assert.equal(events.length, 1);
    assert.equal(events[0].payload.spanName, "pi.ai.request");
    assert.equal(events[0].payload.provider, model.provider);
    assert.equal(events[0].payload.inputTokens, 4);
    assert.equal(events[0].payload.outputTokens, 2);
  } finally { replacement.mock.restore(); store.close(); }
});


test("a late span keeps its original run identity after the active request is cleared", async () => {
  const store = new SqliteTraceStore(":memory:");
  const manager = new DefaultHookManager();
  manager.register(new TraceRecorderHook(store));
  let active: HookContext | undefined = hookContext;
  let attempt: string | undefined = "original-attempt";
  const telemetry = createPiTelemetryContext({ hookManager: manager,
    getHookContext: () => active, getModelAttemptId: () => attempt });
  await telemetry.startSpan({ name: "pi.ai.request" }, async () => {
    active = undefined;
    attempt = undefined;
  });
  await manager.flush({ timeoutMs: 1000, runId: hookContext.runId });
  const events = store.listByRunId(hookContext.runId);
  assert.equal(events.length, 1);
  assert.equal(events[0].payload.modelAttemptId, "original-attempt");
  store.close();
});
