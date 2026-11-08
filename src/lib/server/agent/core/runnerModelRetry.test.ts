import test from "node:test";
import assert from "node:assert/strict";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEventStream
} from "@earendil-works/pi-ai";
import {
  extractRetryDelayMs,
  invokeStreamWithRetry,
  type ModelRetryProgress
} from "./runnerModelRetry.js";

test("extractRetryDelayMs parses various 429 and cooldown formats", () => {
  const err1 = `429: {"type":"server_error","message":"Upstream request failed: [prefill_cap_refused] the cell is at capacity; retry shortly (after 30 s)"}`;
  assert.equal(extractRetryDelayMs(err1), 30000);

  const err2 = `429: {"code":"model_cooldown","message":"All credentials are cooling down","reset_seconds":29,"reset_time":"29s"}`;
  assert.equal(extractRetryDelayMs(err2), 29000);

  const err3 = `rate limit reached: please try again in 15 seconds`;
  assert.equal(extractRetryDelayMs(err3), 15000);

  const err4 = `Too Many Requests`;
  assert.equal(extractRetryDelayMs(err4, 1), 2000);
  assert.equal(extractRetryDelayMs(err4, 2), 4000);
  assert.equal(extractRetryDelayMs(err4, 3), 8000);
});

function createMockStream(events: any[], resultMsg: AssistantMessage): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  setTimeout(() => {
    for (const ev of events) {
      stream.push(ev);
    }
    stream.end(resultMsg);
  }, 5);
  return stream;
}

test("invokeStreamWithRetry retries on 429 and emits real-time progress until recovered", async () => {
  let callCount = 0;
  const progressList: ModelRetryProgress[] = [];

  const stream = invokeStreamWithRetry({
    maxRetries: 5,
    sleepFn: async () => false, // Instant sleep for testing
    produceStream: (attemptIndex) => {
      callCount += 1;
      if (callCount <= 2) {
        // Return 429 error on first 2 calls
        const errMsg = {
          role: "assistant",
          content: [],
          stopReason: "error",
          errorMessage: "429: retry shortly (after 3 s)",
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
        } as unknown as AssistantMessage;
        return createMockStream(
          [{ type: "error", error: errMsg }],
          errMsg
        );
      }
      // 3rd call succeeds
      return createMockStream(
        [
          { type: "start" },
          { type: "text_delta", delta: "Hello " },
          { type: "text_delta", delta: "world" },
          { type: "done", message: { role: "assistant", content: [{ type: "text", text: "Hello world" }], stopReason: "stop" } }
        ],
        {
          role: "assistant",
          content: [{ type: "text", text: "Hello world" }],
          stopReason: "stop",
          usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
        } as unknown as AssistantMessage
      );
    },
    onRetryProgress: (p) => {
      progressList.push({ ...p });
    }
  });

  const deltas: string[] = [];
  for await (const ev of stream) {
    if (ev.type === "text_delta") deltas.push(ev.delta);
  }
  const final = await stream.result();

  assert.equal(callCount, 3);
  assert.equal(deltas.join(""), "Hello world");
  assert.equal(final.stopReason, "stop");

  // Verify progress phases
  assert.ok(progressList.some((p) => p.phase === "scheduled" && p.attempt === 1));
  assert.ok(progressList.some((p) => p.phase === "attempt_start" && p.attempt === 1));
  assert.ok(progressList.some((p) => p.phase === "scheduled" && p.attempt === 2));
  assert.ok(progressList.some((p) => p.phase === "recovered"));
});

test("invokeStreamWithRetry stops after maxRetries (5 times) and marks failed", async () => {
  let callCount = 0;
  const progressList: ModelRetryProgress[] = [];

  const stream = invokeStreamWithRetry({
    maxRetries: 5,
    sleepFn: async () => false,
    produceStream: () => {
      callCount += 1;
      const errMsg = {
        role: "assistant",
        content: [],
        stopReason: "error",
        errorMessage: "429 Too Many Requests",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
      } as unknown as AssistantMessage;
      return createMockStream(
        [{ type: "error", error: errMsg }],
        errMsg
      );
    },
    onRetryProgress: (p) => {
      progressList.push({ ...p });
    }
  });

  const final = await stream.result();
  assert.equal(final.stopReason, "error");
  // 1 initial attempt + 5 retries = 6 attempts
  assert.equal(callCount, 6);
  assert.ok(progressList.some((p) => p.phase === "failed" && p.attempt === 5));
});

test("invokeStreamWithRetry aborts immediately without retry on non-retryable error", async () => {
  let callCount = 0;

  const stream = invokeStreamWithRetry({
    maxRetries: 5,
    sleepFn: async () => false,
    produceStream: () => {
      callCount += 1;
      const errMsg = {
        role: "assistant",
        content: [],
        stopReason: "error",
        errorMessage: "insufficient_quota: You exceeded your current quota",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
      } as unknown as AssistantMessage;
      return createMockStream(
        [{ type: "error", error: errMsg }],
        errMsg
      );
    }
  });

  const final = await stream.result();
  assert.equal(final.stopReason, "error");
  assert.equal(callCount, 1);
});

test("invokeStreamWithRetry respects abort signal during retry backoff", async () => {
  let callCount = 0;
  const controller = new AbortController();

  const stream = invokeStreamWithRetry({
    maxRetries: 5,
    signal: controller.signal,
    sleepFn: async (_ms, signal) => {
      // simulate waiting then being aborted
      controller.abort();
      return signal?.aborted ?? true;
    },
    produceStream: () => {
      callCount += 1;
      const errMsg = {
        role: "assistant",
        content: [],
        stopReason: "error",
        errorMessage: "429 Too Many Requests",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
      } as unknown as AssistantMessage;
      return createMockStream([{ type: "error", error: errMsg }], errMsg);
    }
  });

  const final = await stream.result();
  assert.equal(final.stopReason, "aborted");
  assert.equal(callCount, 1);
});

for (const errorMessage of ["503 Service Unavailable", "ECONNRESET", "Model stream timed out before the first token", "rate limit exceeded without an HTTP status"]) {
  for (const synchronous of [false, true]) {
    test(`inner retry leaves ${synchronous ? "thrown" : "streamed"} ${errorMessage} to the outer policy`, async () => {
      let calls = 0;
      const progress: ModelRetryProgress[] = [];
      const stream = invokeStreamWithRetry({
        sleepFn: async () => false,
        onRetryProgress: event => { progress.push(event); },
        produceStream: () => {
          calls++;
          if (synchronous) throw new Error(errorMessage);
          const message = { role: "assistant", content: [], stopReason: "error", errorMessage } as unknown as AssistantMessage;
          return createMockStream([{ type: "error", error: message }], message);
        }
      });
      const result = await stream.result();
      assert.equal(calls, 1);
      assert.equal(result.stopReason, "error");
      assert.equal(result.errorMessage, errorMessage);
      assert.deepEqual(progress, []);
    });
  }
}

test("429 retry honors Retry-After and never retries account exhaustion", async () => {
  assert.equal(extractRetryDelayMs("429 Too Many Requests; Retry-After: 12"), 12_000);
  let calls = 0;
  const stream = invokeStreamWithRetry({
    sleepFn: async () => false,
    produceStream: () => {
      calls++;
      throw new Error("429 insufficient_quota: usage limit reached");
    }
  });
  assert.equal((await stream.result()).stopReason, "error");
  assert.equal(calls, 1);
});

test("a thrown 429 retries in place but a 429 after streamed content does not replay it", async () => {
  let calls = 0;
  const message = { role: "assistant", content: [], stopReason: "error", errorMessage: "429 Too Many Requests" } as unknown as AssistantMessage;
  const retried = invokeStreamWithRetry({
    maxRetries: 1,
    sleepFn: async () => false,
    produceStream: () => { calls++; throw new Error(message.errorMessage); }
  });
  assert.equal((await retried.result()).stopReason, "error");
  assert.equal(calls, 2);

  calls = 0;
  const partial = invokeStreamWithRetry({
    sleepFn: async () => false,
    produceStream: () => {
      calls++;
      return createMockStream([{ type: "text_delta", delta: "Already delivered" }, { type: "error", error: message }], message);
    }
  });
  const deltas: string[] = [];
  for await (const event of partial) if (event.type === "text_delta") deltas.push(event.delta);
  assert.equal((await partial.result()).stopReason, "error");
  assert.equal(calls, 1);
  assert.deepEqual(deltas, ["Already delivered"]);
});
