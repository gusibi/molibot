import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DurableExecutionCoordinator } from "./coordinator.js";
import {
  activateDurableExecution,
  detectDurableActivation
} from "./activation.js";
import { DurableExecutionStore } from "./store.js";
import { DurableExecutionQuotaError } from "./types.js";

test("ordinary requests stay on the fast path while cross-session intent activates deterministically", () => {
  assert.equal(detectDurableActivation("What is the capital of France?"), null);
  assert.deepEqual(
    detectDurableActivation("请未来几天持续推进这份发布计划，并每天汇报"),
    {
      goal: "请未来几天持续推进这份发布计划，并每天汇报",
      activationPath: "deterministic",
      reason: "cross_session_execution_intent"
    }
  );
});

test("explicit command and per-request mode force activation, while suppress wins for the request", () => {
  assert.deepEqual(
    detectDurableActivation("/longtask Prepare the launch checklist"),
    {
      goal: "Prepare the launch checklist",
      activationPath: "forced",
      reason: "explicit_long_task_command"
    }
  );
  assert.equal(detectDurableActivation("Answer this now", "force")?.activationPath, "forced");
  assert.equal(detectDurableActivation("/longtask Prepare it", "suppress"), null);
});

test("activation persists the source link and starts through the versioned queue seam", () => {
  const root = mkdtempSync(join(tmpdir(), "molibot-durable-activation-"));
  const store = new DurableExecutionStore(join(root, "durable-execution.sqlite"));
  try {
    const coordinator = new DurableExecutionCoordinator(store, "process-a", root);
    const activated = activateDurableExecution({
      message: "Keep working across sessions on the launch plan.",
      ownerId: "owner-1",
      botId: "web-profile",
      sourceChannel: "web",
      sourceChatId: "web:owner-1:web-profile",
      sourceUiSessionId: "session-1",
      sourceProjectId: "project-1"
    }, coordinator);
    assert.ok(activated);
    assert.equal(activated.item.execution.status, "queued");
    assert.equal(activated.item.execution.sourceUiSessionId, "session-1");
    assert.equal(activated.item.execution.sourceProjectId, "project-1");
    const detail = coordinator.inspect("owner-1", activated.item.execution.id);
    assert.equal(detail.acceptanceCriteria[0]?.checkerType, "subjective");
    assert.equal(detail.acceptanceCriteria[0]?.result, "unproven");
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("automatic activation respects the unfinished-task quota while explicit force remains available", () => {
  const root = mkdtempSync(join(tmpdir(), "molibot-durable-quota-"));
  const store = new DurableExecutionStore(join(root, "durable-execution.sqlite"));
  try {
    const coordinator = new DurableExecutionCoordinator(store, "process-a", root);
    const request = {
      message: "Keep working across sessions on the launch plan.",
      ownerId: "owner-1",
      botId: "web-profile",
      sourceChannel: "web",
      sourceChatId: "web:owner-1:web-profile",
      maxUnfinishedExecutions: 1
    };
    assert.ok(activateDurableExecution(request, coordinator));
    assert.throws(
      () => activateDurableExecution({ ...request, message: "未来几天继续处理第二份计划" }, coordinator),
      DurableExecutionQuotaError
    );
    assert.ok(activateDurableExecution({ ...request, message: "/longtask Force the second plan" }, coordinator));
    assert.equal(store.countUnfinished("owner-1"), 2);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
