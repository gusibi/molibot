import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationPlan } from "$lib/shared/types/message.js";
import { applyPlanProgress, finishPlanTurn } from "./planProgress.js";

const plan: ConversationPlan = {
  id: "p", title: "Build", summary: "Build and verify", status: "executing", artifactPath: "plans/p.md", recommendedMode: "accept_edits",
  steps: [{ id: "a", text: "Build", status: "pending" }, { id: "b", text: "Verify", status: "pending" }]
};

test("a finished turn cannot silently complete an unfinished plan", () => {
  assert.equal(finishPlanTurn(plan, "stop").status, "paused");
  assert.equal(finishPlanTurn(plan, "waiting_for_approval").status, "waiting_for_approval");
  assert.equal(finishPlanTurn(plan, "aborted").status, "paused");
  assert.throws(() => applyPlanProgress(plan, { steps: [], status: "completed", summary: "done" }));
});

test("verified completion and human review survive the end of the turn", () => {
  const steps = plan.steps.map((step) => ({ id: step.id, status: "completed" as const }));
  for (const status of ["completed", "waiting_review"] as const) {
    const completed = applyPlanProgress(plan, { steps, status, summary: "Verified build output" });
    assert.equal(finishPlanTurn(completed, "stop").status, status);
    const revised = applyPlanProgress(completed, { steps: [{ id: "a", status: "in_progress" }], status: "executing", summary: "Apply feedback" });
    assert.equal(revised.steps[1].status, "completed");
    assert.equal(revised.steps[0].status, "in_progress");
  }
});

test("step identity and current-step integrity are enforced", () => {
  assert.throws(() => applyPlanProgress(plan, { steps: [{ id: "other", status: "completed" }], status: "executing", summary: "bad id" }));
  assert.throws(() => applyPlanProgress(plan, { steps: plan.steps.map((step) => ({ id: step.id, status: "in_progress" })), status: "executing", summary: "ambiguous" }));
});

test("a concrete blocker or question remains actionable after the reply ends", () => {
  for (const status of ["blocked", "waiting_for_user"] as const) {
    assert.equal(finishPlanTurn({ ...plan, status }, "stop").status, status);
  }
});
