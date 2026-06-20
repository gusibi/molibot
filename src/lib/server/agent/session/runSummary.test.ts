import assert from "node:assert/strict";
import test from "node:test";
import { buildSubagentTaskRecord } from "$lib/server/agent/session/runSummary.js";

test("buildSubagentTaskRecord carries budget, model and a normalized task preview", () => {
  const record = buildSubagentTaskRecord(
    {
      mode: "single",
      agent: "worker",
      taskIndex: 1,
      taskCount: 1,
      task: "do   a   thing\n  with   spaces",
      stopReason: "error",
      errorMessage: "budget exceeded",
      budget: { toolCalls: 24, toolFailures: 1, modelAttempts: 2 },
      model: "claude-sonnet-4-6"
    },
    1234
  );

  assert.equal(record.mode, "single");
  assert.equal(record.agent, "worker");
  assert.equal(record.taskIndex, 1);
  assert.equal(record.taskCount, 1);
  assert.equal(record.taskPreview, "do a thing with spaces");
  assert.equal(record.stopReason, "error");
  assert.equal(record.errorMessage, "budget exceeded");
  assert.equal(record.durationMs, 1234);
  assert.equal(record.budget?.toolCalls, 24);
  assert.equal(record.model, "claude-sonnet-4-6");
});

test("buildSubagentTaskRecord omits budget/model when the event lacks them", () => {
  const record = buildSubagentTaskRecord(
    { mode: "parallel", agent: "scout", taskCount: 3 },
    undefined
  );
  assert.equal(record.budget, undefined);
  assert.equal(record.model, undefined);
  assert.equal(record.durationMs, undefined);
  assert.equal(record.taskPreview, undefined);
});
