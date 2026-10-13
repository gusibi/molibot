import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

interface WorkerMessage {
  phase: string;
  type: string;
  error?: string;
  port?: number;
  runId?: string;
  executionStatus?: string;
  approvalId?: string;
  approvalCommand?: string;
  runStatus?: string;
  requestStatus?: string;
  requestCapability?: string;
  resolved?: string;
  delivered?: string[];
  answerCount?: number;
  recordExists?: boolean;
}

const workerEnv = (directory: string) => {
  const base: Record<string, string | undefined> = { ...process.env };
  // The recovery inspection only runs when live services are enabled, so the
  // child must not inherit the test runner's own kill switch.
  delete base.NODE_TEST_CONTEXT;
  delete base.MOLIBOT_DISABLE_LIVE_CHANNELS;
  return {
    ...base,
    DATA_DIR: directory,
    DB_DIR: join(directory, "db"),
    SETTINGS_DB_FILE: join(directory, "db", "settings.sqlite"),
    SETTINGS_FILE: join(directory, "settings.json"),
    WEB_WORKSPACE_DIR: join(directory, "moli-w"),
    SESSIONS_DIR: join(directory, "sessions"),
    SESSIONS_INDEX_FILE: join(directory, "sessions", "index.json"),
    PI_CODING_AGENT_DIR: join(directory, "pi")
  };
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function spawnWorker(phase: string, directory: string, extra: Record<string, string>, messages: WorkerMessage[]): ChildProcess {
  const child = fork("evals/fixtures/pi-room-review-worker.ts", [], {
    execArgv: ["--import", "./scripts/register-loader.js", "--import", "tsx"],
    env: { ...workerEnv(directory), PI_ROOM_REVIEW_PHASE: phase, PI_REVIEW_KIND: "channel", ...extra },
    stdio: ["ignore", "ignore", "pipe", "ipc"]
  });
  child.on("message", (message) => messages.push(message as WorkerMessage));
  child.stderr?.on("data", (data) => { if (String(data).includes("Error:")) process.stderr.write(data); });
  return child;
}

async function waitForMessage(
  child: ChildProcess,
  messages: WorkerMessage[],
  type: string,
  label: string,
  timeoutMs = 60_000
): Promise<WorkerMessage> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const error = messages.find((message) => message.type === "error");
    if (error) throw new Error(`${label} failed: ${error.error} :: ${JSON.stringify(messages)}`);
    const found = messages.find((message) => message.type === type);
    if (found) return found;
    const exited = child.exitCode !== null || child.signalCode !== null;
    if (exited) {
      await sleep(50);
      const lateError = messages.find((message) => message.type === "error");
      if (lateError) throw new Error(`${label} failed: ${lateError.error}`);
      const late = messages.find((message) => message.type === type);
      if (late) return late;
      throw new Error(`${label}: worker exited (code=${child.exitCode} signal=${child.signalCode}) with ${JSON.stringify(messages)}`);
    }
    if (Date.now() > deadline) throw new Error(`${label} timed out with ${JSON.stringify(messages)}`);
    await sleep(20);
  }
}

const scenarios = [
  { label: "approve", decision: "approve_once", resolved: "approved", executionStatus: "completed", runStatus: "completed", recordExists: false, resends: 1 },
  { label: "reject", decision: "reject", resolved: "rejected", executionStatus: "failed", runStatus: "aborted", recordExists: false, resends: 0 }
] as const;

for (const scenario of scenarios) {
  test(`a restart parks a Channel execution awaiting review and ${scenario.label} settles it exactly once`, { timeout: 120_000 }, async () => {
    const directory = mkdtempSync(join(tmpdir(), "molibot-pi-room-review-"));
    let first: ChildProcess | undefined;
    let second: ChildProcess | undefined;
    try {
      // First boot: the run reaches the provider and the process is killed mid-request.
      const firstMessages: WorkerMessage[] = [];
      first = spawnWorker("start", directory, {}, firstMessages);
      const port = (await waitForMessage(first, firstMessages, "port", "the provider port")).port!;
      assert.ok(port > 0);
      await once(first, "exit");
      await sleep(50);
      assert.equal(firstMessages.filter((message) => message.type === "request").length, 1,
        `the interrupted run must have submitted exactly one provider request: ${JSON.stringify(firstMessages)}`);

      // Second boot: startup must park the run behind a Decision Request, not resend it.
      const secondMessages: WorkerMessage[] = [];
      second = spawnWorker("resolve", directory, { PI_ROOM_REVIEW_PORT: String(port), PI_ROOM_REVIEW_DECISION: scenario.decision }, secondMessages);
      const parked = await waitForMessage(second, secondMessages, "parked", "the parked report");
      assert.equal(secondMessages.filter((message) => message.type === "request").length, 0,
        "a parked run must not be resent before a person decides");
      assert.equal(parked.executionStatus, "waiting_approval");
      assert.equal(parked.approvalId, `recovery-review:${parked.runId}`);
      assert.equal(parked.approvalCommand, "recovery_review");
      assert.equal(parked.runStatus, "recovery_review");
      assert.equal(parked.requestStatus, "pending");
      assert.equal(parked.requestCapability, "recovery_review");

      const resolved = await waitForMessage(second, secondMessages, "resolved", "the resolved report");
      assert.equal(resolved.resolved, scenario.resolved, JSON.stringify(secondMessages));
      assert.equal(resolved.executionStatus, scenario.executionStatus, JSON.stringify(secondMessages));
      assert.equal(resolved.runStatus, scenario.runStatus);
      assert.equal(resolved.recordExists, scenario.recordExists);
      assert.equal(resolved.answerCount, scenario.resends, JSON.stringify(resolved));
      assert.equal(resolved.delivered?.filter(text => text.includes("Reviewed and continued.")).length, scenario.resends);
      assert.equal(secondMessages.filter((message) => message.type === "request").length, scenario.resends,
        `approval must ${scenario.resends === 1 ? "" : "not "}resend the original request: ${JSON.stringify(secondMessages)}`);

      const exit = once(second, "exit");
      await exit;
      assert.equal(second.exitCode, 0);
    } finally {
      for (const child of [first, second]) {
        if (child && child.exitCode === null && child.signalCode === null) {
          const exited = once(child, "exit");
          child.kill("SIGKILL");
          await exited;
        }
      }
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
