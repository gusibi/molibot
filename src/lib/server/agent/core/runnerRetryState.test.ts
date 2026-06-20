import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveFinalErrorAction,
  resolvePromptAttemptDecision,
  shouldCountToolResultAsFailure,
  shouldEmitFinalRunnerError
} from "$lib/server/agent/core/runnerRetryState.js";

test("retryable 429 error stays a retryable request error instead of collapsing into empty response", () => {
  const result = resolvePromptAttemptDecision({
    stopReason: "error",
    errorMessage: "Chat upstream returned 429",
    finalText: "",
    attemptCount: 0,
    maxEmptyRetries: 2
  });

  assert.deepEqual(result, {
    kind: "retryable_error",
    message: "Chat upstream returned 429"
  });
});

test("final attempt keeps a terminal request error when retries are exhausted", () => {
  const result = resolvePromptAttemptDecision({
    stopReason: "error",
    errorMessage: "Chat upstream returned 429",
    finalText: "",
    attemptCount: 2,
    maxEmptyRetries: 2
  });

  assert.deepEqual(result, {
    kind: "terminal_error",
    message: "Chat upstream returned 429"
  });
});

test("aborted prompt is terminal and never becomes an empty-response retry", () => {
  const result = resolvePromptAttemptDecision({
    stopReason: "aborted",
    errorMessage: "Command aborted",
    finalText: "",
    attemptCount: 0,
    maxEmptyRetries: 2
  });

  assert.deepEqual(result, { kind: "aborted" });
});

test("successful final text suppresses stale runner error replacement", () => {
  assert.equal(shouldEmitFinalRunnerError("Chat upstream returned 429", "模型最终回复"), false);
  assert.equal(shouldEmitFinalRunnerError("Chat upstream returned 429", ""), true);
});

test("budget-blocked tool calls are not counted as tool failures", () => {
  // A genuine tool error counts as a failure.
  assert.equal(shouldCountToolResultAsFailure(true, false), true);
  // A call blocked by the run budget is a budget signal, not a tool failure —
  // otherwise hitting the tool-call budget cascades into the tool-failure budget.
  assert.equal(shouldCountToolResultAsFailure(true, true), false);
  // A successful call never counts.
  assert.equal(shouldCountToolResultAsFailure(false, false), false);
  assert.equal(shouldCountToolResultAsFailure(false, true), false);
});

test("resolveFinalErrorAction preserves a streamed partial answer instead of wiping it", () => {
  // Nothing to emit when there is no error.
  assert.equal(resolveFinalErrorAction({ errorMessage: undefined, finalText: "", streamedPartial: "" }).kind, "none");
  // The final message already carries a real answer — leave it alone.
  assert.equal(resolveFinalErrorAction({ errorMessage: "boom", finalText: "答案", streamedPartial: "" }).kind, "none");
  // Error with no final text but a visible streamed partial → keep the partial, note the error.
  assert.equal(resolveFinalErrorAction({ errorMessage: "boom", finalText: "", streamedPartial: "已经写了一半" }).kind, "preserve_partial");
  // Error with nothing shown at all → the generic fallback message is acceptable.
  assert.equal(resolveFinalErrorAction({ errorMessage: "boom", finalText: "", streamedPartial: "" }).kind, "generic");
});
