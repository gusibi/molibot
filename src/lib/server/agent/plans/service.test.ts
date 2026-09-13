import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DurableExecutionStore } from "../durable/store.js";
import { DurableExecutionCoordinator } from "../durable/coordinator.js";
import { durableExecutionEventsDir } from "../durable/events.js";
import { PlanService } from "./service.js";
import type { CreatePlanInput, PlanTaskInput } from "../durable/types.js";

function makeService(): { root: string; store: DurableExecutionStore; service: PlanService; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "molibot-plan-"));
  const store = new DurableExecutionStore(join(root, "durable-execution.sqlite"));
  const coordinator = new DurableExecutionCoordinator(store, "test-process", root);
  const service = new PlanService(store, coordinator);
  return { root, store, service, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function planInput(overrides: Partial<CreatePlanInput> = {}): CreatePlanInput {
  return {
    planId: "plan-test-1",
    ownerId: "owner",
    botId: "bot",
    title: "翻译产品文档",
    summary: "把文档翻成中英双语",
    sourceUiSessionId: "sess-a",
    tasks: [
      { id: "task-1", title: "入门指南", steps: [{ id: "s1", title: "读取原文" }, { id: "s2", title: "翻译" }] },
      { id: "task-2", title: "API 指南", steps: [{ id: "s3", title: "整理术语" }] }
    ],
    acceptanceCriteria: [{ id: "c1", description: "术语一致", required: true }],
    now: new Date("2026-09-13T00:00:00.000Z"),
    ...overrides
  };
}

test("createPlan persists two-layer structure, meta, and stable plan id", () => {
  const { store, service, cleanup } = makeService();
  try {
    const created = service.create(planInput());
    assert.equal(created.execution.id, "plan-test-1");
    assert.equal(created.execution.status, "planned");
    assert.equal(created.execution.currentPlanVersion, 1);
    assert.equal(created.meta.title, "翻译产品文档");
    assert.equal(created.meta.summary, "把文档翻成中英双语");
    assert.equal(created.tasks.length, 2);
    assert.deepEqual(created.tasks.map((task) => task.title), ["入门指南", "API 指南"]);
    assert.deepEqual(created.tasks[0].steps.map((step) => step.title), ["读取原文", "翻译"]);
    assert.equal(created.tasks[1].steps[0].title, "整理术语");
    assert.equal(created.acceptanceCriteria[0].description, "术语一致");
    assert.equal(created.projection.progress.total, 3);
    assert.equal(created.projection.progress.completed, 0);

    const reread = service.read("owner", "plan-test-1");
    assert.equal(reread.tasks.length, 2);
    assert.deepEqual(reread.tasks[0].steps.map((step) => step.title), ["读取原文", "翻译"]);
    assert.equal(store.getPlanMeta("plan-test-1")?.title, "翻译产品文档");
  } finally {
    cleanup();
  }
});

test("a plan with more than 30 steps is stored and read back without truncation", () => {
  const { service, cleanup } = makeService();
  try {
    const tasks: PlanTaskInput[] = [{
      id: "big-task",
      title: "批量任务",
      steps: Array.from({ length: 31 }, (_, index) => ({ title: `步骤 ${index + 1}` }))
    }];
    const created = service.create(planInput({ planId: "plan-big", tasks }));
    assert.equal(created.tasks[0].steps.length, 31);
    const reread = service.read("owner", "plan-big");
    assert.equal(reread.tasks[0].steps.length, 31);
    assert.equal(reread.tasks[0].steps[30].title, "步骤 31");
  } finally {
    cleanup();
  }
});

test("plan list searches by title and id, filters by status, and hides archived by default", () => {
  const { store, service, cleanup } = makeService();
  try {
    service.create(planInput({ planId: "plan-a", title: "Alpha translation" }));
    service.create(planInput({ planId: "plan-b", title: "Beta report" }));
    const all = service.list({ ownerId: "owner" });
    assert.equal(all.length, 2);

    const byTitle = service.list({ ownerId: "owner", search: "alpha" });
    assert.deepEqual(byTitle.map((item) => item.planId), ["plan-a"]);

    const byId = service.list({ ownerId: "owner", search: "plan-b" });
    assert.deepEqual(byId.map((item) => item.planId), ["plan-b"]);

    const notStarted = service.list({ ownerId: "owner", statuses: ["planned"] });
    assert.equal(notStarted.length, 2);
    assert.equal(notStarted[0].planStatus, "not_started");

    // Completing a plan archives it and removes it from the default list.
    let current = store.getById("plan-a")!;
    current = store.transitionStatus("plan-a", current.version, "queued");
    current = store.transitionStatus("plan-a", current.version, "running");
    current = store.transitionStatus("plan-a", current.version, "verifying");
    store.transitionStatus("plan-a", current.version, "completed");
    assert.equal(service.list({ ownerId: "owner" }).some((item) => item.planId === "plan-a"), false);
    const archived = service.list({ ownerId: "owner", includeArchived: true });
    const archivedItem = archived.find((item) => item.planId === "plan-a");
    assert.equal(archivedItem?.archived, true);
    assert.equal(archivedItem?.planStatus, "archived");
  } finally {
    cleanup();
  }
});

test("start moves a planned plan to queued and enqueues one durable event", () => {
  const { root, service, cleanup } = makeService();
  try {
    const created = service.create(planInput());
    const started = service.start({ ownerId: "owner", planId: "plan-test-1", expectedVersion: created.execution.version });
    assert.equal(started.execution.status, "queued");
    const events = readdirSync(durableExecutionEventsDir(root));
    assert.equal(events.filter((file) => file.startsWith("durable-execution-plan-test-1-")).length, 1);
  } finally {
    cleanup();
  }
});

test("revising a plan appends tasks, preserves completed results, and re-enters planned", () => {
  const { store, service, cleanup } = makeService();
  try {
    const created = service.create(planInput());
    service.start({ ownerId: "owner", planId: "plan-test-1", expectedVersion: created.execution.version });
    const queued = store.getById("plan-test-1")!;
    store.claimAttempt({
      executionId: "plan-test-1",
      expectedVersion: queued.version,
      processOwnerId: "test-process",
      runId: "run-1",
      contextSessionId: "sess-a",
      leaseDurationMs: 60_000
    });
    const stepOne = store.getPlanTasks("plan-test-1", 1)[0].steps[0];
    let execution = store.getById("plan-test-1")!;
    store.markStepRunning("plan-test-1", stepOne.id, execution.version, "test-process");
    execution = store.getById("plan-test-1")!;
    store.completeStep({
      executionId: "plan-test-1",
      stepId: stepOne.id,
      expectedVersion: execution.version,
      processOwnerId: "test-process",
      outputSummary: "已读取原文"
    });
    execution = store.getById("plan-test-1")!;

    // Executing plans must be safely paused before a revision is applied.
    const paused = service.pause({ ownerId: "owner", planId: "plan-test-1", expectedVersion: execution.version, actionId: "pause-revise" });
    assert.equal(paused.execution.status, "paused");

    const revised = service.revise({
      executionId: "plan-test-1",
      ownerId: "owner",
      expectedVersion: paused.execution.version,
      reason: "owner rework",
      author: "user",
      title: "翻译产品文档 v2",
      summary: "补充返工任务",
      addTasks: [{ id: "task-3", title: "新增章节", steps: [{ title: "补充翻译" }] }],
      addCriteria: [{ description: "新增章节已翻译", required: true }]
    });

    assert.equal(revised.execution.status, "planned");
    assert.equal(revised.execution.currentPlanVersion, 2);
    assert.equal(revised.meta.title, "翻译产品文档 v2");
    assert.equal(revised.tasks.length, 3);
    assert.equal(revised.tasks[2].title, "新增章节");
    const flat = revised.tasks.flatMap((task) => task.steps);
    assert.equal(flat.length, 4);
    const read = flat.find((step) => step.title === "读取原文");
    assert.equal(read?.status, "completed");
    assert.equal(read?.outputSummary, "已读取原文");
    const reworked = flat.find((step) => step.title === "补充翻译");
    assert.equal(reworked?.status, "pending");
    assert.equal(revised.execution.version, paused.execution.version + 1);
  } finally {
    cleanup();
  }
});

test("delete removes the plan, keeps a tombstone, is idempotent, and read reports deletion", () => {
  const { service, cleanup } = makeService();
  try {
    service.create(planInput());
    const first = service.delete({ ownerId: "owner", planId: "plan-test-1" });
    assert.equal(first.deleted, true);
    assert.equal(first.title, "翻译产品文档");
    assert.throws(() => service.read("owner", "plan-test-1"), /deleted/i);
    const second = service.delete({ ownerId: "owner", planId: "plan-test-1" });
    assert.equal(second.deleted, false);
  } finally {
    cleanup();
  }
});

test("creating the same deterministic plan id is idempotent", () => {
  const { service, cleanup } = makeService();
  try {
    const first = service.create(planInput());
    const second = service.create(planInput({ title: "changed title" }));
    assert.equal(second.execution.id, first.execution.id);
    assert.equal(second.execution.version, first.execution.version);
    assert.equal(second.meta.title, "翻译产品文档");
  } finally {
    cleanup();
  }
});

test("in-session plan progress mirrors into the durable record", () => {
  const { service, cleanup } = makeService();
  try {
    service.create(planInput());
    const base = {
      title: "翻译产品文档",
      summary: "把文档翻成中英双语",
      artifactPath: "plans/p.md",
      recommendedMode: "accept_edits" as const,
      durableExecutionId: "plan-test-1"
    };
    service.mirrorFromConversationPlan({
      ...base,
      id: "plan-test-1",
      status: "executing",
      steps: [
        { id: "s1", text: "读取原文", status: "completed" },
        { id: "s2", text: "翻译", status: "in_progress" },
        { id: "s3", text: "整理术语", status: "pending" }
      ]
    });
    const running = service.read("owner", "plan-test-1");
    assert.equal(running.execution.status, "running");
    assert.deepEqual(
      running.steps.filter((step) => step.planVersion === 1).map((step) => step.status),
      ["completed", "running", "pending"]
    );

    service.mirrorFromConversationPlan({
      ...base,
      id: "plan-test-1",
      status: "completed",
      steps: [
        { id: "s1", text: "读取原文", status: "completed" },
        { id: "s2", text: "翻译", status: "completed" },
        { id: "s3", text: "整理术语", status: "completed" }
      ]
    });
    assert.equal(service.read("owner", "plan-test-1").execution.status, "completed");
  } finally {
    cleanup();
  }
});

test("only an active attempt blocks plan deletion; paused plans are deletable", () => {
  const { service, cleanup } = makeService();
  try {
    const created = service.create(planInput());
    const started = service.start({ ownerId: "owner", planId: "plan-test-1", expectedVersion: created.execution.version });
    assert.equal(started.execution.status, "queued");
    assert.throws(() => service.delete({ ownerId: "owner", planId: "plan-test-1" }), /Illegal Durable Execution transition/);
    const paused = service.pause({ ownerId: "owner", planId: "plan-test-1", expectedVersion: started.execution.version, actionId: "pause-1" });
    assert.equal(paused.execution.status, "paused");
    assert.equal(service.delete({ ownerId: "owner", planId: "plan-test-1" }).deleted, true);
  } finally {
    cleanup();
  }
});

test("plans are isolated by owner", () => {
  const { service, cleanup } = makeService();
  try {
    service.create(planInput({ ownerId: "owner", planId: "plan-owned" }));
    assert.equal(service.list({ ownerId: "other" }).length, 0);
    assert.throws(() => service.read("other", "plan-owned"), /not found/i);
  } finally {
    cleanup();
  }
});
