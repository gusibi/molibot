import assert from "node:assert/strict";
import test from "node:test";
import {
  isRetryableModelError,
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

test("a retryable error becomes terminal once tools have executed, to avoid re-running side effects", () => {
  const result = resolvePromptAttemptDecision({
    stopReason: "error",
    errorMessage: "Chat upstream returned 429",
    finalText: "",
    attemptCount: 0,
    maxEmptyRetries: 2,
    attemptExecutedTools: true
  });

  // Retrying would re-run the tool steps (e.g. re-send a message), so the
  // otherwise-retryable 429 is treated as terminal instead.
  assert.deepEqual(result, {
    kind: "terminal_error",
    message: "Chat upstream returned 429"
  });
});

test("a retryable error still retries when no tools executed in the failed attempt", () => {
  const result = resolvePromptAttemptDecision({
    stopReason: "error",
    errorMessage: "socket hang up",
    finalText: "",
    attemptCount: 0,
    maxEmptyRetries: 2,
    attemptExecutedTools: false
  });

  assert.deepEqual(result, {
    kind: "retryable_error",
    message: "socket hang up"
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

test("account-level exhaustion is never retried, unlike a transient 429", () => {
  // These arrive as 429s and used to match the bare `quota` substring, so a
  // drained subscription burned every retry before failing anyway.
  assert.equal(isRetryableModelError("429 insufficient_quota: You exceeded your current quota"), false);
  assert.equal(isRetryableModelError("Monthly usage limit reached; enable available balance"), false);
  assert.equal(isRetryableModelError("billing hard limit reached"), false);

  assert.equal(isRetryableModelError("Chat upstream returned 429"), true);
  assert.equal(isRetryableModelError("rate limit exceeded, please retry"), true);
});

test("transport failures pi tracks are retryable without this project listing them", () => {
  assert.equal(isRetryableModelError("upstream connect error or disconnect/reset before headers"), true);
  assert.equal(isRetryableModelError("fetch failed"), true);
  assert.equal(isRetryableModelError("Anthropic stream ended before message_stop"), true);
  assert.equal(isRetryableModelError("WebSocket closed unexpectedly"), true);

  // Still covered by the patterns kept from the original matcher.
  assert.equal(isRetryableModelError("read ECONNRESET"), true);
  assert.equal(isRetryableModelError("Service temporarily unavailable"), true);

  assert.equal(isRetryableModelError("invalid_request_error: unknown model"), false);
  assert.equal(isRetryableModelError(""), false);
});
