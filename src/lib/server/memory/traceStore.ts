import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { ensureSqliteParentDir, storagePaths } from "$lib/server/infra/db/storage.js";
import type { MemoryInjectionItem } from "$lib/server/memory/types.js";

export type MemoryWriteOperation = "added" | "updated";

export interface MemoryWriteReceipt {
  memoryId: string;
  operation: MemoryWriteOperation;
  snapshot: {
    displayText: string;
    content: string;
    layer: string;
    type?: string;
    confidence?: number;
    tags: string[];
    updatedAt: string;
  };
}

export type MemoryTraceFeedbackValue = "helpful" | "irrelevant" | "incorrect" | "expired" | "too_private";

export interface MemoryTurnTrace {
  id: string;
  runId: string;
  sessionId: string;
  chatId: string;
  assistantSourceEntryId: string;
  query: string;
  retrievedCount: number;
  selectedCount: number;
  injectedItems: MemoryInjectionItem[];
  writeReceipts: MemoryWriteReceipt[];
  createdAt: string;
}

type TraceRow = {
  id: string;
  run_id: string;
  session_id: string;
  chat_id: string;
  assistant_source_entry_id: string;
  query: string;
  retrieved_count: number;
  selected_count: number;
  injected_json: string;
  writes_json: string;
  created_at: string;
};

export class SqliteMemoryTraceStore {
  private readonly db: DatabaseSync;

  constructor(dbFile = storagePaths.settingsDbFile) {
    ensureSqliteParentDir(dbFile);
    this.db = new DatabaseSync(dbFile);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_turn_traces (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        assistant_source_entry_id TEXT NOT NULL UNIQUE,
        query TEXT NOT NULL,
        retrieved_count INTEGER NOT NULL,
        selected_count INTEGER NOT NULL,
        injected_json TEXT NOT NULL,
        writes_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memory_turn_traces_run_id ON memory_turn_traces(run_id);
      CREATE INDEX IF NOT EXISTS idx_memory_turn_traces_session ON memory_turn_traces(session_id, created_at);

      CREATE TABLE IF NOT EXISTS memory_trace_feedback (
        trace_id TEXT NOT NULL,
        memory_id TEXT NOT NULL,
        value TEXT NOT NULL,
        comment TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY(trace_id, memory_id),
        FOREIGN KEY(trace_id) REFERENCES memory_turn_traces(id) ON DELETE CASCADE
      );
    `);
  }

  save(input: Omit<MemoryTurnTrace, "id"> & { id?: string }): MemoryTurnTrace {
    const trace: MemoryTurnTrace = { ...input, id: input.id ?? randomUUID() };
    this.db.prepare(`
      INSERT INTO memory_turn_traces (
        id, run_id, session_id, chat_id, assistant_source_entry_id, query,
        retrieved_count, selected_count, injected_json, writes_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(assistant_source_entry_id) DO UPDATE SET
        run_id = excluded.run_id,
        injected_json = excluded.injected_json,
        writes_json = excluded.writes_json
    `).run(
      trace.id,
      trace.runId,
      trace.sessionId,
      trace.chatId,
      trace.assistantSourceEntryId,
      trace.query,
      trace.retrievedCount,
      trace.selectedCount,
      JSON.stringify(trace.injectedItems),
      JSON.stringify(trace.writeReceipts),
      trace.createdAt
    );
    return this.getBySourceEntryId(trace.assistantSourceEntryId) ?? trace;
  }

  getBySourceEntryId(sourceEntryId: string): MemoryTurnTrace | null {
    const row = this.db.prepare(`
      SELECT * FROM memory_turn_traces WHERE assistant_source_entry_id = ?
    `).get(sourceEntryId) as TraceRow | undefined;
    return row ? this.fromRow(row) : null;
  }

  getMetaBySourceEntryIds(sourceEntryIds: string[]): Record<string, { traceId: string; injectedCount: number; writeCount: number }> {
    const unique = [...new Set(sourceEntryIds.filter(Boolean))];
    if (unique.length === 0) return {};
    const placeholders = unique.map(() => "?").join(", ");
    const rows = this.db.prepare(`
      SELECT id, assistant_source_entry_id, injected_json, writes_json
      FROM memory_turn_traces
      WHERE assistant_source_entry_id IN (${placeholders})
    `).all(...unique) as Array<Pick<TraceRow, "id" | "assistant_source_entry_id" | "injected_json" | "writes_json">>;
    return Object.fromEntries(rows.map((row) => [row.assistant_source_entry_id, {
      traceId: row.id,
      injectedCount: this.parseArray(row.injected_json).length,
      writeCount: this.parseArray(row.writes_json).length
    }]));
  }

  getById(id: string): MemoryTurnTrace | null {
    const row = this.db.prepare(`SELECT * FROM memory_turn_traces WHERE id = ?`).get(id) as TraceRow | undefined;
    return row ? this.fromRow(row) : null;
  }

  setFeedback(traceId: string, memoryId: string, value: MemoryTraceFeedbackValue, comment?: string): void {
    this.db.prepare(`
      INSERT INTO memory_trace_feedback(trace_id, memory_id, value, comment, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(trace_id, memory_id) DO UPDATE SET
        value = excluded.value,
        comment = excluded.comment,
        created_at = excluded.created_at
    `).run(traceId, memoryId, value, comment?.trim() || null, new Date().toISOString());
  }

  close(): void {
    this.db.close();
  }

  private fromRow(row: TraceRow): MemoryTurnTrace {
    return {
      id: row.id,
      runId: row.run_id,
      sessionId: row.session_id,
      chatId: row.chat_id,
      assistantSourceEntryId: row.assistant_source_entry_id,
      query: row.query,
      retrievedCount: row.retrieved_count,
      selectedCount: row.selected_count,
      injectedItems: this.parseArray(row.injected_json) as MemoryInjectionItem[],
      writeReceipts: this.parseArray(row.writes_json) as MemoryWriteReceipt[],
      createdAt: row.created_at
    };
  }

  private parseArray(value: string): unknown[] {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}

let defaultStore: SqliteMemoryTraceStore | undefined;

export function getMemoryTraceStore(): SqliteMemoryTraceStore {
  defaultStore ??= new SqliteMemoryTraceStore();
  return defaultStore;
}
