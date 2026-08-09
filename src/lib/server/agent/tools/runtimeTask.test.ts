import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { collectRuntimeTaskIds, createRuntimeTaskTool } from "$lib/server/agent/tools/runtimeTask.js";
import type { MomEvent } from "$lib/server/agent/events.js";

function makeTool(workspaceDir: string) {
  return createRuntimeTaskTool({ workspaceDir, chatId: "chat-1", sessionId: "session-1", timezone: "Asia/Shanghai" });
}

function resultJson(result: Awaited<ReturnType<ReturnType<typeof makeTool>["execute"]>>) {
  const block = result.content[0];
  assert.equal(block.type, "text");
  return JSON.parse(block.text) as Record<string, unknown>;
}

function readOnlyEvent(workspaceDir: string): MomEvent {
  const eventsDir = join(workspaceDir, "events");
  const [filename] = readdirSync(eventsDir).filter((name) => name.endsWith(".json"));
  return JSON.parse(readFileSync(join(eventsDir, filename), "utf8")) as MomEvent;
}

test("runtimeTask provides create, list, get, update, and delete for one-shot reminders", async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), "molibot-runtime-task-"));
  try {
    const tool = makeTool(workspaceDir);
    const created = resultJson(await tool.execute("create", {
      action: "create",
      type: "one-shot",
      name: "drink-water",
      at: "2999-01-01T09:00:00+08:00",
      text: "Drink water"
    }));
    const taskId = String((created.task as { taskId: string }).taskId);
    assert.match(taskId, /^drink-water-[a-z0-9]{4}$/);
    assert.equal(readOnlyEvent(workspaceDir).sessionId, "session-1");

    const listed = resultJson(await tool.execute("list", { action: "list" }));
    assert.equal(listed.count, 1);
    const fetched = resultJson(await tool.execute("get", { action: "get", taskId }));
    assert.equal((fetched.task as { text: string }).text, "Drink water");

    const updated = resultJson(await tool.execute("update", {
      action: "update",
      taskId,
      patch: { text: "Drink two glasses", at: "2999-01-02T09:00:00+08:00" }
    }));
    assert.equal((updated.task as { text: string }).text, "Drink two glasses");
    assert.equal(readOnlyEvent(workspaceDir).status?.state, "pending");

    resultJson(await tool.execute("delete", { action: "delete", taskId }));
    assert.equal(readdirSync(join(workspaceDir, "events")).filter((name) => name.endsWith(".json")).length, 0);
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("runtimeTask stores an unscheduled todo without turning it into an event trigger", async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), "molibot-runtime-todo-"));
  try {
    const tool = makeTool(workspaceDir);
    const created = resultJson(await tool.execute("create-todo", {
      action: "create",
      type: "todo",
      text: "Buy milk"
    }));
    const task = created.task as { taskId: string; type: string; text: string; at?: string; schedule?: string };
    assert.equal(task.type, "todo");
    assert.equal(task.text, "Buy milk");
    assert.equal(task.at, undefined);
    assert.equal(task.schedule, undefined);

    const persisted = readOnlyEvent(workspaceDir);
    assert.equal(persisted.type, "todo");
    assert.equal("at" in persisted, false);
    assert.equal("schedule" in persisted, false);

    await assert.rejects(() => tool.execute("schedule-todo", {
      action: "update",
      taskId: task.taskId,
      patch: { at: "2999-01-02T09:00:00+08:00" }
    }), /do not accept schedule/);
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("runtimeTask excludes immediate execution events and Molibot-managed system tasks", async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), "molibot-runtime-task-boundary-"));
  const eventsDir = join(workspaceDir, "events");
  try {
    const tool = makeTool(workspaceDir);
    await tool.execute("seed", {
      action: "create",
      type: "periodic",
      schedule: "0 9 * * *",
      timezone: "Asia/Shanghai",
      text: "Daily report"
    });
    writeFileSync(join(eventsDir, "immediate.json"), JSON.stringify({ type: "immediate", taskId: "event-only", chatId: "chat-1", text: "execute" }));
    writeFileSync(join(eventsDir, "system.json"), JSON.stringify({
      type: "periodic",
      taskId: "system-only",
      chatId: "internal",
      text: "reflect",
      schedule: "0 4 * * *",
      timezone: "Asia/Shanghai",
      managed: { by: "molibot", scope: "owner", kind: "memory-reflection" }
    }));

    const listed = resultJson(await tool.execute("list", { action: "list" }));
    assert.equal(listed.count, 1);
    await assert.rejects(() => tool.execute("get", { action: "get", taskId: "event-only" }), /not found/);
    await assert.rejects(() => tool.execute("delete", { action: "delete", taskId: "system-only" }), /not found/);
    assert.equal(existsSync(join(eventsDir, "immediate.json")), true);
    assert.equal(existsSync(join(eventsDir, "system.json")), true);
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("runtimeTask task ids never collide with execution-only or system events", async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), "molibot-runtime-task-id-boundary-"));
  const eventsDir = join(workspaceDir, "events");
  try {
    const tool = makeTool(workspaceDir);
    await tool.execute("create-events-dir", {
      action: "create",
      type: "one-shot",
      at: "2999-01-01T09:00:00+08:00",
      text: "Seed"
    });
    writeFileSync(join(eventsDir, "immediate.json"), JSON.stringify({ type: "immediate", taskId: "reserved-id", chatId: "chat-1", text: "execute" }));
    writeFileSync(join(eventsDir, "system.json"), JSON.stringify({ type: "periodic", taskId: "reserved-system-id", managed: { by: "molibot" } }));

    const discovered = collectRuntimeTaskIds(eventsDir);
    assert.equal(discovered.has("reserved-id"), true);
    assert.equal(discovered.has("reserved-system-id"), true);
    const allIds = readdirSync(eventsDir).map((filename) => {
      const event = JSON.parse(readFileSync(join(eventsDir, filename), "utf8")) as { taskId?: string };
      return event.taskId;
    }).filter(Boolean);
    assert.equal(new Set(allIds).size, allIds.length);
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("runtimeTask rejects fields from the wrong task type", async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), "molibot-runtime-task-validation-"));
  try {
    const tool = makeTool(workspaceDir);
    const created = resultJson(await tool.execute("create", {
      action: "create",
      type: "one-shot",
      at: "2999-01-01T09:00:00+08:00",
      text: "Reminder"
    }));
    const taskId = String((created.task as { taskId: string }).taskId);
    await assert.rejects(() => tool.execute("update", {
      action: "update",
      taskId,
      patch: { schedule: "0 9 * * *" }
    }), /only apply to periodic/);
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});
