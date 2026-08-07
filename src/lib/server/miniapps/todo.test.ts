import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import createTodoApp from "./builtin/todo/server/index.mjs";

/**
 * Todo's deadline and reminder fields.
 *
 * The interesting surface is entirely about time: an all-day deadline is a
 * floating calendar date and must not be pushed across a day boundary by a
 * timezone, a reminder is an instant, and "overdue" is a comparison that has
 * to agree with both.
 */

function request(
  path: string,
  options: { method?: string; body?: unknown; query?: Record<string, string[]> } = {}
) {
  return {
    method: options.method ?? "GET",
    path,
    query: options.query ?? {},
    body: options.body,
    contentType: "application/json",
    signal: new AbortController().signal
  };
}

function harness() {
  const dataDir = mkdtempSync(join(tmpdir(), "molibot-todo-"));
  const badges: unknown[] = [];
  let current: unknown = null;
  const runtime = createTodoApp({
    appId: "todo",
    dataDir,
    logger: { info() {}, warn() {}, error() {} },
    ai: {},
    badge: {
      set(value: unknown) {
        current = value;
        badges.push(value);
      },
      get: () => current,
      clear() {
        current = null;
      }
    }
  });
  return { runtime, badges, badge: () => current };
}

const iso = (ms: number) => new Date(ms).toISOString();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Local `YYYY-MM-DD` for an instant — what a user calls "that day". */
function localDate(ms: number): string {
  const at = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

test("an all-day deadline keeps its calendar date and only goes overdue once the day is over", async () => {
  const { runtime } = harness();

  const today = localDate(Date.now());
  const created = await runtime.handleHttp(
    request("/todos", { method: "POST", body: { title: "Ship the release", dueAt: today } })
  );

  // Stored verbatim: turning a floating date into a UTC instant is how it
  // becomes the previous or next day for anyone off UTC.
  assert.equal(created.body.todo.dueAt, today);
  assert.equal(created.body.todo.dueAllDay, true);
  assert.ok(created.body.todo.dueMs > Date.now(), "a deadline due today is not yet overdue");
  assert.ok(created.body.todo.dueMs <= Date.now() + DAY);

  const yesterday = localDate(Date.now() - DAY);
  const late = await runtime.handleHttp(
    request("/todos", { method: "POST", body: { title: "Was due yesterday", dueAt: yesterday } })
  );
  assert.equal(late.body.todo.dueAt, yesterday);
  assert.ok(late.body.todo.dueMs < Date.now(), "yesterday's all-day deadline is overdue");

  const overdue = await runtime.handleHttp(request("/todos", { query: { due: ["overdue"] } }));
  assert.deepEqual(
    overdue.body.todos.map((row: { title: string }) => row.title),
    ["Was due yesterday"]
  );

  const dueToday = await runtime.handleHttp(request("/todos", { query: { due: ["today"] } }));
  assert.equal(dueToday.body.todos.length, 2, "the overdue item is still due by end of today");
});

test("a timed deadline round-trips as an instant and a bare date reminder defaults to 09:00 local", async () => {
  const { runtime } = harness();

  const created = await runtime.handleHttp(
    request("/todos", {
      method: "POST",
      body: { title: "Standup", dueAt: "2031-03-04T09:30:00+08:00", remindAt: "2031-03-04" }
    })
  );
  const row = created.body.todo;

  assert.equal(row.dueAllDay, false);
  assert.equal(row.dueAt, "2031-03-04T01:30:00.000Z", "a timed deadline normalizes to its instant");
  assert.equal(row.dueMs, Date.parse("2031-03-04T09:30:00+08:00"));

  // A date is not a moment, so a date-only reminder gets the default hour in
  // the host's own zone — the same defaulting Google Tasks does.
  const remind = new Date(row.remindMs);
  assert.equal(remind.getHours(), 9);
  assert.equal(remind.getMinutes(), 0);
  assert.equal(localDate(row.remindMs), "2031-03-04");
});

test("an unparseable date is rejected before anything is written", async () => {
  const { runtime } = harness();

  for (const bad of ["next monday", "2026-02-31", "03/04/2031", "tomorrow 9am"]) {
    const rejected = await runtime.handleHttp(
      request("/todos", { method: "POST", body: { title: `bad ${bad}`, dueAt: bad } })
    );
    assert.equal(rejected.status, 400, `${bad} should be rejected`);
  }

  const all = await runtime.handleHttp(request("/todos", { query: { status: ["all"] } }));
  assert.deepEqual(all.body.todos, [], "a rejected date must not leave a half-created item");
});

test("dated work sorts ahead of undated work, soonest first, under the pinned group", async () => {
  const { runtime } = harness();
  const soon = localDate(Date.now() + DAY);
  const later = localDate(Date.now() + 5 * DAY);

  await runtime.handleHttp(request("/todos", { method: "POST", body: { title: "undated" } }));
  await runtime.handleHttp(request("/todos", { method: "POST", body: { title: "later", dueAt: later } }));
  await runtime.handleHttp(request("/todos", { method: "POST", body: { title: "soon", dueAt: soon } }));
  await runtime.handleHttp(
    request("/todos", { method: "POST", body: { title: "pinned undated", pinned: true } })
  );

  const listed = await runtime.handleHttp(request("/todos"));
  assert.deepEqual(
    listed.body.todos.map((row: { title: string }) => row.title),
    ["pinned undated", "soon", "later", "undated"],
    "NULL is the smallest value in SQLite, so undated items must be pushed back explicitly"
  );
});

test("clearing a deadline clears its derived sort key too", async () => {
  const { runtime } = harness();
  const created = await runtime.handleHttp(
    request("/todos", { method: "POST", body: { title: "Draft", dueAt: "2031-05-06", remindAt: "2031-05-06T08:00" } })
  );
  const id = created.body.todo.id;

  const cleared = await runtime.handleHttp(
    request(`/todos/${id}`, { method: "PATCH", body: { dueAt: "", remindAt: null } })
  );
  assert.equal(cleared.body.todo.dueAt, null);
  assert.equal(cleared.body.todo.dueMs, null);
  assert.equal(cleared.body.todo.remindAt, null);
  assert.equal(cleared.body.todo.remindMs, null);

  const undated = await runtime.handleHttp(request("/todos", { query: { due: ["none"] } }));
  assert.equal(undated.body.todos.length, 1);
});

test("a due reminder badges the app, acknowledging clears it, and completing retires it", async () => {
  const { runtime, badge } = harness();

  await runtime.handleHttp(request("/todos", { method: "POST", body: { title: "No reminder" } }));
  assert.equal(badge(), null, "an item with no reminder never badges");

  const past = iso(Date.now() - HOUR);
  const created = await runtime.handleHttp(
    request("/todos", { method: "POST", body: { title: "Call the bank", remindAt: past } })
  );
  assert.deepEqual(badge(), { kind: "count", count: 1 });

  // Opening the panel is what "seen" means; nothing else clears the badge.
  await runtime.handleHttp(request("/reminders", { method: "POST" }));
  assert.equal(badge(), null);

  // A second reminder coming due badges again rather than staying silent
  // because an earlier one was acknowledged.
  await runtime.handleHttp(request("/todos", { method: "POST", body: { title: "Renew pass", remindAt: past } }));
  assert.deepEqual(badge(), { kind: "count", count: 1 });

  await runtime.handleHttp(
    request(`/todos/${created.body.todo.id}`, { method: "PATCH", body: { completed: true } })
  );
  assert.deepEqual(badge(), { kind: "count", count: 1 }, "completing the acknowledged one leaves the other");

  const dueNow = await runtime.handleHttp(request("/reminders"));
  assert.deepEqual(
    dueNow.body.due.map((row: { title: string }) => row.title),
    ["Renew pass"],
    "a completed item is no longer a live reminder"
  );
});

test("a future reminder stays silent until its time, and rescheduling can badge again", async () => {
  const { runtime, badge } = harness();

  const created = await runtime.handleHttp(
    request("/todos", { method: "POST", body: { title: "Water plants", remindAt: iso(Date.now() + DAY) } })
  );
  assert.equal(badge(), null);

  const id = created.body.todo.id;
  await runtime.handleHttp(request(`/todos/${id}`, { method: "PATCH", body: { remindAt: iso(Date.now() - HOUR) } }));
  assert.deepEqual(badge(), { kind: "count", count: 1 });

  await runtime.handleHttp(request("/reminders", { method: "POST" }));
  assert.equal(badge(), null);

  // Pushed into the future, then pulled back: the acknowledgement must not
  // still be holding the badge down.
  await runtime.handleHttp(request(`/todos/${id}`, { method: "PATCH", body: { remindAt: iso(Date.now() + DAY) } }));
  await runtime.handleHttp(request(`/todos/${id}`, { method: "PATCH", body: { remindAt: iso(Date.now() - HOUR) } }));
  assert.deepEqual(badge(), { kind: "count", count: 1 });
});

test("the add and update tools carry the deadline into their text, card, and structured result", async () => {
  const { runtime } = harness();

  const added = await runtime.tools.add({ title: "File taxes", dueAt: "2031-04-15", remindAt: "2031-04-10T08:30" });
  assert.equal(added.structuredContent.dueAt, "2031-04-15");
  const dueField = added.card.fields.find((field: { label: string }) => field.label === "Due");
  assert.equal(dueField.value, "2031-04-15");
  const remindField = added.card.fields.find((field: { label: string }) => field.label === "Reminder");
  assert.equal(remindField.value, "2031-04-10 08:30", "the model is shown local time, not the stored UTC");

  const listed = await runtime.tools.list({});
  assert.match(listed.content[0].text, /due 2031-04-15/);
  assert.match(listed.content[0].text, /remind 2031-04-10 08:30/);

  const moved = await runtime.tools.update({ id: added.structuredContent.id, dueAt: "2031-04-20" });
  assert.match(moved.content[0].text, /due 2031-04-20/);
  assert.equal(moved.structuredContent.dueAt, "2031-04-20");

  const overdue = await runtime.tools.list({ due: "overdue" });
  assert.match(overdue.content[0].text, /No overdue open todo items\./);
});

test("an overdue item is labelled overdue for the model, and a completed one is not", async () => {
  const { runtime } = harness();
  const added = await runtime.tools.add({ title: "Renew passport", dueAt: localDate(Date.now() - 2 * DAY) });
  assert.match((await runtime.tools.list({})).content[0].text, /overdue/);

  await runtime.tools.complete({ id: added.structuredContent.id });
  const done = await runtime.tools.list({ status: "all" });
  assert.doesNotMatch(done.content[0].text, /overdue/, "finished work is not late");
});

test("existing v2 rows survive the migration with empty date fields", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "molibot-todo-migrate-"));
  const context = {
    appId: "todo",
    dataDir,
    logger: { info() {}, warn() {}, error() {} },
    ai: {},
    badge: { set() {}, get: () => null, clear() {} }
  };

  const before = createTodoApp(context);
  await before.handleHttp(request("/todos", { method: "POST", body: { title: "From v2" } }));
  await before.dispose();

  const after = createTodoApp(context);
  const listed = await after.handleHttp(request("/todos"));
  assert.equal(listed.body.todos.length, 1);
  assert.equal(listed.body.todos[0].dueAt, null);
  assert.equal(listed.body.todos[0].remindMs, null);
  await after.dispose();
});
