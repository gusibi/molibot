import assert from "node:assert/strict";
import test from "node:test";
import { handoverApprovalAction } from "./handoverApproval";

const durable = {
  requestId: "req-1",
  approvalId: "approval-row-1",
  executionId: "exec-1",
  expectedVersion: 7
};

test("a Durable approval resolves through the tool-approval bridge with its own row id and version", () => {
  assert.deepEqual(handoverApprovalAction(durable, "approve_once", "action-1"), {
    kind: "durable",
    input: {
      action: "resolve_approval",
      executionId: "exec-1",
      approvalId: "approval-row-1",
      status: "approved",
      selectedScope: "once",
      expectedVersion: 7,
      actionId: "action-1"
    }
  });
});

test("rejecting a Durable approval sends no scope", () => {
  const action = handoverApprovalAction(durable, "reject", "action-2");
  assert.equal(action?.kind, "durable");
  if (action?.kind !== "durable" || action.input.action !== "resolve_approval") return;
  assert.equal(action.input.status, "rejected");
  assert.equal("selectedScope" in action.input, false);
});

test("a plain Host Bash approval resolves by request id and keeps the decision", () => {
  assert.deepEqual(handoverApprovalAction({ requestId: "req-2" }, "reject", "action-3"), {
    kind: "host-bash",
    requestId: "req-2"
  });
});

test("an approval with neither owner resolves nothing", () => {
  assert.equal(handoverApprovalAction({}, "approve_once", "action-4"), null);
});
