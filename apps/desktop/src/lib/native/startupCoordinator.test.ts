import assert from "node:assert/strict";
import test from "node:test";
import {
  ActivityScheduler,
  desktopStatusPolicy,
  type ActivityClock,
  type ActivityVisibility
} from "./activityScheduler";
import { initialStartupState, reduceStartup } from "./startupCoordinator";

type Scheduled = { at: number; callback: () => void; cancelled: boolean };

function fakeClock(): ActivityClock & { advance(ms: number): void } {
  let now = 0;
  const scheduled: Scheduled[] = [];
  return {
    now: () => now,
    setTimeout(callback, delayMs) {
      const entry = { at: now + delayMs, callback, cancelled: false };
      scheduled.push(entry);
      return entry as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout(handle) {
      (handle as unknown as Scheduled).cancelled = true;
    },
    advance(ms) {
      const deadline = now + ms;
      while (true) {
        const next = scheduled
          .filter((entry) => !entry.cancelled && entry.at <= deadline)
          .sort((left, right) => left.at - right.at)[0];
        if (!next) break;
        now = next.at;
        next.cancelled = true;
        next.callback();
      }
      now = deadline;
    }
  };
}

function fakeVisibility(): ActivityVisibility & { hiddenValue: boolean; emit(): void } {
  let listener: (() => void) | null = null;
  return {
    hiddenValue: false,
    hidden() { return this.hiddenValue; },
    subscribe(next) {
      listener = next;
      return () => { listener = null; };
    },
    emit() { listener?.(); }
  };
}

test("StartupCoordinator covers delayed, retry, and recovered transitions", () => {
  let state = initialStartupState;
  state = reduceStartup(state, { type: "status", ready: false, recoverable: true });
  assert.equal(state.phase, "starting");
  state = reduceStartup(state, { type: "delayed" });
  assert.equal(state.phase, "delayed");
  state = reduceStartup(state, { type: "retry" });
  assert.equal(state.phase, "retrying");
  state = reduceStartup(state, { type: "status", ready: true, recoverable: true });
  assert.deepEqual(state, { phase: "ready", error: "" });
  state = reduceStartup(state, { type: "failed", error: "Unavailable" });
  assert.deepEqual(state, { phase: "error", error: "Unavailable" });
});

test("ActivityScheduler fast-polls for eight seconds then backs off", async () => {
  const clock = fakeClock();
  const visibility = fakeVisibility();
  let requests = 0;
  const scheduler = new ActivityScheduler(desktopStatusPolicy, async () => { requests += 1; }, visibility, clock);

  scheduler.start();
  await Promise.resolve();
  assert.equal(requests, 1);
  clock.advance(1_000);
  await Promise.resolve();
  for (let index = 0; index < 7; index += 1) {
    clock.advance(1_000);
    await Promise.resolve();
  }
  assert.equal(requests, 9);
  clock.advance(2_000);
  await Promise.resolve();
  assert.equal(requests, 10);
  clock.advance(4_000);
  await Promise.resolve();
  assert.equal(requests, 11);
  scheduler.dispose();
});

test("ActivityScheduler pauses hidden work, wakes once visible, and disposes", async () => {
  const clock = fakeClock();
  const visibility = fakeVisibility();
  let requests = 0;
  const scheduler = new ActivityScheduler(desktopStatusPolicy, async () => { requests += 1; }, visibility, clock);

  scheduler.start();
  await Promise.resolve();
  visibility.hiddenValue = true;
  clock.advance(4_000);
  await Promise.resolve();
  assert.equal(requests, 1);
  visibility.hiddenValue = false;
  visibility.emit();
  await Promise.resolve();
  assert.equal(requests, 2);
  scheduler.dispose();
  clock.advance(10_000);
  await Promise.resolve();
  assert.equal(requests, 2);
});

test("ActivityScheduler coalesces wakes while a request is in flight", async () => {
  const clock = fakeClock();
  const visibility = fakeVisibility();
  let resolveRequest: () => void = () => {};
  let requests = 0;
  const scheduler = new ActivityScheduler(desktopStatusPolicy, () => new Promise<void>((resolve) => {
    requests += 1;
    resolveRequest = resolve;
  }), visibility, clock);

  scheduler.start();
  scheduler.wake("retry");
  scheduler.wake("manual");
  assert.equal(requests, 1);
  resolveRequest();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(requests, 2);
  scheduler.dispose();
});
