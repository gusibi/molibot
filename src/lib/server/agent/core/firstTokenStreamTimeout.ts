import type { AssistantMessageEventStream } from "@earendil-works/pi-ai";

/**
 * Minimal async-iterable + result() surface that mirrors the part of
 * {@link AssistantMessageEventStream} the agent loop consumes. Kept structural
 * so the timeout wrapper can be unit-tested without constructing a real
 * provider stream.
 */
export interface FirstTokenStreamLike<T> {
  [Symbol.asyncIterator](): AsyncIterator<T>;
  result(): Promise<unknown>;
}

export interface FirstTokenTimeoutOptions {
  /**
   * How long to wait for the first real content token before giving up, in ms.
   * Values <= 0 disable the timeout (the stream is returned unwrapped).
   */
  timeoutMs: number;
  /**
   * Called once, when the first-token timeout fires. Use it to abort the
   * underlying request so the hung connection is torn down instead of leaking.
   */
  onTimeout: () => void;
  /**
   * Builds the error thrown when the timeout fires. The message MUST read as a
   * timeout (e.g. contain "timed out") so the caller classifies it as a
   * retryable model error and falls back to the next model.
   */
  buildError?: (timeoutMs: number) => Error;
  /**
   * Predicate deciding whether an event counts as the first real token, i.e.
   * proof the model is actually producing output (not merely that the HTTP
   * stream opened). The timer stays armed across non-progress events and is
   * cleared only once this returns true. Defaults to {@link isFirstTokenEvent}.
   */
  isFirstTokenEvent?: (event: unknown) => boolean;
}

export function defaultFirstTokenTimeoutError(timeoutMs: number): Error {
  return new Error(
    `Model stream timed out: no response within ${Math.round(timeoutMs / 1000)}s before the first token.`
  );
}

/**
 * pi-ai stream events that carry actual incremental content or end the stream.
 * Notably this EXCLUDES `start` (the HTTP stream merely opened) and the bare
 * `*_start` markers (a content block was announced but produced no bytes yet) —
 * the gap between those and the first delta is exactly the "time to first
 * token" we want to bound, so seeing them must NOT clear the timer.
 */
const FIRST_TOKEN_EVENT_TYPES: ReadonlySet<string> = new Set([
  "text_delta",
  "text_end",
  "thinking_delta",
  "thinking_end",
  "toolcall_delta",
  "toolcall_end",
  "done",
  "error"
]);

/** Default progress predicate for pi-ai `AssistantMessageEvent`s. */
export function isFirstTokenEvent(event: unknown): boolean {
  const type = (event as { type?: unknown } | null | undefined)?.type;
  return typeof type === "string" && FIRST_TOKEN_EVENT_TYPES.has(type);
}

/**
 * Wrap a streaming response so that the wait for the *first* event is bounded.
 *
 * Stream mode hangs when an upstream model accepts the request but never starts
 * responding: the consumer's `for await` blocks forever and the whole run is
 * stuck. This guards only the first event — once any token arrives the timer is
 * cleared and the rest of the stream flows untouched (a slow-but-alive model is
 * not interrupted mid-answer).
 *
 * On timeout the underlying request is aborted via {@link FirstTokenTimeoutOptions.onTimeout}
 * and a retryable error is thrown from the iterator, which propagates up so the
 * caller can fall back to the next model or surface an error instead of hanging.
 */
export function withFirstTokenTimeout<T extends FirstTokenStreamLike<unknown>>(
  stream: T,
  options: FirstTokenTimeoutOptions
): T {
  if (!(options.timeoutMs > 0)) {
    return stream;
  }
  const buildError = options.buildError ?? defaultFirstTokenTimeoutError;
  const isFirstToken = options.isFirstTokenEvent ?? isFirstTokenEvent;

  async function* iterate(): AsyncGenerator<unknown> {
    const iterator = stream[Symbol.asyncIterator]();
    // Single deadline armed from the moment iteration starts. It stays armed
    // across "stream opened" / "block announced" events and is only cleared
    // once a real content token (or terminal event) proves the model is alive.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        options.onTimeout();
        reject(buildError(options.timeoutMs));
      }, options.timeoutMs);
    });
    const clearTimer = () => {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
    };

    try {
      let cleared = false;
      while (true) {
        // Keep racing each event against the SAME deadline until the first real
        // token arrives; once cleared, drain the rest with no further timeout.
        const next = cleared
          ? await iterator.next()
          : await Promise.race([iterator.next(), timeoutPromise]);
        if (next.done) return;
        if (!cleared && isFirstToken(next.value)) {
          cleared = true;
          clearTimer();
        }
        yield next.value;
      }
    } finally {
      clearTimer();
      // Best-effort, fire-and-forget cleanup if the consumer (or the timeout
      // throw) abandons us. Never await it: on timeout the underlying iterator
      // is still suspended on a connection that may not unblock until the abort
      // propagates, and awaiting here would re-introduce the very hang we guard.
      void iterator.return?.();
    }
  }

  const wrapped: FirstTokenStreamLike<unknown> = {
    [Symbol.asyncIterator]: () => iterate(),
    result: () => stream.result()
  };
  return wrapped as unknown as T;
}
