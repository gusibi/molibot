import { createAssistantMessageEventStream, type AssistantMessage, type AssistantMessageEventStream } from "@earendil-works/pi-ai";
import { isRetryableModelError } from "./runnerRetryState.js";
import { createAbortedAssistantMessage, createErrorAssistantMessage, defaultSleep, extractRetryDelayMs, performRetryWait,
  type ModelRetryOptions } from "./runnerModelRetry.js";

export const APP_MODEL_MAX_RETRIES = 10;
export const APP_MODEL_RECOVERY_TIMEOUT_MS = 180_000;
const RETRY_DELAYS = [2000, 3000, 5000, 8000, 10000];

interface AppModelRetryOptions extends ModelRetryOptions {
  recoveryTimeoutMs?: number;
  now?: () => number;
  random?: () => number;
}

function retryable(error: string): boolean {
  if (/\b(?:400|401|402|403|404|422)\b|model_not_found|unauthori[sz]ed|insufficient|quota exceeded|billing|usage limit|available balance|abort|cancel/i.test(error)) return false;
  return isRetryableModelError(error) || /terminated|econnrefused|enetunreach|ehostunreach|etimedout|eai_again|enotfound/i.test(error);
}

/** Retry only this generation before output; committed tools from earlier generations are never replayed. */
export function invokeAppModelWithRetry(options: AppModelRetryOptions): AssistantMessageEventStream {
  const output = createAssistantMessageEventStream();
  const maxRetries = options.maxRetries ?? APP_MODEL_MAX_RETRIES;
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const recoveryTimeoutMs = options.recoveryTimeoutMs ?? APP_MODEL_RECOVERY_TIMEOUT_MS;

  void (async () => {
    let retries = 0;
    let deadline: number | undefined;
    let lastError = "";
    const failed = async (error: string) => {
      await options.onRetryProgress?.({ phase: "failed", attempt: retries, maxRetries, delayMs: 0, remainingSeconds: 0, error });
    };
    const cancelled = async () => {
      if (retries) await options.onRetryProgress?.({ phase: "cancelled", attempt: retries, maxRetries, delayMs: 0, remainingSeconds: 0, error: "" });
      output.end(createAbortedAssistantMessage());
    };
    while (true) {
      if (options.signal?.aborted) { await cancelled(); return; }
      const controller = new AbortController();
      const abort = () => controller.abort();
      options.signal?.addEventListener("abort", abort, { once: true });
      let timer: ReturnType<typeof setTimeout> | undefined;
      let delivered = false;
      let terminal: AssistantMessage | undefined;
      let error = "";
      const consume = async () => {
        const source = options.produceStream(retries + 1, controller.signal);
        for await (const event of source) {
          if (controller.signal.aborted) return;
          if (["text_delta", "thinking_delta", "toolcall_start", "toolcall_delta", "toolcall_end"].includes(event.type)) delivered = true;
          if (event.type === "error") { terminal = event.error; error = event.error.errorMessage || "Model request failed"; }
          else output.push(event);
        }
        terminal = await source.result();
        if (terminal.stopReason === "error") error = terminal.errorMessage || "Model request failed";
      };
      let rejectAbort: ((cause: Error) => void) | undefined;
      const abortWatch = new Promise<never>((_, reject) => { rejectAbort = reject; });
      const onAbort = () => rejectAbort?.(new Error("Model request aborted"));
      controller.signal.addEventListener("abort", onAbort, { once: true });
      try {
        if (deadline !== undefined) {
          const remaining = deadline - now();
          if (remaining <= 0) throw new Error(lastError || "Model connection recovery timed out");
          timer = setTimeout(() => controller.abort(), remaining);
        }
        await Promise.race([consume(), abortWatch]);
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause);
        if (!options.signal?.aborted && controller.signal.aborted) error = lastError || "Model connection recovery timed out";
      } finally {
        if (timer) clearTimeout(timer);
        controller.abort();
        controller.signal.removeEventListener("abort", onAbort);
        options.signal?.removeEventListener("abort", abort);
      }
      if (options.signal?.aborted) { await cancelled(); return; }
      if (!error && terminal) {
        if (retries) await options.onRetryProgress?.({ phase: "recovered", attempt: retries, maxRetries, delayMs: 0, remainingSeconds: 0, error: "" });
        output.end(terminal); return;
      }
      lastError = error || "Model request failed without a terminal response";
      delivered ||= Boolean(terminal?.content?.length);
      if (delivered || !retryable(lastError) || retries >= maxRetries) {
        if (retries) await failed(lastError);
        output.end(terminal?.stopReason === "error" ? terminal : createErrorAssistantMessage(lastError)); return;
      }
      deadline ??= now() + recoveryTimeoutMs;
      const base = RETRY_DELAYS[Math.min(retries, RETRY_DELAYS.length - 1)];
      const hint = extractRetryDelayMs(lastError, 1, { baseDelayMs: 0, maxDelayMs: Number.MAX_SAFE_INTEGER });
      const delayMs = Math.max(hint, Math.round(base * (0.9 + random() * 0.2)));
      if (now() + delayMs >= deadline) {
        await failed(lastError);
        output.end(createErrorAssistantMessage(lastError)); return;
      }
      retries++;
      const resume = await performRetryWait({ attempt: retries, maxRetries, delayMs, error: lastError,
        parentSignal: options.signal, onProgress: options.onRetryProgress, sleepFn: options.sleepFn ?? defaultSleep });
      if (!resume) { await cancelled(); return; }
    }
  })().catch(cause => output.end(createErrorAssistantMessage(cause instanceof Error ? cause.message : String(cause))));
  return output;
}
