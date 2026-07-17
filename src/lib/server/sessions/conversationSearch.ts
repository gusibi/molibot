import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { tokenizeWords } from "#mory";
import type { AuthorizedConversationSource } from "$lib/server/sessions/conversationAuthorization.js";

export interface ConversationSearchDocument {
  messageId: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  botId: string;
  channel: string;
  chatId?: string;
  projectId?: string;
  origin?: string;
  purpose: "chat" | "project" | "automation" | "internal";
  sourceKey: string;
}

export interface ConversationSearchQuery {
  query: string;
  authorizedSources: AuthorizedConversationSource[];
  from?: string;
  to?: string;
  channel?: string;
  projectId?: string;
  limit?: number;
}

export interface ConversationSearchHit {
  conversationId: string;
  conversationMessageId: string;
  role: "user" | "assistant";
  snippet: string;
  createdAt: string;
  channel: string;
  projectId?: string;
}

type ChangeKind = "upsert" | "delete-message" | "delete-conversation" | "revoke-source";

function searchTokens(input: string): string[] {
  const words = tokenizeWords(input).map((item) => item.toLowerCase()).filter(Boolean);
  const out = new Set(words);
  for (const word of words) {
    const chars = Array.from(word);
    if (chars.some((char) => /[\u3400-\u9fff]/u.test(char))) {
      for (let index = 0; index < chars.length - 1; index += 1) out.add(chars.slice(index, index + 2).join(""));
    }
  }
  return [...out];
}

export class ConversationSearchIndex {
  private readonly db: DatabaseSync;
  private readonly fts5Enabled: boolean;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS conversation_search_documents (
        message_id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        bot_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        chat_id TEXT,
        project_id TEXT,
        origin TEXT,
        purpose TEXT NOT NULL,
        source_key TEXT NOT NULL,
        change_seq INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS conversation_search_terms (
        term TEXT NOT NULL,
        message_id TEXT NOT NULL,
        PRIMARY KEY(term, message_id)
      );
      CREATE TABLE IF NOT EXISTS conversation_search_changes (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        source_key TEXT NOT NULL,
        conversation_id TEXT,
        message_id TEXT,
        payload_json TEXT,
        created_at TEXT NOT NULL,
        applied_at TEXT
      );
      CREATE TABLE IF NOT EXISTS conversation_search_tombstones (
        source_key TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        message_id TEXT NOT NULL DEFAULT '',
        change_seq INTEGER NOT NULL,
        PRIMARY KEY(source_key, conversation_id, message_id)
      );
      CREATE TABLE IF NOT EXISTS conversation_search_backfill (
        source_key TEXT PRIMARY KEY,
        cursor TEXT NOT NULL DEFAULT '',
        watermark INTEGER NOT NULL DEFAULT 0,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS conversation_search_scope_idx
        ON conversation_search_documents(bot_id, channel, chat_id, project_id, created_at);
    `);
    try {
      this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS conversation_search_fts USING fts5(
        message_id UNINDEXED, tokens, content, tokenize='unicode61'
      )`);
      this.fts5Enabled = true;
    } catch {
      // Some embedded Node SQLite builds omit FTS5. The token table preserves
      // the same pre-tokenized search and SQL authorization contract.
      this.fts5Enabled = false;
    }
  }

  close(): void { this.db.close(); }

  enqueueUpsert(document: ConversationSearchDocument): number {
    if (!document.content.trim() || (document.role !== "user" && document.role !== "assistant")) return 0;
    if (document.origin?.startsWith("internal:") || document.origin === "automation") return 0;
    if (document.purpose === "automation" || document.purpose === "internal") return 0;
    if (document.content.trimStart().startsWith("[EVENT:")) return 0;
    return this.enqueue("upsert", document.sourceKey, document.conversationId, document.messageId, document);
  }

  enqueueDeleteMessage(sourceKey: string, conversationId: string, messageId: string): number {
    return this.enqueue("delete-message", sourceKey, conversationId, messageId);
  }

  enqueueDeleteConversation(sourceKey: string, conversationId: string): number {
    return this.enqueue("delete-conversation", sourceKey, conversationId);
  }

  enqueueRevokeSource(sourceKey: string): number {
    return this.enqueue("revoke-source", sourceKey);
  }

  private enqueue(kind: ChangeKind, sourceKey: string, conversationId?: string, messageId?: string, payload?: unknown): number {
    const result = this.db.prepare(`INSERT INTO conversation_search_changes
      (kind, source_key, conversation_id, message_id, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(
        kind, sourceKey, conversationId ?? null, messageId ?? null,
        payload == null ? null : JSON.stringify(payload), new Date().toISOString()
      );
    const seq = Number(result.lastInsertRowid);
    this.apply(seq);
    return seq;
  }

  replayPending(limit = 500): number {
    const rows = this.db.prepare(`SELECT seq FROM conversation_search_changes
      WHERE applied_at IS NULL ORDER BY seq LIMIT ?`).all(limit) as Array<{ seq: number }>;
    for (const row of rows) this.apply(row.seq);
    return rows.length;
  }

  private apply(seq: number): void {
    const row = this.db.prepare("SELECT * FROM conversation_search_changes WHERE seq = ?").get(seq) as any;
    if (!row || row.applied_at) return;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (row.kind === "upsert") {
        const doc = JSON.parse(row.payload_json) as ConversationSearchDocument;
        const conversationTombstone = this.db.prepare(`SELECT change_seq FROM conversation_search_tombstones
          WHERE source_key = ? AND conversation_id = ? AND message_id = ''`).get(doc.sourceKey, doc.conversationId) as { change_seq: number } | undefined;
        const messageTombstone = this.db.prepare(`SELECT change_seq FROM conversation_search_tombstones
          WHERE source_key = ? AND conversation_id = ? AND message_id = ?`).get(doc.sourceKey, doc.conversationId, doc.messageId) as { change_seq: number } | undefined;
        if (!conversationTombstone && !messageTombstone) {
          this.deleteIndexedMessage(doc.messageId);
          this.db.prepare(`INSERT INTO conversation_search_documents
            (message_id, conversation_id, role, content, created_at, bot_id, channel, chat_id, project_id, origin, purpose, source_key, change_seq)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
              doc.messageId, doc.conversationId, doc.role, doc.content, doc.createdAt, doc.botId,
              doc.channel, doc.chatId ?? null, doc.projectId ?? null, doc.origin ?? null,
              doc.purpose, doc.sourceKey, seq
            );
          const terms = searchTokens(doc.content);
          if (this.fts5Enabled) {
            this.db.prepare("INSERT INTO conversation_search_fts(message_id, tokens, content) VALUES (?, ?, ?)")
              .run(doc.messageId, terms.join(" "), doc.content);
          }
          const insertTerm = this.db.prepare("INSERT OR IGNORE INTO conversation_search_terms(term, message_id) VALUES (?, ?)");
          for (const term of terms) insertTerm.run(term, doc.messageId);
        }
      } else if (row.kind === "delete-message") {
        this.db.prepare(`INSERT INTO conversation_search_tombstones(source_key, conversation_id, message_id, change_seq)
          VALUES (?, ?, ?, ?) ON CONFLICT(source_key, conversation_id, message_id)
          DO UPDATE SET change_seq = MAX(change_seq, excluded.change_seq)`).run(row.source_key, row.conversation_id, row.message_id, seq);
        this.deleteIndexedMessage(row.message_id);
      } else if (row.kind === "delete-conversation") {
        this.db.prepare(`INSERT INTO conversation_search_tombstones(source_key, conversation_id, message_id, change_seq)
          VALUES (?, ?, '', ?) ON CONFLICT(source_key, conversation_id, message_id)
          DO UPDATE SET change_seq = MAX(change_seq, excluded.change_seq)`).run(row.source_key, row.conversation_id, seq);
        const ids = this.db.prepare("SELECT message_id FROM conversation_search_documents WHERE source_key = ? AND conversation_id = ?")
          .all(row.source_key, row.conversation_id) as Array<{ message_id: string }>;
        for (const item of ids) this.deleteIndexedMessage(item.message_id);
      } else if (row.kind === "revoke-source") {
        const rows = this.db.prepare("SELECT DISTINCT conversation_id FROM conversation_search_documents WHERE source_key = ?")
          .all(row.source_key) as Array<{ conversation_id: string }>;
        for (const item of rows) {
          this.db.prepare(`INSERT INTO conversation_search_tombstones(source_key, conversation_id, message_id, change_seq)
            VALUES (?, ?, '', ?) ON CONFLICT(source_key, conversation_id, message_id)
            DO UPDATE SET change_seq = MAX(change_seq, excluded.change_seq)`).run(row.source_key, item.conversation_id, seq);
        }
        const ids = this.db.prepare("SELECT message_id FROM conversation_search_documents WHERE source_key = ?")
          .all(row.source_key) as Array<{ message_id: string }>;
        for (const item of ids) this.deleteIndexedMessage(item.message_id);
      }
      this.db.prepare("UPDATE conversation_search_changes SET applied_at = ? WHERE seq = ?")
        .run(new Date().toISOString(), seq);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private deleteIndexedMessage(messageId: string): void {
    if (this.fts5Enabled) this.db.prepare("DELETE FROM conversation_search_fts WHERE message_id = ?").run(messageId);
    this.db.prepare("DELETE FROM conversation_search_terms WHERE message_id = ?").run(messageId);
    this.db.prepare("DELETE FROM conversation_search_documents WHERE message_id = ?").run(messageId);
  }

  backfill(sourceKey: string, documents: ConversationSearchDocument[], batchSize = 200): { indexed: number; done: boolean; watermark: number } {
    const state = this.db.prepare("SELECT cursor, watermark FROM conversation_search_backfill WHERE source_key = ?")
      .get(sourceKey) as { cursor: string; watermark: number } | undefined;
    const watermark = state?.watermark ?? Number((this.db.prepare("SELECT COALESCE(MAX(seq), 0) AS seq FROM conversation_search_changes").get() as any).seq);
    const sorted = documents.filter((item) => item.sourceKey === sourceKey)
      .sort((a, b) => `${a.createdAt}:${a.messageId}`.localeCompare(`${b.createdAt}:${b.messageId}`));
    const batch = sorted.filter((item) => `${item.createdAt}:${item.messageId}` > (state?.cursor ?? "")).slice(0, batchSize);
    for (const item of batch) this.enqueueUpsert(item);
    const cursor = batch.length > 0 ? `${batch.at(-1)!.createdAt}:${batch.at(-1)!.messageId}` : (state?.cursor ?? "");
    const done = batch.length < batchSize;
    this.db.prepare(`INSERT INTO conversation_search_backfill(source_key, cursor, watermark, completed_at)
      VALUES (?, ?, ?, ?) ON CONFLICT(source_key) DO UPDATE SET cursor=excluded.cursor, watermark=excluded.watermark, completed_at=excluded.completed_at`)
      .run(sourceKey, cursor, watermark, done ? new Date().toISOString() : null);
    this.replayPending();
    return { indexed: batch.length, done, watermark };
  }

  reconcile(sourceKey: string, currentMessageIds: Set<string>): number {
    const rows = this.db.prepare("SELECT message_id, conversation_id FROM conversation_search_documents WHERE source_key = ?")
      .all(sourceKey) as Array<{ message_id: string; conversation_id: string }>;
    let removed = 0;
    for (const row of rows) {
      if (currentMessageIds.has(row.message_id)) continue;
      this.enqueueDeleteMessage(sourceKey, row.conversation_id, row.message_id);
      removed += 1;
    }
    return removed;
  }

  search(input: ConversationSearchQuery): ConversationSearchHit[] {
    const tokens = searchTokens(input.query);
    if (tokens.length === 0 || input.authorizedSources.length === 0) return [];
    const params: any[] = [];
    let fromSql: string;
    let rankSql: string;
    if (this.fts5Enabled) {
      params.push(tokens.map((token) => `"${token.replaceAll('"', '""')}"`).join(" OR "));
      fromSql = `conversation_search_fts f JOIN conversation_search_documents d ON d.message_id = f.message_id`;
      rankSql = "bm25(conversation_search_fts) ASC";
    } else {
      params.push(...tokens);
      fromSql = `conversation_search_terms f JOIN conversation_search_documents d ON d.message_id = f.message_id`;
      rankSql = "COUNT(DISTINCT f.term) DESC";
    }
    const scopeSql = input.authorizedSources.map((source) => {
      params.push(source.botId, source.channel);
      if (source.purpose === "project") {
        params.push(source.projectId ?? "");
        return "(d.bot_id = ? AND d.channel = ? AND d.project_id = ? AND d.purpose = 'project')";
      }
      params.push(source.chatId ?? "");
      return "(d.bot_id = ? AND d.channel = ? AND d.chat_id = ? AND d.project_id IS NULL AND d.purpose = 'chat')";
    }).join(" OR ");
    const where = [
      `(${scopeSql})`,
      "(d.origin IS NULL OR (d.origin NOT LIKE 'internal:%' AND d.origin <> 'automation'))",
      "d.purpose NOT IN ('automation','internal')"
    ];
    if (input.from) { where.push("d.created_at >= ?"); params.push(input.from); }
    if (input.to) { where.push("d.created_at <= ?"); params.push(input.to); }
    if (input.channel) { where.push("d.channel = ?"); params.push(input.channel); }
    if (input.projectId) { where.push("d.project_id = ?"); params.push(input.projectId); }
    params.push(Math.max(1, Math.min(50, input.limit ?? 10)));
    const matchSql = this.fts5Enabled
      ? "conversation_search_fts MATCH ?"
      : `f.term IN (${tokens.map(() => "?").join(", ")})`;
    const rows = this.db.prepare(`SELECT d.* FROM ${fromSql}
      WHERE ${matchSql} AND ${where.join(" AND ")}
      GROUP BY d.message_id
      ORDER BY ${rankSql}, d.created_at DESC LIMIT ?`).all(...params) as any[];
    return rows.map((row) => ({
      conversationId: row.conversation_id,
      conversationMessageId: row.message_id,
      role: row.role,
      snippet: String(row.content).length > 360 ? `${String(row.content).slice(0, 357)}...` : row.content,
      createdAt: row.created_at,
      channel: row.channel,
      projectId: row.project_id ?? undefined
    }));
  }
}

export { searchTokens as tokenizeConversationSearch };

const sharedIndexes = new Map<string, ConversationSearchIndex>();

export function getConversationSearchIndex(dbPath: string): ConversationSearchIndex {
  const existing = sharedIndexes.get(dbPath);
  if (existing) return existing;
  const created = new ConversationSearchIndex(dbPath);
  sharedIndexes.set(dbPath, created);
  return created;
}
