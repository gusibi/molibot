import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { PersistentTaskQueue } from "./persistentTaskQueue.js";

test("PersistentTaskQueue runs front-inserted task before older pending task", async () => {
  const steps: string[] = [];
  let releaseCurrent: (() => void) | null = null;
  let resolveDone: (() => void) | null = null;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  const queue = new PersistentTaskQueue<{ text: string }>({
    channel: "test",
    instanceId: "bot-1",
    dbFile: ":memory:",
    process: async (payload) => {
      steps.push(payload.text);
      if (payload.text === "current") {
        await new Promise<void>((resolve) => {
          releaseCurrent = resolve;
        });
      }
      if (payload.text === "second") {
        resolveDone?.();
      }
    }
  });

  queue.enqueue("chat-1", { text: "current" }, { preview: "current" });
  queue.enqueue("chat-1", { text: "second" }, { preview: "second" });
  queue.enqueue("chat-1", { text: "first" }, { front: true, preview: "first" });
  await delay(0);
  if (releaseCurrent) {
    releaseCurrent();
  }
  await done;

  assert.deepEqual(steps, ["current", "first", "second"]);
  await delay(10);
  queue.close();
});

test("PersistentTaskQueue lists and deletes pending tasks by id", async () => {
  let releaseCurrent: (() => void) | null = null;
  const queue = new PersistentTaskQueue<{ text: string }>({
    channel: "test",
    instanceId: "bot-2",
    dbFile: ":memory:",
    process: async (payload) => {
      if (payload.text === "current") {
        await new Promise<void>((resolve) => {
          releaseCurrent = resolve;
        });
      }
    }
  });

  const firstId = queue.enqueue("chat-1", { text: "current" }, { preview: "current" });
  const pendingId = queue.enqueue("chat-1", { text: "alpha" }, { preview: "alpha" });
  const secondId = queue.enqueue("chat-1", { text: "beta" }, { preview: "beta" });
  await delay(0);

  const listed = queue.list("chat-1");
  assert.deepEqual(listed.map((item) => item.id), [firstId, pendingId, secondId]);
  assert.deepEqual(queue.peek("chat-1", firstId), { status: "running", preview: "current" });
  assert.deepEqual(queue.peek("chat-1", pendingId), { status: "pending", preview: "alpha" });

  const deleted = queue.delete("chat-1", pendingId);
  assert.equal(deleted, "deleted");
  assert.deepEqual(queue.list("chat-1").map((item) => item.id), [firstId, secondId]);
  assert.deepEqual(queue.peek("chat-1", pendingId), { status: "not_found" });
  if (releaseCurrent) {
    releaseCurrent();
  }
  await delay(10);
  queue.close();
});

test("PersistentTaskQueue removes successful tasks from sqlite automatically", async () => {
  let resolveDone: (() => void) | null = null;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  const queue = new PersistentTaskQueue<{ text: string }>({
    channel: "test",
    instanceId: "bot-3",
    dbFile: ":memory:",
    process: async (payload) => {
      if (payload.text === "done") {
        resolveDone?.();
      }
    }
  });

  const id = queue.enqueue("chat-1", { text: "done" }, { preview: "done" });
  await done;
  await delay(10);

  assert.equal(queue.size("chat-1"), 0);
  assert.deepEqual(queue.list("chat-1"), []);
  assert.equal(queue.delete("chat-1", id), "not_found");
  queue.close();
});

test("PersistentTaskQueue cancelPending keeps running task and clears only backlog", async () => {
  let releaseCurrent: (() => void) | null = null;
  const queue = new PersistentTaskQueue<{ text: string }>({
    channel: "test",
    instanceId: "bot-4",
    dbFile: ":memory:",
    process: async (payload) => {
      if (payload.text === "current") {
        await new Promise<void>((resolve) => {
          releaseCurrent = resolve;
        });
      }
    }
  });

  const currentId = queue.enqueue("chat-1", { text: "current" }, { preview: "current" });
  queue.enqueue("chat-1", { text: "alpha" }, { preview: "alpha" });
  queue.enqueue("chat-1", { text: "beta" }, { preview: "beta" });
  await delay(0);

  assert.equal(queue.cancelPending("chat-1"), 2);
  assert.deepEqual(queue.list("chat-1").map((item) => item.id), [currentId]);
  assert.equal(queue.size("chat-1"), 1);

  if (releaseCurrent) {
    releaseCurrent();
  }
  await delay(10);
  queue.close();
});
