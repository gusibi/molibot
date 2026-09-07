import { DatabaseSync } from "node:sqlite";
import { ensureSqliteParentDir, storagePaths } from "$lib/server/infra/db/storage.js";

export type ExtractionReceiptStatus = "saved" | "no-useful-information" | "pending-review" | "failed";

export interface ExtractionDocRef {
  docId: string;
  title?: string;
}

export interface SessionExtractionReceipt {
  conversationId: string;
  channel: string;
  sessionId: string;
  projectId: string | null;
  ownerExternalUserId: string | null;
  botId: string;
  messageRevision: string;
  processedThroughId: string | null;
  processedThroughAt: string | null;
  status: ExtractionReceiptStatus;
  savedMemoryIds: string[];
  savedDocRefs: ExtractionDocRef[];
  pendingCandidateIds: string[];
  failureReasons: string[];
  suppressedCount: number;
  runKey: string;
  updatedAt: string;
}

interface ReceiptRow {
  conversation_id: string;
  channel: string;
  session_id: string;
  project_id: string | null;
  owner_external_user_id: string | null;
  bot_id: string;
  message_revision: string;
  processed_through_id: string | null;
  processed_through_at: string | null;
  status: string;
  saved_memory_ids: string;
  saved_doc_refs: string;
  pending_candidate_ids: string;
  failure_reasons: string;
  suppressed_count: number;
  run_key: string;
  updated_at: string;
}

function parseJsonArray<T>(value: string | null): T[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function toReceipt(row: ReceiptRow): SessionExtractionReceipt {
  return {
    conversationId: row.conversation_id,
    channel: row.channel,
    sessionId: row.session_id,
    projectId: row.project_id,
    ownerExternalUserId: row.owner_external_user_id,
    botId: row.bot_id,
    messageRevision: row.message_revision,
    processedThroughId: row.processed_through_id,
    processedThroughAt: row.processed_through_at,
    status: row.status as ExtractionReceiptStatus,
    savedMemoryIds: parseJsonArray<string>(row.saved_memory_ids),
    savedDocRefs: parseJsonArray<ExtractionDocRef>(row.saved_doc_refs),
    pendingCandidateIds: parseJsonArray<string>(row.pending_candidate_ids),
    failureReasons: parseJsonArray<string>(row.failure_reasons),
    suppressedCount: row.suppressed_count,
    runKey: row.run_key,
    updatedAt: row.updated_at
  };
}

/**
 * Session-owned extraction receipts: explicit per-Session range progress
 * (`messageRevision` + `processedThrough*`) plus durable result references.
 * A daily reflection watermark never stands in for a whole Session here —
 * later messages change the revision and the Session reads partially
 * processed again. Tests inject a temporary `dbFile`.
 */
export class SessionExtractionStore {
  private readonly db: DatabaseSync;

  constructor(dbFile: string = storagePaths.sessionsDbFile) {
    ensureSqliteParentDir(dbFile);
    this.db = new DatabaseSync(dbFile);
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_extraction_receipts (
        conversation_id TEXT PRIMARY KEY,
        channel TEXT NOT NULL DEFAULT '',
        session_id TEXT NOT NULL DEFAULT '',
        project_id TEXT,
        owner_external_user_id TEXT,
        bot_id TEXT NOT NULL DEFAULT '',
        message_revision TEXT NOT NULL DEFAULT '',
        processed_through_id TEXT,
        processed_through_at TEXT,
        status TEXT NOT NULL DEFAULT 'failed',
        saved_memory_ids TEXT NOT NULL DEFAULT '[]',
        saved_doc_refs TEXT NOT NULL DEFAULT '[]',
        pending_candidate_ids TEXT NOT NULL DEFAULT '[]',
        failure_reasons TEXT NOT NULL DEFAULT '[]',
        suppressed_count INTEGER NOT NULL DEFAULT 0,
        run_key TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT ''
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  get(conversationId: string): SessionExtractionReceipt | null {
    const id = String(conversationId ?? "").trim();
    if (!id) return null;
    const row = this.db
      .prepare("SELECT * FROM session_extraction_receipts WHERE conversation_id = ?")
      .get(id) as unknown as ReceiptRow | null;
    return row ? toReceipt(row) : null;
  }

  upsert(receipt: Omit<SessionExtractionReceipt, "updatedAt"> & { updatedAt?: string }): SessionExtractionReceipt {
    const updatedAt = receipt.updatedAt ?? new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO session_extraction_receipts
          (conversation_id, channel, session_id, project_id, owner_external_user_id, bot_id,
           message_revision, processed_through_id, processed_through_at, status,
           saved_memory_ids, saved_doc_refs, pending_candidate_ids, failure_reasons,
           suppressed_count, run_key, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(conversation_id) DO UPDATE SET
           channel = excluded.channel, session_id = excluded.session_id, project_id = excluded.project_id,
           owner_external_user_id = excluded.owner_external_user_id, bot_id = excluded.bot_id,
           message_revision = excluded.message_revision,
           processed_through_id = excluded.processed_through_id, processed_through_at = excluded.processed_through_at,
           status = excluded.status, saved_memory_ids = excluded.saved_memory_ids,
           saved_doc_refs = excluded.saved_doc_refs, pending_candidate_ids = excluded.pending_candidate_ids,
           failure_reasons = excluded.failure_reasons, suppressed_count = excluded.suppressed_count,
           run_key = excluded.run_key, updated_at = excluded.updated_at`
      )
      .run(
        receipt.conversationId,
        receipt.channel,
        receipt.sessionId,
        receipt.projectId,
        receipt.ownerExternalUserId,
        receipt.botId,
        receipt.messageRevision,
        receipt.processedThroughId,
        receipt.processedThroughAt,
        receipt.status,
        JSON.stringify(receipt.savedMemoryIds),
        JSON.stringify(receipt.savedDocRefs),
        JSON.stringify(receipt.pendingCandidateIds),
        JSON.stringify(receipt.failureReasons),
        receipt.suppressedCount,
        receipt.runKey,
        updatedAt
      );
    const stored = this.get(receipt.conversationId);
    if (!stored) throw new Error(`Failed to persist extraction receipt for ${receipt.conversationId}`);
    return stored;
  }
}
