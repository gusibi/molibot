import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationPlan } from "$lib/shared/types/message.js";
import type { DurableExecutionDetail } from "./types.js";
import { projectDurableConversationPlan } from "./planProjection.js";

const plan: ConversationPlan = {
  id: "plan-1",
  title: "Ship",
  summary: "",
  steps: [
    { id: "plan-step-1", text: "Build", status: "pending" },
    { id: "plan-step-2", text: "Publish", status: "pending" }
  ],
  status: "executing",
  recommendedMode: "accept_edits",
  artifactPath: "plans/ship.md",
  durableExecutionId: "durable-1"
};

function detail(status: DurableExecutionDetail["execution"]["status"], stepStatuses: Array<DurableExecutionDetail["steps"][number]["status"]>): DurableExecutionDetail {
  return {
    execution: { id: "durable-1", currentPlanVersion: 1, status } as DurableExecutionDetail["execution"],
    planVersions: [],
    steps: stepStatuses.map((stepStatus, index) => ({
      id: `durable-step-${index}`,
      planVersion: 1,
      index,
      status: stepStatus
    })) as DurableExecutionDetail["steps"],
    acceptanceCriteria: [],
    attempts: [],
    sideEffects: [],
    evidenceRefs: [],
    decisions: [],
    approvals: [],
    actionReceipts: []
  };
}

test("Durable step progress projects into the originating Session Plan", () => {
  const projected = projectDurableConversationPlan(plan, detail("queued", ["completed", "pending"]));
  assert.equal(projected.status, "executing");
  assert.deepEqual(projected.steps.map((step) => step.status), ["completed", "pending"]);
});

test("terminal Durable failures make the Session Plan visibly blocked", () => {
  const projected = projectDurableConversationPlan(plan, detail("recovery_required", ["completed", "uncertain"]));
  assert.equal(projected.status, "blocked");
  assert.deepEqual(projected.steps.map((step) => step.status), ["completed", "blocked"]);
});
