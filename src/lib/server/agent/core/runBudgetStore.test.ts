import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunBudget } from "./runtimeBudget.js";
import { RunBudgetStore } from "./runBudgetStore.js";

const limits = { maxToolCalls: 2, maxToolFailures: 2, maxModelAttempts: 2 };

test("budget reopen retains limits, counts, exhaustion and per-operation receipts", () => {
  const dir = mkdtempSync(join(tmpdir(), "molibot-budget-"));
  const path = join(dir, "budgets.sqlite");
  let budget = new RunBudget(limits, new RunBudgetStore(path, "root", limits));
  try {
    assert.equal(budget.tryStartTool("call-1").ok, true);
    assert.equal(budget.recordToolResult(true, "call-1").ok, true);
    assert.equal(budget.tryRecordModelFailure("generation-1").ok, true);
    budget.close();
    const changedLimits = { maxToolCalls: 100, maxToolFailures: 100, maxModelAttempts: 100 };
    budget = new RunBudget(changedLimits, new RunBudgetStore(path, "root", changedLimits));
    assert.deepEqual(budget.limitsSnapshot(), limits);
    assert.equal(budget.tryStartTool("call-1").ok, true);
    assert.equal(budget.recordToolResult(true, "call-1").ok, true);
    assert.equal(budget.tryRecordModelFailure("generation-1").ok, true);
    assert.deepEqual(budget.snapshot(), { toolCalls: 1, toolFailures: 1, modelFailures: 1, modelTurns: 0 });
    assert.throws(() => budget.recordToolResult(false, "call-1"), /conflicting results/);
    assert.equal(budget.tryStartTool("call-2").ok, true);
    assert.equal(budget.recordToolResult(true, "call-2").ok, false);
    budget.close();
    budget = new RunBudget(limits, new RunBudgetStore(path, "root", limits));
    assert.equal(budget.getExceededKind(), "toolFailures");
    assert.equal(budget.tryStartTool("call-3").ok, false);
    assert.deepEqual(budget.snapshot(), { toolCalls: 2, toolFailures: 2, modelFailures: 1, modelTurns: 0 });
  } finally { budget.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("two controllers share atomic counts while other admitted runs remain isolated", () => {
  const dir = mkdtempSync(join(tmpdir(), "molibot-budget-"));
  const path = join(dir, "budgets.sqlite");
  const first = new RunBudget(limits, new RunBudgetStore(path, "root", limits));
  const second = new RunBudget(limits, new RunBudgetStore(path, "root", limits));
  const foreign = new RunBudget(limits, new RunBudgetStore(path, "other", limits));
  try {
    assert.equal(first.tryStartTool("call-1").ok, true);
    assert.equal(second.tryStartTool("call-1").ok, true);
    assert.equal(second.tryStartTool("call-2").ok, true);
    assert.equal(first.tryStartTool("call-3").ok, false);
    assert.equal(second.tryStartTool("call-1").ok, false, "an old admission receipt cannot bypass later exhaustion");
    assert.deepEqual(second.snapshot(), { toolCalls: 2, toolFailures: 0, modelFailures: 0, modelTurns: 0 });
    assert.equal(foreign.tryStartTool("call-1").ok, true);
    assert.equal(foreign.snapshot().toolCalls, 1);
    assert.equal(first.tryRecordModelFailure("one").ok, true);
    assert.equal(second.tryRecordModelFailure("two").ok, true);
    assert.equal(first.tryRecordModelFailure("three").ok, false);
    assert.equal(second.getExceededKind(), "modelFailures");
  } finally { first.close(); second.close(); foreign.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("model turns retain deduplicated receipts without consuming failure retries after reopen", () => {
  const dir = mkdtempSync(join(tmpdir(), "molibot-budget-turns-"));
  const path = join(dir, "budgets.sqlite");
  const childLimits = { ...limits };
  let budget = new RunBudget(childLimits, new RunBudgetStore(path, "child", childLimits));
  try {
    assert.equal(budget.tryStartModelTurn("same-id").ok, true);
    assert.equal(budget.tryRecordModelFailure("same-id").ok, true);
    budget.close();
    const raised = { ...limits, maxModelAttempts: 100 };
    budget = new RunBudget(raised, new RunBudgetStore(path, "child", raised));
    assert.deepEqual(budget.limitsSnapshot(), childLimits);
    assert.equal(budget.tryStartModelTurn("same-id").ok, true);
    assert.equal(budget.tryRecordModelFailure("same-id").ok, true);
    assert.deepEqual(budget.snapshot(), { toolCalls: 0, toolFailures: 0, modelFailures: 1, modelTurns: 1 });
    assert.equal(budget.tryStartModelTurn("second").ok, true);
    assert.equal(budget.tryStartModelTurn("third").ok, true);
    budget.close();
    budget = new RunBudget(childLimits, new RunBudgetStore(path, "child", childLimits));
    assert.ok(!budget.getExceededKind());
    assert.equal(budget.snapshot().modelFailures, 1);
    assert.equal(budget.snapshot().modelTurns, 3);
  } finally { budget.close(); rmSync(dir, { recursive: true, force: true }); }
});
