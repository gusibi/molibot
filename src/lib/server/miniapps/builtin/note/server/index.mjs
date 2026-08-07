import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS note_items (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'text',
  color TEXT NOT NULL DEFAULT 'default',
  labels TEXT NOT NULL DEFAULT '[]',
  is_pinned INTEGER NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS note_items_state_idx ON note_items (is_archived, is_pinned, updated_at DESC);
`;

const MAX_TITLE_LENGTH = 300;
const MAX_CONTENT_LENGTH = 5000;
const ALLOWED_COLORS = new Set(["default", "yellow", "blue", "green", "red", "purple", "gray"]);
const ALLOWED_TYPES = new Set(["text", "checklist"]);

function openDatabase(dataDir) {
  const db = new DatabaseSync(path.join(dataDir, "note.sqlite"));
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

function parseLabels(raw) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toRecord(row) {
  return {
    id: row.id,
    title: row.title ?? "",
    content: row.content ?? "",
    type: row.type ?? "text",
    color: row.color ?? "default",
    labels: parseLabels(row.labels),
    isPinned: row.is_pinned === 1,
    isArchived: row.is_archived === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

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

  list(filters = {}) {
    const { query, label, color, pinned_only, archived = false } = filters;
    let sql = "SELECT * FROM note_items WHERE is_archived = ?";
    const params = [archived ? 1 : 0];

    if (pinned_only) {
      sql += " AND is_pinned = 1";
    }

    if (color && ALLOWED_COLORS.has(color)) {
      sql += " AND color = ?";
      params.push(color);
    }

    if (query && query.trim()) {
      sql += " AND (title LIKE ? OR content LIKE ?)";
      const q = `%${query.trim()}%`;
      params.push(q, q);
    }

    sql += " ORDER BY is_pinned DESC, updated_at DESC";

    const rows = this.db.prepare(sql).all(...params).map(toRecord);

    if (label && label.trim()) {
      const targetLabel = label.trim().toLowerCase();
      return rows.filter((r) => r.labels.some((l) => String(l).toLowerCase() === targetLabel));
    }

    return rows;
  }

  get(id) {
    const row = this.db.prepare("SELECT * FROM note_items WHERE id = ?").get(id);
    return row ? toRecord(row) : null;
  }

  create(data = {}) {
    const title = this.#cleanTitle(data.title);
    const content = this.#cleanContent(data.content);
    if (!title && !content) {
      throw new AppError("Note must have either a title or content.", 400);
    }

    const type = ALLOWED_TYPES.has(data.type) ? data.type : "text";
    const color = ALLOWED_COLORS.has(data.color) ? data.color : "default";
    const labels = this.#cleanLabels(data.labels);
    const isPinned = data.is_pinned ? 1 : 0;

    const now = new Date().toISOString();
    const id = randomUUID();

    this.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO note_items
          (id, title, content, type, color, labels, is_pinned, is_archived, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
        )
        .run(id, title, content, type, color, JSON.stringify(labels), isPinned, now, now);
    });

    return this.get(id);
  }

  update(id, changes = {}) {
    const existing = this.get(id);
    if (!existing) throw new AppError("Note not found.", 404);

    const title = changes.title !== undefined ? this.#cleanTitle(changes.title) : existing.title;
    const content = changes.content !== undefined ? this.#cleanContent(changes.content) : existing.content;

    if (!title && !content) {
      throw new AppError("Note cannot be updated to empty title and content.", 400);
    }

    const type = changes.type !== undefined ? (ALLOWED_TYPES.has(changes.type) ? changes.type : existing.type) : existing.type;
    const color = changes.color !== undefined ? (ALLOWED_COLORS.has(changes.color) ? changes.color : existing.color) : existing.color;
    const labels = changes.labels !== undefined ? this.#cleanLabels(changes.labels) : existing.labels;
    const isPinned = changes.is_pinned !== undefined ? (changes.is_pinned ? 1 : 0) : (existing.isPinned ? 1 : 0);
    const isArchived = changes.is_archived !== undefined ? (changes.is_archived ? 1 : 0) : (existing.isArchived ? 1 : 0);
    const now = new Date().toISOString();

    this.transaction(() => {
      this.db
        .prepare(
          `UPDATE note_items SET
            title = ?, content = ?, type = ?, color = ?, labels = ?,
            is_pinned = ?, is_archived = ?, updated_at = ?
          WHERE id = ?`
        )
        .run(title, content, type, color, JSON.stringify(labels), isPinned, isArchived, now, id);
    });

    return this.get(id);
  }

  delete(id) {
    const existing = this.get(id);
    if (!existing) throw new AppError("Note not found.", 404);
    this.transaction(() => {
      this.db.prepare("DELETE FROM note_items WHERE id = ?").run(id);
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
      } catch {}
      throw cause;
    }
  }

  close() {
    this.db.close();
  }

  #cleanTitle(val) {
    const t = String(val ?? "").trim();
    if (t.length > MAX_TITLE_LENGTH) {
      throw new AppError(`Title cannot exceed ${MAX_TITLE_LENGTH} chars.`, 400);
    }
    return t;
  }

  #cleanContent(val) {
    const c = String(val ?? "").trim();
    if (c.length > MAX_CONTENT_LENGTH) {
      throw new AppError(`Content cannot exceed ${MAX_CONTENT_LENGTH} chars.`, 400);
    }
    return c;
  }

  #cleanLabels(val) {
    if (!Array.isArray(val)) return [];
    return Array.from(
      new Set(
        val
          .map((item) => String(item ?? "").trim())
          .filter((item) => item.length > 0 && item.length <= 50)
      )
    );
  }
}

function text(msg) {
  return { content: [{ type: "text", text: msg }] };
}

function describeNote(n) {
  const flags = [];
  if (n.isPinned) flags.push("PINNED");
  if (n.isArchived) flags.push("ARCHIVED");
  const flagStr = flags.length ? ` [${flags.join(",")}]` : "";
  const labelStr = n.labels.length ? ` #${n.labels.join(" #")}` : "";
  const titleStr = n.title ? `"${n.title}"` : "(Untitled)";
  const snippet = n.content.length > 60 ? n.content.slice(0, 60) + "..." : n.content;
  return `${titleStr}${flagStr}${labelStr}: ${snippet} (id: ${n.id})`;
}

/**
 * The summary card the host renders beside a tool result.
 *
 * Display only: the one affordance is a deep link that opens this app's panel
 * at the note. The tool's `content` stays the authoritative text — that is what
 * the model reads, and all a non-desktop surface shows.
 */
function noteCard(appId, note, subtitle) {
  const preview = String(note.content ?? "").replace(/\s+/g, " ").trim();
  return {
    title: note.title || preview.slice(0, 60) || "(Untitled)",
    subtitle,
    icon: "note-blank",
    fields: [
      ...(note.labels?.length ? [{ label: "Labels", value: note.labels.join(", ") }] : []),
      ...(preview && note.title ? [{ label: "Preview", value: preview.slice(0, 120) }] : [])
    ],
    link: `molibot://miniapp/${appId}/note/${encodeURIComponent(note.id)}`
  };
}

export default function createApp(context) {
  const store = new Store(context.dataDir);
  context.logger.info("ready");

  return {
    tools: {
      create_note: async (input) => {
        // Two callers, one tool. The agent supplies title/content; the host
        // message action supplies `capture`. A selection wins over the whole
        // message because it is what the owner actually highlighted.
        const captured = input.capture?.selection || input.capture?.text;
        const note = store.create(
          captured && !input.title && !input.content
            ? { ...input, content: captured, labels: [...(input.labels ?? []), "chat"] }
            : input
        );
        return {
          ...text(`Created note: ${note.title || "(Untitled)"}`),
          structuredContent: note,
          changed: true,
          card: noteCard(context.appId, note, "Saved to Note")
        };
      },

      list_notes: async (input) => {
        const notes = store.list(input);
        if (notes.length === 0) {
          return { ...text("No matching notes found."), structuredContent: [] };
        }
        return {
          ...text(`Found ${notes.length} note(s):\n` + notes.map(describeNote).join("\n")),
          structuredContent: notes
        };
      },

      update_note: async (input) => {
        const { id, ...changes } = input;
        const note = store.update(id, changes);
        return {
          ...text(`Updated note: ${note.title || note.id}`),
          structuredContent: note,
          changed: true
        };
      },

      pin_note: async (input) => {
        const note = store.update(input.id, { is_pinned: input.is_pinned });
        return {
          ...text(`${input.is_pinned ? "Pinned" : "Unpinned"} note: ${note.title || note.id}`),
          structuredContent: note,
          changed: true
        };
      },

      archive_note: async (input) => {
        const note = store.update(input.id, { is_archived: input.is_archived });
        return {
          ...text(`${input.is_archived ? "Archived" : "Unarchived"} note: ${note.title || note.id}`),
          structuredContent: note,
          changed: true
        };
      },

      delete_note: async (input) => {
        const note = store.delete(input.id);
        return {
          ...text(`Deleted note: ${note.title || note.id}`),
          structuredContent: note,
          changed: true
        };
      }
    },

    async handleHttp(request) {
      try {
        return route(store, request);
      } catch (cause) {
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

function route(store, request) {
  const { method, path: requestPath, query, body } = request;

  if (requestPath === "/notes") {
    if (method === "GET") {
      const filters = {
        query: query.query?.[0],
        label: query.label?.[0],
        color: query.color?.[0],
        pinned_only: query.pinned_only?.[0] === "true",
        archived: query.archived?.[0] === "true"
      };
      return { body: { notes: store.list(filters) } };
    }

    if (method === "POST") {
      return { status: 201, body: { note: store.create(body ?? {}) }, changed: true };
    }

    return { status: 405, body: { error: `${method} is not allowed on /notes.` } };
  }

  const match = requestPath.match(/^\/notes\/([^/]+)$/);
  if (match) {
    const id = match[1];

    if (method === "GET") {
      const note = store.get(id);
      if (!note) return { status: 404, body: { error: "Note not found." } };
      return { body: { note } };
    }

    if (method === "PATCH") {
      return { body: { note: store.update(id, body ?? {}) }, changed: true };
    }

    if (method === "DELETE") {
      return { body: { note: store.delete(id) }, changed: true };
    }

    return { status: 405, body: { error: `${method} is not allowed on /notes/:id.` } };
  }

  return { status: 404, body: { error: "Unknown Google Note endpoint." } };
}
