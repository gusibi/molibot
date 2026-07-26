import type { AssistantMessage } from "@earendil-works/pi-ai";
import { isRetryableAssistantError } from "@earendil-works/pi-ai";

/**
 * Wrap a bare error string as the failed assistant message pi's classifiers
 * expect. Both `isRetryableAssistantError` and `isContextOverflow` only read
 * `stopReason`/`errorMessage`/`usage` on the error path, but the usage block is
 * filled in so the silent-overflow branch cannot read `undefined`.
 */
export function assistantErrorFromText(message: string): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    stopReason: "error",
    errorMessage: message,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
  } as unknown as AssistantMessage;
}

/**
 * Account-level exhaustion, checked before anything else.
 *
 * These arrive as 429s and used to match the bare `quota` substring below, so a
 * drained subscription burned the whole retry budget (and, through
 * `generateSummaryWithRetry`, delayed compaction) before failing anyway. pi
 * carries the same exclusion list in `isRetryableAssistantError`, but it cannot
 * be reused directly: pi returns a plain `false` for both "not transient" and
 * "never retry", and only the latter must also suppress model fallback.
 */
const NON_RETRYABLE_PATTERN =
  /insufficient_quota|quota exceeded|out of budget|billing|usage limit reached|available balance/i;

/**
 * Transient signals pi's pattern list does not carry, kept from the original
 * hand-rolled matcher: `ECONNRESET`, bare "connection reset", the generic
 * "temporarily unavailable" wording, and any bare 5xx status in the text.
 */
const EXTRA_RETRYABLE_PATTERN = /econnreset|connection reset|temporarily unavailable|\b5\d\d\b/i;

/**
 * Classify a provider error string for retry.
 *
 * The transient half is delegated to pi's `isRetryableAssistantError`, which
 * tracks provider-specific transport wording (`upstream connect`, `fetch
 * failed`, `stream ended before message_stop`, WebSocket closes, gRPC
 * `ResourceExhausted`, …) that this project would otherwise have to chase on
 * its own.
 */
export function isRetryableModelError(message: string): boolean {
  if (!message) return false;
  if (NON_RETRYABLE_PATTERN.test(message)) return false;
  if (isRetryableAssistantError(assistantErrorFromText(message))) return true;
  return EXTRA_RETRYABLE_PATTERN.test(message);
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
  /**
   * Whether the failed attempt already executed tool steps. Retrying re-runs the
   * whole attempt from scratch, so if tools ran we must NOT retry — re-execution
   * would repeat non-idempotent side effects (sent messages, written files).
   * Such an error is treated as terminal even when otherwise retryable.
   */
  attemptExecutedTools?: boolean;
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
    const canRetry =
      input.attemptCount < input.maxEmptyRetries &&
      isRetryableModelError(normalizedError) &&
      !input.attemptExecutedTools;
    return canRetry
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
