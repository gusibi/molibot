import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

/**
 * Todo — the reference Mini App.
 *
 * This file is also the platform's worked example, so it is written the way an
 * app author should write one: a single domain module over the app's own
 * SQLite database, with the tool handlers and the HTTP handler both calling
 * into it. Neither entrance writes its own SQL, so validation and business
 * rules exist exactly once and the agent and the UI can never disagree.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS todos (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS todos_completed_idx ON todos (completed, created_at);
`;

function openDatabase(dataDir) {
  const db = new DatabaseSync(path.join(dataDir, "todo.sqlite"));
  // WAL plus a busy timeout: the agent and the panel write through the same
  // process, but a slow read must never turn into an immediate SQLITE_BUSY.
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

function toRow(record) {
  return {
    id: record.id,
    title: record.title,
    completed: record.completed === 1,
    createdAt: record.created_at,
    completedAt: record.completed_at ?? null
  };
}

class TodoStore {
  constructor(dataDir) {
    this.db = openDatabase(dataDir);
  }

  list(status = "open") {
    const where = status === "open"
      ? "WHERE completed = 0"
      : status === "completed"
        ? "WHERE completed = 1"
        : "";
    const rows = this.db
      .prepare(`SELECT * FROM todos ${where} ORDER BY completed ASC, created_at DESC`)
      .all();
    return rows.map(toRow);
  }

  get(id) {
    const row = this.db.prepare("SELECT * FROM todos WHERE id = ?").get(id);
    return row ? toRow(row) : null;
  }

  add(rawTitle) {
    const title = String(rawTitle ?? "").trim();
    if (!title) throw new TodoError("A todo needs a title.", 400);
    if (title.length > 300) throw new TodoError("A todo title is limited to 300 characters.", 400);

    const record = {
      id: randomUUID(),
      title,
      completed: 0,
      created_at: new Date().toISOString(),
      completed_at: null
    };
    this.transaction(() => {
      this.db
        .prepare("INSERT INTO todos (id, title, completed, created_at, completed_at) VALUES (?, ?, ?, ?, ?)")
        .run(record.id, record.title, record.completed, record.created_at, record.completed_at);
    });
    return toRow(record);
  }

  complete(id, completed = true) {
    const existing = this.get(id);
    if (!existing) throw new TodoError("No todo with that id.", 404);
    const completedAt = completed ? new Date().toISOString() : null;
    this.transaction(() => {
      this.db
        .prepare("UPDATE todos SET completed = ?, completed_at = ? WHERE id = ?")
        .run(completed ? 1 : 0, completedAt, id);
    });
    return { ...existing, completed, completedAt };
  }

  remove(id) {
    const existing = this.get(id);
    if (!existing) throw new TodoError("No todo with that id.", 404);
    this.transaction(() => {
      this.db.prepare("DELETE FROM todos WHERE id = ?").run(id);
    });
    return existing;
  }

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

class TodoError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function text(value) {
  return { content: [{ type: "text", text: value }] };
}

function describe(row) {
  return `${row.completed ? "[done]" : "[open]"} ${row.title} (id: ${row.id})`;
}

export default function createTodoApp(context) {
  const store = new TodoStore(context.dataDir);
  context.logger.info("ready");

  return {
    tools: {
      add: async (input) => {
        const row = store.add(input.title);
        return { ...text(`Added: ${row.title}`), structuredContent: row, changed: true };
      },

      list: async (input) => {
        const rows = store.list(input.status ?? "open");
        const label = input.status === "completed"
          ? "completed todo"
          : input.status === "all"
            ? "todo"
            : "open todo";
        return {
          ...text(
            rows.length === 0
              ? `No ${label} items.`
              : `${rows.length} ${label} item(s):\n${rows.map(describe).join("\n")}`
          ),
          structuredContent: rows
        };
      },

      complete: async (input) => {
        const row = store.complete(input.id, input.completed ?? true);
        return {
          ...text(row.completed ? `Completed: ${row.title}` : `Reopened: ${row.title}`),
          structuredContent: row,
          changed: true
        };
      },

      remove: async (input) => {
        const row = store.remove(input.id);
        return { ...text(`Deleted: ${row.title}`), structuredContent: row, changed: true };
      }
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
    }
  };
}

function route(store, request) {
  const { method, path: requestPath, query, body } = request;

  if (requestPath === "/todos") {
    if (method === "GET") {
      return { body: { todos: store.list(query.status?.[0] ?? "all") } };
    }
    if (method === "POST") {
      return { status: 201, body: { todo: store.add(body?.title) }, changed: true };
    }
    return { status: 405, body: { error: `${method} is not allowed on /todos.` } };
  }

  const itemMatch = requestPath.match(/^\/todos\/([^/]+)$/);
  if (itemMatch) {
    const id = itemMatch[1];
    if (method === "PATCH") {
      const completed = body?.completed;
      if (typeof completed !== "boolean") {
        throw new TodoError("PATCH requires a boolean \"completed\" field.", 400);
      }
      return { body: { todo: store.complete(id, completed) }, changed: true };
    }
    if (method === "DELETE") {
      return { body: { todo: store.remove(id) }, changed: true };
    }
    return { status: 405, body: { error: `${method} is not allowed on a todo item.` } };
  }

  return { status: 404, body: { error: "Unknown Todo endpoint." } };
}
