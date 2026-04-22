import assert from "node:assert/strict";
import test from "node:test";
import { resolvePromptAttemptDecision, shouldEmitFinalRunnerError } from "./runnerRetryState.js";

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

test("successful final text suppresses stale runner error replacement", () => {
  assert.equal(shouldEmitFinalRunnerError("Chat upstream returned 429", "模型最终回复"), false);
  assert.equal(shouldEmitFinalRunnerError("Chat upstream returned 429", ""), true);
});
