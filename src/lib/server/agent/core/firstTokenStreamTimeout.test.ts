import assert from "node:assert/strict";
import test from "node:test";
import {
  withFirstTokenTimeout,
  type FirstTokenStreamLike
} from "$lib/server/agent/core/firstTokenStreamTimeout.js";

/** Build a push-based fake stream we can feed events into on demand. */
function makeFakeStream() {
  const queue: unknown[] = [];
  const waiters: Array<(r: IteratorResult<unknown>) => void> = [];
  let ended = false;
  let resultResolve!: (v: unknown) => void;
  const resultPromise = new Promise<unknown>((resolve) => {
    resultResolve = resolve;
  });

  const stream: FirstTokenStreamLike<unknown> & {
    push: (event: unknown) => void;
    end: (result?: unknown) => void;
  } = {
    push(event: unknown) {
      const waiter = waiters.shift();
      if (waiter) waiter({ value: event, done: false });
      else queue.push(event);
    },
    end(result?: unknown) {
      ended = true;
      resultResolve(result);
      while (waiters.length > 0) waiters.shift()!({ value: undefined, done: true });
    },
    result: () => resultPromise,
    async *[Symbol.asyncIterator]() {
      while (true) {
        if (queue.length > 0) {
          yield queue.shift();
        } else if (ended) {
          return;
        } else {
          const r = await new Promise<IteratorResult<unknown>>((resolve) => waiters.push(resolve));
          if (r.done) return;
          yield r.value;
        }
      }
    }
  };
  return stream;
}

test("fires onTimeout and throws a retryable error when the first event never arrives", async () => {
  const stream = makeFakeStream();
  let aborted = false;
  const wrapped = withFirstTokenTimeout(stream, {
    timeoutMs: 20,
    onTimeout: () => {
      aborted = true;
    }
  });

  await assert.rejects(
    (async () => {
      for await (const _ of wrapped) {
        // never reached: nothing is ever pushed
      }
    })(),
    (err: Error) => {
      assert.match(err.message, /timed out/i);
      return true;
    }
  );
  assert.equal(aborted, true);
});

test("keeps the timer armed through stream-open events and still times out when the model stalls before the first token", async () => {
  const stream = makeFakeStream();
  let aborted = false;
  const wrapped = withFirstTokenTimeout(stream, {
    timeoutMs: 25,
    onTimeout: () => {
      aborted = true;
    }
  });

  const collected: unknown[] = [];
  const consume = (async () => {
    for await (const event of wrapped) collected.push(event);
  })();

  // pi-ai opens the HTTP stream and announces a content block, but no real
  // token follows — these must NOT clear the first-token guard.
  stream.push({ type: "start" });
  stream.push({ type: "text_start" });

  await assert.rejects(consume, (err: Error) => {
    assert.match(err.message, /timed out/i);
    return true;
  });
  assert.equal(aborted, true);
  // The non-progress events were still delivered before the timeout fired.
  assert.deepEqual(collected, [{ type: "start" }, { type: "text_start" }]);
});

test("does not time out once a real content token arrives, even if later events are slow", async () => {
  const stream = makeFakeStream();
  let aborted = false;
  const wrapped = withFirstTokenTimeout(stream, {
    timeoutMs: 30,
    onTimeout: () => {
      aborted = true;
    }
  });

  const collected: unknown[] = [];
  const consume = (async () => {
    for await (const event of wrapped) collected.push(event);
  })();

  // Open + announce (no content), then the first real delta clears the timer.
  stream.push({ type: "start" });
  stream.push({ type: "text_delta", delta: "a" });
  // A later token arrives after the original timeout window — must NOT abort.
  await new Promise((r) => setTimeout(r, 60));
  stream.push({ type: "text_delta", delta: "b" });
  stream.end("final");
  await consume;

  assert.deepEqual(collected, [
    { type: "start" },
    { type: "text_delta", delta: "a" },
    { type: "text_delta", delta: "b" }
  ]);
  assert.equal(aborted, false);
});

test("forwards result() to the underlying stream", async () => {
  const stream = makeFakeStream();
  const wrapped = withFirstTokenTimeout(stream, { timeoutMs: 1000, onTimeout: () => {} });
  stream.end("the-final-result");
  assert.equal(await wrapped.result(), "the-final-result");
});

test("returns the stream untouched when the timeout is disabled", () => {
  const stream = makeFakeStream();
  const wrapped = withFirstTokenTimeout(stream, { timeoutMs: 0, onTimeout: () => {} });
  assert.equal(wrapped, stream);
});
