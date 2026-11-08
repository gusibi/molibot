import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEventStream
} from "@earendil-works/pi-ai";
import { isRetryableModelError } from "./runnerRetryState.js";

export interface ModelRetryProgress {
  phase: "scheduled" | "countdown" | "attempt_start" | "recovered" | "failed";
  attempt: number;
  maxRetries: number;
  delayMs: number;
  remainingSeconds: number;
  error: string;
}

export interface ModelRetryOptions {
  produceStream: (attemptIndex: number, signal: AbortSignal) => AssistantMessageEventStream;
  signal?: AbortSignal;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  onRetryProgress?: (progress: ModelRetryProgress) => void | Promise<void>;
  /** Injectable sleep helper for deterministic unit testing */
  sleepFn?: (ms: number, signal?: AbortSignal) => Promise<boolean>;
}

/**
 * Extract suggested retry delay in milliseconds from 429 error messages / response bodies.
 * Supports:
 * - `"reset_seconds": 29`
 * - `"reset_time": "29s"` / `Retry-After: 29`
 * - `after 30 s` / `retry shortly (after 30 s)` / `retry after 30s`
 * - `try again in 15 seconds` / `wait 15s`
 * Falls back to exponential backoff (e.g. 2s, 4s, 8s, 16s, 30s).
 */
export function extractRetryDelayMs(
  errorText: string,
  attempt = 1,
  options?: { baseDelayMs?: number; maxDelayMs?: number }
): number {
  const base = options?.baseDelayMs ?? 2000;
  const max = options?.maxDelayMs ?? 60000;
  if (!errorText) return Math.min(base * Math.pow(2, attempt - 1), max);

  const resetSecMatch = errorText.match(/"reset_seconds"\s*:\s*(\d+)/i);
  if (resetSecMatch) {
    return Math.min(Math.max(Number(resetSecMatch[1]), 1) * 1000, max);
  }
  const resetTimeMatch = errorText.match(/"reset_time"\s*:\s*"(\d+)s?"/i);
  if (resetTimeMatch) {
    return Math.min(Math.max(Number(resetTimeMatch[1]), 1) * 1000, max);
  }
  const retryAfterMatch = errorText.match(/retry[-_ ]?after["']?\s*[:=]\s*(\d+(?:\.\d+)?)/i);
  if (retryAfterMatch) {
    return Math.min(Math.max(Number(retryAfterMatch[1]), 1) * 1000, max);
  }
  const afterMatch = errorText.match(/(?:after|retry shortly \(after|retry after)\s*(\d+(?:\.\d+)?)\s*s/i);
  if (afterMatch) {
    return Math.min(Math.max(Math.round(Number(afterMatch[1])), 1) * 1000, max);
  }
  const tryAgainMatch = errorText.match(/(?:try again in|wait)\s*(\d+(?:\.\d+)?)\s*(?:seconds|s)/i);
  if (tryAgainMatch) {
    return Math.min(Math.max(Math.round(Number(tryAgainMatch[1])), 1) * 1000, max);
  }
  return Math.min(base * Math.pow(2, attempt - 1), max);
}

/**
 * Standard sleep that resolves to true if aborted early, false if completed.
 */
async function defaultSleep(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return true;
  return new Promise<boolean>((resolve) => {
    let timer: NodeJS.Timeout | undefined;
    const onAbort = () => {
      if (timer) clearTimeout(timer);
      resolve(true);
    };
    timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(false);
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function createAbortedAssistantMessage(): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    stopReason: "aborted",
    errorMessage: "Model request aborted by user",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    }
  } as unknown as AssistantMessage;
}

function createErrorAssistantMessage(errorMessage: string): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    stopReason: "error",
    errorMessage,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    }
  } as unknown as AssistantMessage;
}

/**
 * Countdown-based waiting loop that updates progress every second.
 */
async function performRetryWait(input: {
  attempt: number;
  maxRetries: number;
  delayMs: number;
  error: string;
  parentSignal?: AbortSignal;
  onProgress?: (progress: ModelRetryProgress) => void | Promise<void>;
  sleepFn: (ms: number, signal?: AbortSignal) => Promise<boolean>;
}): Promise<boolean> {
  const { attempt, maxRetries, delayMs, error, parentSignal, onProgress, sleepFn } = input;
  let remainingMs = delayMs;
  const initialSeconds = Math.max(1, Math.ceil(delayMs / 1000));

  await onProgress?.({
    phase: "scheduled",
    attempt,
    maxRetries,
    delayMs,
    remainingSeconds: initialSeconds,
    error
  });

  while (remainingMs > 0) {
    if (parentSignal?.aborted) return false;
    const currentSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
    await onProgress?.({
      phase: "countdown",
      attempt,
      maxRetries,
      delayMs,
      remainingSeconds: currentSeconds,
      error
    });

    const sleepDuration = Math.min(remainingMs, 1000);
    const aborted = await sleepFn(sleepDuration, parentSignal);
    if (aborted) return false;
    remainingMs -= sleepDuration;
  }

  if (parentSignal?.aborted) return false;

  await onProgress?.({
    phase: "attempt_start",
    attempt,
    maxRetries,
    delayMs: 0,
    remainingSeconds: 0,
    error
  });

  return true;
}

/**
 * Retries transient HTTP 429 responses before any content is delivered, up to
 * `maxRetries` times (default 5), with countdown progress. Other errors and an
 * exhausted 429 sequence return to the outer generation/fallback policy. These
 * transport retries belong to one native generation, not its failure budget.
 */
export function invokeStreamWithRetry(options: ModelRetryOptions): AssistantMessageEventStream {
  const output = createAssistantMessageEventStream();
  const maxRetries = options.maxRetries ?? 5;
  const parentSignal = options.signal;
  const sleepFn = options.sleepFn ?? defaultSleep;

  void (async () => {
    let attempt = 0;
    let hadRetries = false;

    while (true) {
      if (parentSignal?.aborted) {
        output.end(createAbortedAssistantMessage());
        return;
      }

      attempt += 1;
      const attemptController = new AbortController();
      const abortHandler = () => attemptController.abort();
      parentSignal?.addEventListener("abort", abortHandler, { once: true });

      let stream: AssistantMessageEventStream | undefined;
      let syncError: any = undefined;

      try {
        stream = options.produceStream(attempt, attemptController.signal);
      } catch (err) {
        syncError = err;
      }

      if (syncError) {
        parentSignal?.removeEventListener("abort", abortHandler);
        const errText = syncError instanceof Error ? syncError.message : String(syncError);
        if (attempt <= maxRetries && isRetryableRateLimitError(errText)) {
          hadRetries = true;
          const delayMs = extractRetryDelayMs(errText, attempt, options);
          const shouldContinue = await performRetryWait({
            attempt,
            maxRetries,
            delayMs,
            error: errText,
            parentSignal,
            onProgress: options.onRetryProgress,
            sleepFn
          });
          if (shouldContinue) {
            continue;
          }
          if (parentSignal?.aborted) {
            output.end(createAbortedAssistantMessage());
            return;
          }
        }
        if (hadRetries && attempt > maxRetries) {
          await options.onRetryProgress?.({
            phase: "failed",
            attempt: maxRetries,
            maxRetries,
            delayMs: 0,
            remainingSeconds: 0,
            error: `exceeded retry limit, last status: ${errText}`
          });
        }
        output.end(createErrorAssistantMessage(errText));
        return;
      }

      let hasDeliveredChunks = false;
      let streamError: any = undefined;
      let terminal: AssistantMessage | undefined;

      try {
        for await (const event of stream!) {
          if (parentSignal?.aborted) {
            attemptController.abort();
            output.end(createAbortedAssistantMessage());
            parentSignal?.removeEventListener("abort", abortHandler);
            return;
          }

          if (event.type === "text_delta" || event.type === "thinking_delta" || event.type === "toolcall_start" || event.type === "toolcall_delta") {
            hasDeliveredChunks = true;
          }

          if (event.type === "error") {
            streamError = event.error;
            if (!hasDeliveredChunks) {
              continue;
            }
          }

          output.push(event);
        }
      } catch (err) {
        streamError = err;
      }

      if (!streamError) {
        try {
          terminal = await stream!.result();
          if (terminal.stopReason === "error") {
            streamError = terminal.errorMessage || "Model request error";
          }
        } catch (err) {
          streamError = err;
        }
      }

      parentSignal?.removeEventListener("abort", abortHandler);

      if (!hasDeliveredChunks && streamError) {
        const errText = typeof streamError === "string"
          ? streamError
          : streamError?.errorMessage || streamError?.message || String(streamError);

        if (attempt <= maxRetries && isRetryableRateLimitError(errText)) {
          hadRetries = true;
          const delayMs = extractRetryDelayMs(errText, attempt, options);
          const shouldContinue = await performRetryWait({
            attempt,
            maxRetries,
            delayMs,
            error: errText,
            parentSignal,
            onProgress: options.onRetryProgress,
            sleepFn
          });
          if (shouldContinue) {
            continue;
          }
          if (parentSignal?.aborted) {
            output.end(createAbortedAssistantMessage());
            return;
          }
        }

        if (hadRetries && attempt > maxRetries) {
          await options.onRetryProgress?.({
            phase: "failed",
            attempt: maxRetries,
            maxRetries,
            delayMs: 0,
            remainingSeconds: 0,
            error: `exceeded retry limit, last status: ${errText}`
          });
        }

        if (terminal) {
          output.end(terminal);
        } else {
          output.end(createErrorAssistantMessage(errText));
        }
        return;
      }

      if (hadRetries) {
        await options.onRetryProgress?.({
          phase: "recovered",
          attempt: attempt - 1,
          maxRetries,
          delayMs: 0,
          remainingSeconds: 0,
          error: ""
        });
      }

      if (terminal) {
        output.end(terminal);
      } else {
        try {
          output.end(await stream!.result());
        } catch (finalErr) {
          output.end(createErrorAssistantMessage(String(finalErr)));
        }
      }
      return;
    }
  })();

  return output;
}

function isRetryableRateLimitError(message: string): boolean {
  return /\b429\b/.test(message) && isRetryableModelError(message);
}
