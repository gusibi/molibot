import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

for (const mode of ["codemode", "extension", "manual", "plan", "command", "stream", "deferred", "stream_cancel", "manual_stream", "compact"]) test(`production Runner ${mode} uses native model ownership and the original Session`, { timeout: 60000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-model-runner-"));
  const child = fork("evals/fixtures/pi-model-runner-worker.ts", [], {
    execArgv: ["--import", "./scripts/register-loader.js", "--import", "tsx"],
    env: { ...process.env, DATA_DIR: directory, DB_DIR: join(directory, "db"), SETTINGS_DB_FILE: join(directory, "db", "settings.sqlite"), SETTINGS_FILE: join(directory, "settings.json"), WEB_WORKSPACE_DIR: join(directory, "moli-web"), SESSIONS_DIR: join(directory, "sessions"), SESSIONS_INDEX_FILE: join(directory, "sessions", "index.json"), PI_CODING_AGENT_DIR: join(directory, "pi"), PI_MODEL_FIXTURE_MODE: mode },
    stdio: ["ignore", "ignore", "pipe", "ipc"]
  });
  let logs = ""; child.stderr?.on("data", chunk => { logs += chunk; });
  let result: any; child.on("message", message => { result = message; });
  try {
    await once(child, "close");
    assert.equal(child.exitCode, 0, logs);
    assert.equal(result?.type, "result", JSON.stringify(result));
    if (mode.startsWith("manual") || mode === "plan") {
      assert.deepEqual(result.ledger, [], JSON.stringify(result));
      assert.equal(result.tasks.length, 0);
      if (mode.startsWith("manual")) {
        assert.equal(result.outcome.stopReason, "waiting_for_approval", JSON.stringify(result));
        assert.equal(result.approvals.length, 1);
        assert.equal(result.approvals[0].action.toolName, mode === "manual_stream" ? "stream_fixture (x1 aggregated)" : "modelsClassify (x1 aggregated)");
        assert.equal(result.approvals[0].sessionId, "session");
      } else assert.equal(result.messages.find((message: any) => message.role === "toolResult")?.isError, true, JSON.stringify(result.messages));
      return;
    }
    assert.equal(result.outcome.stopReason, "stop", JSON.stringify(result));
    if (mode === "compact") {
      assert.ok(JSON.stringify(result.messages).includes("Compaction requested"), JSON.stringify(result));
      assert.equal(result.generations, 3, JSON.stringify({ generations: result.generations, messages: result.messages }));
      const compaction = result.receipts.filter((row: any) => String(row.requestId).includes(":compaction:"));
      assert.equal(compaction.length, 1);
      assert.equal(compaction[0].totalTokens, 4);
      assert.ok(result.requestContexts.some((request: any) => JSON.stringify(request).includes("Keep fixture facts")));
      return;
    }
    if (mode === "stream_cancel") {
      assert.deepEqual(result.ledger, ["stream", "cancelled"], JSON.stringify(result));
      assert.ok(JSON.stringify(result.messages).includes("Cancellation verified"));
      assert.equal(result.modelBudgetReceipts.length, 1);
      const cancelledUsage = result.receipts.filter((row: any) => String(row.requestId).includes(":extension:model:"));
      assert.equal(cancelledUsage.length, 1, JSON.stringify(result.receipts));
      assert.equal(cancelledUsage[0].totalTokens, 4);
      return;
    }
    assert.deepEqual(result.ledger, mode === "codemode" ? ["classify", "classify", "images"] : mode === "stream" ? ["stream"] : mode === "deferred" ? ["stream", "poll"] : ["classify"], JSON.stringify(result.messages));
    assert.equal(result.modelBudgetReceipts.length, mode === "codemode" ? 3 : 1);
    const modelUsage = result.receipts.filter((row: any) => String(row.requestId).includes(":model:"));
    assert.equal(modelUsage.length, mode === "codemode" ? 2 : 1);
    assert.equal(new Set(modelUsage.map((row: any) => row.requestId)).size, modelUsage.length);
    if (mode === "codemode") {
      assert.equal(result.tasks.length, 1);
      assert.equal(result.tasks[0].status, "completed");
      assert.equal(result.tasks[0].sessionId, "session");
      assert.equal(result.tasks[0].artifacts.length, 2);
      assert.equal(result.tasks[0].textOutput, "Two fixture images");
      assert.equal(result.tasks[0].usage.totalTokens, 4);
      assert.deepEqual(result.tasks[0].artifacts.map((artifact: any) => readFileSync(artifact.path).subarray(-6).toString().replace(/[^a-z]/g, "")), ["first", "second"]);
    }
    for (const request of result.requestContexts) {
      const rendered = JSON.stringify(request);
      assert.ok(rendered.includes("codemode"));
      assert.ok(!rendered.includes('"name":"modelsClassify"'));
      assert.ok(!rendered.includes('"name":"modelsGenerateImages"'));
      assert.ok(!rendered.includes('"name":"modelsStream"'));
    }
    if (mode === "command") { assert.equal(result.generations, 0); assert.ok(result.commandOutput.includes("Command verified"), JSON.stringify(result)); }
    assert.ok(JSON.stringify(result.messages).includes(mode === "codemode" ? "Two fixture images" : mode === "command" ? "Command verified" : ["stream", "deferred", "stream_cancel", "manual_stream", "compact"].includes(mode) ? "Streamed fixture" : "Extension verified"), JSON.stringify(result.messages));
  } finally {
    if (child.exitCode === null && child.signalCode === null) { const exited = once(child, "exit"); child.kill("SIGKILL"); await exited; }
    rmSync(directory, { recursive: true, force: true });
  }
});
