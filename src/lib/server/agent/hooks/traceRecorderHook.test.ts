import assert from "node:assert/strict";
import test from "node:test";
import { DefaultHookManager } from "$lib/server/agent/hooks/manager.js";
import { TraceRecorderHook } from "$lib/server/agent/hooks/traceRecorderHook.js";
import { SqliteTraceStore } from "$lib/server/agent/hooks/traceStore.js";
import type { HookContext } from "$lib/server/agent/hooks/types.js";

function context(runId: string): HookContext {
  return {
    runId,
    channel: "web",
    botId: "web-profile-1",
    chatId: "chat-1",
    sessionId: "session-1",
    workspaceId: "personal",
    actorId: "user-1"
  };
}

test("TraceRecorderHook writes sanitized trace events to SQLite", async () => {
  const store = new SqliteTraceStore(":memory:");
  const manager = new DefaultHookManager();
  manager.register(new TraceRecorderHook(store));

  manager.emit("run.started", context("run-1"), {
    textLength: 12,
    secret: "should-not-be-captured",
    apiKey: "sk-test"
  });
  await manager.flush({ timeoutMs: 1000 });

  const rows = store.listByRunId("run-1");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.stage, "run.started");
  assert.equal(rows[0]?.botId, "web-profile-1");
  assert.equal(rows[0]?.payload.textLength, 12);
  assert.equal(rows[0]?.payload.secret, undefined);
  assert.equal(rows[0]?.payload.apiKey, undefined);
  store.close();
});

test("TraceRecorderHook isolates run state and purges it on run.finished", async () => {
  const store = new SqliteTraceStore(":memory:");
  const hook = new TraceRecorderHook(store);
  const manager = new DefaultHookManager();
  manager.register(hook);

  manager.emit("tool.call.before", context("run-a"), { toolName: "memory", toolCallId: "tool-a" });
  manager.emit("tool.call.before", context("run-b"), { toolName: "bash", toolCallId: "tool-b" });
  await manager.flush({ timeoutMs: 1000 });

  assert.equal(hook.getActiveRunCountForTest(), 2);

  manager.emit("run.finished", context("run-a"), { status: "success" });
  await manager.flush({ timeoutMs: 1000 });

  assert.equal(hook.getActiveRunCountForTest(), 1);
  assert.equal(store.listByRunId("run-a").some((row) => row.stage === "run.finished"), true);
  assert.equal(store.listByRunId("run-b").some((row) => row.payload.toolName === "bash"), true);
  store.close();
});

test("TraceRecorderHook records memory as a normal tool event", async () => {
  const store = new SqliteTraceStore(":memory:");
  const manager = new DefaultHookManager();
  manager.register(new TraceRecorderHook(store));

  manager.emit("tool.call.before", context("run-memory"), {
    toolName: "memory",
    source: "builtin",
    toolCallId: "tool-memory"
  });
  await manager.flush({ timeoutMs: 1000 });

  const rows = store.listByRunId("run-memory");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.stage, "tool.call.before");
  assert.equal(rows[0]?.payload.toolName, "memory");
  store.close();
});

test("TraceRecorderHook writes unified tool and model call facts for analysis", async () => {
  const store = new SqliteTraceStore(":memory:");
  const manager = new DefaultHookManager();
  manager.register(new TraceRecorderHook(store));
  const runContext = context("run-facts");

  manager.emit("model.call.before", runContext, {
    modelAttemptId: "run-facts:0:0",
    modelCallSeq: 1,
    provider: "test-provider",
    model: "test-model",
    api: "openai-compatible"
  });
  manager.emit("tool.call.before", runContext, {
    toolName: "memory",
    toolCallId: "tool-memory",
    argsPreview: "{\"query\":\"hello\"}"
  });
  manager.emit("tool.call.after", runContext, {
    toolName: "memory",
    toolCallId: "tool-memory",
    isError: false,
    resultPreview: "remembered"
  });
  manager.emit("tool.call.before", runContext, {
    toolName: "bash",
    toolCallId: "tool-bash",
    argsPreview: "{\"cmd\":\"date\"}"
  });
  manager.emit("tool.call.error", runContext, {
    toolName: "bash",
    toolCallId: "tool-bash",
    isError: true,
    resultPreview: "failed"
  });
  manager.emit("model.call.after", runContext, {
    modelAttemptId: "run-facts:0:0",
    modelCallSeq: 1,
    usage: { input: 10, output: 5, cacheRead: 3, cacheWrite: 2 },
    stopReason: "stop"
  });
  await manager.flush({ timeoutMs: 1000 });

  const sessionFacts = store.listFactsBySessionId("session-1");
  const toolFacts = sessionFacts.filter((row) => row.factType === "tool_call");
  const modelFacts = sessionFacts.filter((row) => row.factType === "model_call");

  assert.equal(toolFacts.length, 2);
  assert.equal(new Set(toolFacts.map((row) => row.name)).size, 2);
  assert.equal(modelFacts.length, 1);
  assert.equal(modelFacts[0]?.provider, "test-provider");
  assert.equal(modelFacts[0]?.model, "test-model");
  assert.equal(modelFacts[0]?.inputTokens, 10);
  assert.equal(modelFacts[0]?.outputTokens, 5);
  assert.equal(modelFacts[0]?.cacheReadTokens, 3);
  assert.equal(modelFacts[0]?.cacheWriteTokens, 2);
  assert.equal(modelFacts[0]?.totalTokens, 20);
  assert.equal(modelFacts[0]?.botId, "web-profile-1");
  assert.equal(toolFacts.find((row) => row.name === "memory")?.status, "success");
  assert.equal(toolFacts.find((row) => row.name === "bash")?.status, "error");

  const runFacts = store.listFactsByRunId("run-facts");
  assert.equal(runFacts.filter((row) => row.factType === "tool_call").length, 2);
  assert.equal(runFacts.filter((row) => row.factType === "model_call").length, 1);
  store.close();
});

test("TraceRecorderHook writes blocked tool facts without a before event", async () => {
  const store = new SqliteTraceStore(":memory:");
  const manager = new DefaultHookManager();
  manager.register(new TraceRecorderHook(store));

  manager.emit("tool.call.blocked", context("run-blocked"), {
    toolName: "bash",
    toolCallId: "tool-blocked",
    blockedBy: "hook_gate",
    reason: "blocked by test"
  });
  await manager.flush({ timeoutMs: 1000 });

  const facts = store.listFactsByRunId("run-blocked");
  assert.equal(facts.length, 1);
  assert.equal(facts[0]?.factType, "tool_call");
  assert.equal(facts[0]?.name, "bash");
  assert.equal(facts[0]?.status, "blocked");
  assert.equal(facts[0]?.blockedBy, "hook_gate");
  store.close();
});
