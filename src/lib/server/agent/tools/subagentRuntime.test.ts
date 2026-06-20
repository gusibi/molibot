import assert from "node:assert/strict";
import test from "node:test";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";
import {
  armSubagentDeadline,
  DEFAULT_SUBAGENT_DEADLINE_MS,
  evaluateSubagentEvent,
  resolveSubagentBudgetLimits,
  shouldFallbackToNextModel,
  SubagentExecutionGuard
} from "$lib/server/agent/tools/subagentRuntime.js";

const TEST_LIMITS = { maxToolCalls: 24, maxToolFailures: 6, maxModelAttempts: 6 };

test("guard blocks tool calls once the tool-call budget is exhausted and exposes a structured stop reason", () => {
  const guard = new SubagentExecutionGuard({
    limits: { maxToolCalls: 2, maxToolFailures: 6, maxModelAttempts: 6 }
  });

  assert.equal(guard.beforeToolCall().ok, true);
  assert.equal(guard.beforeToolCall().ok, true);

  const blocked = guard.beforeToolCall();
  assert.equal(blocked.ok, false);
  assert.match(String(blocked.reason), /too many tool calls/);

  const stop = guard.getStopReason();
  assert.equal(stop?.kind, "budget_exceeded");
  assert.match(String(stop?.reason), /too many tool calls/);
});

test("guard aborts when the wall-clock deadline is exceeded", () => {
  let now = 1_000;
  const guard = new SubagentExecutionGuard({
    limits: { maxToolCalls: 24, maxToolFailures: 6, maxModelAttempts: 6 },
    deadlineMs: 5_000,
    now: () => now
  });

  assert.equal(guard.checkDeadline().ok, true);
  now = 6_500; // 5_500ms elapsed, past the 5_000ms deadline
  const expired = guard.checkDeadline();
  assert.equal(expired.ok, false);
  assert.match(String(expired.reason), /time budget|deadline/i);

  const stop = guard.getStopReason();
  assert.equal(stop?.kind, "timeout");
});

test("guard reports no stop reason while within budget and deadline", () => {
  const guard = new SubagentExecutionGuard({
    limits: { maxToolCalls: 24, maxToolFailures: 6, maxModelAttempts: 6 },
    deadlineMs: 60_000
  });
  guard.beforeToolCall();
  guard.recordToolResult(false);
  assert.equal(guard.getStopReason(), undefined);
});

test("evaluateSubagentEvent aborts the session when a tool_execution_start exhausts the budget", () => {
  const guard = new SubagentExecutionGuard({
    limits: { maxToolCalls: 1, maxToolFailures: 6, maxModelAttempts: 6 }
  });

  assert.equal(evaluateSubagentEvent(guard, { type: "tool_execution_start", toolName: "bash" }).abort, false);

  const second = evaluateSubagentEvent(guard, { type: "tool_execution_start", toolName: "bash" });
  assert.equal(second.abort, true);
  assert.match(String(second.reason), /too many tool calls/);
});

test("evaluateSubagentEvent aborts when repeated tool errors exhaust the failure budget", () => {
  const guard = new SubagentExecutionGuard({
    limits: { maxToolCalls: 24, maxToolFailures: 2, maxModelAttempts: 6 }
  });

  evaluateSubagentEvent(guard, { type: "tool_execution_end", toolName: "bash", isError: true });
  const second = evaluateSubagentEvent(guard, { type: "tool_execution_end", toolName: "bash", isError: true });
  assert.equal(second.abort, true);
  assert.match(String(second.reason), /too many tool failures/);
});

test("evaluateSubagentEvent ignores unrelated events and does not abort", () => {
  const guard = new SubagentExecutionGuard({
    limits: { maxToolCalls: 24, maxToolFailures: 6, maxModelAttempts: 6 }
  });
  assert.equal(evaluateSubagentEvent(guard, { type: "message_update" }).abort, false);
  assert.equal(evaluateSubagentEvent(guard, { type: "tool_execution_end", toolName: "bash", isError: false }).abort, false);
});

test("shouldFallbackToNextModel retries only on a plain model error", () => {
  // A model-call error with budget/deadline left intact: try the next model.
  assert.equal(shouldFallbackToNextModel({ stopReason: "error" }), true);
});

test("shouldFallbackToNextModel does not retry on success, abort or approval", () => {
  assert.equal(shouldFallbackToNextModel({ stopReason: "stop" }), false);
  assert.equal(shouldFallbackToNextModel({ stopReason: "aborted" }), false);
  assert.equal(shouldFallbackToNextModel({ stopReason: "waiting_for_approval" }), false);
});

test("shouldFallbackToNextModel does not waste another model when budget/timeout stopped the run", () => {
  assert.equal(
    shouldFallbackToNextModel({ stopReason: "error", runtimeStopKind: "budget_exceeded" }),
    false
  );
  assert.equal(
    shouldFallbackToNextModel({ stopReason: "error", runtimeStopKind: "timeout" }),
    false
  );
});

test("guard reports remaining time until the deadline and clamps at zero", () => {
  let now = 1_000;
  const guard = new SubagentExecutionGuard({ limits: TEST_LIMITS, deadlineMs: 5_000, now: () => now });
  assert.equal(guard.remainingMs(), 5_000);
  now = 4_000; // 3_000 elapsed
  assert.equal(guard.remainingMs(), 2_000);
  now = 9_000; // past the deadline
  assert.equal(guard.remainingMs(), 0);
});

test("guard without a deadline reports no remaining time", () => {
  const guard = new SubagentExecutionGuard({ limits: TEST_LIMITS });
  assert.equal(guard.remainingMs(), undefined);
});

test("armSubagentDeadline schedules expiry at the remaining deadline and the returned clear cancels it", () => {
  const guard = new SubagentExecutionGuard({ limits: TEST_LIMITS, deadlineMs: 5_000, now: () => 0 });
  const scheduled: Array<{ ms: number; cb: () => void }> = [];
  let clearedHandle: unknown;
  const scheduler = {
    setTimer: (cb: () => void, ms: number) => {
      const handle = { ms, cb };
      scheduled.push(handle);
      return handle;
    },
    clearTimer: (handle: unknown) => {
      clearedHandle = handle;
    }
  };

  let expired = false;
  const clear = armSubagentDeadline(guard, () => { expired = true; }, scheduler);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0]?.ms, 5_000);

  scheduled[0]?.cb();
  assert.equal(expired, true);

  clear();
  assert.equal(clearedHandle, scheduled[0]);
});

test("armSubagentDeadline is a no-op when the guard has no deadline", () => {
  const guard = new SubagentExecutionGuard({ limits: TEST_LIMITS });
  const scheduler = {
    setTimer: () => {
      throw new Error("should not schedule without a deadline");
    },
    clearTimer: () => {}
  };
  const clear = armSubagentDeadline(guard, () => {}, scheduler);
  clear(); // must not throw
});

test("resolveSubagentBudgetLimits falls back to defaults and applies the subagent deadline default", () => {
  const limits = resolveSubagentBudgetLimits(defaultRuntimeSettings);
  assert.ok(limits.maxToolCalls > 0);
  assert.ok(limits.maxToolFailures > 0);
  assert.ok(limits.maxModelAttempts > 0);
  assert.ok(DEFAULT_SUBAGENT_DEADLINE_MS > 0);
});
