import assert from "node:assert/strict";
import test from "node:test";
import { buildSubagentTaskRecord, formatStoppedSubagentReport } from "$lib/server/agent/session/runSummary.js";

test("buildSubagentTaskRecord carries budget, model, session and a normalized task preview", () => {
  const record = buildSubagentTaskRecord(
    {
      mode: "single",
      agent: "worker",
      taskIndex: 1,
      taskCount: 1,
      task: "do   a   thing\n  with   spaces",
      stopReason: "error",
      errorMessage: "budget exceeded",
      budget: { toolCalls: 24, toolFailures: 1, modelFailures: 2, modelTurns: 0 },
      model: "claude-sonnet-4-6",
      sessionId: "run-1-1-worker"
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
  assert.equal(record.sessionId, "run-1-1-worker");
});

test("buildSubagentTaskRecord omits budget/model when the event lacks them", () => {
  const record = buildSubagentTaskRecord(
    { mode: "parallel", agent: "scout", taskCount: 3 },
    undefined
  );
  assert.equal(record.budget, undefined);
  assert.equal(record.model, undefined);
  assert.equal(record.sessionId, undefined);
  assert.equal(record.durationMs, undefined);
  assert.equal(record.taskPreview, undefined);
});


test("parent fallback explains incomplete work, last progress and both stopping reasons", () => {
  const report = formatStoppedSubagentReport([{ mode: "single", taskCount: 1, agent: "worker",
    taskPreview: "Translate article", stopReason: "error", errorMessage: "Model retries exhausted",
    progress: "source.md written; translation not validated" }], "Parent model unavailable");
  for (const evidence of ["未完成", "Translate article", "Model retries exhausted", "source.md", "Parent model unavailable", "不能确认全部完成"]) assert.ok(report.includes(evidence));
  assert.equal(formatStoppedSubagentReport([{ mode: "single", taskCount: 1, stopReason: "stop" }]), "");
});
