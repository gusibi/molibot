import assert from "node:assert/strict";
import { test } from "node:test";
import type { DesktopHomeNotification } from "@molibot/desktop-contract";
import { get } from "svelte/store";
import { createHomeInbox } from "./homeInbox";

function item(id: string): DesktopHomeNotification {
  return { id, type: "task-result", payload: {}, status: "unread", createdAt: "", updatedAt: "" };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test("each dismissal keeps its own undo window and restores unread when offline", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const a = item("a"), b = item("b");
  const writes: string[] = [];
  let online = true;
  const inbox = createHomeInbox({
    load: async () => [a, b].filter(row => !writes.includes(row.id)),
    markRead: async (_endpoint, ids) => { writes.push(...ids); },
    canWrite: () => online,
    onRead() {},
  });
  inbox.setEndpoint("service");
  await inbox.refresh("service");
  inbox.dismiss("service", a);
  context.mock.timers.tick(1000);
  inbox.dismiss("service", b);
  assert.deepEqual(get(inbox).undoItems, [a, b]);
  context.mock.timers.tick(3499);
  assert.deepEqual(writes, []);
  inbox.undo("a");
  online = false;
  context.mock.timers.tick(1001);
  assert.deepEqual(writes, []);
  assert.deepEqual(get(inbox).notifications, [a, b]);
});

test("late reads and older list snapshots cannot resurrect acknowledged cards", async () => {
  const a = item("a"), b = item("b");
  const olderList = deferred<DesktopHomeNotification[]>();
  const first = deferred<DesktopHomeNotification[]>();
  const second = deferred<DesktopHomeNotification[]>();
  let loads = 0;
  const inbox = createHomeInbox({
    load: () => {
      loads++;
      if (loads === 1) return Promise.resolve([a, b]);
      if (loads === 2) return olderList.promise;
      return Promise.resolve([]);
    },
    markRead: (_endpoint, ids) => (ids[0] === "a" ? first : second).promise,
    canWrite: () => true,
    onRead() {},
  });
  inbox.setEndpoint("service");
  await inbox.refresh("service");
  const refreshing = inbox.refresh("service");
  const readingA = inbox.commitRead("service", a);
  const readingB = inbox.commitRead("service", b);
  second.resolve([]);
  await readingB;
  first.resolve([b]);
  await readingA;
  olderList.resolve([a, b]);
  await refreshing;
  assert.deepEqual(get(inbox).notifications, []);
});

test("switching connections cancels old timers and ignores completion from old writes", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const a = item("a"), b = item("b");
  const response = deferred<void>();
  const writes: string[] = [];
  const inbox = createHomeInbox({
    load: async () => [a, b],
    markRead: (_endpoint, ids) => {
      writes.push(...ids);
      return response.promise;
    },
    canWrite: () => true,
    onRead() { assert.fail("Old connection must not update the new connection"); },
  });
  inbox.setEndpoint("old");
  await inbox.refresh("old");
  inbox.dismiss("old", a);
  const reading = inbox.commitRead("old", b);
  inbox.setEndpoint("new");
  await inbox.refresh("new");
  context.mock.timers.tick(4500);
  response.resolve();
  await reading;
  assert.deepEqual(writes, ["b"]);
  assert.deepEqual(get(inbox).notifications, [a, b]);
});
