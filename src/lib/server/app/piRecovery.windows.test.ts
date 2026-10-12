import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAssistantMessageEventStream, type AssistantMessage, type Model } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { PiRecoveryStore } from "$lib/server/agent/core/piRecoveryStore.js";
import { PiRunSession } from "$lib/server/agent/core/piRunSession.js";
import { inspectPiRecovery } from "./piRecovery.js";

const model: Model<"openai-completions"> = { api: "openai-completions", id: "fixture", provider: "fixture", name: "Fixture",
  baseUrl: "http://fixture.invalid", reasoning: false, input: ["text"], contextWindow: 8192, maxTokens: 1024,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
const answer = (): AssistantMessage => ({ role: "assistant", api: model.api, provider: model.provider, model: model.id,
  content: [{ type: "text", text: "Done" }], stopReason: "stop", timestamp: Date.now(),
  usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });

const scenarios = [
  { label: "intent 前", window: "before-intent", replay: undefined, disposition: "resume", reopen: true, ledger: ["reopen:1"] },
  { label: "外部成功未提交（不可重放）", window: "external-success", replay: undefined, disposition: "review", reopen: false, ledger: ["exec:1"] },
  { label: "外部成功未提交（可安全重放）", window: "external-success", replay: "safe" as const, disposition: "resume", reopen: true, ledger: ["exec:1", "reopen:1"] },
  { label: "结果提交未投影", window: "committed-not-projected", replay: undefined, disposition: "resume", reopen: true, ledger: ["exec:1", "reopen:1"] },
  { label: "核对确认后继续（不重放未知操作）", window: "external-success", replay: undefined, disposition: "review", reopen: true, approved: ["call-1"], ledger: ["exec:1"] }
] as const;

function ledger(directory: string): string[] {
  try { return readFileSync(join(directory, "ledger"), "utf8").trim().split("\n").filter(Boolean); }
  catch { return []; }
}

function reopenTool(replay: "safe" | undefined, directory: string): AgentTool {
  let executions = 0;
  const base: AgentTool = {
    name: "effect", label: "Effect", description: "Effect", parameters: { type: "object", properties: {} },
    execute: async () => { executions += 1; appendFileSync(join(directory, "ledger"), `reopen:${executions}\n`); return { content: [{ type: "text", text: `reopened:${executions}` }], details: {} }; }
  };
  return replay ? { ...base, replay } : base;
}

/** Resume the interrupted native execution exactly as the startup recovery would. */
async function reopen(directory: string, replay: "safe" | undefined, approved?: readonly string[]): Promise<PiRunSession> {
  const run = new PiRunSession({
    initialState: { model, systemPrompt: "Answer", messages: [], tools: [reopenTool(replay, directory)] },
    getApiKey: () => "fixture",
    streamFn: () => { const stream = createAssistantMessageEventStream(); const message = answer(); stream.push({ type: "done", reason: "stop", message }); stream.end(); return stream; }
  });
  run.startTurn();
  run.bindRun({ storagePath: join(directory, "pi.sqlite"), requestId: "inbound", admissionKey: "manual", models: [model],
    scope: { ownerId: "owner", executionId: "run", stepId: "step", planVersion: 1, authorityKey: "manual" },
    assertStorageOwnership: () => undefined, assertAuthority: () => undefined,
    ...(approved ? { approvedRecoveryCallIds: approved } : {}) });
  await run.prompt("Do it");
  return run;
}

for (const scenario of scenarios) test(`native recovery window ${scenario.label} survives SIGKILL and does not duplicate the effect`, { timeout: 30000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-window-"));
  let child: ReturnType<typeof fork> | undefined;
  try {
    child = fork("evals/fixtures/pi-tool-window-worker.ts", [], {
      execArgv: ["--import", "./scripts/register-loader.js", "--import", "tsx"],
      env: { ...process.env, DB_DIR: join(directory, "db"), SETTINGS_DB_FILE: join(directory, "db", "settings.sqlite"),
        SETTINGS_FILE: join(directory, "settings.json"), WEB_WORKSPACE_DIR: join(directory, "moli-w"),
        SESSIONS_DIR: join(directory, "sessions"), SESSIONS_INDEX_FILE: join(directory, "sessions", "index.json"),
        DATA_DIR: directory, PI_CODING_AGENT_DIR: join(directory, "pi"),
        PI_TOOL_WINDOW: scenario.window, PI_TOOL_REPLAY: scenario.replay ?? "" },
      stdio: ["ignore", "ignore", "pipe", "ipc"]
    });
    child.stderr?.on("data", (data) => { if (String(data).includes("Error:")) process.stderr.write(data); });
    const [barrier] = await once(child, "message") as [Record<string, unknown>];
    assert.equal(barrier.type, "barrier", barrier.error as string | undefined);
    const exited = once(child, "exit"); child.kill("SIGKILL"); await exited;

    const store = new PiRecoveryStore(directory);
    try {
      store.save({ runId: "run", workspaceDir: directory, chatId: "chat", sessionId: "session", channel: "web",
        context: {}, actor: "actor", workspaceId: "personal", models: [], storagePath: join(directory, "pi.sqlite"), deferred: false });
    } finally { store.close(); }
    const inspected = await inspectPiRecovery(directory, () => "running");
    assert.equal(inspected.length, 1);
    assert.equal(inspected[0].disposition, scenario.disposition, inspected[0].reason);
    if (!scenario.reopen) {
      assert.deepEqual(ledger(directory), [...scenario.ledger], "a blocked effect must not run again");
      return;
    }
    const run = await reopen(directory, scenario.replay, "approved" in scenario ? scenario.approved : undefined);
    try {
      assert.deepEqual(ledger(directory), [...scenario.ledger], `ledger: ${ledger(directory).join(",")}`);
      // The committed first effect must never execute a second time in one attempt.
      assert.ok(ledger(directory).filter((line) => line === "exec:1").length <= 1);
    } finally { await run.close(); }
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) { const exited = once(child, "exit"); child.kill("SIGKILL"); await exited; }
    rmSync(directory, { recursive: true, force: true });
  }
});
