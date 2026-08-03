import assert from "node:assert/strict";
import test from "node:test";
import {
  describesProjectFileMutationClaim,
  getFileMutationReceipt,
  isRetryableModelError,
  describesUnexecutedMiniAppChange,
  isProjectFileMutationReceipt,
  isMiniAppInstallReceipt,
  REPEATED_TOOL_FAILURE_NOTICE_THRESHOLD,
  resolveFinalErrorAction,
  resolvePromptAttemptDecision,
  shouldCountToolResultAsFailure,
  shouldEmitFinalRunnerError,
  toolFailureSignature,
  trackRepeatedToolFailure,
  verifyProjectFileMutationClaim
} from "$lib/server/agent/core/runnerRetryState.js";

test("Project file completion claims require a successful Project mutation receipt", () => {
  const fabricated = [
    "改动记录（git diff）",
    "```diff",
    "diff --git a/@02-内容创作/a.md b/@02-内容创作/a.md",
    "+invented",
    "```",
    "文件已保存至你指定的目录。"
  ].join("\n");
  assert.equal(describesProjectFileMutationClaim(fabricated), true);
  assert.equal(describesProjectFileMutationClaim("文件尚未修改；目标路径不存在。"), false);
  assert.equal(describesProjectFileMutationClaim("建议修改这个文件。"), false);
  assert.equal(describesProjectFileMutationClaim("公众号短文案已经生成完成。"), false);

  assert.equal(isProjectFileMutationReceipt("edit", true, { details: { rootKind: "project", action: "modified", relativePath: "a.md" } }), false);
  assert.equal(isProjectFileMutationReceipt("edit", false, { details: { rootKind: "scratch", action: "modified", relativePath: "a.md" } }), false);
  assert.equal(isProjectFileMutationReceipt("edit", false, { details: { rootKind: "project", action: "modified", relativePath: "a.md" } }), true);
  assert.equal(isProjectFileMutationReceipt("write", false, { details: { rootKind: "project", action: "created", relativePath: "b.md" } }), true);
  assert.deepEqual(getFileMutationReceipt("write", false, { details: { rootKind: "scratch", action: "created", relativePath: "report.md" } }), {
    rootKind: "scratch",
    action: "created",
    relativePath: "report.md"
  });

  const verified = verifyProjectFileMutationClaim({
    finalText: fabricated,
    userMessage: "你改了什么？",
    successfulMutationCount: 0
  });
  assert.equal(verified.corrected, true);
  assert.doesNotMatch(verified.text, /diff --git|文件已保存/);
  assert.match(verified.text, /没有成功的文件写入回执/);

  assert.deepEqual(
    verifyProjectFileMutationClaim({
      finalText: fabricated,
      userMessage: "请修改文件",
      successfulMutationCount: 1
    }),
    { text: fabricated, corrected: false }
  );
});

test("Mini App completion prose is distinguishable from an honest blocked report", () => {
  assert.equal(describesUnexecutedMiniAppChange("✅ 已为你完成 Mini App 安装和更新，manifest.json 是 1.1.0。"), true);
  assert.equal(describesUnexecutedMiniAppChange("我现在真正更新了 ~/.molibot/miniapps/apps/expense-tracker。"), true);
  assert.equal(describesUnexecutedMiniAppChange("由于路径被拒绝，尚未完成小程序安装。"), false);
  assert.equal(describesUnexecutedMiniAppChange("下面解释如何安装普通 npm 包。"), false);
});

test("only a successful miniAppManage install result counts as an install receipt", () => {
  const receipt = {
    details: {
      action: "install",
      appId: "expense-tracker",
      version: "1.1.0",
      manifestHash: "abc123"
    }
  };
  assert.equal(isMiniAppInstallReceipt("miniAppManage", false, receipt), true);
  assert.equal(isMiniAppInstallReceipt("miniAppManage", true, receipt), false);
  assert.equal(isMiniAppInstallReceipt("miniAppManage", false, {
    details: { ...receipt.details, action: "validate" }
  }), false);
  assert.equal(isMiniAppInstallReceipt("write", false, receipt), false);
});

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

test("repeated tool failures are recognised by class, not by exact error text", () => {
  // The three `ls` calls that started a real run's death spiral carried three
  // different paths in the same error; an exact compare saw three unrelated
  // failures and never warned the model.
  const a = toolFailureSignature("ls", "Path not found: /w/scratch/~/.molibot/miniapps/apps/expense-tracker");
  const b = toolFailureSignature("ls", "Path not found: /w/scratch/~/.molibot/miniapps/apps");
  assert.equal(a, b);
  // A different tool, or a different kind of error, is a different class.
  assert.notEqual(a, toolFailureSignature("read", "Path not found: /w/scratch/~/x"));
  assert.notEqual(a, toolFailureSignature("ls", "Permission denied: /w/scratch/x"));
});

test("a failure streak only counts consecutive failures of the same class", () => {
  let state = trackRepeatedToolFailure(undefined, { signature: "ls::a" });
  assert.deepEqual(state, { signature: "ls::a", count: 1 });
  state = trackRepeatedToolFailure(state, { signature: "ls::a" });
  state = trackRepeatedToolFailure(state, { signature: "ls::a" });
  assert.equal(state?.count, REPEATED_TOOL_FAILURE_NOTICE_THRESHOLD);

  // A success in between means the model is making progress — reset.
  assert.equal(trackRepeatedToolFailure(state, undefined), undefined);
  // So does a different failure class.
  assert.deepEqual(trackRepeatedToolFailure(state, { signature: "read::b" }), { signature: "read::b", count: 1 });
});
