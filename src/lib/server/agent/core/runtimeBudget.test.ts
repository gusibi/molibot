import assert from "node:assert/strict";
import test from "node:test";
import { buildBudgetStopUserMessage, RunBudget } from "./runtimeBudget.js";

const LIMITS = { maxToolCalls: 100, maxToolFailures: 3, maxModelAttempts: 6 };

test("an exhausted failure budget refuses every later tool instead of needing an abort", () => {
  const budget = new RunBudget(LIMITS);
  assert.equal(budget.tryStartTool().ok, true);
  assert.equal(budget.recordToolResult(true).ok, true);
  assert.equal(budget.recordToolResult(true).ok, true);
  const exhausted = budget.recordToolResult(true);
  assert.equal(exhausted.ok, false);
  assert.equal(budget.getExceededKind(), "toolFailures");
  assert.match(exhausted.reason ?? "", /too many tool failures \(3\/3\)/);

  // Refusing here is what lets the turn wind down on its own: the caller turns
  // this into a blocked tool result and strips the tool list, so the model
  // still gets to write its answer. Killing the request instead is what left a
  // run with nothing but "Request aborted".
  const blocked = budget.tryStartTool();
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, exhausted.reason);
  // A refused call must not inflate the tool-call count.
  assert.equal(budget.snapshot().toolCalls, 1);
});

test("budget kinds are reported structurally, not by matching the reason prose", () => {
  const callBudget = new RunBudget({ ...LIMITS, maxToolCalls: 1 });
  assert.equal(callBudget.tryStartTool().ok, true);
  assert.equal(callBudget.tryStartTool().ok, false);
  assert.equal(callBudget.getExceededKind(), "toolCalls");

  const attemptBudget = new RunBudget({ ...LIMITS, maxModelAttempts: 1 });
  assert.equal(attemptBudget.tryRecordModelAttempt().ok, true);
  assert.equal(attemptBudget.tryRecordModelAttempt().ok, false);
  assert.equal(attemptBudget.getExceededKind(), "modelAttempts");

  const clean = new RunBudget(LIMITS);
  assert.equal(clean.getExceededKind(), undefined);
});

test("the user-facing stop message names the cause and the failing tools", () => {
  const message = buildBudgetStopUserMessage({
    kind: "toolFailures",
    snapshot: { toolCalls: 19, toolFailures: 6, modelAttempts: 1 },
    limits: { maxToolCalls: 100, maxToolFailures: 6, maxModelAttempts: 6 },
    failedToolNames: ["ls", "ls", "read", "subagent"]
  });
  assert.match(message, /连续 6 次工具失败/);
  assert.match(message, /上限 6/);
  // De-duplicated, so a tool that failed three times is named once.
  assert.match(message, /ls、read、subagent/);
  // Never the model-facing instruction text.
  assert.doesNotMatch(message, /Run budget exceeded/);
});
