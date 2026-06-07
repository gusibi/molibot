import assert from "node:assert/strict";
import test from "node:test";
import { RuntimeLogHook } from "$lib/server/agent/hooks/runtimeLogHook.js";
import type { HookContext } from "$lib/server/agent/hooks/types.js";

const context: HookContext = {
  runId: "run-1",
  channel: "web",
  chatId: "chat-1",
  sessionId: "session-1",
  workspaceId: "personal"
};

test("RuntimeLogHook maps run lifecycle hook events to runner logs", () => {
  const calls: Array<{ level: string; scope: string; event: string; data?: Record<string, unknown> }> = [];
  const hook = new RuntimeLogHook({
    log: (scope, event, data) => calls.push({ level: "log", scope, event, data }),
    warn: (scope, event, data) => calls.push({ level: "warn", scope, event, data }),
    error: (scope, event, data) => calls.push({ level: "error", scope, event, data })
  });

  hook.handle({
    stage: "run.beforeStart",
    kind: "observe",
    timestamp: "2026-06-07T00:00:00.000Z",
    context,
    payload: {
      messageId: 42,
      textLength: 12,
      attachmentCount: 1,
      imageCount: 0,
      isEvent: false
    }
  });
  hook.handle({
    stage: "run.finished",
    kind: "observe",
    timestamp: "2026-06-07T00:00:01.000Z",
    context,
    payload: {
      status: "success",
      stopReason: "stop",
      durationMs: 1000
    }
  });

  assert.deepEqual(calls.map((call) => `${call.level}:${call.scope}:${call.event}`), [
    "log:runner:run_start",
    "log:runner:run_end"
  ]);
  assert.deepEqual(calls[0]?.data, {
    runId: "run-1",
    workspaceId: "personal",
    chatId: "chat-1",
    sessionId: "session-1",
    messageId: 42,
    textLength: 12,
    attachments: 1,
    images: 0,
    isEvent: false
  });
  assert.equal(calls[1]?.data?.hasError, false);
});

test("RuntimeLogHook maps tool hook events to tool logs", () => {
  const calls: Array<{ level: string; scope: string; event: string; data?: Record<string, unknown> }> = [];
  const hook = new RuntimeLogHook({
    log: (scope, event, data) => calls.push({ level: "log", scope, event, data }),
    warn: (scope, event, data) => calls.push({ level: "warn", scope, event, data }),
    error: (scope, event, data) => calls.push({ level: "error", scope, event, data })
  });

  hook.handle({
    stage: "tool.call.before",
    kind: "observe",
    timestamp: "2026-06-07T00:00:00.000Z",
    context,
    payload: {
      toolName: "bash",
      displayName: "Host Bash",
      label: "Host Bash: Run tests"
    }
  });
  hook.handle({
    stage: "tool.call.error",
    kind: "observe",
    timestamp: "2026-06-07T00:00:01.000Z",
    context,
    payload: {
      toolName: "bash",
      displayName: "Host Bash",
      resultPreview: "failed"
    }
  });
  hook.handle({
    stage: "tool.call.blocked",
    kind: "observe",
    timestamp: "2026-06-07T00:00:02.000Z",
    context,
    payload: {
      toolName: "bash",
      displayName: "Host Bash",
      blockedBy: "budget",
      reason: "tool call budget exhausted"
    }
  });

  assert.deepEqual(calls.map((call) => `${call.level}:${call.event}`), [
    "log:tool_start",
    "log:tool_end",
    "warn:tool_call_blocked"
  ]);
  assert.equal(calls[0]?.data?.label, "Host Bash: Run tests");
  assert.equal(calls[1]?.data?.isError, true);
  assert.equal(calls[2]?.data?.blockedBy, "budget");
});
