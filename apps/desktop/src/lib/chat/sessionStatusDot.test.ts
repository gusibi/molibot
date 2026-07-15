import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveStatusDot,
  nextTurnStatus,
  sessionRuntimeKey,
  statusFromRestoredRun
} from "./sessionStatusDot.js";

test("sessionRuntimeKey is profileId:sessionId", () => {
  assert.equal(sessionRuntimeKey("personal", "s-1"), "personal:s-1");
});

test("deriveStatusDot: running and waiting always show, regardless of active", () => {
  assert.deepEqual(deriveStatusDot("running", true), { color: "running", labelKey: "running" });
  assert.deepEqual(deriveStatusDot("running", false), { color: "running", labelKey: "running" });
  assert.deepEqual(deriveStatusDot("waiting", true), { color: "waiting", labelKey: "waitingApproval" });
  assert.deepEqual(deriveStatusDot("waiting", false), { color: "waiting", labelKey: "waitingApproval" });
});

test("deriveStatusDot: terminal status only shows for background sessions (plan §8.2)", () => {
  assert.deepEqual(deriveStatusDot("completed", false), { color: "completed", labelKey: "completed" });
  assert.equal(deriveStatusDot("completed", true), null);
  assert.deepEqual(deriveStatusDot("failed", false), { color: "failed", labelKey: "failed" });
  assert.equal(deriveStatusDot("failed", true), null);
  assert.equal(deriveStatusDot("idle", true), null);
  assert.equal(deriveStatusDot("idle", false), null);
});

test("nextTurnStatus mirrors an in-flight turn", () => {
  assert.equal(
    nextTurnStatus({ prevSending: false, sending: true, pendingApproval: false, isActive: true, error: "", current: "idle" }),
    "running"
  );
  assert.equal(
    nextTurnStatus({ prevSending: true, sending: true, pendingApproval: true, isActive: false, error: "", current: "running" }),
    "waiting"
  );
});

test("nextTurnStatus: active turn end goes idle (outcome shown inline, no unread dot)", () => {
  assert.equal(
    nextTurnStatus({ prevSending: true, sending: false, pendingApproval: false, isActive: true, error: "boom", current: "running" }),
    "idle"
  );
});

test("nextTurnStatus: background turn end records terminal status for the unread dot", () => {
  assert.equal(
    nextTurnStatus({ prevSending: true, sending: false, pendingApproval: false, isActive: false, error: "", current: "running" }),
    "completed"
  );
  assert.equal(
    nextTurnStatus({ prevSending: true, sending: false, pendingApproval: false, isActive: false, error: "boom", current: "running" }),
    "failed"
  );
});

test("nextTurnStatus leaves a background terminal status intact outside a transition", () => {
  // A background session that already finished must keep its dot until viewed.
  assert.equal(
    nextTurnStatus({ prevSending: false, sending: false, pendingApproval: false, isActive: false, error: "", current: "completed" }),
    "completed"
  );
  assert.equal(
    nextTurnStatus({ prevSending: false, sending: false, pendingApproval: false, isActive: false, error: "", current: "failed" }),
    "failed"
  );
});

test("statusFromRestoredRun maps server run status to registry status", () => {
  assert.equal(statusFromRestoredRun("running"), "running");
  assert.equal(statusFromRestoredRun("waiting_for_approval"), "waiting");
});
