import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MomRuntimeStore } from "$lib/server/agent/session/store.js";
import { resolveEventSessionMode, taskSessionRetentionMs, type MomEvent } from "$lib/server/agent/events.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function makeStore(): { store: MomRuntimeStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "molibot-task-sessions-"));
  return { store: new MomRuntimeStore(dir), dir };
}

function ageSessionFiles(store: MomRuntimeStore, chatId: string, sessionId: string, ageMs: number): void {
  const old = new Date(Date.now() - ageMs);
  const entries = store.getSessionEntriesPath(chatId, sessionId);
  utimesSync(entries, old, old);
  utimesSync(entries.replace(/\.jsonl$/, ".json"), old, old);
}

test("beginTaskSession creates an active task- session", () => {
  const { store, dir } = makeStore();
  try {
    const chatId = "chat1";
    const id = store.beginTaskSession(chatId);
    assert.match(id, /^task-\d{8}-[a-z]{4}$/);
    assert.equal(store.getActiveSession(chatId), id);
    assert.ok(store.listSessions(chatId).includes(id));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("createSession uses date-scoped random ids", () => {
  const { store, dir } = makeStore();
  try {
    const chatId = "chat1";
    const first = store.createSession(chatId);
    const second = store.createSession(chatId);
    assert.match(first, /^s-\d{8}-[a-z]{4}$/);
    assert.match(second, /^s-\d{8}-[a-z]{4}$/);
    assert.equal(store.getActiveSession(chatId), second);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("beginTaskSession uses date-scoped random ids", () => {
  const { store, dir } = makeStore();
  try {
    const chatId = "chat1";
    const first = store.beginTaskSession(chatId);
    const second = store.beginTaskSession(chatId);
    assert.match(first, /^task-\d{8}-[a-z]{4}$/);
    assert.match(second, /^task-\d{8}-[a-z]{4}$/);
    assert.equal(store.getActiveSession(chatId), second);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pruneTaskSessions removes expired task sessions but keeps active and user sessions", () => {
  const { store, dir } = makeStore();
  try {
    const chatId = "chat1";
    const userSession = store.createSession(chatId);
    const oldTask = store.beginTaskSession(chatId);
    ageSessionFiles(store, chatId, oldTask, 10 * DAY_MS);
    ageSessionFiles(store, chatId, userSession, 10 * DAY_MS);
    const newTask = store.beginTaskSession(chatId, 7 * DAY_MS);

    const sessions = store.listSessions(chatId);
    assert.ok(!sessions.includes(oldTask), "expired task session should be pruned");
    assert.ok(sessions.includes(userSession), "non-task session must never be pruned");
    assert.ok(sessions.includes(newTask));
    assert.equal(store.getActiveSession(chatId), newTask);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("beginTaskSession without retention keeps old task sessions", () => {
  const { store, dir } = makeStore();
  try {
    const chatId = "chat1";
    const oldTask = store.beginTaskSession(chatId);
    ageSessionFiles(store, chatId, oldTask, 10 * DAY_MS);
    store.beginTaskSession(chatId);
    assert.ok(store.listSessions(chatId).includes(oldTask));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveEventSessionMode defaults periodic to fresh, others to chat", () => {
  const base = { chatId: "c", text: "t" };
  assert.equal(resolveEventSessionMode({ ...base, type: "periodic", schedule: "0 9 * * *", timezone: "UTC" } as MomEvent), "fresh");
  assert.equal(resolveEventSessionMode({ ...base, type: "immediate" } as MomEvent), "chat");
  assert.equal(resolveEventSessionMode({ ...base, type: "one-shot", at: "2030-01-01T00:00:00Z" } as MomEvent), "chat");
  assert.equal(
    resolveEventSessionMode({ ...base, type: "periodic", schedule: "0 9 * * *", timezone: "UTC", sessionMode: "chat" } as MomEvent),
    "chat"
  );
  assert.equal(resolveEventSessionMode({ ...base, type: "immediate", sessionMode: "fresh" } as MomEvent), "fresh");
});

test("taskSessionRetentionMs converts days and disables on 0", () => {
  assert.equal(taskSessionRetentionMs(7), 7 * DAY_MS);
  assert.equal(taskSessionRetentionMs(0), undefined);
  assert.equal(taskSessionRetentionMs(undefined), undefined);
});
