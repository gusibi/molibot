import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { EventsWatcher, type MomEvent } from "$lib/server/agent/events.js";
import { EventExecutionLeaseStore, type EventExecutionLease } from "$lib/server/agent/eventsLeaseStore.js";

function createPeriodicEvent(): MomEvent {
  return {
    type: "periodic",
    chatId: "chat-1",
    text: "run report",
    schedule: "0 17 * * *",
    timezone: "Asia/Shanghai"
  };
}

function createLease(store: EventExecutionLeaseStore, timeoutMs: number): EventExecutionLease {
  const lease = store.acquire({
    eventFile: "event.json",
    eventType: "periodic",
    triggerSlot: "2026-06-04T17:00",
    chatId: "chat-1",
    sessionId: "session-1",
    channel: "telegram",
    runId: "run-1",
    maxAttempts: 3,
    timeoutMs,
    eventPayloadJson: JSON.stringify(createPeriodicEvent()),
    now: new Date("2026-06-04T09:00:00.000Z")
  });
  assert.ok(lease);
  return lease;
}

test("late successful event completion suppresses timeout retry outcome", async () => {
  const store = new EventExecutionLeaseStore(":memory:");
  const eventsDir = mkdtempSync(join(tmpdir(), "molibot-events-"));
  let timeoutCalls = 0;
  const watcher = new EventsWatcher(
    eventsDir,
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    },
    {
      leaseStore: store,
      onTimeout: () => {
        timeoutCalls += 1;
      }
    }
  );
  const lease = createLease(store, 5);

  try {
    const runAttemptWithTimeout = (
      watcher as unknown as {
        runAttemptWithTimeout: (
          event: MomEvent,
          filename: string,
          lease: EventExecutionLease
        ) => Promise<{ status: "success" } | { status: "timeout" } | { status: "error"; error: unknown }>;
      }
    ).runAttemptWithTimeout.bind(watcher);

    const result = await runAttemptWithTimeout(createPeriodicEvent(), "event.json", lease);
    assert.deepEqual(result, { status: "success" });
    assert.equal(timeoutCalls, 1);
  } finally {
    rmSync(eventsDir, { recursive: true, force: true });
    store.close();
  }
});
