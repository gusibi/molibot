import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

/**
 * Starter — a Mini App skeleton you are meant to edit, not to read once.
 *
 * The shape is the one every Mini App should have: a single domain module
 * (`Store`) over the app's own SQLite database, with the tool handlers and the
 * HTTP handler both calling into it. Neither entrance writes its own SQL, so
 * validation and business rules exist exactly once and the agent and the panel
 * can never disagree.
 *
 * WHERE TO EDIT, in order:
 *   1. SCHEMA        — your table(s) and indexes.
 *   2. Store         — validation, business rules, transactions.
 *   3. tools         — call Store, phrase the result for the agent.
 *   4. route()       — call Store, shape the JSON for your UI.
 * Keep 3 and 4 thin. Everything interesting belongs in 2.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS starter_records (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  note TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS starter_records_done_idx ON starter_records (done, created_at);
`;

const MAX_TITLE_LENGTH = 300;
const MAX_NOTE_LENGTH = 2000;

function openDatabase(dataDir) {
  const db = new DatabaseSync(path.join(dataDir, "starter.sqlite"));
  // WAL plus a busy timeout: the agent and the panel write through the same
  // process, but a slow read must never turn into an immediate SQLITE_BUSY.
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

function toRecord(row) {
  return {
    id: row.id,
    title: row.title,
    note: row.note ?? "",
    done: row.done === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/** Fails a call with an HTTP status the UI can act on; the agent sees the message. */
class AppError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

class Store {
  constructor(dataDir) {
    this.db = openDatabase(dataDir);
  }

  list(status = "open") {
    const where = status === "open"
      ? "WHERE done = 0"
      : status === "done"
        ? "WHERE done = 1"
        : "";
    return this.db
      .prepare(`SELECT * FROM starter_records ${where} ORDER BY done ASC, created_at DESC`)
      .all()
      .map(toRecord);
  }

  get(id) {
    const row = this.db.prepare("SELECT * FROM starter_records WHERE id = ?").get(id);
    return row ? toRecord(row) : null;
  }

  add(rawTitle, rawNote) {
    const title = this.#requireTitle(rawTitle);
    const note = this.#normalizeNote(rawNote);
    const now = new Date().toISOString();
    const record = {
      id: randomUUID(),
      title,
      note,
      done: 0,
      created_at: now,
      updated_at: now
    };
    this.transaction(() => {
      this.db
        .prepare(
          "INSERT INTO starter_records (id, title, note, done, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .run(record.id, record.title, record.note, record.done, record.created_at, record.updated_at);
    });
    return toRecord(record);
  }

  update(id, changes = {}) {
    const existing = this.get(id);
    if (!existing) throw new AppError("No record with that id.", 404);

    const next = {
      title: changes.title === undefined ? existing.title : this.#requireTitle(changes.title),
      note: changes.note === undefined ? existing.note : this.#normalizeNote(changes.note),
      done: changes.done === undefined ? existing.done : Boolean(changes.done),
      updatedAt: new Date().toISOString()
    };

    this.transaction(() => {
      this.db
        .prepare("UPDATE starter_records SET title = ?, note = ?, done = ?, updated_at = ? WHERE id = ?")
        .run(next.title, next.note, next.done ? 1 : 0, next.updatedAt, id);
    });
    return { ...existing, ...next };
  }

  remove(id) {
    const existing = this.get(id);
    if (!existing) throw new AppError("No record with that id.", 404);
    this.transaction(() => {
      this.db.prepare("DELETE FROM starter_records WHERE id = ?").run(id);
    });
    return existing;
  }

  /**
   * One mutation, one transaction. BEGIN IMMEDIATE takes the write lock up
   * front so two concurrent writers queue instead of one failing at COMMIT.
   */
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

  // The schema validator already checked shape; these enforce business rules,
  // which the HTTP entrance needs just as much as the tool entrance.
  #requireTitle(value) {
    const title = String(value ?? "").trim();
    if (!title) throw new AppError("A record needs a title.", 400);
    if (title.length > MAX_TITLE_LENGTH) {
      throw new AppError(`A title is limited to ${MAX_TITLE_LENGTH} characters.`, 400);
    }
    return title;
  }

  #normalizeNote(value) {
    const note = String(value ?? "").trim();
    if (note.length > MAX_NOTE_LENGTH) {
      throw new AppError(`A note is limited to ${MAX_NOTE_LENGTH} characters.`, 400);
    }
    return note;
  }
}

function text(value) {
  return { content: [{ type: "text", text: value }] };
}

function describe(record) {
  const note = record.note ? ` — ${record.note}` : "";
  return `${record.done ? "[done]" : "[open]"} ${record.title}${note} (id: ${record.id})`;
}

export default function createApp(context) {
  // context.appId / context.dataDir / context.logger — see references/doc.md.
  const store = new Store(context.dataDir);
  context.logger.info("ready");

  return {
    // Exactly the tools the manifest declares — no more, no fewer. A mismatch
    // fails the whole app load with a visible error in Settings.
    tools: {
      add: async (input) => {
        // The same tool accepts an Agent-authored title or a host-owned message
        // capture. Selection wins because that is what the owner highlighted.
        const capturedTitle = input.capture?.selection || input.capture?.text;
        const record = store.add(input.title ?? capturedTitle, input.note);
        // Optional sidebar badge. `?.` because an older host has no `badge`.
        context.badge?.set({ kind: "count", count: store.list("open").length });
        return {
          // `content` stays the authoritative text: it is what the model reads
          // and the only thing non-desktop surfaces show. The card is extra.
          ...text(`Added: ${record.title}`),
          structuredContent: record,
          changed: true,
          card: {
            title: record.title,
            subtitle: "Saved to Starter",
            fields: [{ label: "Status", value: record.done ? "Done" : "Open" }],
            icon: "bookmark-simple",
            // A card's only affordance is a deep link back into THIS app; a
            // link to any other app is dropped by the host.
            link: `molibot://miniapp/${context.appId}/record/${encodeURIComponent(record.id)}`
          }
        };
      },

      list: async (input) => {
        const status = input.status ?? "open";
        const records = store.list(status);
        const label = status === "done" ? "done" : status === "all" ? "" : "open ";
        return {
          ...text(
            records.length === 0
              ? `No ${label}records.`
              : `${records.length} ${label}record(s):\n${records.map(describe).join("\n")}`
          ),
          structuredContent: records
        };
      },

      update: async (input) => {
        const { id, ...changes } = input;
        const record = store.update(id, changes);
        return { ...text(`Updated: ${record.title}`), structuredContent: record, changed: true };
      },

      remove: async (input) => {
        const record = store.remove(input.id);
        return { ...text(`Deleted: ${record.title}`), structuredContent: record, changed: true };
      }
    },

    async handleHttp(request) {
      try {
        return route(store, request);
      } catch (cause) {
        // Domain failures become the status the UI expects; anything else is a
        // real bug and belongs in the service log as a 500.
        if (cause instanceof AppError) {
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

/**
 * The UI's API. `/_host/state` is answered by the host and never arrives here.
 * Set `changed: true` on every mutation — it advances the revision the panel polls.
 */
function route(store, request) {
  const { method, path: requestPath, query, body } = request;

  if (requestPath === "/records") {
    if (method === "GET") {
      return { body: { records: store.list(query.status?.[0] ?? "all") } };
    }
    if (method === "POST") {
      return { status: 201, body: { record: store.add(body?.title, body?.note) }, changed: true };
    }
    return { status: 405, body: { error: `${method} is not allowed on /records.` } };
  }

  const itemMatch = requestPath.match(/^\/records\/([^/]+)$/);
  if (itemMatch) {
    const id = itemMatch[1];
    if (method === "PATCH") {
      return { body: { record: store.update(id, body ?? {}) }, changed: true };
    }
    if (method === "DELETE") {
      return { body: { record: store.remove(id) }, changed: true };
    }
    return { status: 405, body: { error: `${method} is not allowed on a record.` } };
  }

  return { status: 404, body: { error: "Unknown Starter endpoint." } };
}
