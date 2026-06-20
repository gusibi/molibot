export function isRetryableModelError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    /\b429\b/.test(lower) ||
    lower.includes("rate limit") ||
    lower.includes("too many requests") ||
    lower.includes("quota") ||
    lower.includes("temporarily unavailable") ||
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("econnreset") ||
    lower.includes("socket hang up") ||
    lower.includes("connection reset") ||
    lower.includes("network error") ||
    /\b5\d\d\b/.test(lower)
  );
}

export type PromptAttemptDecision =
  | { kind: "success" }
  | { kind: "aborted" }
  | { kind: "retryable_error"; message: string }
  | { kind: "terminal_error"; message: string }
  | { kind: "retry_empty" }
  | { kind: "terminal_empty" };

export function resolvePromptAttemptDecision(input: {
  stopReason?: "stop" | "aborted" | "error" | "waiting_for_approval";
  errorMessage?: string;
  finalText: string;
  attemptCount: number;
  maxEmptyRetries: number;
}): PromptAttemptDecision {
  if (input.stopReason === "aborted") {
    return { kind: "aborted" };
  }

  if (input.finalText.trim()) {
    return { kind: "success" };
  }

  const normalizedError =
    input.stopReason === "error"
      ? (input.errorMessage?.trim() || "Model request failed without an explicit error message.")
      : "";
  if (normalizedError) {
    return input.attemptCount < input.maxEmptyRetries && isRetryableModelError(normalizedError)
      ? { kind: "retryable_error", message: normalizedError }
      : { kind: "terminal_error", message: normalizedError };
  }

  return input.attemptCount < input.maxEmptyRetries
    ? { kind: "retry_empty" }
    : { kind: "terminal_empty" };
}

export function shouldEmitFinalRunnerError(errorMessage: string | undefined, finalText: string): boolean {
  return Boolean(errorMessage && !finalText.trim());
}

/**
 * Whether an errored tool result should count against the tool-failure budget.
 * A call the runtime deliberately blocked because the tool-CALL budget was hit
 * is a budget signal, not a tool failure — counting it would cascade into the
 * tool-FAILURE budget and trigger a hard abort, bypassing the graceful no-tool
 * continuation that returns the best partial answer.
 */
export function shouldCountToolResultAsFailure(isError: boolean, budgetBlocked: boolean): boolean {
  return isError && !budgetBlocked;
}

export type FinalErrorActionKind = "none" | "preserve_partial" | "generic";

/**
 * Decide how to surface a run that ended with an error.
 * - `none`: no error, or a real final answer was already delivered — leave the message.
 * - `preserve_partial`: a streamed partial answer is visible — keep it, append a short
 *   error note instead of replacing it with a generic message (which loses the partial).
 * - `generic`: nothing was shown to the user — the generic fallback message is acceptable.
 */
export function resolveFinalErrorAction(input: {
  errorMessage: string | undefined;
  finalText: string;
  streamedPartial: string;
}): { kind: FinalErrorActionKind } {
  if (!input.errorMessage || input.finalText.trim()) {
    return { kind: "none" };
  }
  return { kind: input.streamedPartial.trim() ? "preserve_partial" : "generic" };
}
