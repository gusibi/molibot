import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DurableExecutionStore } from "$lib/server/agent/durable/store.js";
import { PlanService } from "./service.js";

function tempDatabase(): { file: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "molibot-kanban-service-"));
  return {
    file: join(root, "durable-execution.sqlite"),
    cleanup: () => rmSync(root, { recursive: true, force: true })
  };
}

test("boardPage projects stages and full-set counts for kanban tasks and legacy plans", () => {
  const database = tempDatabase();
  try {
    const store = new DurableExecutionStore(database.file);
    const service = new PlanService(store);

    const task = store.kanban.createTask({
      ownerId: "owner-1",
      botId: "bot-1",
      form: "team",
      title: "Ship the release notes",
      goal: "Draft, review and publish the release notes.",
      coordinatorAgentId: "agent-lead",
      members: [
        { agentId: "agent-lead", name: "Lead" },
        { agentId: "agent-cr", name: "Reviewer" }
      ],
      projectId: "proj-1",
      autoStart: true,
      now: new Date("2026-11-07T08:00:00.000Z")
    });
    store.kanban.transact(() => {
      store.kanban.applyChecklistInTransaction(task.executionId, 1, [
        { text: "Draft", done: true },
        { text: "Review", done: false }
      ]);
    });

    const legacy = store.createPlan({
      ownerId: "owner-1",
      botId: "bot-1",
      title: "Old archive candidate",
      tasks: [{ title: "Work", steps: [{ title: "Only step", sideEffectClass: "pure" as const }] }],
      now: new Date("2026-11-06T08:00:00.000Z")
    });
    // A completed legacy plan must appear in Done (the old planStatus bucket
    // would have projected it as archived).
    store.bindPlan({ ownerId: "owner-1", planId: legacy.id, expectedVersion: legacy.version, sessionId: "s-1", agentId: "agent-coder", mode: "accept_edits" });
    const bound = store.getById(legacy.id)!;
    store.transitionStatus(legacy.id, bound.version, "running");
    const running = store.getById(legacy.id)!;
    store.transitionStatus(legacy.id, running.version, "verifying");
    const verifying = store.getById(legacy.id)!;
    store.transitionStatus(legacy.id, verifying.version, "completed");

    const board = service.boardPage({ ownerId: "owner-1" });
    assert.equal(board.total, 2);
    assert.deepEqual(board.counts, { all: 2, todo: 1, doing: 0, done: 1, cancelled: 0 });

    const kanbanItem = board.items.find(item => item.executionId === task.executionId);
    assert.ok(kanbanItem);
    assert.equal(kanbanItem.kind, "kanban");
    assert.equal(kanbanItem.stage, "todo");
    assert.equal(kanbanItem.form, "team");
    assert.equal(kanbanItem.executorLabel, "Lead +1");
    assert.deepEqual(kanbanItem.checklist, { doneChecked: 1, checkedTotal: 2 });
    assert.equal(kanbanItem.handoffLimit, 8);

    const legacyItem = board.items.find(item => item.executionId === legacy.id);
    assert.ok(legacyItem);
    assert.equal(legacyItem.kind, "legacy-plan");
    assert.equal(legacyItem.stage, "done");
    assert.deepEqual(legacyItem.progress, { completed: 0, total: 1 });

    // Stage filter and counts stay full-set consistent.
    const doneOnly = service.boardPage({ ownerId: "owner-1", stage: "done" });
    assert.equal(doneOnly.total, 1);
    assert.deepEqual(doneOnly.counts, { all: 1, todo: 0, doing: 0, done: 1, cancelled: 0 });

    // Executor filter: only tasks involving the member match.
    const byMember = service.boardPage({ ownerId: "owner-1", executorAgentId: "agent-cr" });
    assert.equal(byMember.total, 1);
    assert.equal(byMember.items[0].executionId, task.executionId);
    const byStranger = service.boardPage({ ownerId: "owner-1", executorAgentId: "agent-nobody" });
    assert.equal(byStranger.total, 0);
    store.close();
  } finally {
    database.cleanup();
  }
});

test("createKanbanTask validates inputs and startTask flows through the service", () => {
  const database = tempDatabase();
  try {
    const store = new DurableExecutionStore(database.file);
    const service = new PlanService(store);
    assert.throws(() => service.createKanbanTask({
      ownerId: "owner-1",
      botId: "bot-1",
      form: "single",
      title: "No executor",
      goal: "This task has no agent."
    }));
    const detail = service.createKanbanTask({
      ownerId: "owner-1",
      botId: "bot-1",
      form: "single",
      title: "Refactor the importer",
      goal: "Refactor and test.",
      agentId: "agent-coder",
      completionConditions: [{ description: "Tests pass" }]
    });
    assert.equal(detail.execution.status, "planned");
    const started = service.startKanbanTask({
      ownerId: "owner-1",
      executionId: detail.execution.id,
      expectedVersion: detail.execution.version,
      actionId: "op-1"
    });
    assert.equal(started.execution.status, "queued");
    service.addKanbanInput({ ownerId: "owner-1", executionId: detail.execution.id, text: "Target module: src/importer." });
    assert.equal(service.listKanbanInputs("owner-1", detail.execution.id, true).length, 1);
    store.close();
  } finally {
    database.cleanup();
  }
});
