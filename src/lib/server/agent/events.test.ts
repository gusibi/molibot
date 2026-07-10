import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

test("skipping a periodic run for task_already_running releases the file run-lock", async () => {
  const store = new EventExecutionLeaseStore(":memory:");
  const eventsDir = mkdtempSync(join(tmpdir(), "molibot-events-"));
  const filename = "event.json";
  const eventPath = join(eventsDir, filename);

  // A sibling event sharing the same taskId is already running.
  const blocking = store.acquire({
    leaseScope: "telegram",
    eventFile: "sibling.json",
    eventType: "periodic",
    triggerSlot: "2026-06-04T09:00",
    chatId: "chat-1",
    sessionId: "session-1",
    channel: "telegram",
    taskId: "explicit",
    runId: "blocking-run",
    maxAttempts: 3,
    timeoutMs: 600_000,
    eventPayloadJson: "{}",
    now: new Date("2026-06-04T09:00:00.000Z")
  });
  assert.equal(blocking?.status, "running");

  const event: MomEvent = { ...createPeriodicEvent(), taskId: "explicit" };
  writeFileSync(eventPath, `${JSON.stringify(event, null, 2)}\n`, "utf8");

  let onEventCalls = 0;
  const watcher = new EventsWatcher(
    eventsDir,
    async () => {
      onEventCalls += 1;
    },
    { leaseStore: store, channel: "telegram" }
  ) as unknown as {
    tryAcquirePeriodicRunLock: (filename: string, slotKey: string) => { event: MomEvent; slotKey: string; runId: string } | null;
    runLeasedEvent: (event: MomEvent, filename: string, triggerSlot: string, runId: string) => Promise<void>;
  };

  try {
    const lock = watcher.tryAcquirePeriodicRunLock(filename, "2026-06-04T17:00");
    assert.ok(lock, "periodic dispatch should acquire the file run-lock");
    // Run-lock flipped the file to "running".
    assert.equal(JSON.parse(readFileSync(eventPath, "utf8")).status.state, "running");

    await watcher.runLeasedEvent(lock.event, filename, lock.slotKey, lock.runId);

    // The run was skipped (never executed) and the file lock was released.
    assert.equal(onEventCalls, 0);
    const status = JSON.parse(readFileSync(eventPath, "utf8")).status;
    assert.equal(status.state, "pending");
    assert.equal(status.reason, "task_already_running");
    assert.equal(status.runningSlotKey, undefined);
    assert.equal(status.runId, undefined);
  } finally {
    rmSync(eventsDir, { recursive: true, force: true });
    store.close();
  }
});

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
  // `acquire` clamps lease.timeoutMs to a 1000ms floor, so drive the race with an
  // explicit sub-run-duration timeout to actually exercise "timeout fires first,
  // run succeeds later" (5ms timeout vs the 20ms onEvent above).
  const fastTimeoutLease: EventExecutionLease = { ...lease, timeoutMs: 5 };

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

    const result = await runAttemptWithTimeout(createPeriodicEvent(), "event.json", fastTimeoutLease);
    assert.deepEqual(result, { status: "success" });
    assert.equal(timeoutCalls, 1);
  } finally {
    rmSync(eventsDir, { recursive: true, force: true });
    store.close();
  }
});

test("disabled periodic events never enter the scheduler dispatch loop", async () => {
  const store = new EventExecutionLeaseStore(":memory:");
  const eventsDir = mkdtempSync(join(tmpdir(), "molibot-events-paused-"));
  const filename = "paused.json";
  writeFileSync(join(eventsDir, filename), JSON.stringify({
    ...createPeriodicEvent(),
    schedule: "* * * * *",
    enabled: false
  }), "utf8");

  let calls = 0;
  const watcher = new EventsWatcher(eventsDir, async () => { calls += 1; }, { leaseStore: store }) as unknown as {
    handleFile: (filename: string) => void;
    tickPeriodic: () => void;
    stop: () => void;
  };

  try {
    watcher.handleFile(filename);
    watcher.tickPeriodic();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(calls, 0);
  } finally {
    watcher.stop();
    rmSync(eventsDir, { recursive: true, force: true });
    store.close();
  }
});
