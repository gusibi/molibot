import assert from "node:assert/strict";
import test from "node:test";
import { DefaultHookManager } from "$lib/server/agent/hooks/manager.js";
import { TraceRecorderHook } from "$lib/server/agent/hooks/traceRecorderHook.js";
import { SqliteTraceStore } from "$lib/server/agent/hooks/traceStore.js";
import type { HookContext } from "$lib/server/agent/hooks/types.js";

test("hook manager records a representative run trace timeline", async () => {
  const store = new SqliteTraceStore(":memory:");
  const manager = new DefaultHookManager();
  manager.register(new TraceRecorderHook(store));
  const context: HookContext = {
    runId: "run-e2e",
    channel: "web",
    chatId: "chat-e2e",
    sessionId: "session-e2e",
    workspaceId: "personal"
  };

  manager.emit("run.started", context, { textLength: 20 });
  manager.emit("model.call.before", context, {
    modelAttemptId: "run-e2e:0:0",
    candidateIndex: 0,
    attemptIndex: 0,
    modelCallSeq: 1,
    provider: "test",
    model: "fake-model"
  });
  manager.emit("tool.call.before", context, {
    toolName: "memory",
    toolCallId: "tool-1",
    source: "builtin"
  });
  manager.emit("tool.call.after", context, {
    toolName: "memory",
    toolCallId: "tool-1",
    isError: false
  });
  manager.emit("model.call.after", context, {
    modelAttemptId: "run-e2e:0:0",
    modelCallSeq: 1,
    usage: { input: 10, output: 5, totalTokens: 15 }
  });
  manager.emit("run.finished", context, { status: "success", durationMs: 42 });
  await manager.flush({ timeoutMs: 1000 });

  const stages = store.listByRunId("run-e2e").map((row) => row.stage);
  assert.deepEqual(stages, [
    "run.started",
    "model.call.before",
    "tool.call.before",
    "tool.call.after",
    "model.call.after",
    "run.finished"
  ]);
  store.close();
});
