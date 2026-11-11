import assert from "node:assert/strict";
import test from "node:test";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import { invokeAppModelWithRetry } from "./appModelRetry.js";
import type { ModelRetryProgress } from "./runnerModelRetry.js";

function response(error?: string, partial = false) {
  const stream = createAssistantMessageEventStream();
  const message = { role: "assistant", content: partial || !error ? [{ type: "text", text: "answer" }] : [],
    stopReason: error ? "error" : "stop", errorMessage: error } as AssistantMessage;
  if (partial) stream.push({ type: "text_delta", contentIndex: 0, delta: "answer", partial: message });
  if (error) stream.push({ type: "error", reason: "error", error: message });
  stream.end(message);
  return stream;
}

test("App retries transport failures ten times with progress instead of the legacy 429-only policy", async () => {
  let requests = 0;
  const events: ModelRetryProgress[] = [];
  const waits: number[] = [];
  const stream = invokeAppModelWithRetry({
    produceStream: () => { requests++; return response("fetch failed"); },
    sleepFn: async ms => { waits.push(ms); return false; },
    random: () => 0.5,
    onRetryProgress: event => { events.push(event); }
  });
  assert.equal((await stream.result()).stopReason, "error");
  assert.equal(requests, 11);
  assert.deepEqual(events.filter(event => event.phase === "scheduled").map(event => event.delayMs),
    [2000, 3000, 5000, 8000, 10000, 10000, 10000, 10000, 10000, 10000]);
  assert.equal(events.at(-1)?.phase, "failed");
  assert.equal(events.at(-1)?.attempt, 10);
  assert.ok(waits.every(ms => ms <= 1000));
});

test("App retries synchronous connection failures and recovers once", async () => {
  let requests = 0;
  const events: ModelRetryProgress[] = [];
  const stream = invokeAppModelWithRetry({
    produceStream: () => { if (++requests <= 2) throw new Error("ECONNRESET"); return response(); },
    sleepFn: async () => false,
    onRetryProgress: event => { events.push(event); }
  });
  assert.equal((await stream.result()).stopReason, "stop");
  assert.equal(requests, 3);
  assert.equal(events.filter(event => event.phase === "recovered").length, 1);
});

for (const error of ["401 unauthorized", "400 model_not_found", "429 insufficient_quota", "402 insufficient balance", "Request aborted"]) {
  test(`App does not repeatedly submit permanent error: ${error}`, async () => {
    let requests = 0;
    const stream = invokeAppModelWithRetry({ produceStream: () => { requests++; return response(error); } });
    assert.equal((await stream.result()).stopReason, "error");
    assert.equal(requests, 1);
  });
}

test("App obeys long provider cooldowns without shortening them or issuing another request", async () => {
  let requests = 0;
  const stream = invokeAppModelWithRetry({ produceStream: () => { requests++; return response('429: {"reset_seconds":600}'); } });
  assert.equal((await stream.result()).stopReason, "error");
  assert.equal(requests, 1);
});

test("App Stop during countdown cancels retries", async () => {
  const controller = new AbortController();
  let requests = 0;
  const events: ModelRetryProgress[] = [];
  const stream = invokeAppModelWithRetry({ signal: controller.signal,
    produceStream: () => { requests++; return response("503 Service Unavailable"); },
    sleepFn: async () => { controller.abort(); return true; },
    onRetryProgress: event => { events.push(event); }
  });
  assert.equal((await stream.result()).stopReason, "aborted");
  assert.equal(requests, 1);
  assert.equal(events.at(-1)?.phase, "cancelled");
});

test("App never jitters an explicit Retry-After below its minimum", async () => {
  const delays: number[] = [];
  let requests = 0;
  const stream = invokeAppModelWithRetry({
    produceStream: () => ++requests === 1 ? response("429 Retry-After: 2") : response(), random: () => 0,
    sleepFn: async () => false,
    onRetryProgress: event => { if (event.phase === "scheduled") delays.push(event.delayMs); }
  });
  assert.equal((await stream.result()).stopReason, "stop");
  assert.deepEqual(delays, [2000]);
});

test("App preserves partial output and never automatically replays a streamed generation", async () => {
  let requests = 0;
  const stream = invokeAppModelWithRetry({ produceStream: () => { requests++; return response("terminated", true); } });
  const events = [];
  for await (const event of stream) events.push(event);
  assert.equal((await stream.result()).stopReason, "error");
  assert.equal(requests, 1);
  assert.equal(events.filter(event => event.type === "text_delta").length, 1);
});

test("App recovery deadline includes request time and bounds a hanging retry", async () => {
  let requests = 0;
  let time = 0;
  const stream = invokeAppModelWithRetry({ recoveryTimeoutMs: 3000, now: () => time,
    produceStream: (_attempt, signal) => {
      if (++requests === 1) return response("fetch failed");
      const pending = createAssistantMessageEventStream();
      signal.addEventListener("abort", () => pending.end({ role: "assistant", content: [], stopReason: "aborted" } as unknown as AssistantMessage), { once: true });
      return pending;
    },
    sleepFn: async () => { time = 2995; return false; }
  });
  assert.equal((await stream.result()).stopReason, "error");
  assert.equal(requests, 2);
});
