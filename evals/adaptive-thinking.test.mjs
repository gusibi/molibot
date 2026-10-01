import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { adaptiveTasks, percentile, summarizeAdaptiveSamples, readAdaptiveTrace } from "./lib/adaptive-thinking.mjs";

test("offline listing covers representative categories without a service or credentials", () => {
  const output = execFileSync(process.execPath, ["evals/adaptive-thinking.mjs", "--list"], { encoding: "utf8" });
  assert.match(output, /adaptive-thinking-v1/);
  for (const category of ["simple", "diagnosis", "followup", "missing-context", "attachment", "long-context"]) assert.ok(adaptiveTasks.some(task => task.category === category));
});
test("percentiles exclude unmeasured values and report unproven cost", () => {
  assert.equal(percentile([null, undefined, 10, 20, 30], .5), 20);
  assert.equal(percentile([null], .95), null);
  const summary = summarizeAdaptiveSamples([{ mode: "auto", status: "pass", endToEndMs: 10, decisionMs: null, firstVisibleMs: null }]);
  assert.equal(summary.auto.passRate, 1);
  assert.equal(summary.auto.firstVisibleMs.p50, null);
  assert.equal(summary.auto.totalCost, null);
});
test("trace metrics select only measured sessions and do not infer retries or cost", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "adaptive-eval-test-"));
  try {
    mkdirSync(path.join(dir, "db"));
    const db = new DatabaseSync(path.join(dir, "db", "trace.sqlite"));
    db.exec("CREATE TABLE agent_trace_facts (session_id TEXT, fact_type TEXT, name TEXT, status TEXT, payload_json TEXT)");
    const insert = db.prepare("INSERT INTO agent_trace_facts VALUES (?, ?, '', 'success', ?)");
    insert.run("selected", "runtime_notice", JSON.stringify({ code: "decision_model.thinking_level", latencyMs: 15, fallbackReason: "timeout" }));
    insert.run("other", "runtime_notice", JSON.stringify({ code: "decision_model.thinking_level", latencyMs: 999 }));
    insert.run("selected", "model_call", JSON.stringify({ requestedThinkingLevel: "high", effectiveThinkingLevel: "medium" }));
    db.close();
    const result = readAdaptiveTrace(dir, ["selected"]);
    assert.equal(result.decisionMs, 15);
    assert.deepEqual(result.fallbackReasons, ["timeout"]);
    assert.equal(result.capabilityAdjustments.length, 1);
    assert.equal(result.retries, null);
    assert.equal(result.totalCost, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("combined cost requires every attempted decision and main call cost", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "adaptive-cost-test-"));
  try {
    const db = new DatabaseSync(path.join(dir, "trace.sqlite"));
    db.exec("CREATE TABLE agent_trace_facts (session_id TEXT, fact_type TEXT, name TEXT, status TEXT, payload_json TEXT)");
    const insert = db.prepare("INSERT INTO agent_trace_facts VALUES (?, ?, '', 'success', ?)");
    insert.run("known", "runtime_notice", JSON.stringify({ code: "decision_model.thinking_level", attempted: true, estimatedCost: .01, usage: { inputTokens: 10, outputTokens: 2 } }));
    insert.run("known", "model_call", JSON.stringify({ usage: { cost: { total: .1 } } }));
    insert.run("unknown", "runtime_notice", JSON.stringify({ code: "decision_model.thinking_level", attempted: true }));
    insert.run("unknown", "model_call", JSON.stringify({ usage: { cost: { total: .1 } } }));
    db.close();
    assert.equal(readAdaptiveTrace(dir, ["known"]).totalCost, .11);
    assert.equal(readAdaptiveTrace(dir, ["unknown"]).totalCost, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
