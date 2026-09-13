import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConversationPlan } from "$lib/shared/types/message.js";
import { DurableExecutionStore } from "../durable/store.js";
import { DurableExecutionCoordinator } from "../durable/coordinator.js";
import { PlanService } from "./service.js";
import { ensureSessionPlanRecord, approveAndStartPlan, planTasksFromConversationPlan } from "./sessionIntegration.js";

function makeService(): { store: DurableExecutionStore; service: PlanService; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "molibot-plan-session-"));
  const store = new DurableExecutionStore(join(root, "durable-execution.sqlite"));
  const service = new PlanService(store, new DurableExecutionCoordinator(store, "test-process", root));
  return { store, service, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function proposal(overrides: Partial<ConversationPlan> = {}): ConversationPlan {
  return {
    id: "plan-call-1",
    title: "翻译产品文档",
    summary: "翻成中英双语",
    status: "proposed",
    recommendedMode: "accept_edits",
    artifactPath: "plans/p.md",
    steps: [
      { id: "plan-call-1-1", text: "读取原文", status: "pending" },
      { id: "plan-call-1-2", text: "翻译", status: "pending" }
    ],
    ...overrides
  };
}

test("a proposed Session plan is saved, linked, and idempotent", () => {
  const { service, cleanup } = makeService();
  try {
    const saved = ensureSessionPlanRecord({ plan: proposal(), botId: "bot", sourceUiSessionId: "sess-a" }, service);
    assert.equal(saved?.durableExecutionId, "plan-call-1");
    const detail = service.read("owner", "plan-call-1");
    assert.equal(detail.execution.status, "planned");
    assert.equal(detail.meta.title, "翻译产品文档");
    assert.deepEqual(detail.tasks[0].steps.map((step) => step.title), ["读取原文", "翻译"]);

    // Re-saving the same proposal does not create a second aggregate.
    const again = ensureSessionPlanRecord({ plan: proposal({ title: "ignored" }), botId: "bot" }, service);
    assert.equal(again?.durableExecutionId, "plan-call-1");
    assert.equal(service.list({ ownerId: "owner" }).length, 1);
  } finally {
    cleanup();
  }
});

test("approving applies edited content and starts the plan without resuming the chat", () => {
  const { service, cleanup } = makeService();
  try {
    const saved = ensureSessionPlanRecord({ plan: proposal(), botId: "bot", sourceUiSessionId: "sess-a" }, service)!;
    const edited: ConversationPlan = {
      ...saved,
      title: "翻译产品文档 v2",
      summary: "改成日语",
      steps: [
        { id: saved.steps[0].id, text: "读取原文", status: "pending" },
        { id: saved.steps[1].id, text: "翻译成日语", status: "pending" }
      ]
    };
    const approved = approveAndStartPlan({ plan: edited }, service);
    assert.equal(approved.durableExecutionId, "plan-call-1");

    const detail = service.read("owner", "plan-call-1");
    assert.equal(detail.execution.status, "queued");
    assert.equal(detail.meta.title, "翻译产品文档 v2");
    assert.equal(detail.meta.summary, "改成日语");
    assert.deepEqual(detail.tasks[0].steps.map((step) => step.title), ["读取原文", "翻译成日语"]);
  } finally {
    cleanup();
  }
});

test("plan content cannot be replaced after execution has started", () => {
  const { service, store, cleanup } = makeService();
  try {
    ensureSessionPlanRecord({ plan: proposal(), botId: "bot" }, service);
    const queued = service.start({ ownerId: "owner", planId: "plan-call-1", expectedVersion: service.read("owner", "plan-call-1").execution.version });
    assert.equal(queued.execution.status, "queued");
    assert.throws(() => store.replacePlanContent({
      executionId: "plan-call-1",
      ownerId: "owner",
      expectedVersion: queued.execution.version,
      author: "user",
      tasks: [{ title: "different", steps: [{ title: "x" }] }]
    }), /Illegal Durable Execution transition/);
  } finally {
    cleanup();
  }
});

test("planTasksFromConversationPlan keeps every step without truncation", () => {
  const plan = proposal({ steps: Array.from({ length: 35 }, (_, index) => ({ id: `s${index}`, text: `步骤 ${index + 1}`, status: "pending" as const })) });
  const tasks = planTasksFromConversationPlan(plan);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].steps.length, 35);
});
