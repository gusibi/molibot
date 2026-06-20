import assert from "node:assert/strict";
import test from "node:test";
import { pollUntilResolved } from "$lib/server/approval/approvalWaiter.js";

function fakeClock() {
  let clock = 0;
  return {
    now: () => clock,
    sleep: async (ms: number) => { clock += ms; }
  };
}

test("pollUntilResolved returns the polled value as soon as poll reports done", async () => {
  const clock = fakeClock();
  let calls = 0;
  const value = await pollUntilResolved<string>({
    poll: () => { calls += 1; return { done: true, value: "ok" }; },
    timeoutMs: 1_000,
    pollMs: 10,
    onAbort: () => "aborted",
    onTimeout: () => "timeout",
    now: clock.now,
    sleep: clock.sleep
  });
  assert.equal(value, "ok");
  assert.equal(calls, 1);
});

test("pollUntilResolved keeps polling until a terminal outcome", async () => {
  const clock = fakeClock();
  let calls = 0;
  const value = await pollUntilResolved<string>({
    poll: () => {
      calls += 1;
      return calls < 3 ? { done: false } : { done: true, value: "ready" };
    },
    timeoutMs: 1_000,
    pollMs: 10,
    onAbort: () => "aborted",
    onTimeout: () => "timeout",
    now: clock.now,
    sleep: clock.sleep
  });
  assert.equal(value, "ready");
  assert.equal(calls, 3);
});

test("pollUntilResolved returns the abort value without polling when the signal is already aborted", async () => {
  const clock = fakeClock();
  let calls = 0;
  const value = await pollUntilResolved<string>({
    poll: () => { calls += 1; return { done: false }; },
    timeoutMs: 1_000,
    pollMs: 10,
    signal: { aborted: true },
    onAbort: () => "aborted",
    onTimeout: () => "timeout",
    now: clock.now,
    sleep: clock.sleep
  });
  assert.equal(value, "aborted");
  assert.equal(calls, 0);
});

test("pollUntilResolved returns the timeout value once the deadline passes", async () => {
  const clock = fakeClock();
  let calls = 0;
  const value = await pollUntilResolved<string>({
    poll: () => { calls += 1; return { done: false }; },
    timeoutMs: 250,
    pollMs: 100,
    onAbort: () => "aborted",
    onTimeout: () => "timeout",
    now: clock.now,
    sleep: clock.sleep
  });
  assert.equal(value, "timeout");
  assert.equal(calls, 3); // polls at t=0,100,200; t=300 exits the loop
});
