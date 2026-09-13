import assert from "node:assert/strict";
import test from "node:test";
import {
  emitApprovalResolved,
  onApprovalResolved,
  resetApprovalResolutionListenersForTests
} from "$lib/server/approval/resolutionEvents.js";

test("approval decisions reach every observer and a throwing observer cannot break the rest", () => {
  resetApprovalResolutionListenersForTests();
  try {
    const seen: Array<[string, string]> = [];
    onApprovalResolved((approvalId, status) => seen.push([approvalId, status]));
    onApprovalResolved(() => { throw new Error("observer failed"); });
    onApprovalResolved((approvalId, status) => seen.push([approvalId, status]));

    emitApprovalResolved("hba-1", "approved");
    emitApprovalResolved("", "rejected");

    assert.deepEqual(seen, [["hba-1", "approved"], ["hba-1", "approved"]]);
  } finally {
    resetApprovalResolutionListenersForTests();
  }
});

test("unsubscribing stops delivery", () => {
  resetApprovalResolutionListenersForTests();
  try {
    const seen: string[] = [];
    const unsubscribe = onApprovalResolved((approvalId) => seen.push(approvalId));
    emitApprovalResolved("hba-1", "rejected");
    unsubscribe();
    emitApprovalResolved("hba-2", "rejected");
    assert.deepEqual(seen, ["hba-1"]);
  } finally {
    resetApprovalResolutionListenersForTests();
  }
});
