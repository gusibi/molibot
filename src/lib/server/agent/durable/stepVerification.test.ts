import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { MomEvent } from "$lib/server/agent/events.js";
import type { ChannelInboundMessage, DurableAttemptHooks } from "$lib/server/agent/core/types.js";
import { DurableExecutionCoordinator } from "./coordinator.js";
import { DurableExecutionRuntime } from "./runtime.js";
import { DurableExecutionStore } from "./store.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "molibot-durable-verify-"));
  const store = new DurableExecutionStore(join(root, "durable-execution.sqlite"));
  const coordinator = new DurableExecutionCoordinator(store, "process-a", root);
  return { root, store, coordinator };
}

async function runNext(
  runtime: DurableExecutionRuntime,
  store: DurableExecutionStore,
  root: string,
  executionId: string
): Promise<void> {
  const version = store.getById(executionId)!.version;
  const file = join(root, "system", "bots", "owner", "events", `durable-execution-${executionId}-v${version}.json`);
  await runtime.run(JSON.parse(readFileSync(file, "utf8")) as MomEvent, file);
}

test("plan work items carry a verification rule and default to run-detail evidence", () => {
  const { root, store } = fixture();
  try {
    const execution = store.createPlan({
      ownerId: "owner-1",
      botId: "bot-1",
      title: "Translate the book",
      sourceChannel: "web",
      sourceChatId: "web:owner-1:bot-1",
      tasks: [
        {
          title: "Chapter 1",
          steps: [
            {
              title: "Translate chapter one",
              verification: { checkerKey: "expected_outputs", params: { outputs: ["chapter-1.md"] }, onFailure: "block" }
            },
            { title: "Translate chapter two" }
          ]
        }
      ]
    });
    const [task] = store.getPlanTasks(execution.id);
    assert.equal(task.steps[0].verification?.checkerKey, "expected_outputs");
    assert.deepEqual(task.steps[0].verification?.params, { outputs: ["chapter-1.md"] });
    assert.equal(task.steps[1].verification?.checkerKey, "run_detail_present");
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("a plan revision carries each work item's verification rule forward", () => {
  const { root, store } = fixture();
  try {
    const execution = store.createPlan({
      ownerId: "owner-1",
      botId: "bot-1",
      title: "Translate the book",
      sourceChannel: "web",
      sourceChatId: "web:owner-1:bot-1",
      tasks: [{ title: "Chapter 1", steps: [{ title: "Step one", verification: { checkerKey: "expected_outputs", params: { outputs: ["a.md"] } } }] }],
      acceptanceCriteria: [{ description: "done", checkerType: "deterministic", checkerKey: "steps_completed" }]
    });
    const revised = store.revisePlan({
      executionId: execution.id,
      ownerId: "owner-1",
      expectedVersion: execution.version,
      reason: "add chapter two",
      author: "user",
      addTasks: [{ title: "Chapter 2", steps: [{ title: "Step two" }] }]
    });
    const steps = store.getPlanTasks(execution.id, revised.currentPlanVersion).flatMap((task) => task.steps);
    assert.deepEqual(steps.map((step) => [step.title, step.verification?.checkerKey]), [
      ["Step one", "expected_outputs"],
      ["Step two", "run_detail_present"]
    ]);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("a completed-in-name step without its required output is rejected and blocks the goal", async () => {
  const { root, store, coordinator } = fixture();
  const notices: string[] = [];
  try {
    const execution = store.createPlan({
      ownerId: "owner-1",
      botId: "bot-1",
      title: "Translate the book",
      sourceChannel: "web",
      sourceChatId: "web:owner-1:bot-1",
      tasks: [
        {
          title: "Chapter 1",
          steps: [
            {
              title: "Translate chapter one",
              verification: { checkerKey: "expected_outputs", params: { outputs: ["chapter-1.md"] }, onFailure: "block" }
            }
          ]
        }
      ]
    });
    coordinator.activate({ ownerId: "owner-1", executionId: execution.id, expectedVersion: execution.version });
    const runtime = new DurableExecutionRuntime({
      store,
      processOwnerId: "process-a",
      dataDir: root,
      channelManagers: new Map([["web", new Map([["bot-1", {
        runDurableAttempt: async () => ({ result: { stopReason: "stop", runId: "run-empty" }, contextSessionId: "ctx" }),
        sendInternalNotice: async (_chatId: string, text: string) => { notices.push(text); }
      }]])]]) as never
    });
    await runNext(runtime, store, root, execution.id);
    const detail = store.getDetail(execution.id)!;
    assert.equal(detail.steps[0].status, "failed");
    assert.equal(detail.execution.status, "recovery_required");
    assert.equal(notices.length, 1);
    assert.match(notices[0], /Translate chapter one/);
    assert.match(notices[0], /chapter-1\.md/);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("a step whose required output is produced passes verification and advances", async () => {
  const { root, store, coordinator } = fixture();
  try {
    const execution = store.createPlan({
      ownerId: "owner-1",
      botId: "bot-1",
      title: "Translate the book",
      sourceChannel: "web",
      sourceChatId: "web:owner-1:bot-1",
      tasks: [
        {
          title: "Chapter 1",
          steps: [
            {
              title: "Translate chapter one",
              verification: { checkerKey: "expected_outputs", params: { outputs: ["chapter-1.md"] }, onFailure: "block" }
            }
          ]
        }
      ]
    });
    coordinator.activate({ ownerId: "owner-1", executionId: execution.id, expectedVersion: execution.version });
    const runtime = new DurableExecutionRuntime({
      store,
      processOwnerId: "process-a",
      dataDir: root,
      channelManagers: new Map([["web", new Map([["bot-1", {
        runDurableAttempt: async (_message: ChannelInboundMessage, hooks: DurableAttemptHooks) => {
          await hooks.onToolSideEffectReceipt!(
            { toolId: "write", sideEffectClass: "idempotent", idempotencyKey: "chapter-1", targetSummary: "chapter-1.md", contentSummary: "wrote chapter-1.md" },
            { ok: true, content: "chapter-1.md" }
          );
          return { result: { stopReason: "stop", runId: "run-done" }, contextSessionId: "ctx" };
        }
      }]])]]) as never
    });
    await runNext(runtime, store, root, execution.id);
    const detail = store.getDetail(execution.id)!;
    assert.equal(detail.steps[0].status, "completed");
    assert.equal(detail.execution.status, "verifying");
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("a multi-step plan advances across attempts to completion without user continuation", async () => {
  const { root, store, coordinator } = fixture();
  try {
    const execution = store.createPlan({
      ownerId: "owner-1",
      botId: "bot-1",
      title: "Translate the book",
      sourceChannel: "web",
      sourceChatId: "web:owner-1:bot-1",
      tasks: [
        {
          title: "Chapters",
          steps: [{ title: "Chapter 1" }, { title: "Chapter 2" }, { title: "Chapter 3" }]
        }
      ],
      acceptanceCriteria: [{ description: "All steps are complete", checkerType: "deterministic", checkerKey: "steps_completed" }]
    });
    coordinator.activate({ ownerId: "owner-1", executionId: execution.id, expectedVersion: execution.version });
    let attempts = 0;
    const runtime = new DurableExecutionRuntime({
      store,
      processOwnerId: "process-a",
      dataDir: root,
      channelManagers: new Map([["web", new Map([["bot-1", {
        runDurableAttempt: async (message: ChannelInboundMessage) => {
          attempts += 1;
          return { result: { stopReason: "stop", runId: `run-${attempts}-${message.runId}` }, contextSessionId: "ctx" };
        }
      }]])]]) as never
    });
    for (let i = 0; i < 4; i += 1) await runNext(runtime, store, root, execution.id);
    const detail = store.getDetail(execution.id)!;
    assert.equal(detail.execution.status, "completed");
    assert.equal(detail.steps.every((step) => step.status === "completed"), true);
    assert.equal(attempts, 3, "one bounded attempt per work item");
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("a step with a retry rule is re-queued instead of blocked", async () => {
  const { root, store, coordinator } = fixture();
  try {
    const execution = store.createPlan({
      ownerId: "owner-1",
      botId: "bot-1",
      title: "Translate the book",
      sourceChannel: "web",
      sourceChatId: "web:owner-1:bot-1",
      tasks: [
        {
          title: "Chapter 1",
          steps: [
            {
              title: "Translate chapter one",
              verification: { checkerKey: "expected_outputs", params: { outputs: ["chapter-1.md"] }, onFailure: "retry", maxAttempts: 2 }
            }
          ]
        }
      ]
    });
    coordinator.activate({ ownerId: "owner-1", executionId: execution.id, expectedVersion: execution.version });
    const runtime = new DurableExecutionRuntime({
      store,
      processOwnerId: "process-a",
      dataDir: root,
      channelManagers: new Map([["web", new Map([["bot-1", {
        runDurableAttempt: async () => ({ result: { stopReason: "stop", runId: "run-empty" }, contextSessionId: "ctx" })
      }]])]]) as never
    });
    await runNext(runtime, store, root, execution.id);
    const detail = store.getDetail(execution.id)!;
    assert.equal(detail.steps[0].status, "pending");
    assert.equal(detail.execution.status, "queued");
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
