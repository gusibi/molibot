function isRetryableModelError(message: string): boolean {
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
  | { kind: "retryable_error"; message: string }
  | { kind: "terminal_error"; message: string }
  | { kind: "retry_empty" }
  | { kind: "terminal_empty" };

export function resolvePromptAttemptDecision(input: {
  stopReason?: "stop" | "aborted" | "error";
  errorMessage?: string;
  finalText: string;
  attemptCount: number;
  maxEmptyRetries: number;
}): PromptAttemptDecision {
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
