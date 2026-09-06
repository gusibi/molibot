import assert from "node:assert/strict";
import test from "node:test";
import type { DesktopDurableExecutionStatus } from "@molibot/desktop-contract";
import { isActiveDurableExecution, isOpenDurableExecution } from "./sessionPlanUi";

function item(status: DesktopDurableExecutionStatus, waitingKind?: string) {
  return {
    execution: { status },
    projection: waitingKind ? { waiting: { kind: waitingKind } } : {}
  };
}

test("finished review does not remain in the running task list", () => {
  assert.equal(isActiveDurableExecution(item("waiting_for_user", "review")), false);
  assert.equal(isOpenDurableExecution(item("waiting_for_user", "review")), true);
  assert.equal(isActiveDurableExecution(item("completed")), false);
  assert.equal(isOpenDurableExecution(item("completed")), false);
});

test("work, approval, and recovery remain visible while action is pending", () => {
  assert.equal(isActiveDurableExecution(item("running")), true);
  assert.equal(isActiveDurableExecution(item("waiting_for_user", "user")), true);
  assert.equal(isActiveDurableExecution(item("waiting_for_approval", "approval")), true);
  assert.equal(isActiveDurableExecution(item("recovery_required", "recovery")), true);
});
