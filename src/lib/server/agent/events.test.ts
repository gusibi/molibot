import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { EventsWatcher, markOneShotReminderReadFile, type MomEvent } from "$lib/server/agent/events.js";
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

// Recovery harness: an event file left at "running" by a process that died,
// plus the lease that attempt was holding.
function stageInterruptedRun(options: { startedAt: string; taskId?: string } ) {
  const store = new EventExecutionLeaseStore(":memory:");
  const eventsDir = mkdtempSync(join(tmpdir(), "molibot-events-"));
  const filename = "event.json";
  const eventPath = join(eventsDir, filename);
  const slotKey = "2026-06-04T17:00";
  const taskId = options.taskId ?? "daily-report";

  const lease = store.acquire({
    leaseScope: "telegram",
    eventFile: filename,
    eventType: "periodic",
    triggerSlot: slotKey,
    chatId: "chat-1",
    sessionId: "session-1",
    channel: "telegram",
    taskId,
    runId: "crashed-run",
    maxAttempts: 3,
    timeoutMs: 600_000,
    eventPayloadJson: "{}",
    now: new Date(options.startedAt)
  });
  assert.ok(lease);

  const event: MomEvent = {
    ...createPeriodicEvent(),
    taskId,
    status: { state: "running", reason: "running", startedAt: options.startedAt, runId: "crashed-run", runningSlotKey: slotKey }
  };
  writeFileSync(eventPath, `${JSON.stringify(event, null, 2)}\n`, "utf8");
  return { store, eventsDir, eventPath, filename, event, lease, slotKey, taskId };
}

function readStatus(eventPath: string) {
  return JSON.parse(readFileSync(eventPath, "utf8")).status as Record<string, unknown>;
}

test("an interrupted run outside the catch-up window is reported, never left spinning", async () => {
  const staged = stageInterruptedRun({ startedAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString() });
  let onEventCalls = 0;
  const watcher = new EventsWatcher(staged.eventsDir, async () => { onEventCalls += 1; }, {
    leaseStore: staged.store,
    channel: "telegram",
    leaseScope: "telegram",
    catchUpWindowMs: 30 * 60 * 1000
  }) as unknown as { resumeRecoveredLease: (filename: string, event: MomEvent) => boolean };

  try {
    // A restart reclaims the orphaned lease first, exactly as start() does.
    staged.store.recoverStaleRunning(new Date(), "next-process");
    assert.equal(staged.store.getById(staged.lease.id)?.status, "interrupted");

    assert.equal(watcher.resumeRecoveredLease(staged.filename, staged.event), true);
    await new Promise((resolve) => setTimeout(resolve, 10));

    const status = readStatus(staged.eventPath);
    assert.equal(status.state, "pending", "a periodic task returns to its schedule instead of hanging");
    assert.equal(status.reason, "interrupted");
    assert.equal(status.runningSlotKey, undefined);
    assert.equal(status.runId, undefined);
    assert.equal(onEventCalls, 0, "a stale side-effecting run must not be replayed hours later");
  } finally {
    rmSync(staged.eventsDir, { recursive: true, force: true });
    staged.store.close();
  }
});

test("an interrupted run inside the catch-up window resumes and is not blocked by its own lease", async () => {
  const staged = stageInterruptedRun({ startedAt: new Date(Date.now() - 60_000).toISOString() });
  let onEventCalls = 0;
  const watcher = new EventsWatcher(staged.eventsDir, async () => { onEventCalls += 1; }, {
    leaseStore: staged.store,
    channel: "telegram",
    leaseScope: "telegram",
    catchUpWindowMs: 30 * 60 * 1000
  }) as unknown as { resumeRecoveredLease: (filename: string, event: MomEvent) => boolean };

  try {
    staged.store.recoverStaleRunning(new Date(), "next-process");
    assert.equal(watcher.resumeRecoveredLease(staged.filename, staged.event), true);
    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.equal(onEventCalls, 1, "the catch-up actually executed");
    assert.equal(staged.store.getById(staged.lease.id)?.status, "completed");
    assert.equal(
      staged.store.listForTask(staged.taskId).some((execution) => execution.stopReason === "task_already_running"),
      false,
      "recovery must not skip itself"
    );
    assert.equal(readStatus(staged.eventPath).state, "pending");
  } finally {
    rmSync(staged.eventsDir, { recursive: true, force: true });
    staged.store.close();
  }
});

test("a running file whose lease vanished is reconciled instead of hanging", async () => {
  const staged = stageInterruptedRun({ startedAt: new Date().toISOString() });
  const emptyStore = new EventExecutionLeaseStore(":memory:");
  const watcher = new EventsWatcher(staged.eventsDir, async () => {}, {
    leaseStore: emptyStore,
    channel: "telegram",
    leaseScope: "telegram"
  }) as unknown as { resumeRecoveredLease: (filename: string, event: MomEvent) => boolean };

  try {
    assert.equal(watcher.resumeRecoveredLease(staged.filename, staged.event), true);
    const status = readStatus(staged.eventPath);
    assert.equal(status.state, "pending");
    assert.equal(status.reason, "interrupted");
  } finally {
    rmSync(staged.eventsDir, { recursive: true, force: true });
    emptyStore.close();
    staged.store.close();
  }
});

// The release guard compared runIds only. On the recovery path the file still
// holds the crashed attempt's runId while the release carries a fresh one, so
// the guard rejected exactly the release that unsticks the file.
test("releasing the run-lock succeeds when recovery carries a fresh runId for the same slot", () => {
  const staged = stageInterruptedRun({ startedAt: new Date().toISOString() });
  const watcher = new EventsWatcher(staged.eventsDir, async () => {}, {
    leaseStore: staged.store,
    channel: "telegram",
    leaseScope: "telegram"
  }) as unknown as {
    releasePeriodicRunLock: (filename: string, event: MomEvent, reason: string, slotKey: string, runId: string) => void;
  };

  try {
    watcher.releasePeriodicRunLock(staged.filename, staged.event, "task_already_running", staged.slotKey, "a-brand-new-run-id");
    const status = readStatus(staged.eventPath);
    assert.equal(status.state, "pending");
    assert.equal(status.runningSlotKey, undefined);
  } finally {
    rmSync(staged.eventsDir, { recursive: true, force: true });
    staged.store.close();
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

test("event timeout returns after grace when the run ignores cancellation", async () => {
  const store = new EventExecutionLeaseStore(":memory:");
  const eventsDir = mkdtempSync(join(tmpdir(), "molibot-events-hard-timeout-"));
  const watcher = new EventsWatcher(
    eventsDir,
    async () => await new Promise<void>(() => {}),
    { leaseStore: store, timeoutSettleGraceMs: 5 }
  );
  const lease = { ...createLease(store, 5), timeoutMs: 5 };

  try {
    const runAttemptWithTimeout = (watcher as any).runAttemptWithTimeout.bind(watcher);
    const startedAt = Date.now();
    const result = await runAttemptWithTimeout(createPeriodicEvent(), "event.json", lease);
    assert.deepEqual(result, { status: "timeout" });
    assert.ok(Date.now() - startedAt < 100);
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

test("successful one-shot completion becomes unread", () => {
  const store = new EventExecutionLeaseStore(":memory:");
  const eventsDir = mkdtempSync(join(tmpdir(), "molibot-events-reminder-"));
  const watcher = new EventsWatcher(eventsDir, async () => {}, { leaseStore: store }) as unknown as {
    markDone: (filename: string, event: MomEvent, reason: string) => void;
    stop: () => void;
  };
  const event: MomEvent = { type: "one-shot", chatId: "chat-1", text: "Drink water", at: "2026-07-15T10:00:00.000Z" };
  writeFileSync(join(eventsDir, "reminder.json"), `${JSON.stringify(event)}\n`, "utf8");

  try {
    watcher.markDone("reminder.json", event, "completed");
    const completed = JSON.parse(readFileSync(join(eventsDir, "reminder.json"), "utf8"));
    assert.equal(completed.status.state, "completed");
    assert.equal(completed.status.reminderUnread, true);
  } finally {
    watcher.stop();
    rmSync(eventsDir, { recursive: true, force: true });
    store.close();
  }
});

test("markOneShotReminderReadFile persists read state and rejects periodic tasks", () => {
  const eventsDir = mkdtempSync(join(tmpdir(), "molibot-events-read-"));
  const reminderPath = join(eventsDir, "reminder.json");
  const periodicPath = join(eventsDir, "periodic.json");
  writeFileSync(reminderPath, JSON.stringify({ type: "one-shot", at: "2026-07-15T10:00:00.000Z", chatId: "chat-1", text: "Drink water", status: { state: "completed", reminderUnread: true } }), "utf8");
  writeFileSync(periodicPath, JSON.stringify(createPeriodicEvent()), "utf8");

  try {
    markOneShotReminderReadFile(reminderPath);
    assert.equal(JSON.parse(readFileSync(reminderPath, "utf8")).status.reminderUnread, false);
    assert.throws(() => markOneShotReminderReadFile(periodicPath), /not_one_shot/);
  } finally {
    rmSync(eventsDir, { recursive: true, force: true });
  }
});
