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
