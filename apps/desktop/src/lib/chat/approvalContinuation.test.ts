import assert from "node:assert/strict";
import test from "node:test";
import { followApprovalContinuation } from "./approvalContinuation";

test("progress rows and more than fifteen polls do not finish an active continuation", async () => {
  let polls = 0;
  let reloads = 0;
  await followApprovalContinuation({
    isCurrent: () => true,
    reload: async () => { reloads++; },
    adoptApproval: async () => false,
    isRunning: async () => ++polls <= 20,
    pause: async () => {}
  });
  assert.equal(polls, 22);
  assert.equal(reloads, 23);
});

test("another approval hands control back without waiting for terminal status", async () => {
  await followApprovalContinuation({
    isCurrent: () => true, reload: async () => {}, adoptApproval: async () => true,
    isRunning: async () => { assert.fail("approval waits must return control"); }, pause: async () => {}
  });
});

test("switching sessions during a pause does not reload the old conversation", async () => {
  let current = true;
  await followApprovalContinuation({
    isCurrent: () => current, reload: async () => assert.fail("stale reload"),
    adoptApproval: async () => false, isRunning: async () => true,
    pause: async () => { current = false; }
  });
});

test("a session change during the status request cannot trigger a final stale reload", async () => {
  let current = true;
  let checks = 0;
  let reloads = 0;
  await followApprovalContinuation({
    isCurrent: () => current,
    reload: async () => { reloads++; },
    adoptApproval: async () => false,
    isRunning: async () => { if (++checks === 2) current = false; return false; },
    pause: async () => {}
  });
  assert.equal(reloads, 2);
});

test("stopping during a long continuation releases polling without a new message", async () => {
  let stopped = false;
  let checks = 0;
  await followApprovalContinuation({
    isCurrent: () => !stopped, reload: async () => {}, adoptApproval: async () => false,
    isRunning: async () => { checks++; return true; },
    pause: async () => { if (checks === 3) stopped = true; }
  });
  assert.equal(checks, 3);
});
