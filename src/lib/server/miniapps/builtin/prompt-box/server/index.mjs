import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS prompts (
  id TEXT PRIMARY KEY,
  remote_id TEXT,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  example_image_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  synced_at TEXT
);
CREATE INDEX IF NOT EXISTS prompts_updated_idx ON prompts (updated_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

const DEFAULT_API_URL = "https://pb.onlinestool.com/api";

function openDatabase(dataDir) {
  const db = new DatabaseSync(path.join(dataDir, "prompt-box.sqlite"));
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(SCHEMA);
  try {
    db.exec("ALTER TABLE prompts ADD COLUMN example_image_url TEXT;");
  } catch {
    // Column already exists
  }
  return db;
}

function parseTags(raw) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t) => typeof t === "string" && t.trim()) : [];
  } catch {
    return [];
  }
}

function toRecord(row) {
  let exampleImageUrl = row.example_image_url ?? undefined;
  if (!exampleImageUrl) {
    const combined = `${row.description || ""}\n${row.content || ""}`;
    const tutuMatch = combined.match(/(https?:\/\/tutu\.onlinestool\.com\/[^\s"'<>\)]+\.(?:png|jpg|jpeg|gif|webp|svg))/i);
    const mdMatch = combined.match(/!\[.*?\]\((https?:\/\/[^\s\)]+)\)/i);
    const imgMatch = combined.match(/(https?:\/\/[^\s"'<>\)]+\.(?:png|jpg|jpeg|gif|webp|svg)(?:\?[^\s"'<>\)]*)?)/i);
    if (tutuMatch) exampleImageUrl = tutuMatch[1].replace(/^https?:/i, (m) => m.toLowerCase());
    else if (mdMatch) exampleImageUrl = mdMatch[1].replace(/^https?:/i, (m) => m.toLowerCase());
    else if (imgMatch) exampleImageUrl = imgMatch[1].replace(/^https?:/i, (m) => m.toLowerCase());
  }

  return {
    id: row.id,
    remoteId: row.remote_id ?? undefined,
    title: row.title ?? "",
    content: row.content ?? "",
    description: row.description ?? "",
    tags: parseTags(row.tags),
    exampleImageUrl,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncedAt: row.synced_at ?? undefined
  };
}

class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

class Store {
  constructor(dataDir) {
    this.db = openDatabase(dataDir);
  }

  list(filters = {}) {
    const { query, tag } = filters;
    let sql = "SELECT * FROM prompts WHERE 1=1";
    const params = [];

    if (query && query.trim()) {
      sql += " AND (title LIKE ? OR content LIKE ? OR description LIKE ?)";
      const q = `%${query.trim()}%`;
      params.push(q, q, q);
    }

    sql += " ORDER BY updated_at DESC";

    const rows = this.db.prepare(sql).all(...params).map(toRecord);

    if (tag && tag.trim()) {
      const targetTag = tag.trim().toLowerCase();
      return rows.filter((r) => r.tags.some((t) => String(t).toLowerCase() === targetTag));
    }

    return rows;
  }

  get(id) {
    const row = this.db.prepare("SELECT * FROM prompts WHERE id = ?").get(id);
    return row ? toRecord(row) : null;
  }

  getByRemoteId(remoteId) {
    if (!remoteId) return null;
    const row = this.db.prepare("SELECT * FROM prompts WHERE remote_id = ?").get(remoteId);
    return row ? toRecord(row) : null;
  }

  create(data = {}) {
    const title = this.#cleanString(data.title, 300);
    const content = this.#cleanString(data.content, 10000);
    const description = this.#cleanString(data.description, 1000);
    const tags = this.#cleanTags(data.tags);
    const exampleImageUrl = this.#extractImageUrl(data);

    if (!title && !content) {
      throw new AppError("Prompt must have either a title or content.", 400);
    }

    const id = data.id && typeof data.id === "string" && data.id.trim() ? data.id.trim() : randomUUID();
    const remoteId = data.remoteId ? String(data.remoteId) : (data.remote_id ? String(data.remote_id) : null);
    const now = new Date().toISOString();
    const createdAt = data.createdAt || data.created_at || now;
    const updatedAt = data.updatedAt || data.updated_at || now;
    const syncedAt = data.syncedAt || data.synced_at || null;

    this.db.prepare(`
      INSERT INTO prompts (id, remote_id, title, content, description, tags, example_image_url, created_at, updated_at, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, remoteId, title, content, description, JSON.stringify(tags), exampleImageUrl, createdAt, updatedAt, syncedAt);

    return this.get(id);
  }

  update(id, changes = {}) {
    const existing = this.get(id);
    if (!existing) {
      throw new AppError(`Prompt "${id}" not found.`, 404);
    }

    const title = changes.title !== undefined ? this.#cleanString(changes.title, 300) : existing.title;
    const content = changes.content !== undefined ? this.#cleanString(changes.content, 10000) : existing.content;
    const description = changes.description !== undefined ? this.#cleanString(changes.description, 1000) : existing.description;
    const tags = changes.tags !== undefined ? this.#cleanTags(changes.tags) : existing.tags;
    const exampleImageUrl = changes.exampleImageUrl !== undefined
      ? this.#cleanUrl(changes.exampleImageUrl)
      : (changes.example_image_url !== undefined
          ? this.#cleanUrl(changes.example_image_url)
          : (this.#extractImageUrl(changes) || existing.exampleImageUrl || null));
    const remoteId = changes.remoteId !== undefined ? (changes.remoteId ? String(changes.remoteId) : null) : (existing.remoteId ?? null);
    const syncedAt = changes.syncedAt !== undefined ? changes.syncedAt : (existing.syncedAt ?? null);
    const updatedAt = new Date().toISOString();

    if (!title && !content) {
      throw new AppError("Prompt must have either a title or content.", 400);
    }

    this.db.prepare(`
      UPDATE prompts
      SET remote_id = ?, title = ?, content = ?, description = ?, tags = ?, example_image_url = ?, updated_at = ?, synced_at = ?
      WHERE id = ?
    `).run(remoteId, title, content, description, JSON.stringify(tags), exampleImageUrl, updatedAt, syncedAt, id);

    return this.get(id);
  }

  upsertFromRemote(remoteItem) {
    const remoteId = remoteItem.id ? String(remoteItem.id) : null;
    const title = this.#cleanString(remoteItem.title, 300);
    const content = this.#cleanString(remoteItem.content, 10000);
    const description = this.#cleanString(remoteItem.description, 1000);
    const tags = this.#cleanTags(remoteItem.tags);
    const exampleImageUrl = this.#extractImageUrl(remoteItem);
    const now = new Date().toISOString();
    const createdAt = remoteItem.createdAt || remoteItem.created_at || now;
    const updatedAt = remoteItem.updatedAt || remoteItem.updated_at || now;

    // Check if we already have this prompt by remote_id or by exact title & content
    let existing = remoteId ? this.getByRemoteId(remoteId) : null;
    if (!existing && title) {
      const match = this.db.prepare("SELECT * FROM prompts WHERE title = ? AND content = ? LIMIT 1").get(title, content);
      if (match) existing = toRecord(match);
    }

    if (existing) {
      this.db.prepare(`
        UPDATE prompts
        SET remote_id = ?, title = ?, content = ?, description = ?, tags = ?, example_image_url = ?, updated_at = ?, synced_at = ?
        WHERE id = ?
      `).run(remoteId, title, content, description, JSON.stringify(tags), exampleImageUrl || existing.exampleImageUrl || null, updatedAt, now, existing.id);
      return this.get(existing.id);
    } else {
      const id = randomUUID();
      this.db.prepare(`
        INSERT INTO prompts (id, remote_id, title, content, description, tags, example_image_url, created_at, updated_at, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, remoteId, title, content, description, JSON.stringify(tags), exampleImageUrl, createdAt, updatedAt, now);
      return this.get(id);
    }
  }

  delete(id) {
    const existing = this.get(id);
    if (!existing) {
      throw new AppError(`Prompt "${id}" not found.`, 404);
    }
    this.db.prepare("DELETE FROM prompts WHERE id = ?").run(id);
    return existing;
  }

  getSetting(key, defaultValue = "") {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
    return row ? String(row.value) : defaultValue;
  }

  setSetting(key, value) {
    this.db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, String(value));
  }

  getSettings() {
    const apiKey = this.getSetting("api_key", "");
    const apiUrl = this.getSetting("api_url", DEFAULT_API_URL);
    const lastSyncTime = this.getSetting("last_sync_time", "");

    return {
      apiKey,
      apiKeyMasked: apiKey ? `${apiKey.slice(0, 4)}••••${apiKey.slice(-4)}` : "",
      apiKeyPresent: Boolean(apiKey),
      apiUrl: apiUrl || DEFAULT_API_URL,
      lastSyncTime: lastSyncTime || null
    };
  }

  saveSettings(payload = {}) {
    if (payload.apiKey !== undefined) {
      this.setSetting("api_key", String(payload.apiKey).trim());
    }
    if (payload.apiUrl !== undefined) {
      const cleanUrl = String(payload.apiUrl).trim().replace(/\/+$/, "");
      this.setSetting("api_url", cleanUrl || DEFAULT_API_URL);
    }
    return this.getSettings();
  }

  async syncWithRemote(fetchImpl = globalThis.fetch) {
    const settings = this.getSettings();
    if (!settings.apiKey) {
      throw new AppError("Please configure your API Key in settings before syncing.", 400);
    }

    // Step 1: Push unsynced local prompts to remote server
    let pushedCount = 0;
    const unsyncedLocals = this.db.prepare("SELECT * FROM prompts WHERE remote_id IS NULL").all().map(toRecord);
    for (const local of unsyncedLocals) {
      const remote = await this.pushToRemote(local, fetchImpl);
      if (remote?.id) {
        this.db.prepare("UPDATE prompts SET remote_id = ?, synced_at = ? WHERE id = ?")
          .run(String(remote.id), new Date().toISOString(), local.id);
        pushedCount++;
      }
    }

    // Step 2: Pull remote prompts and merge into local
    const targetUrl = `${settings.apiUrl}/prompts`;
    let response;
    try {
      response = await fetchImpl(targetUrl, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": settings.apiKey
        }
      });
    } catch (netErr) {
      throw new AppError(`Network error while connecting to ${targetUrl}: ${netErr.message}`, 502);
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new AppError(`Failed to fetch prompts from remote (HTTP ${response.status}): ${errorText || response.statusText}`, response.status);
    }

    const result = await response.json().catch(() => ({}));
    const rawList = Array.isArray(result.data) ? result.data : (Array.isArray(result) ? result : []);

    let pulledCount = 0;
    for (const item of rawList) {
      if (item && typeof item === "object" && (item.title || item.content)) {
        this.upsertFromRemote(item);
        pulledCount++;
      }
    }

    const now = new Date().toISOString();
    this.setSetting("last_sync_time", now);

    return {
      success: true,
      pushedCount,
      pulledCount,
      syncedCount: pulledCount + pushedCount,
      lastSyncTime: now
    };
  }

  async pushToRemote(promptData, fetchImpl = globalThis.fetch) {
    const settings = this.getSettings();
    if (!settings.apiKey) return null;

    const targetUrl = `${settings.apiUrl}/prompts`;
    try {
      const response = await fetchImpl(targetUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": settings.apiKey
        },
        body: JSON.stringify({
          title: promptData.title,
          content: promptData.content,
          description: promptData.description,
          tags: promptData.tags
        })
      });
      if (response.ok) {
        const json = await response.json().catch(() => ({}));
        return json.data || json;
      }
    } catch {
      // Remote push failure shouldn't fail local create
    }
    return null;
  }

  #cleanString(value, max) {
    if (typeof value !== "string") return "";
    return value.trim().slice(0, max);
  }

  #cleanTags(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((t) => (typeof t === "string" ? t.trim() : ""))
      .filter(Boolean)
      .slice(0, 20);
  }

  #cleanUrl(raw) {
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    return trimmed.replace(/^https?:/i, (m) => m.toLowerCase());
  }

  #extractImageUrl(item) {
    if (!item || typeof item !== "object") return null;
    const raw =
      item.example_image_url ||
      item.exampleImageUrl ||
      item.image_url ||
      item.imageUrl ||
      item.cover_image_url ||
      item.coverImageUrl ||
      item.image;
    if (typeof raw === "string" && raw.trim()) {
      return this.#cleanUrl(raw);
    }
    const combined = `${item.description || ""}\n${item.content || ""}`;
    const mdMatch = combined.match(/!\[.*?\]\((https?:\/\/[^\s\)]+)\)/i);
    if (mdMatch) return this.#cleanUrl(mdMatch[1]);
    const tutuMatch = combined.match(/(https?:\/\/tutu\.onlinestool\.com\/[^\s"'<>\)]+)/i);
    if (tutuMatch) return this.#cleanUrl(tutuMatch[1]);
    const imgMatch = combined.match(/(https?:\/\/[^\s"'<>\)]+\.(?:png|jpg|jpeg|gif|webp|svg)(?:\?[^\s"'<>\)]*)?)/i);
    if (imgMatch) return this.#cleanUrl(imgMatch[1]);
    return null;
  }

  close() {
    this.db.close();
  }
}

function promptCard(appId, prompt, title) {
  const fields = [];
  if (prompt.description) {
    fields.push({ label: "Description", value: prompt.description });
  }
  if (prompt.tags && prompt.tags.length > 0) {
    fields.push({ label: "Tags", value: prompt.tags.join(", ") });
  }
  const preview = prompt.content ? prompt.content.replace(/\s+/g, " ").slice(0, 100) : "";
  if (preview) {
    fields.push({ label: "Content", value: preview });
  }

  return {
    title: title || "Saved to Prompt Box",
    subtitle: prompt.title || "Untitled Prompt",
    fields,
    icon: "sparkle",
    link: `molibot://miniapp/${appId}?promptId=${encodeURIComponent(prompt.id)}`
  };
}

function formatPromptSummary(prompt) {
  const tagsStr = prompt.tags && prompt.tags.length > 0 ? ` [${prompt.tags.join(", ")}]` : "";
  return `- **${prompt.title || "Untitled"}**${tagsStr}\n  ${prompt.content.replace(/\n+/g, " ").slice(0, 120)}`;
}

function extractPromptFromCapture(capture) {
  const text = capture.selection || capture.text || "";
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  let title = lines[0] || "Captured Prompt";
  if (title.length > 80) {
    title = title.slice(0, 77) + "...";
  }
  // Strip title line if text has multiple lines, otherwise keep content as full text
  const content = text.trim();
  return {
    title,
    content,
    description: `Captured from ${capture.role === "assistant" ? "AI response" : "chat message"}`,
    tags: ["captured"]
  };
}

export default function createPromptBox(context) {
  const store = new Store(context.dataDir);

  return {
    tools: {
      save_prompt: async (input) => {
        let promptInput = { ...input };

        if (input.capture) {
          const fromCapture = extractPromptFromCapture(input.capture);
          promptInput = {
            title: input.title || fromCapture.title,
            content: input.content || fromCapture.content,
            description: input.description || fromCapture.description,
            tags: input.tags || fromCapture.tags
          };
        }

        const prompt = store.create(promptInput);

        // Best-effort remote push if API key is present
        store.pushToRemote(prompt).then((remote) => {
          if (remote?.id) {
            try {
              store.update(prompt.id, { remoteId: remote.id, syncedAt: new Date().toISOString() });
            } catch {}
          }
        }).catch(() => {});

        return {
          content: [{ type: "text", text: `Saved prompt: "${prompt.title}" to Prompt Box.` }],
          structuredContent: prompt,
          changed: true,
          card: promptCard(context.appId, prompt, "Saved to Prompt Box")
        };
      },

      list_prompts: async (input = {}) => {
        const prompts = store.list(input);
        if (prompts.length === 0) {
          return {
            content: [{ type: "text", text: "No matching prompts found in Prompt Box." }],
            structuredContent: []
          };
        }
        return {
          content: [
            {
              type: "text",
              text: `Found ${prompts.length} prompt(s) in Prompt Box:\n` + prompts.map(formatPromptSummary).join("\n")
            }
          ],
          structuredContent: prompts
        };
      },

      get_prompt: async (input) => {
        if (!input.id) throw new AppError("Prompt ID is required.", 400);
        const prompt = store.get(input.id);
        if (!prompt) throw new AppError(`Prompt "${input.id}" not found.`, 404);
        return {
          content: [
            {
              type: "text",
              text: `# ${prompt.title}\n\n${prompt.description ? `*${prompt.description}*\n\n` : ""}Tags: ${prompt.tags.join(", ") || "none"}\n\n\`\`\`\n${prompt.content}\n\`\`\``
            }
          ],
          structuredContent: prompt
        };
      },

      update_prompt: async (input) => {
        const { id, ...changes } = input;
        if (!id) throw new AppError("Prompt ID is required.", 400);
        const prompt = store.update(id, changes);
        return {
          content: [{ type: "text", text: `Updated prompt: "${prompt.title}".` }],
          structuredContent: prompt,
          changed: true
        };
      },

      delete_prompt: async (input) => {
        if (!input.id) throw new AppError("Prompt ID is required.", 400);
        const prompt = store.delete(input.id);
        return {
          content: [{ type: "text", text: `Deleted prompt: "${prompt.title}".` }],
          structuredContent: prompt,
          changed: true
        };
      },

      sync_prompts: async () => {
        const result = await store.syncWithRemote();
        return {
          content: [{ type: "text", text: `Successfully synced ${result.syncedCount} prompt(s) with remote server at ${result.lastSyncTime}.` }],
          structuredContent: result,
          changed: true
        };
      }
    },

    async handleHttp(request) {
      try {
        return await route(store, request);
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

async function route(store, request) {
  const { method, path: requestPath, query, body } = request;

  if (requestPath === "/prompts") {
    if (method === "GET") {
      const filters = {
        query: query.query?.[0],
        tag: query.tag?.[0]
      };
      return { body: { prompts: store.list(filters) } };
    }

    if (method === "POST") {
      const prompt = store.create(body ?? {});
      store.pushToRemote(prompt).then((remote) => {
        if (remote?.id) {
          try {
            store.update(prompt.id, { remoteId: remote.id, syncedAt: new Date().toISOString() });
          } catch {}
        }
      }).catch(() => {});
      return { status: 201, body: { prompt }, changed: true };
    }

    return { status: 405, body: { error: `${method} is not allowed on /prompts.` } };
  }

  const promptMatch = requestPath.match(/^\/prompts\/([^/]+)$/);
  if (promptMatch) {
    const id = promptMatch[1];

    if (method === "GET") {
      const prompt = store.get(id);
      if (!prompt) return { status: 404, body: { error: "Prompt not found." } };
      return { body: { prompt } };
    }

    if (method === "PATCH") {
      return { body: { prompt: store.update(id, body ?? {}) }, changed: true };
    }

    if (method === "DELETE") {
      return { body: { prompt: store.delete(id) }, changed: true };
    }

    return { status: 405, body: { error: `${method} is not allowed on /prompts/:id.` } };
  }

  if (requestPath === "/settings") {
    if (method === "GET") {
      return { body: { settings: store.getSettings() } };
    }
    if (method === "POST") {
      return { body: { settings: store.saveSettings(body ?? {}) }, changed: true };
    }
    return { status: 405, body: { error: `${method} is not allowed on /settings.` } };
  }

  if (requestPath === "/sync" && method === "POST") {
    const syncResult = await store.syncWithRemote();
    return { body: syncResult, changed: true };
  }

  return { status: 404, body: { error: "Unknown Prompt Box endpoint." } };
}
