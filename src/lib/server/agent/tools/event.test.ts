import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createEventTool } from "$lib/server/agent/tools/event.js";
import type { MomEvent } from "$lib/server/agent/events.js";

function makeTool(workspaceDir: string) {
  return createEventTool({ workspaceDir, chatId: "chat-1", timezone: "Asia/Shanghai" });
}

function readEvents(eventsDir: string): MomEvent[] {
  return readdirSync(eventsDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(join(eventsDir, name), "utf8")) as MomEvent);
}

test("createEvent assigns a readable, name-based, globally-unique taskId", async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), "molibot-eventtool-"));
  const eventsDir = join(workspaceDir, "events");
  try {
    const tool = makeTool(workspaceDir);
    await tool.execute("t1", {
      type: "periodic",
      name: "AI News Daily",
      schedule: "10 19 * * *",
      timezone: "Asia/Shanghai",
      text: "run report"
    });

    const [event] = readEvents(eventsDir);
    assert.match(String(event.taskId), /^ai-news-daily-[a-z0-9]{4}$/);
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("createEvent never reuses a taskId already present in the events dir", async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), "molibot-eventtool-"));
  const eventsDir = join(workspaceDir, "events");
  try {
    const tool = makeTool(workspaceDir);
    await tool.execute("t1", {
      type: "one-shot",
      name: "reminder",
      at: "2999-01-01T09:00:00+08:00",
      text: "one"
    });
    await tool.execute("t2", {
      type: "one-shot",
      name: "reminder",
      at: "2999-01-02T09:00:00+08:00",
      text: "two"
    });

    const ids = readEvents(eventsDir).map((event) => String(event.taskId));
    assert.equal(ids.length, 2);
    assert.notEqual(ids[0], ids[1]);
    for (const id of ids) assert.match(id, /^reminder-[a-z0-9]{4}$/);
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("updating a periodic task by schedule preserves its existing taskId", async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), "molibot-eventtool-"));
  const eventsDir = join(workspaceDir, "events");
  try {
    const tool = makeTool(workspaceDir);
    await tool.execute("t1", {
      type: "periodic",
      name: "standup",
      schedule: "0 9 * * 1-5",
      timezone: "Asia/Shanghai",
      text: "original"
    });
    const originalId = String(readEvents(eventsDir)[0].taskId);

    // Same chatId + schedule + timezone -> updates the existing file in place.
    await tool.execute("t2", {
      type: "periodic",
      name: "renamed-standup",
      schedule: "0 9 * * 1-5",
      timezone: "Asia/Shanghai",
      text: "updated"
    });

    const events = readEvents(eventsDir);
    assert.equal(events.length, 1);
    assert.equal(events[0].text, "updated");
    assert.equal(String(events[0].taskId), originalId);
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("createEvent falls back to a generic slug when no name is given", async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), "molibot-eventtool-"));
  const eventsDir = join(workspaceDir, "events");
  try {
    const tool = makeTool(workspaceDir);
    await tool.execute("t1", {
      type: "immediate",
      text: "go"
    });
    const [event] = readEvents(eventsDir);
    assert.match(String(event.taskId), /^task-[a-z0-9]{4}$/);
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

// Guard against a collision-storm regression: pre-seed a file holding the id a
// naive generator might mint, and confirm the tool still produces a distinct id.
test("createEvent skips an id already taken by a pre-existing file", async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), "molibot-eventtool-"));
  const eventsDir = join(workspaceDir, "events");
  try {
    const tool = makeTool(workspaceDir);
    await tool.execute("t1", { type: "immediate", name: "dup", text: "first" });
    const firstId = String(readEvents(eventsDir)[0].taskId);

    await tool.execute("t2", { type: "immediate", name: "dup", text: "second" });
    const ids = readEvents(eventsDir).map((event) => String(event.taskId));
    assert.equal(new Set(ids).size, ids.length, "all taskIds must be distinct");
    assert.ok(ids.includes(firstId));
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});
