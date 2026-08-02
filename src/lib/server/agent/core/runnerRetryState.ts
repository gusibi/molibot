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

/**
 * Detects a Mini App completion receipt written as prose when the attempt ran
 * no tools. The runner uses this only under the zero-tool gate, so retrying can
 * never duplicate a file write or installation side effect.
 */
export function describesUnexecutedMiniAppChange(finalText: string): boolean {
  const text = String(finalText ?? "").replace(/\s+/g, " ").trim();
  if (!text) return false;
  const namesMiniApp = /mini\s*app|miniapp|小程序|miniapps[\\/]+apps|manifest\.json/i.test(text);
  const claimsCompletion =
    /(?:已(?:经)?|成功|完成).{0,24}(?:安装|更新|写入|替换|修改)/i.test(text) ||
    /(?:安装|更新|写入|替换|修改).{0,16}(?:完成|成功)/i.test(text) ||
    /我.{0,16}(?:安装|更新|写入|替换|修改)了/i.test(text);
  const reportsBlocker = /(?:没有|并未|未能|尚未|无法|不能).{0,16}(?:安装|更新|写入|替换|修改|完成)/i.test(text);
  return namesMiniApp && claimsCompletion && !reportsBlocker;
}

/**
 * A successful install is the only tool result that proves the live Mini App
 * tree changed. File writes can target a scratch build and validate/inspect are
 * deliberately non-mutating, so merely observing "some tool" is not enough.
 */
export function isMiniAppInstallReceipt(
  toolName: string,
  isError: boolean,
  result: unknown
): boolean {
  if (toolName !== "miniAppManage" || isError || !result || typeof result !== "object") return false;
  const details = (result as { details?: unknown }).details;
  if (!details || typeof details !== "object") return false;
  const receipt = details as Record<string, unknown>;
  return receipt.action === "install" &&
    typeof receipt.appId === "string" && receipt.appId.length > 0 &&
    typeof receipt.version === "string" && receipt.version.length > 0 &&
    typeof receipt.manifestHash === "string" && receipt.manifestHash.length > 0;
}

/** How many identical failures in a row earn a corrective runtime notice. */
export const REPEATED_TOOL_FAILURE_NOTICE_THRESHOLD = 3;

/**
 * Signature for "the same tool failed the same way again".
 *
 * Error bodies carry the offending path, so an exact-string compare would treat
 * three `ls` calls on three different `~/...` paths as three unrelated
 * failures. Digits, quoted fragments and anything path-shaped are folded away
 * so the signature describes the *class* of failure, which is what the model
 * needs to be told about.
 */
export function toolFailureSignature(toolName: string, errorText: string): string {
  const normalized = String(errorText ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[~$]?[\w.@%+-]*\/[\w./@%+-]*/g, "<path>")
    .replace(/\d+/g, "<n>")
    .slice(0, 160);
  return `${toolName}::${normalized}`;
}

/**
 * Track consecutive identical failures. Any success, or a failure of a
 * different class, resets the streak — we only want to interrupt a model that
 * is genuinely stuck in a loop, not one that is making progress with the odd
 * error along the way.
 */
export function trackRepeatedToolFailure(
  previous: { signature: string; count: number } | undefined,
  next: { signature: string } | undefined
): { signature: string; count: number } | undefined {
  if (!next) return undefined;
  if (previous?.signature === next.signature) {
    return { signature: next.signature, count: previous.count + 1 };
  }
  return { signature: next.signature, count: 1 };
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
