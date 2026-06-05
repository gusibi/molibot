import assert from "node:assert/strict";
import test from "node:test";
import { ACTIVE_TURN_CONFLICT_ERROR_MESSAGE } from "$lib/server/agent/core/turnOrchestrator.js";
import { retryApprovalAutoResume } from "$lib/server/channels/shared/approvalAutoResume.js";

test("retryApprovalAutoResume retries session lock conflicts and then completes", async () => {
  const warnings: string[] = [];
  let attempts = 0;

  await retryApprovalAutoResume({
    maxAttempts: 3,
    delayMs: 0,
    run: async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error(ACTIVE_TURN_CONFLICT_ERROR_MESSAGE);
      }
    },
    onWarn: (event, meta) => {
      warnings.push(`${event}:${meta.attempt}`);
    }
  });

  assert.equal(attempts, 2);
  assert.deepEqual(warnings, ["approval_auto_resume_retrying:1"]);
});

test("retryApprovalAutoResume can wait through a long-running active session", async () => {
  let attempts = 0;

  await retryApprovalAutoResume({
    maxAttempts: 30,
    delayMs: 0,
    run: async () => {
      attempts += 1;
      if (attempts < 25) {
        throw new Error(ACTIVE_TURN_CONFLICT_ERROR_MESSAGE);
      }
    }
  });

  assert.equal(attempts, 25);
});

test("retryApprovalAutoResume stops retrying on non-lock failures and triggers exhaustion handler", async () => {
  const warnings: string[] = [];
  let exhausted = false;

  await retryApprovalAutoResume({
    maxAttempts: 3,
    delayMs: 0,
    run: async () => {
      throw new Error("boom");
    },
    onWarn: (event, meta) => {
      warnings.push(`${event}:${meta.attempt}:${meta.error}`);
    },
    onRetryExhausted: async () => {
      exhausted = true;
    }
  });

  assert.equal(exhausted, true);
  assert.deepEqual(warnings, ["approval_auto_resume_failed:1:boom"]);
});
