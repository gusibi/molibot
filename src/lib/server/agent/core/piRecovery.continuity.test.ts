import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAssistantMessageEventStream, type Model } from "@earendil-works/pi-ai";
import { RunBudget } from "./runtimeBudget.js";
import { RunBudgetStore } from "./runBudgetStore.js";
import { PiRunSession } from "./piRunSession.js";

const model: Model<"openai-completions"> = { api: "openai-completions", id: "fixture", provider: "fixture", name: "Fixture",
  baseUrl: "http://fixture.invalid", reasoning: false, input: ["text"], contextWindow: 8192, maxTokens: 1024,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };

test("losing the service lease before recovery starts prevents the first provider request", async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-lease-"));
  let streamCalls = 0;
  const run = new PiRunSession({ initialState: { model, systemPrompt: "Answer", messages: [], tools: [] },
    getApiKey: () => "fixture", streamFn: () => { streamCalls += 1; const stream = createAssistantMessageEventStream(); stream.end(); return stream; } });
  try {
    run.startTurn();
    run.bindRun({ storagePath: join(directory, "pi.sqlite"), requestId: "inbound", admissionKey: "manual", models: [model],
      scope: { ownerId: "owner", executionId: "run", stepId: "step", planVersion: 1, authorityKey: "manual" },
      assertStorageOwnership: () => { throw new Error("Pi execution lost service ownership."); }, assertAuthority: () => {} });
    await assert.rejects(() => run.prompt("Resume"), /service ownership/);
    assert.equal(streamCalls, 0);
  } finally { await run.close().catch(() => undefined); rmSync(directory, { recursive: true, force: true }); }
});

test("the run budget is keyed by the admitted budget identity, so recovery resumes it", () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-budget-"));
  const limits = { maxToolCalls: 20, maxToolFailures: 6, maxModelAttempts: 6 };
  // The runner keys the budget store by [workspaceDir, chatId, budgetId ?? runId].
  const key = JSON.stringify(["/workspace", "chat", "budget-1"]);
  try {
    const first = new RunBudget(limits, new RunBudgetStore(join(directory, "budget.sqlite"), key, limits));
    first.tryStartModelTurn("attempt-1");
    first.tryStartTool("tool-1");
    const before = first.snapshot();
    first.close();

    // Reopening with the same admitted budget identity continues the same budget.
    const resumed = new RunBudget(limits, new RunBudgetStore(join(directory, "budget.sqlite"), key, limits));
    assert.deepEqual(resumed.snapshot(), before);
    resumed.close();

    // A different run (no shared budget id) starts from a fresh budget.
    const other = new RunBudget(limits, new RunBudgetStore(join(directory, "budget.sqlite"), JSON.stringify(["/workspace", "chat", "run-2"]), limits));
    assert.equal(other.snapshot().modelTurns, 0);
    other.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
