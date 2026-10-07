import assert from "node:assert/strict";
import test from "node:test";
import { buildSubagentTaskRecord, formatStoppedSubagentReport, formatInterruptedRunReport } from "$lib/server/agent/session/runSummary.js";

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

test("monitoring timeout preserves receipts without claiming external completion", () => {
  const report = formatInterruptedRunReport({
    progressText: "内容已推送，commit abc123。正在等待发布结果。",
    tools: [
      { label: "commit-and-push", status: "success", result: "[main abc123] add articles" },
      { label: "watch-actions", status: "running" }
    ],
    error: "Preparation stage sandbox outcome is unknown: Command timed out after 300 seconds"
  });
  for (const evidence of ["abc123", "watch-actions", "300 seconds", "超时不等于外部任务失败", "正在等待发布结果", "执行结果尚未返回"]) assert.ok(report.includes(evidence));
  assert.doesNotMatch(report, /发布成功|整体已完成/);
});

test("interruption reports are bounded and distinguish errors from successful tool results", () => {
  const report = formatInterruptedRunReport({ progressText: "[SILENT]", error: "provider unavailable",
    tools: [
      ...Array.from({ length: 20 }, (_, index) => ({ label: `step-${index}`, status: "success" as const, result: "x".repeat(10000) })),
      { label: "validation", status: "error" }
    ] });
  assert.match(report, /20 项，列出最近 5 项/);
  assert.match(report, /validation：返回错误/);
  assert.doesNotMatch(report, /\[SILENT\]|step-0：/);
  assert.ok(report.length < 3500);
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
