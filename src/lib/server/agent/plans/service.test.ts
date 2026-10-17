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
    current = store.bindPlan({ ownerId: "owner", planId: "plan-a", expectedVersion: current.version, sessionId: "receiver", agentId: "default", mode: "manual" });
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

test("approval moves a planned plan to queued and enqueues one durable event", () => {
  const { root, service, cleanup } = makeService();
  try {
    const created = service.create(planInput());
    const started = service.approve({ ownerId: "owner", planId: "plan-test-1", expectedVersion: created.execution.version, sessionId: "receiver", agentId: "default", mode: "manual" });
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
    service.approve({ ownerId: "owner", planId: "plan-test-1", expectedVersion: created.execution.version, sessionId: "receiver", agentId: "default", mode: "manual" });
    const queued = store.getById("plan-test-1")!;
    const claim = store.claimAttempt({
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
    assert.equal(paused.execution.status, "running");
    assert.equal(paused.controlRequest, "pause");
    store.finishAttempt({ executionId: "plan-test-1", attemptId: claim.attempt.id, expectedVersion: execution.version, processOwnerId: "test-process", status: "completed", nextExecutionStatus: "paused" });
    store.settleControl("plan-test-1");
    const stopped = service.read("owner", "plan-test-1");

    const revised = service.revise({
      executionId: "plan-test-1",
      ownerId: "owner",
      expectedVersion: stopped.execution.version,
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
    assert.equal(revised.execution.version, stopped.execution.version + 1);
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

test("only an active attempt blocks plan deletion; paused plans are deletable", () => {
  const { service, cleanup } = makeService();
  try {
    const created = service.create(planInput());
    const started = service.approve({ ownerId: "owner", planId: "plan-test-1", expectedVersion: created.execution.version, sessionId: "receiver", agentId: "default", mode: "manual" });
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

test("plan search and project filtering happen before pagination across the whole collection", () => {
  const { service, cleanup } = makeService();
  try {
    for (let index = 0; index < 205; index++) service.create(planInput({ planId: `page-${String(index).padStart(3, "0")}`, title: `Item ${index}`, sourceProjectId: index % 2 ? "project-a" : "project-b" }));
    const matches = service.listPage({ ownerId: "owner", search: "Item 204", limit: 10 });
    assert.equal(matches.total, 1);
    assert.equal(matches.items[0].planId, "page-204");
    const page = service.listPage({ ownerId: "owner", projectId: "project-a", limit: 10, offset: 100 });
    assert.equal(page.total, 102);
    assert.equal(page.items.length, 2);
    assert.ok(page.items.every(item => item.projectId === "project-a"));
    assert.deepEqual(service.listPage({ ownerId: "other", limit: 10 }).items, []);
  } finally { cleanup(); }
});

test("paused plan editing preserves stable completed work and immutable version history", () => {
  const { service, store, cleanup } = makeService();
  try {
    const first = service.create(planInput());
    const steps = first.tasks.flatMap(task => task.steps);
    const approved = service.approve({ ownerId: "owner", planId: first.execution.id, expectedVersion: first.execution.version, sessionId: "b", agentId: "default", mode: "manual" });
    const claim = store.claimAttempt({ executionId: first.execution.id, expectedVersion: approved.execution.version, processOwnerId: "test", runId: "test-run", contextSessionId: "archive", leaseDurationMs: 10000 });
    store.markStepRunning(first.execution.id, steps[0].id, claim.execution.version, "test");
    store.completeStep({ executionId: first.execution.id, stepId: steps[0].id, expectedVersion: store.getById(first.execution.id)!.version, processOwnerId: "test", outputSummary: "Original completed result" });
    store.finishAttempt({ executionId: first.execution.id, attemptId: claim.attempt.id, expectedVersion: store.getById(first.execution.id)!.version, processOwnerId: "test", status: "completed", nextExecutionStatus: "paused" });
    const before = service.read("owner", first.execution.id);
    const input = { ownerId: "owner", executionId: first.execution.id, expectedVersion: before.execution.version, author: "user" as const, title: "Revised", tasks: before.tasks.map(task => ({ ...task, steps: task.steps.map(step => ({ ...step, title: step.status === "completed" ? step.title : `${step.title} revised` })) })), acceptanceCriteria: [{ description: "Owner checks output" }] };
    const edited = service.edit(input);
    assert.equal(edited.execution.status, "planned");
    assert.equal(edited.tasks[0].id, before.tasks[0].id);
    assert.equal(edited.tasks[0].steps[0].id, steps[0].id);
    assert.equal(edited.tasks[0].steps[0].status, "completed");
    assert.equal(service.read("owner", first.execution.id, 1).tasks[0].steps[1].title, "翻译");
    assert.throws(() => service.edit(input), /version/i);
    assert.throws(() => service.edit({ ...input, expectedVersion: edited.execution.version, tasks: [{ ...input.tasks[0], steps: [{ ...input.tasks[0].steps[0], title: "Rewrite done work" }] }] }), /completed/i);
    assert.equal(service.read("owner", first.execution.id).meta.title, "Revised");
  } finally { store.close(); cleanup(); }
});

test("approved plan binds receiving Session atomically, keeps source, and rejects concurrent handoff", () => {
  const { service, store, root, cleanup } = makeService();
  try {
    const created = service.create(planInput());
    const input = { ownerId: "owner", planId: created.execution.id, expectedVersion: created.execution.version, sessionId: "sess-b", agentId: "agent-a", mode: "manual" as const };
    const approved = service.approve(input);
    assert.equal(approved.execution.status, "queued");
    assert.equal(approved.execution.sourceUiSessionId, "sess-a");
    assert.equal(approved.binding?.sessionId, "sess-b");
    assert.equal(approved.binding?.mode, "manual");
    assert.equal(readdirSync(durableExecutionEventsDir(root)).length, 1);
    assert.throws(() => service.approve({ ...input, sessionId: "sess-c" }), /version|transition/i);
    assert.equal(service.read("owner", input.planId).binding?.sessionId, "sess-b");
  } finally { store.close(); cleanup(); }
});

test("shared resume and claim reject changed content under an old approval", () => {
  const { store, service, cleanup, root } = makeService();
  try {
    const initial = service.create(planInput());
    const approved = service.approve({ ownerId: "owner", planId: initial.execution.id, expectedVersion: initial.execution.version, sessionId: "b", agentId: "default", mode: "manual" });
    const paused = store.pause(initial.execution.id, approved.execution.version);
    const changed = service.edit({ ownerId: "owner", executionId: initial.execution.id, expectedVersion: paused.version, author: "user", tasks: [{ title: "Changed", steps: [{ title: "Changed instruction" }] }] });
    const pausedAgain = store.pause(initial.execution.id, changed.execution.version);
    const coordinator = new DurableExecutionCoordinator(store, "test", root);
    assert.throws(() => coordinator.resume({ ownerId: "owner", executionId: initial.execution.id, expectedVersion: pausedAgain.version, actionId: "stale" }), /approv/i);
    assert.throws(() => store.claimAttempt({ executionId: initial.execution.id, expectedVersion: pausedAgain.version, processOwnerId: "test", runId: "test-run", contextSessionId: "archive", leaseDurationMs: 10000 }), /approv/i);
  } finally { cleanup(); }
});
