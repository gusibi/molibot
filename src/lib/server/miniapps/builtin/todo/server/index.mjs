import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

/**
 * Todo Mini App — v2 (multi-list, priority, search, pin).
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
  pinned INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS lists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS todos_completed_idx ON todos (completed, created_at);
CREATE INDEX IF NOT EXISTS todos_list_idx ON todos (list_id, pinned DESC, priority ASC, created_at DESC);
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

  // Ensure the default inbox list always exists.
  db.prepare(
    "INSERT OR IGNORE INTO lists (id, name, sort_order) VALUES ('inbox', 'Inbox', 0)"
  ).run();

  return db;
}

function toRow(record) {
  return {
    id: record.id,
    title: record.title,
    completed: record.completed === 1,
    createdAt: record.created_at,
    completedAt: record.completed_at ?? null,
    listId: record.list_id || "inbox",
    priority: record.priority ?? 2,
    pinned: record.pinned === 1,
  };
}

class TodoError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

class TodoStore {
  constructor(dataDir) {
    this.db = openDatabase(dataDir);
  }

  // — Todo CRUD — ------------------------------------------------------------

  list(opts = {}) {
    const { status, listId, priority, pinned, search } = opts;
    const conditions = [];
    const params = [];

    if (status === "open") conditions.push("completed = 0");
    else if (status === "completed") conditions.push("completed = 1");

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
    const order =
      "ORDER BY completed ASC, pinned DESC, priority ASC, created_at DESC";

    const rows = this.db
      .prepare(`SELECT * FROM todos ${where} ${order}`)
      .all(...params);
    return rows.map(toRow);
  }

  get(id) {
    const row = this.db.prepare("SELECT * FROM todos WHERE id = ?").get(id);
    return row ? toRow(row) : null;
  }

  add(rawTitle, listId = "inbox", priority = 2, pinned = false) {
    const title = String(rawTitle ?? "").trim();
    if (!title) throw new TodoError("A todo needs a title.", 400);
    if (title.length > 300)
      throw new TodoError("A todo title is limited to 300 characters.", 400);

    const record = {
      id: randomUUID(),
      title,
      completed: 0,
      created_at: new Date().toISOString(),
      completed_at: null,
      list_id: listId,
      priority: Math.min(Math.max(priority, 1), 3),
      pinned: pinned ? 1 : 0,
    };

    this.transaction(() => {
      this.db
        .prepare(
          "INSERT INTO todos (id, title, completed, created_at, completed_at, list_id, priority, pinned) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .run(
          record.id,
          record.title,
          record.completed,
          record.created_at,
          record.completed_at,
          record.list_id,
          record.priority,
          record.pinned
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

    if (setClauses.length === 0) return existing;

    const sql = `UPDATE todos SET ${setClauses.join(", ")} WHERE id = ?`;
    params.push(id);

    this.transaction(() => {
      this.db.prepare(sql).run(...params);
    });

    return this.get(id);
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

// — Helpers for tool output — -------------------------------------------------

function text(value) {
  return { content: [{ type: "text", text: value }] };
}

const PRIORITY_LABELS = { 1: "high", 2: "normal", 3: "low" };

function describe(row) {
  const pin = row.pinned ? "📌 " : "";
  const pri = row.priority !== 2 ? `[${PRIORITY_LABELS[row.priority]}] ` : "";
  const list = row.listId !== "inbox" ? ` (${row.listId})` : "";
  return `${pin}${row.completed ? "[done]" : "[open]"} ${pri}${row.title}${list} (id: ${row.id})`;
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
  return {
    title: row.title,
    subtitle: "Saved to Todo",
    icon: "check-square",
    fields: [
      { label: "List", value: row.listId || "inbox" },
      { label: "Priority", value: PRIORITY_LABELS[row.priority] || "normal" }
    ],
    link: `molibot://miniapp/${appId}/item/${encodeURIComponent(row.id)}`
  };
}

export default function createTodoApp(context) {
  const store = new TodoStore(context.dataDir);
  context.logger.info("ready");

  return {
    tools: {
      add: async (input) => {
        const row = store.add(
          titleFromAddInput(input),
          input.listId,
          input.priority,
          input.pinned
        );
        return {
          ...text(`Added: ${row.title}`),
          structuredContent: row,
          changed: true,
          card: todoCard(context.appId, row)
        };
      },

      list: async (input) => {
        const rows = store.list({
          status: input.status ?? "open",
          listId: input.listId,
          priority: input.priority,
          pinned: input.pinned,
          search: input.search,
        });
        const label = input.status === "completed" ? "completed todo" : input.status === "all" ? "todo" : "open todo";
        return {
          ...text(
            rows.length === 0
              ? `No ${label} items.`
              : `${rows.length} ${label} item(s):\n${rows.map(describe).join("\n")}`
          ),
          structuredContent: rows,
        };
      },

      complete: async (input) => {
        const row = store.complete(input.id, input.completed ?? true);
        return {
          ...text(row.completed ? `Completed: ${row.title}` : `Reopened: ${row.title}`),
          structuredContent: row,
          changed: true,
        };
      },

      update: async (input) => {
        const row = store.update(input.id, input);
        return { ...text(`Updated: ${row.title}`), structuredContent: row, changed: true };
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
        return route(store, request);
      } catch (cause) {
        if (cause instanceof TodoError) {
          return { status: cause.status, body: { error: cause.message } };
        }
        throw cause;
      }
    },

    dispose() {
      store.close();
    },
  };
}

// — HTTP route — --------------------------------------------------------------

function route(store, request) {
  const { method, path: requestPath, query, body } = request;

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
      return { body: { todos: store.list(opts) } };
    }
    if (method === "POST") {
      if (!body?.title) throw new TodoError("POST /todos requires a \"title\" field.", 400);
      const row = store.add(
        body.title,
        body.listId ?? "inbox",
        body.priority ?? 2,
        body.pinned ?? false
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
