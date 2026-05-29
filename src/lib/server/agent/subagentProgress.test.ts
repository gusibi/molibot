import assert from "node:assert/strict";
import test from "node:test";
import { buildSubagentDiagnostic, formatSubagentProgressLabel, formatSubagentProgressSummary } from "$lib/server/agent/subagentProgress.js";

test("formatSubagentProgressLabel renders task start with role and index", () => {
  assert.equal(
    formatSubagentProgressLabel({
      type: "subagent_execution",
      phase: "task_start",
      mode: "parallel",
      agent: "worker",
      task: "Implement shared event rendering for all channels",
      taskIndex: 2,
      taskCount: 3
    }),
    "Sub Agent task started (2/3): worker - Implement shared event rendering for all channels"
  );
});

test("subagent progress summary and diagnostic include failure details", () => {
  const event = {
    type: "subagent_execution" as const,
    phase: "task_end" as const,
    mode: "chain" as const,
    agent: "reviewer",
    task: "Review the patch and report regressions",
    taskIndex: 2,
    taskCount: 2,
    stopReason: "error" as const,
    errorMessage: "Approval denied"
  };

  assert.equal(formatSubagentProgressSummary(event), "error - Approval denied");
  assert.match(buildSubagentDiagnostic(event), /subagent_phase=task_end/);
  assert.match(buildSubagentDiagnostic(event), /agent=reviewer/);
  assert.match(buildSubagentDiagnostic(event), /error=Approval denied/);
});
