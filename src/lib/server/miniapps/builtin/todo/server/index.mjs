import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

/**
 * Todo Mini App — v3 (multi-list, priority, search, pin, due date + reminder).
 *
 * One domain module over the app's own SQLite database. Tool handlers and
 * HTTP handler both call into TodoStore — neither entrance writes its own SQL.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS todos (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  list_id TEXT DEFAULT 'inbox',
  priority INTEGER DEFAULT 2,
  pinned INTEGER DEFAULT 0,
  due_at TEXT,
  due_ms INTEGER,
  remind_at TEXT,
  remind_ms INTEGER
);
CREATE TABLE IF NOT EXISTS lists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS todos_completed_idx ON todos (completed, created_at);
CREATE INDEX IF NOT EXISTS todos_list_idx ON todos (list_id, pinned DESC, priority ASC, created_at DESC);
CREATE INDEX IF NOT EXISTS todos_due_idx ON todos (completed, due_ms);
CREATE INDEX IF NOT EXISTS todos_remind_idx ON todos (completed, remind_ms);
`;

function openDatabase(dataDir) {
  const db = new DatabaseSync(path.join(dataDir, "todo.sqlite"));
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(SCHEMA);

  // — Migration from v1: add columns if the table was created before they existed —
  const cols = db.prepare("PRAGMA table_info(todos)").all();
  const colNames = new Set(cols.map((c) => c.name));
  if (!colNames.has("list_id"))
    db.exec("ALTER TABLE todos ADD COLUMN list_id TEXT DEFAULT 'inbox'");
  if (!colNames.has("priority"))
    db.exec("ALTER TABLE todos ADD COLUMN priority INTEGER DEFAULT 2");
  if (!colNames.has("pinned"))
    db.exec("ALTER TABLE todos ADD COLUMN pinned INTEGER DEFAULT 0");

  // — Migration to v3: due date + reminder —
  if (!colNames.has("due_at")) db.exec("ALTER TABLE todos ADD COLUMN due_at TEXT");
  if (!colNames.has("due_ms")) db.exec("ALTER TABLE todos ADD COLUMN due_ms INTEGER");
  if (!colNames.has("remind_at")) db.exec("ALTER TABLE todos ADD COLUMN remind_at TEXT");
  if (!colNames.has("remind_ms")) db.exec("ALTER TABLE todos ADD COLUMN remind_ms INTEGER");

  // Ensure the default inbox list always exists.
  db.prepare(
    "INSERT OR IGNORE INTO lists (id, name, sort_order) VALUES ('inbox', 'Inbox', 0)"
  ).run();

  return db;
}

class TodoError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// — Time — --------------------------------------------------------------------

/**
 * Two time fields, matching what Google Tasks actually models:
 *
 * - `dueAt` is the deadline. It is EITHER a floating calendar date
 *   (`YYYY-MM-DD` — "due Monday", which has no time and belongs to no
 *   timezone) OR an exact instant (`...THH:MM` with or without an offset).
 * - `remindAt` is when to raise the reminder, and is always an exact instant.
 *   A bare date is not a moment, so a date-only reminder is read as
 *   `DEFAULT_REMIND_HOUR` local — the same defaulting Google Tasks does.
 *
 * An all-day due date is never *stored* as an instant. Turning "2026-08-10"
 * into a UTC instant is precisely how a date silently becomes the 9th or the
 * 11th for everyone not on UTC. The instant that sorting and overdue maths
 * need is derived alongside it into `due_ms`, resolved in the host's local
 * zone, where "due Monday" means "before Monday is over". That derived value
 * is recomputed on every write; if the host later moves timezone an untouched
 * row's `due_ms` can be a few hours stale, which shifts nothing a user sees
 * except the exact minute an all-day item flips to overdue.
 *
 * A value with no offset (`2026-08-10T09:00`) is local wall-clock time, which
 * is what `new Date()` already does for date-TIME strings. It is NOT what it
 * does for date-only strings — those parse as UTC — so calendar dates are
 * built field by field here and never handed to the Date parser.
 */
const DEFAULT_REMIND_HOUR = 9;

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;

function startOfLocalDay(year, month, day) {
  return new Date(year, month - 1, day, 0, 0, 0, 0).getTime();
}

function endOfLocalDay(year, month, day) {
  return new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
}

/** True when the fields describe a real calendar day (rejects 2026-02-31). */
function isRealDate(year, month, day) {
  const probe = new Date(year, month - 1, day);
  return probe.getFullYear() === year && probe.getMonth() === month - 1 && probe.getDate() === day;
}

function parseInstant(value) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Normalizes a deadline. Returns `{ at, ms, allDay }`, or null to clear it.
 *
 * Validation happens here, before anything is written — an unparseable date
 * must fail loudly rather than land in the row as a string nothing can
 * compare, which would make the item silently un-sortable and never overdue.
 */
function normalizeDue(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return null;

  const date = CALENDAR_DATE.exec(value);
  if (date) {
    const [, y, m, d] = date.map(Number);
    if (!isRealDate(y, m, d)) throw new TodoError(`"${value}" is not a real calendar date.`, 400);
    // A deadline "on Monday" is met any time that Monday, so it only becomes
    // overdue once the day is over.
    return { at: value, ms: endOfLocalDay(y, m, d), allDay: true };
  }

  const stamp = DATE_TIME.exec(value);
  if (stamp) {
    const ms = parseInstant(value);
    if (ms === null) throw new TodoError(`"${value}" is not a valid date-time.`, 400);
    return { at: new Date(ms).toISOString(), ms, allDay: false };
  }

  throw new TodoError(
    `"${value}" is not an ISO 8601 date. Use YYYY-MM-DD for an all-day deadline, or YYYY-MM-DDTHH:MM for a timed one.`,
    400
  );
}

/**
 * Normalizes a reminder to an exact instant. Returns `{ at, ms }` or null.
 *
 * Stored as a UTC instant: a reminder is a moment, and a moment has exactly
 * one correct representation. Display converts back to local.
 */
function normalizeRemind(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return null;

  const date = CALENDAR_DATE.exec(value);
  if (date) {
    const [, y, m, d] = date.map(Number);
    if (!isRealDate(y, m, d)) throw new TodoError(`"${value}" is not a real calendar date.`, 400);
    const ms = new Date(y, m - 1, d, DEFAULT_REMIND_HOUR, 0, 0, 0).getTime();
    return { at: new Date(ms).toISOString(), ms };
  }

  if (DATE_TIME.test(value)) {
    const ms = parseInstant(value);
    if (ms === null) throw new TodoError(`"${value}" is not a valid date-time.`, 400);
    return { at: new Date(ms).toISOString(), ms };
  }

  throw new TodoError(
    `"${value}" is not an ISO 8601 date-time. Use YYYY-MM-DDTHH:MM, or YYYY-MM-DD to remind at ${DEFAULT_REMIND_HOUR}:00 local.`,
    400
  );
}

/** Window bounds for the `due` filter, resolved in the host's local zone. */
function dueWindow(kind, now = Date.now()) {
  const today = new Date(now);
  const y = today.getFullYear();
  const m = today.getMonth() + 1;
  const d = today.getDate();
  if (kind === "overdue") return { max: now };
  if (kind === "today") return { max: endOfLocalDay(y, m, d) };
  if (kind === "week") return { max: endOfLocalDay(y, m, d + 7) };
  return null;
}

function toRow(record) {
  const dueAt = record.due_at ?? null;
  return {
    id: record.id,
    title: record.title,
    completed: record.completed === 1,
    createdAt: record.created_at,
    completedAt: record.completed_at ?? null,
    listId: record.list_id || "inbox",
    priority: record.priority ?? 2,
    pinned: record.pinned === 1,
    dueAt,
    // Derived from the stored format rather than a second column, so the two
    // can never disagree about what kind of deadline this is.
    dueAllDay: dueAt !== null && CALENDAR_DATE.test(dueAt),
    dueMs: record.due_ms ?? null,
    remindAt: record.remind_at ?? null,
    remindMs: record.remind_ms ?? null,
  };
}

class TodoStore {
  constructor(dataDir) {
    this.db = openDatabase(dataDir);
  }

  // — Todo CRUD — ------------------------------------------------------------

  list(opts = {}) {
    const { status, listId, priority, pinned, search, due } = opts;
    const conditions = [];
    const params = [];

    if (status === "open") conditions.push("completed = 0");
    else if (status === "completed") conditions.push("completed = 1");

    if (due === "none") {
      conditions.push("due_ms IS NULL");
    } else if (due === "any") {
      conditions.push("due_ms IS NOT NULL");
    } else if (due) {
      const window = dueWindow(due);
      if (!window) throw new TodoError(`Unknown due filter "${due}".`, 400);
      conditions.push("due_ms IS NOT NULL AND due_ms <= ?");
      params.push(window.max);
    }

    if (listId) {
      conditions.push("list_id = ?");
      params.push(listId);
    }
    if (priority !== undefined && priority !== null) {
      conditions.push("priority = ?");
      params.push(priority);
    }
    if (pinned !== undefined && pinned !== null) {
      conditions.push("pinned = ?");
      params.push(pinned ? 1 : 0);
    }
    if (search) {
      conditions.push("title LIKE ?");
      params.push(`%${search}%`);
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    // Dated work outranks undated work, soonest first — the Google Tasks
    // ordering. `due_ms IS NULL` sorts 0/1, so undated items fall to the back
    // of their pin group instead of to the very top (which is where a plain
    // `due_ms ASC` would put them, NULL being the smallest value in SQLite).
    const order =
      "ORDER BY completed ASC, pinned DESC, (due_ms IS NULL) ASC, due_ms ASC, priority ASC, created_at DESC";

    const rows = this.db
      .prepare(`SELECT * FROM todos ${where} ${order}`)
      .all(...params);
    return rows.map(toRow);
  }

  get(id) {
    const row = this.db.prepare("SELECT * FROM todos WHERE id = ?").get(id);
    return row ? toRow(row) : null;
  }

  add(rawTitle, listId = "inbox", priority = 2, pinned = false, times = {}) {
    const title = String(rawTitle ?? "").trim();
    if (!title) throw new TodoError("A todo needs a title.", 400);
    if (title.length > 300)
      throw new TodoError("A todo title is limited to 300 characters.", 400);

    // Both are validated before the insert, so a bad date cannot leave a
    // half-configured item behind (the tool reports the error and nothing is
    // written at all).
    const due = normalizeDue(times.dueAt);
    const remind = normalizeRemind(times.remindAt);

    const record = {
      id: randomUUID(),
      title,
      completed: 0,
      created_at: new Date().toISOString(),
      completed_at: null,
      list_id: listId,
      priority: Math.min(Math.max(priority, 1), 3),
      pinned: pinned ? 1 : 0,
      due_at: due?.at ?? null,
      due_ms: due?.ms ?? null,
      remind_at: remind?.at ?? null,
      remind_ms: remind?.ms ?? null,
    };

    this.transaction(() => {
      this.db
        .prepare(
          "INSERT INTO todos (id, title, completed, created_at, completed_at, list_id, priority, pinned, due_at, due_ms, remind_at, remind_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .run(
          record.id,
          record.title,
          record.completed,
          record.created_at,
          record.completed_at,
          record.list_id,
          record.priority,
          record.pinned,
          record.due_at,
          record.due_ms,
          record.remind_at,
          record.remind_ms
        );
    });
    return toRow(record);
  }

  complete(id, completed = true) {
    return this.update(id, { completed });
  }

  update(id, updates) {
    const existing = this.get(id);
    if (!existing) throw new TodoError("No todo with that id.", 404);

    const setClauses = [];
    const params = [];

    if (updates.title !== undefined) {
      const title = String(updates.title).trim();
      if (!title) throw new TodoError("Title cannot be empty.", 400);
      if (title.length > 300)
        throw new TodoError("A todo title is limited to 300 characters.", 400);
      setClauses.push("title = ?");
      params.push(title);
    }
    if (updates.completed !== undefined) {
      setClauses.push("completed = ?");
      setClauses.push("completed_at = ?");
      params.push(updates.completed ? 1 : 0);
      params.push(updates.completed ? new Date().toISOString() : null);
    }
    if (updates.listId !== undefined) {
      setClauses.push("list_id = ?");
      params.push(updates.listId);
    }
    if (updates.priority !== undefined) {
      setClauses.push("priority = ?");
      params.push(Math.min(Math.max(updates.priority, 1), 3));
    }
    if (updates.pinned !== undefined) {
      setClauses.push("pinned = ?");
      params.push(updates.pinned ? 1 : 0);
    }
    // An empty string or null clears the field; `undefined` leaves it alone.
    // Both columns are always written together so the stored value and its
    // derived sort key cannot drift apart.
    if (updates.dueAt !== undefined) {
      const due = normalizeDue(updates.dueAt);
      setClauses.push("due_at = ?", "due_ms = ?");
      params.push(due?.at ?? null, due?.ms ?? null);
    }
    if (updates.remindAt !== undefined) {
      const remind = normalizeRemind(updates.remindAt);
      setClauses.push("remind_at = ?", "remind_ms = ?");
      params.push(remind?.at ?? null, remind?.ms ?? null);
    }

    if (setClauses.length === 0) return existing;

    const sql = `UPDATE todos SET ${setClauses.join(", ")} WHERE id = ?`;
    params.push(id);

    this.transaction(() => {
      this.db.prepare(sql).run(...params);
    });

    return this.get(id);
  }

  /** Open items whose reminder time has arrived, soonest first. */
  remindersDue(now = Date.now()) {
    return this.db
      .prepare(
        "SELECT * FROM todos WHERE completed = 0 AND remind_ms IS NOT NULL AND remind_ms <= ? ORDER BY remind_ms ASC"
      )
      .all(now)
      .map(toRow);
  }

  remove(id) {
    const existing = this.get(id);
    if (!existing) throw new TodoError("No todo with that id.", 404);
    this.transaction(() => {
      this.db.prepare("DELETE FROM todos WHERE id = ?").run(id);
    });
    return existing;
  }

  // — List management — ------------------------------------------------------

  createList(rawName) {
    const name = String(rawName ?? "").trim();
    if (!name) throw new TodoError("A list needs a name.", 400);
    if (name.length > 100)
      throw new TodoError("List name is limited to 100 characters.", 400);

    // Slugify the name for the id; fall back to a UUID if it produces nothing.
    let id = name
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!id) id = randomUUID().slice(0, 8);

    const existing = this.db.prepare("SELECT * FROM lists WHERE id = ?").get(id);
    if (existing)
      throw new TodoError(`List "${name}" already exists.`, 409);

    const sortOrder =
      (this.db.prepare("SELECT MAX(sort_order) AS m FROM lists").get()?.m ?? 0) +
      1;

    this.transaction(() => {
      this.db
        .prepare("INSERT INTO lists (id, name, sort_order) VALUES (?, ?, ?)")
        .run(id, name, sortOrder);
    });
    return { id, name, sortOrder };
  }

  listLists() {
    const lists = this.db
      .prepare("SELECT * FROM lists ORDER BY sort_order ASC")
      .all();
    return lists.map((l) => {
      const counts = this.db
        .prepare(
          "SELECT SUM(CASE WHEN completed = 0 THEN 1 ELSE 0 END) AS open_count, SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) AS done_count FROM todos WHERE list_id = ?"
        )
        .get(l.id);
      return {
        id: l.id,
        name: l.name,
        sortOrder: l.sort_order,
        openCount: counts?.open_count ?? 0,
        completedCount: counts?.done_count ?? 0,
      };
    });
  }

  deleteList(id) {
    if (id === "inbox")
      throw new TodoError("Cannot delete the inbox list.", 400);
    const existing = this.db.prepare("SELECT * FROM lists WHERE id = ?").get(id);
    if (!existing) throw new TodoError("No list with that id.", 404);

    this.transaction(() => {
      this.db
        .prepare("UPDATE todos SET list_id = 'inbox' WHERE list_id = ?")
        .run(id);
      this.db.prepare("DELETE FROM lists WHERE id = ?").run(id);
    });
    return existing;
  }

  // — Infrastructure — -------------------------------------------------------

  transaction(run) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      run();
      this.db.exec("COMMIT");
    } catch (cause) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // A failed rollback must not mask the original error.
      }
      throw cause;
    }
  }

  close() {
    this.db.close();
  }
}

// — Reminders — ---------------------------------------------------------------

/** How often to re-check for reminders that have come due. */
const REMINDER_TICK_MS = 30_000;

/**
 * Raises the sidebar badge when a reminder comes due.
 *
 * The badge is the *entire* delivery mechanism available here on purpose: the
 * Mini App runtime offers no notification seam, and that is a deliberate
 * platform decision (`types.ts` — "no system notification, no interrupting
 * popup"). So a reminder here means "the app's icon starts carrying a count",
 * not "the OS pops a banner". Anything louder belongs behind a host
 * capability, not behind a `setInterval` in an app.
 *
 * "Already seen" lives only in memory, matching the badge itself: it is live
 * state about what the user has looked at, so a restart legitimately re-raises
 * whatever is still due rather than resurrecting an acknowledgement nothing
 * can any longer explain (pitfall #23d — a stored field is not a status).
 */
class ReminderWatcher {
  constructor(store, badge, logger) {
    this.store = store;
    this.badge = badge;
    this.logger = logger;
    this.acknowledged = new Set();
    this.timer = null;
  }

  start() {
    // Unref'd: a reminder check must never be the reason this process stays
    // alive (pitfall #30a — a stray timer kept a whole runtime running).
    this.timer = setInterval(() => this.tick(), REMINDER_TICK_MS);
    this.timer.unref?.();
    this.tick();
  }

  /**
   * Never throws and never returns a promise. This runs from a timer inside
   * the shared service process, where one unhandled rejection takes down every
   * Mini App and the runtime with it (pitfall #21d).
   */
  tick() {
    try {
      const due = this.store.remindersDue();
      const dueIds = new Set(due.map((row) => row.id));

      // Forget acknowledgements for items that are no longer due — completed,
      // deleted, or rescheduled. Without this an item rescheduled into the
      // future could never badge again once it came back around.
      for (const id of this.acknowledged) {
        if (!dueIds.has(id)) this.acknowledged.delete(id);
      }

      const pending = due.filter((row) => !this.acknowledged.has(row.id));
      this.badge?.set(pending.length > 0 ? { kind: "count", count: pending.length } : null);
      return pending;
    } catch (cause) {
      this.logger?.error("reminder_tick_failed", { message: String(cause?.message ?? cause) });
      return [];
    }
  }

  /** Called when the panel is open: everything due right now has been seen. */
  acknowledge() {
    try {
      for (const row of this.store.remindersDue()) this.acknowledged.add(row.id);
      this.badge?.set(null);
    } catch (cause) {
      this.logger?.error("reminder_ack_failed", { message: String(cause?.message ?? cause) });
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

// — Helpers for tool output — -------------------------------------------------

function text(value) {
  return { content: [{ type: "text", text: value }] };
}

const PRIORITY_LABELS = { 1: "high", 2: "normal", 3: "low" };

/**
 * A stored instant rendered in the host's local zone.
 *
 * Everything the model and the user read is local: they asked for "Monday
 * 9am", and echoing back a UTC `Z` string would read as the wrong time to
 * both. Only storage is UTC.
 */
function localStamp(iso) {
  const at = new Date(iso);
  const pad = (value) => String(value).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

function dueLabel(row, now = Date.now()) {
  if (!row.dueAt) return null;
  const shown = row.dueAllDay ? row.dueAt : localStamp(row.dueAt);
  const overdue = !row.completed && row.dueMs !== null && row.dueMs < now;
  return overdue ? `${shown} (overdue)` : shown;
}

function describe(row, now = Date.now()) {
  const pin = row.pinned ? "📌 " : "";
  const pri = row.priority !== 2 ? `[${PRIORITY_LABELS[row.priority]}] ` : "";
  const list = row.listId !== "inbox" ? ` (${row.listId})` : "";
  const due = dueLabel(row, now);
  const parts = [];
  if (due) parts.push(`due ${due}`);
  if (row.remindAt) parts.push(`remind ${localStamp(row.remindAt)}`);
  const when = parts.length > 0 ? ` — ${parts.join(", ")}` : "";
  return `${pin}${row.completed ? "[done]" : "[open]"} ${pri}${row.title}${list}${when} (id: ${row.id})`;
}

function titleFromAddInput(input) {
  if (typeof input?.title === "string" && input.title.trim()) return input.title;
  const capture = input?.capture;
  const selected = typeof capture?.selection === "string" ? capture.selection.trim() : "";
  const text = selected || (typeof capture?.text === "string" ? capture.text.trim() : "");
  return text.slice(0, 300);
}

// — App factory — -------------------------------------------------------------

/**
 * Display-only summary card rendered beside the tool result.
 *
 * Its one affordance is a deep link into this app's own panel — a card never
 * writes anything. The tool's text stays authoritative: the model reads that,
 * and it is all a non-desktop surface shows.
 */
function todoCard(appId, row) {
  const fields = [
    { label: "List", value: row.listId || "inbox" },
    { label: "Priority", value: PRIORITY_LABELS[row.priority] || "normal" }
  ];
  // Only when set: an empty "Due: —" row spends a field slot (there are 6) on
  // saying nothing.
  const due = dueLabel(row);
  if (due) fields.push({ label: "Due", value: due });
  if (row.remindAt) fields.push({ label: "Reminder", value: localStamp(row.remindAt) });

  return {
    title: row.title,
    subtitle: "Saved to Todo",
    icon: "check-square",
    fields,
    link: `molibot://miniapp/${appId}/item/${encodeURIComponent(row.id)}`
  };
}

export default function createTodoApp(context) {
  const store = new TodoStore(context.dataDir);
  const reminders = new ReminderWatcher(store, context.badge, context.logger);
  reminders.start();
  context.logger?.info("ready");

  return {
    tools: {
      add: async (input) => {
        const row = store.add(
          titleFromAddInput(input),
          input.listId,
          input.priority,
          input.pinned,
          { dueAt: input.dueAt, remindAt: input.remindAt }
        );
        reminders.tick();
        return {
          ...text(`Added: ${row.title}`),
          structuredContent: row,
          changed: true,
          card: todoCard(context.appId, row)
        };
      },

      list: async (input) => {
        const now = Date.now();
        const rows = store.list({
          status: input.status ?? "open",
          listId: input.listId,
          priority: input.priority,
          pinned: input.pinned,
          search: input.search,
          due: input.due,
        });
        const scope = input.due === "overdue" ? "overdue " : input.due === "today" ? "due-today " : input.due === "week" ? "due-this-week " : "";
        const label = `${scope}${input.status === "completed" ? "completed todo" : input.status === "all" ? "todo" : "open todo"}`;
        return {
          ...text(
            rows.length === 0
              ? `No ${label} items.`
              : `${rows.length} ${label} item(s):\n${rows.map((row) => describe(row, now)).join("\n")}`
          ),
          structuredContent: rows,
        };
      },

      complete: async (input) => {
        const row = store.complete(input.id, input.completed ?? true);
        // Completing an item retires its reminder — recompute rather than wait
        // out the tick, so the badge does not keep counting finished work.
        reminders.tick();
        return {
          ...text(row.completed ? `Completed: ${row.title}` : `Reopened: ${row.title}`),
          structuredContent: row,
          changed: true,
        };
      },

      update: async (input) => {
        const row = store.update(input.id, input);
        reminders.tick();
        const due = dueLabel(row);
        const suffix = [due && `due ${due}`, row.remindAt && `remind ${localStamp(row.remindAt)}`].filter(Boolean).join(", ");
        return {
          ...text(suffix ? `Updated: ${row.title} — ${suffix}` : `Updated: ${row.title}`),
          structuredContent: row,
          changed: true,
          card: todoCard(context.appId, row)
        };
      },

      pin: async (input) => {
        const row = store.update(input.id, { pinned: true });
        return { ...text(`Pinned: ${row.title}`), structuredContent: row, changed: true };
      },

      unpin: async (input) => {
        const row = store.update(input.id, { pinned: false });
        return { ...text(`Unpinned: ${row.title}`), structuredContent: row, changed: true };
      },

      move: async (input) => {
        const row = store.update(input.id, { listId: input.listId });
        return { ...text(`Moved to ${input.listId}: ${row.title}`), structuredContent: row, changed: true };
      },

      remove: async (input) => {
        const row = store.remove(input.id);
        reminders.tick();
        return { ...text(`Deleted: ${row.title}`), structuredContent: row, changed: true };
      },

      list_create: async (input) => {
        const list = store.createList(input.name);
        return { ...text(`Created list: ${list.name}`), structuredContent: list, changed: true };
      },

      list_all: async () => {
        const lists = store.listLists();
        const body =
          lists.length === 0
            ? "No lists."
            : `${lists.length} list(s):\n${lists
                .map((l) => `- ${l.name} (${l.id}): ${l.openCount} open, ${l.completedCount} done`)
                .join("\n")}`;
        return { ...text(body), structuredContent: lists };
      },

      list_delete: async (input) => {
        const list = store.deleteList(input.id);
        return { ...text(`Deleted list: ${list.name} (items moved to inbox)`), structuredContent: { id: list.id, name: list.name }, changed: true };
      },
    },

    async handleHttp(request) {
      try {
        const result = route(store, request, reminders);
        if (result?.changed) reminders.tick();
        return result;
      } catch (cause) {
        if (cause instanceof TodoError) {
          return { status: cause.status, body: { error: cause.message } };
        }
        throw cause;
      }
    },

    dispose() {
      reminders.stop();
      store.close();
    },
  };
}

// — HTTP route — --------------------------------------------------------------

function route(store, request, reminders) {
  const { method, path: requestPath, query, body } = request;

  // — /reminders —
  // The panel calls this on open and on refocus. Being able to see the list is
  // what "acknowledged" means, so this is the only signal that clears the
  // badge; the app never guesses it from a poll.
  if (requestPath === "/reminders") {
    if (method === "GET") {
      return { body: { due: store.remindersDue() } };
    }
    if (method === "POST") {
      reminders?.acknowledge();
      return { body: { acknowledged: true } };
    }
    return { status: 405, body: { error: `${method} is not allowed on /reminders.` } };
  }

  // — /lists —
  if (requestPath === "/lists") {
    if (method === "GET") {
      return { body: { lists: store.listLists() } };
    }
    if (method === "POST") {
      if (!body?.name) throw new TodoError("POST /lists requires a \"name\" field.", 400);
      return { status: 201, body: { list: store.createList(body.name) }, changed: true };
    }
    return { status: 405, body: { error: `${method} is not allowed on /lists.` } };
  }

  // — /lists/:id —
  const listMatch = requestPath.match(/^\/lists\/([^/]+)$/);
  if (listMatch) {
    const id = listMatch[1];
    if (method === "DELETE") {
      return { body: { list: store.deleteList(id) }, changed: true };
    }
    return { status: 405, body: { error: `${method} is not allowed on a list item.` } };
  }

  // — /todos —
  if (requestPath === "/todos") {
    if (method === "GET") {
      const opts = {};
      const status = query?.status?.[0];
      if (status) opts.status = status;
      const listId = query?.listId?.[0];
      if (listId) opts.listId = listId;
      const priority = query?.priority?.[0];
      if (priority) opts.priority = parseInt(priority, 10);
      const pinned = query?.pinned?.[0];
      if (pinned !== undefined) opts.pinned = pinned === "true";
      const search = query?.search?.[0];
      if (search) opts.search = search;
      const due = query?.due?.[0];
      if (due) opts.due = due;
      return { body: { todos: store.list(opts) } };
    }
    if (method === "POST") {
      if (!body?.title) throw new TodoError("POST /todos requires a \"title\" field.", 400);
      const row = store.add(
        body.title,
        body.listId ?? "inbox",
        body.priority ?? 2,
        body.pinned ?? false,
        { dueAt: body.dueAt, remindAt: body.remindAt }
      );
      return { status: 201, body: { todo: row }, changed: true };
    }
    return { status: 405, body: { error: `${method} is not allowed on /todos.` } };
  }

  // — /todos/:id —
  const itemMatch = requestPath.match(/^\/todos\/([^/]+)$/);
  if (itemMatch) {
    const id = itemMatch[1];
    if (method === "PATCH") {
      const updates = {};
      if (body?.completed !== undefined) updates.completed = !!body.completed;
      if (body?.title !== undefined) updates.title = body.title;
      if (body?.priority !== undefined) updates.priority = body.priority;
      if (body?.pinned !== undefined) updates.pinned = !!body.pinned;
      if (body?.listId !== undefined) updates.listId = body.listId;
      // `null` is a meaningful value here — it clears the field — so these two
      // are keyed on the property being present, not on it being truthy.
      if (body && "dueAt" in body) updates.dueAt = body.dueAt;
      if (body && "remindAt" in body) updates.remindAt = body.remindAt;
      if (Object.keys(updates).length === 0)
        throw new TodoError("PATCH requires at least one updatable field.", 400);
      return { body: { todo: store.update(id, updates) }, changed: true };
    }
    if (method === "DELETE") {
      return { body: { todo: store.remove(id) }, changed: true };
    }
    return { status: 405, body: { error: `${method} is not allowed on a todo item.` } };
  }

  return { status: 404, body: { error: "Unknown Todo endpoint." } };
}
