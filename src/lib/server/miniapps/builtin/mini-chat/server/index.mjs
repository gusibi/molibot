import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const MAX_MESSAGE_LENGTH = 16_000;
const MODEL_CONTEXT_BYTES = 48 * 1024;
const MODEL_CONTEXT_MESSAGES = 80;
const AI_ERROR_CODES = new Set([
  "capability_not_declared",
  "capability_unavailable",
  "invalid_request",
  "rate_limited",
  "provider_failed",
  "aborted"
]);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'cancelled', 'failed', 'interrupted')),
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS mini_chat_conversations_updated_idx ON conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS mini_chat_messages_conversation_idx ON messages(conversation_id, created_at);
`;

class AppError extends Error {
  constructor(message, status = 400, code = "bad_request") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function openDatabase(dataDir) {
  const db = new DatabaseSync(path.join(dataDir, "mini-chat.sqlite"));
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(SCHEMA);
  const now = new Date().toISOString();
  db.prepare("UPDATE messages SET status = 'interrupted', error_code = 'service_restarted', updated_at = ? WHERE status = 'pending'").run(now);
  return db;
}

function messageRecord(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    status: row.status,
    usage: {
      inputTokens: Number(row.input_tokens || 0),
      outputTokens: Number(row.output_tokens || 0),
      totalTokens: Number(row.total_tokens || 0)
    },
    errorCode: row.error_code || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function conversationRecord(row) {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function cleanContent(value) {
  if (typeof value !== "string" || !value.trim()) throw new AppError("Message cannot be empty.");
  const content = value.trim();
  if (content.length > MAX_MESSAGE_LENGTH) throw new AppError(`Message cannot exceed ${MAX_MESSAGE_LENGTH} characters.`);
  return content;
}

function titleFrom(content) {
  const oneLine = content.replace(/\s+/g, " ").trim();
  return oneLine.length > 60 ? `${oneLine.slice(0, 57)}…` : oneLine;
}

class Store {
  constructor(dataDir) {
    this.db = openDatabase(dataDir);
  }

  transaction(run) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = run();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }

  listConversations() {
    return this.db.prepare("SELECT * FROM conversations ORDER BY updated_at DESC").all().map(conversationRecord);
  }

  getConversation(id) {
    const row = this.db.prepare("SELECT * FROM conversations WHERE id = ?").get(id);
    return row ? conversationRecord(row) : null;
  }

  createConversation(title = "New chat") {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare("INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .run(id, String(title || "New chat").trim().slice(0, 80) || "New chat", now, now);
    return this.getConversation(id);
  }

  deleteConversation(id) {
    const existing = this.getConversation(id);
    if (!existing) throw new AppError("Conversation not found.", 404, "not_found");
    this.db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
    return existing;
  }

  listMessages(conversationId) {
    return this.db.prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at, rowid")
      .all(conversationId).map(messageRecord);
  }

  appendTurn(conversationId, content) {
    const conversation = this.getConversation(conversationId);
    if (!conversation) throw new AppError("Conversation not found.", 404, "not_found");
    const now = new Date().toISOString();
    const userId = randomUUID();
    const assistantId = randomUUID();
    const count = Number(this.db.prepare("SELECT COUNT(*) AS count FROM messages WHERE conversation_id = ?").get(conversationId)?.count || 0);
    this.transaction(() => {
      this.db.prepare(`INSERT INTO messages
        (id, conversation_id, role, content, status, created_at, updated_at)
        VALUES (?, ?, 'user', ?, 'completed', ?, ?)`)
        .run(userId, conversationId, content, now, now);
      this.db.prepare(`INSERT INTO messages
        (id, conversation_id, role, content, status, created_at, updated_at)
        VALUES (?, ?, 'assistant', '', 'pending', ?, ?)`)
        .run(assistantId, conversationId, now, now);
      this.db.prepare("UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?")
        .run(count === 0 ? titleFrom(content) : conversation.title, now, conversationId);
    });
    return { userId, assistantId };
  }

  appendRetry(conversationId) {
    const last = this.db.prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(conversationId);
    if (!last || last.role !== "assistant" || !["failed", "cancelled", "interrupted"].includes(last.status)) {
      throw new AppError("Only an unfinished assistant reply can be retried.", 409, "not_retryable");
    }
    const previousUser = this.db.prepare("SELECT * FROM messages WHERE conversation_id = ? AND role = 'user' AND created_at <= ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
      .get(conversationId, last.created_at);
    if (!previousUser) throw new AppError("The user message for this reply is unavailable.", 409, "not_retryable");
    const now = new Date().toISOString();
    const assistantId = randomUUID();
    this.db.prepare(`INSERT INTO messages
      (id, conversation_id, role, content, status, created_at, updated_at)
      VALUES (?, ?, 'assistant', '', 'pending', ?, ?)`)
      .run(assistantId, conversationId, now, now);
    this.db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(now, conversationId);
    return { assistantId };
  }

  modelMessages(conversationId) {
    const rows = this.db.prepare(`SELECT role, content FROM messages
      WHERE conversation_id = ? AND status = 'completed' AND content <> ''
      ORDER BY created_at, rowid`).all(conversationId);
    const merged = [];
    for (const row of rows) {
      const previous = merged.at(-1);
      if (previous?.role === row.role) previous.content += `\n\n${row.content}`;
      else merged.push({ role: row.role, content: row.content });
    }
    while (merged[0]?.role === "assistant") merged.shift();
    while (merged.length > MODEL_CONTEXT_MESSAGES) {
      merged.shift();
      if (merged[0]?.role === "assistant") merged.shift();
    }
    let bytes = merged.reduce((total, item) => total + Buffer.byteLength(item.content, "utf8"), 0);
    while (bytes > MODEL_CONTEXT_BYTES && merged.length > 1) {
      const removed = merged.shift();
      bytes -= Buffer.byteLength(removed.content, "utf8");
      if (merged[0]?.role === "assistant") {
        const paired = merged.shift();
        bytes -= Buffer.byteLength(paired.content, "utf8");
      }
    }
    if (merged.at(-1)?.role !== "user") throw new AppError("Conversation has no pending user turn.", 409, "invalid_history");
    return merged;
  }

  completeAssistant(id, result) {
    const now = new Date().toISOString();
    this.transaction(() => {
      this.db.prepare(`UPDATE messages SET content = ?, status = 'completed', input_tokens = ?,
        output_tokens = ?, total_tokens = ?, error_code = NULL, updated_at = ? WHERE id = ?`)
        .run(result.text, result.usage.inputTokens, result.usage.outputTokens, result.usage.totalTokens, now, id);
      this.db.prepare("UPDATE conversations SET updated_at = ? WHERE id = (SELECT conversation_id FROM messages WHERE id = ?)")
        .run(now, id);
    });
  }

  failAssistant(id, status, code) {
    const now = new Date().toISOString();
    this.db.prepare("UPDATE messages SET status = ?, error_code = ?, updated_at = ? WHERE id = ? AND status = 'pending'")
      .run(status, code, now, id);
  }

  close() {
    this.db.close();
  }
}

function response(status, body, changed = false) {
  return { status, body, changed };
}

function routeParts(requestPath) {
  return requestPath.split("/").filter(Boolean);
}

export default function createApp(context) {
  const store = new Store(context.dataDir);
  const active = new Map();
  context.logger.info("ready");

  function visibleMessages(conversationId) {
    const messages = store.listMessages(conversationId);
    const running = active.get(conversationId);
    if (!running?.text) return messages;
    return messages.map((message) => message.id === running.assistantId
      ? { ...message, content: running.text }
      : message);
  }

  async function generate(conversationId, running) {
    try {
      const result = await context.ai.chat({
        messages: store.modelMessages(conversationId),
        maxTokens: 2048,
        signal: running.controller.signal,
        onTextDelta: (delta) => { running.text += delta; }
      });
      store.completeAssistant(running.assistantId, result);
    } catch (error) {
      const aborted = running.controller.signal.aborted || error?.code === "aborted";
      store.failAssistant(running.assistantId, aborted ? "cancelled" : "failed", String(error?.code || "provider_failed"));
      context.logger.error("ai_request_failed", {
        conversationId,
        code: String(error?.code || "provider_failed"),
        message: error instanceof Error ? error.message : "Model request failed."
      });
      throw error;
    } finally {
      active.delete(conversationId);
    }
  }

  return {
    tools: {},
    async handleHttp(request) {
      try {
        const parts = routeParts(request.path);
        if (request.method === "GET" && parts.length === 1 && parts[0] === "conversations") {
          return response(200, { conversations: store.listConversations() });
        }
        if (request.method === "POST" && parts.length === 1 && parts[0] === "conversations") {
          return response(201, { conversation: store.createConversation(request.body?.title) }, true);
        }
        if (parts[0] !== "conversations" || !parts[1]) throw new AppError("Route not found.", 404, "not_found");
        const conversationId = parts[1];

        if (request.method === "GET" && parts.length === 3 && parts[2] === "messages") {
          if (!store.getConversation(conversationId)) throw new AppError("Conversation not found.", 404, "not_found");
          return response(200, { conversation: store.getConversation(conversationId), messages: visibleMessages(conversationId) });
        }
        if (request.method === "DELETE" && parts.length === 2) {
          if (active.has(conversationId)) throw new AppError("Stop the active reply before deleting this conversation.", 409, "busy");
          return response(200, { conversation: store.deleteConversation(conversationId) }, true);
        }
        if (request.method === "POST" && parts.length === 3 && parts[2] === "messages") {
          if (active.has(conversationId)) throw new AppError("A reply is already being generated.", 409, "busy");
          const content = cleanContent(request.body?.content);
          const { assistantId } = store.appendTurn(conversationId, content);
          const running = { controller: new AbortController(), assistantId, text: "" };
          active.set(conversationId, running);
          await generate(conversationId, running);
          return response(201, { conversation: store.getConversation(conversationId), messages: store.listMessages(conversationId) }, true);
        }
        if (request.method === "POST" && parts.length === 3 && parts[2] === "retry") {
          if (active.has(conversationId)) throw new AppError("A reply is already being generated.", 409, "busy");
          const { assistantId } = store.appendRetry(conversationId);
          const running = { controller: new AbortController(), assistantId, text: "" };
          active.set(conversationId, running);
          await generate(conversationId, running);
          return response(201, { conversation: store.getConversation(conversationId), messages: store.listMessages(conversationId) }, true);
        }
        if (request.method === "POST" && parts.length === 3 && parts[2] === "cancel") {
          const running = active.get(conversationId);
          if (!running) return response(200, { cancelled: false });
          running.controller.abort();
          store.failAssistant(running.assistantId, "cancelled", "aborted");
          return response(200, { cancelled: true }, true);
        }
        throw new AppError("Route not found.", 404, "not_found");
      } catch (error) {
        const isAiError = AI_ERROR_CODES.has(String(error?.code || ""));
        return response(
          Number.isInteger(error?.status) ? error.status : 500,
          {
            error: error instanceof AppError || isAiError ? error.message : "Mini Chat request failed.",
            code: String(error?.code || "internal_error")
          }
        );
      }
    },
    dispose() {
      for (const running of active.values()) running.controller.abort();
      active.clear();
      store.close();
    }
  };
}
