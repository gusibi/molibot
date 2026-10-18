import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { installParentWatchdog } from "./parent-watchdog.mjs";

function fakeProcess(ppid) {
  const signals = [];
  return {
    signals,
    ref: {
      pid: 4242,
      ppid,
      kill(pid, signal) {
        signals.push([pid, signal]);
      }
    }
  };
}

test("standalone launches install no watchdog", () => {
  assert.equal(installParentWatchdog({ managed: false, intervalMs: 5 }), null);
});

test("a reparented sidecar (ppid 1) SIGTERMs itself exactly once", async () => {
  const { signals, ref } = fakeProcess(987);
  const watchdog = installParentWatchdog({ managed: true, intervalMs: 5, processRef: ref });
  assert.notEqual(watchdog, null);
  await sleep(20);
  assert.deepEqual(signals, [], "no signal while the supervisor is still the parent");
  ref.ppid = 1;
  await sleep(30);
  // Polling stops after the signal: a process already shutting down must not
  // be peppered with SIGTERMs.
  assert.deepEqual(signals, [[4242, "SIGTERM"]]);
  watchdog.stop();
});

test("an already orphaned sidecar is signalled on install, not a tick later", () => {
  const { signals, ref } = fakeProcess(1);
  const watchdog = installParentWatchdog({ managed: true, intervalMs: 60_000, processRef: ref });
  assert.deepEqual(signals, [[4242, "SIGTERM"]]);
  watchdog.stop();
});

test("stop() ends the polling before any signal", async () => {
  const { signals, ref } = fakeProcess(987);
  const watchdog = installParentWatchdog({ managed: true, intervalMs: 5, processRef: ref });
  watchdog.stop();
  ref.ppid = 1;
  await sleep(20);
  assert.deepEqual(signals, []);
});
