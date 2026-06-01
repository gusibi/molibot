import assert from "node:assert/strict";
import test from "node:test";
import { EventExecutionLeaseStore } from "$lib/server/agent/eventsLeaseStore.js";

function acquireInput(overrides: Partial<Parameters<EventExecutionLeaseStore["acquire"]>[0]> = {}) {
  return {
    eventFile: "event.json",
    eventType: "periodic",
    triggerSlot: "2026-05-31T10:00",
    chatId: "chat-1",
    sessionId: "session-1",
    channel: "telegram",
    runId: "run-1",
    maxAttempts: 3,
    timeoutMs: 600_000,
    eventPayloadJson: "{}",
    now: new Date("2026-05-31T10:00:00.000Z"),
    ...overrides
  };
}

test("event lease acquisition allows only one running attempt per event slot", () => {
  const store = new EventExecutionLeaseStore(":memory:");
  const first = store.acquire(acquireInput());
  const second = store.acquire(acquireInput({ runId: "run-2" }));

  assert.equal(first?.status, "running");
  assert.equal(first?.attempt, 1);
  assert.equal(second, null);
  store.close();
});

test("event lease acquisition is isolated by lease scope", () => {
  const store = new EventExecutionLeaseStore(":memory:");
  const first = store.acquire(acquireInput({ leaseScope: "telegram:bot-a" }));
  const second = store.acquire(acquireInput({ leaseScope: "telegram:bot-b", runId: "run-2" }));

  assert.equal(first?.status, "running");
  assert.equal(second?.status, "running");
  assert.equal(first?.leaseScope, "telegram:bot-a");
  assert.equal(second?.leaseScope, "telegram:bot-b");
  store.close();
});

test("timed out event lease moves to retry and starts the next attempt", () => {
  const store = new EventExecutionLeaseStore(":memory:");
  const first = store.acquire(acquireInput());
  assert.ok(first);

  const timedOut = store.markTimedOut(first.id, first.runId, 5000, new Date("2026-05-31T10:10:00.000Z"));
  assert.equal(timedOut?.status, "retry_wait");
  assert.equal(timedOut?.attempt, 1);

  const tooEarly = store.acquire(acquireInput({
    runId: "run-2",
    now: new Date("2026-05-31T10:10:04.000Z")
  }));
  assert.equal(tooEarly, null);

  const retry = store.acquire(acquireInput({
    runId: "run-2",
    now: new Date("2026-05-31T10:10:05.000Z")
  }));
  assert.equal(retry?.status, "running");
  assert.equal(retry?.attempt, 2);
  assert.equal(retry?.runId, "run-2");
  store.close();
});

test("event lease stops retrying after max attempts", () => {
  const store = new EventExecutionLeaseStore(":memory:");
  const first = store.acquire(acquireInput({ maxAttempts: 2 }));
  assert.ok(first);

  store.markTimedOut(first.id, first.runId, 0, new Date("2026-05-31T10:10:00.000Z"));
  const retry = store.acquire(acquireInput({
    runId: "run-2",
    maxAttempts: 2,
    now: new Date("2026-05-31T10:10:00.000Z")
  }));
  assert.ok(retry);

  const final = store.markTimedOut(retry.id, retry.runId, 0, new Date("2026-05-31T10:20:00.000Z"));
  assert.equal(final?.status, "failed");
  assert.equal(final?.attempt, 2);

  const exhausted = store.acquire(acquireInput({
    runId: "run-3",
    maxAttempts: 2,
    now: new Date("2026-05-31T10:20:00.000Z")
  }));
  assert.equal(exhausted, null);
  store.close();
});

test("manual stop aborts active event leases and suppresses retry", () => {
  const store = new EventExecutionLeaseStore(":memory:");
  const lease = store.acquire(acquireInput());
  assert.ok(lease);

  const aborted = store.markAbortedForChat("chat-1", "Stopped by user.", new Date("2026-05-31T10:01:00.000Z"));
  assert.equal(aborted, 1);
  assert.equal(store.hasActiveForChat("chat-1"), false);

  const nextSlot = store.acquire(acquireInput({
    triggerSlot: "2026-05-31T10:01",
    runId: "run-next",
    now: new Date("2026-05-31T10:01:00.000Z")
  }));
  assert.equal(nextSlot?.attempt, 1);
  store.close();
});

test("startup recovery releases stale running event leases into retry state", () => {
  const store = new EventExecutionLeaseStore(":memory:");
  const lease = store.acquire(acquireInput({
    timeoutMs: 60_000,
    now: new Date("2026-05-31T10:00:00.000Z")
  }));
  assert.ok(lease);

  const recovered = store.recoverStaleRunning(new Date("2026-05-31T10:02:00.000Z"));
  assert.equal(recovered, 1);

  const retry = store.acquire(acquireInput({
    runId: "run-recovered",
    timeoutMs: 60_000,
    now: new Date("2026-05-31T10:02:00.000Z")
  }));
  assert.equal(retry?.status, "running");
  assert.equal(retry?.attempt, 2);
  assert.equal(retry?.runId, "run-recovered");
  store.close();
});
