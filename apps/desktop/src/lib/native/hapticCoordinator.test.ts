import assert from "node:assert/strict";
import test from "node:test";
import { HapticCoordinator, type HapticAdapter } from "./hapticCoordinator";

test("HapticCoordinator emits once for each explicit committed gesture", async () => {
  let commits = 0;
  const adapter: HapticAdapter = { async commit() { commits += 1; } };
  const coordinator = new HapticCoordinator(adapter, () => "system");

  await coordinator.commit("gesture-1");
  await coordinator.commit("gesture-1");
  await coordinator.commit("gesture-2");

  assert.equal(commits, 2);
});

test("HapticCoordinator remains silent when haptics are off", async () => {
  let commits = 0;
  const adapter: HapticAdapter = { async commit() { commits += 1; } };
  const coordinator = new HapticCoordinator(adapter, () => "off");

  await coordinator.commit("gesture-1");

  assert.equal(commits, 0);
});
