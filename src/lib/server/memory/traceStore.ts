import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { ensureSqliteParentDir, storagePaths } from "$lib/server/infra/db/storage.js";
import type { MemoryInjectionItem, MemoryScope } from "$lib/server/memory/types.js";

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
  scope: MemoryScope;
  profileBaseFingerprint?: string;
  profileRevokedMemoryIds: string[];
  assistantSourceEntryId: string;
  query: string;
  retrievedCount: number;
  selectedCount: number;
  injectedItems: MemoryInjectionItem[];
  writeReceipts: MemoryWriteReceipt[];
  createdAt: string;
}

export interface MemoryFeedbackEvent {
  id: string;
  idempotencyKey: string;
  traceId: string;
  memoryId: string;
  value: MemoryTraceFeedbackValue;
  previousValue?: MemoryTraceFeedbackValue;
  comment?: string;
  createdAt: string;
}

export interface MemoryFeedbackEffect {
  traceId: string;
  memoryId: string;
  value: MemoryTraceFeedbackValue;
  utilityContribution: number;
  ownsDispute: boolean;
  previousConfidence?: number;
  ownsExpiry: boolean;
  previousExpiresAt?: string;
  updatedAt: string;
}

type TraceRow = {
  id: string;
  run_id: string;
  session_id: string;
  chat_id: string;
  scope_json: string;
  profile_base_fingerprint: string | null;
  profile_revoked_json: string;
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
        scope_json TEXT NOT NULL DEFAULT '{}',
        profile_base_fingerprint TEXT,
        profile_revoked_json TEXT NOT NULL DEFAULT '[]',
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

      CREATE TABLE IF NOT EXISTS memory_feedback_events (
        id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL UNIQUE,
        trace_id TEXT NOT NULL,
        memory_id TEXT NOT NULL,
        value TEXT NOT NULL,
        previous_value TEXT,
        comment TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(trace_id) REFERENCES memory_turn_traces(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_memory_feedback_events_target
        ON memory_feedback_events(trace_id, memory_id, created_at);

      CREATE TABLE IF NOT EXISTS memory_feedback_current (
        trace_id TEXT NOT NULL,
        memory_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(trace_id, memory_id),
        FOREIGN KEY(trace_id) REFERENCES memory_turn_traces(id) ON DELETE CASCADE,
        FOREIGN KEY(event_id) REFERENCES memory_feedback_events(id)
      );
      CREATE INDEX IF NOT EXISTS idx_memory_feedback_current_memory
        ON memory_feedback_current(memory_id, value);

      CREATE TABLE IF NOT EXISTS memory_feedback_effects (
        trace_id TEXT NOT NULL,
        memory_id TEXT NOT NULL,
        value TEXT NOT NULL,
        utility_contribution REAL NOT NULL DEFAULT 0,
        owns_dispute INTEGER NOT NULL DEFAULT 0,
        previous_confidence REAL,
        owns_expiry INTEGER NOT NULL DEFAULT 0,
        previous_expires_at TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(trace_id, memory_id)
      );

      CREATE TABLE IF NOT EXISTS memory_feedback_bases (
        memory_id TEXT PRIMARY KEY,
        base_utility REAL NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memory_feedback_effect_outbox (
        event_id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(event_id) REFERENCES memory_feedback_events(id)
      );
      CREATE INDEX IF NOT EXISTS idx_memory_feedback_effect_outbox_status
        ON memory_feedback_effect_outbox(status, updated_at);
    `);
    const columns = this.db.prepare("PRAGMA table_info(memory_turn_traces)").all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "scope_json")) {
      this.db.exec("ALTER TABLE memory_turn_traces ADD COLUMN scope_json TEXT NOT NULL DEFAULT '{}'");
    }
    if (!columns.some((column) => column.name === "profile_base_fingerprint")) {
      this.db.exec("ALTER TABLE memory_turn_traces ADD COLUMN profile_base_fingerprint TEXT");
    }
    if (!columns.some((column) => column.name === "profile_revoked_json")) {
      this.db.exec("ALTER TABLE memory_turn_traces ADD COLUMN profile_revoked_json TEXT NOT NULL DEFAULT '[]'");
    }
  }

  save(input: Omit<MemoryTurnTrace, "id"> & { id?: string }): MemoryTurnTrace {
    const trace: MemoryTurnTrace = { ...input, id: input.id ?? randomUUID() };
    this.db.prepare(`
      INSERT INTO memory_turn_traces (
        id, run_id, session_id, chat_id, scope_json, profile_base_fingerprint, profile_revoked_json, assistant_source_entry_id, query,
        retrieved_count, selected_count, injected_json, writes_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(assistant_source_entry_id) DO UPDATE SET
        run_id = excluded.run_id,
        scope_json = excluded.scope_json,
        profile_base_fingerprint = excluded.profile_base_fingerprint,
        profile_revoked_json = excluded.profile_revoked_json,
        injected_json = excluded.injected_json,
        writes_json = excluded.writes_json
    `).run(
      trace.id,
      trace.runId,
      trace.sessionId,
      trace.chatId,
      JSON.stringify(trace.scope),
      trace.profileBaseFingerprint ?? null,
      JSON.stringify(trace.profileRevokedMemoryIds),
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

  getLatestForSession(sessionId: string): MemoryTurnTrace | null {
    const row = this.db.prepare(`
      SELECT * FROM memory_turn_traces WHERE session_id = ? ORDER BY created_at DESC, id DESC LIMIT 1
    `).get(sessionId) as TraceRow | undefined;
    return row ? this.fromRow(row) : null;
  }

  setFeedback(traceId: string, memoryId: string, value: MemoryTraceFeedbackValue, comment?: string): void {
    this.recordFeedback({ traceId, memoryId, value, comment, idempotencyKey: randomUUID() });
  }

  recordFeedback(input: {
    traceId: string;
    memoryId: string;
    value: MemoryTraceFeedbackValue;
    comment?: string;
    idempotencyKey: string;
  }): { event: MemoryFeedbackEvent; duplicate: boolean } {
    const existing = this.getFeedbackEventByKey(input.idempotencyKey);
    if (existing) return { event: existing, duplicate: true };
    const trace = this.getById(input.traceId);
    if (!trace) throw new Error("Memory trace not found.");
    if (!trace.injectedItems.some((item) => item.memoryId === input.memoryId)) {
      throw new Error("Memory was not injected by this trace.");
    }
    const current = this.db.prepare(`
      SELECT event_id, value FROM memory_feedback_current WHERE trace_id = ? AND memory_id = ?
    `).get(input.traceId, input.memoryId) as { event_id: string; value: MemoryTraceFeedbackValue } | undefined;
    const event: MemoryFeedbackEvent = {
      id: randomUUID(),
      idempotencyKey: input.idempotencyKey,
      traceId: input.traceId,
      memoryId: input.memoryId,
      value: input.value,
      previousValue: current?.value,
      comment: input.comment?.trim() || undefined,
      createdAt: new Date().toISOString()
    };
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`
        INSERT INTO memory_feedback_events(
          id, idempotency_key, trace_id, memory_id, value, previous_value, comment, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(event.id, event.idempotencyKey, event.traceId, event.memoryId, event.value, event.previousValue ?? null, event.comment ?? null, event.createdAt);
      if (current?.event_id) {
        this.db.prepare(`
          UPDATE memory_feedback_effect_outbox SET status = 'superseded', updated_at = ? WHERE event_id = ? AND status = 'pending'
        `).run(event.createdAt, current.event_id);
      }
      this.db.prepare(`
        INSERT INTO memory_feedback_current(trace_id, memory_id, event_id, value, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(trace_id, memory_id) DO UPDATE SET
          event_id = excluded.event_id,
          value = excluded.value,
          updated_at = excluded.updated_at
      `).run(event.traceId, event.memoryId, event.id, event.value, event.createdAt);
      this.db.prepare(`
        INSERT INTO memory_feedback_effect_outbox(event_id, status, attempts, updated_at)
        VALUES (?, 'pending', 0, ?)
      `).run(event.id, event.createdAt);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      const duplicate = this.getFeedbackEventByKey(input.idempotencyKey);
      if (duplicate) return { event: duplicate, duplicate: true };
      throw error;
    }
    return { event, duplicate: false };
  }

  listFeedbackEvents(traceId: string, memoryId: string): MemoryFeedbackEvent[] {
    const rows = this.db.prepare(`
      SELECT * FROM memory_feedback_events
      WHERE trace_id = ? AND memory_id = ? ORDER BY created_at ASC, id ASC
    `).all(traceId, memoryId) as Array<Record<string, unknown>>;
    return rows.map((row) => this.feedbackEventFromRow(row));
  }

  listCurrentFeedbackValues(memoryId: string): Array<{ traceId: string; value: MemoryTraceFeedbackValue }> {
    return (this.db.prepare(`
      SELECT trace_id, value FROM memory_feedback_current WHERE memory_id = ? ORDER BY trace_id
    `).all(memoryId) as Array<{ trace_id: string; value: MemoryTraceFeedbackValue }>).map((row) => ({
      traceId: row.trace_id,
      value: row.value
    }));
  }

  getOrCreateBaseUtility(memoryId: string, currentUtility: number): number {
    const safeUtility = Math.max(0, Math.min(1, currentUtility));
    this.db.prepare(`
      INSERT OR IGNORE INTO memory_feedback_bases(memory_id, base_utility, created_at) VALUES (?, ?, ?)
    `).run(memoryId, safeUtility, new Date().toISOString());
    const row = this.db.prepare(`SELECT base_utility FROM memory_feedback_bases WHERE memory_id = ?`).get(memoryId) as { base_utility: number };
    return Number(row.base_utility);
  }

  getFeedbackEffect(traceId: string, memoryId: string): MemoryFeedbackEffect | null {
    const row = this.db.prepare(`
      SELECT * FROM memory_feedback_effects WHERE trace_id = ? AND memory_id = ?
    `).get(traceId, memoryId) as Record<string, unknown> | undefined;
    return row ? this.effectFromRow(row) : null;
  }

  saveFeedbackEffect(effect: MemoryFeedbackEffect): void {
    this.db.prepare(`
      INSERT INTO memory_feedback_effects(
        trace_id, memory_id, value, utility_contribution, owns_dispute, previous_confidence,
        owns_expiry, previous_expires_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(trace_id, memory_id) DO UPDATE SET
        value = excluded.value,
        utility_contribution = excluded.utility_contribution,
        owns_dispute = excluded.owns_dispute,
        previous_confidence = excluded.previous_confidence,
        owns_expiry = excluded.owns_expiry,
        previous_expires_at = excluded.previous_expires_at,
        updated_at = excluded.updated_at
    `).run(
      effect.traceId,
      effect.memoryId,
      effect.value,
      effect.utilityContribution,
      effect.ownsDispute ? 1 : 0,
      effect.previousConfidence ?? null,
      effect.ownsExpiry ? 1 : 0,
      effect.previousExpiresAt ?? null,
      effect.updatedAt
    );
  }

  listPendingFeedbackEffects(limit = 100): MemoryFeedbackEvent[] {
    const rows = this.db.prepare(`
      SELECT events.* FROM memory_feedback_effect_outbox outbox
      JOIN memory_feedback_events events ON events.id = outbox.event_id
      JOIN memory_feedback_current current ON current.event_id = events.id
      WHERE outbox.status = 'pending'
      ORDER BY events.created_at ASC, events.id ASC
      LIMIT ?
    `).all(Math.max(1, Math.min(1_000, limit))) as Array<Record<string, unknown>>;
    return rows.map((row) => this.feedbackEventFromRow(row));
  }

  markFeedbackEffectApplied(eventId: string): void {
    this.db.prepare(`
      UPDATE memory_feedback_effect_outbox
      SET status = 'applied', attempts = attempts + 1, last_error = NULL, updated_at = ?
      WHERE event_id = ?
    `).run(new Date().toISOString(), eventId);
  }

  markFeedbackEffectFailed(eventId: string, error: string): void {
    this.db.prepare(`
      UPDATE memory_feedback_effect_outbox
      SET status = 'pending', attempts = attempts + 1, last_error = ?, updated_at = ?
      WHERE event_id = ?
    `).run(error.slice(0, 2_000), new Date().toISOString(), eventId);
  }

  enqueueHistoricalFeedbackEffects(): number {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO memory_feedback_effect_outbox(event_id, status, attempts, updated_at)
      SELECT id, 'pending', 0, ? FROM memory_feedback_events
    `).run(now);
    return Number(result.changes);
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
      scope: this.parseScope(row.scope_json, row),
      profileBaseFingerprint: row.profile_base_fingerprint ?? undefined,
      profileRevokedMemoryIds: this.parseArray(row.profile_revoked_json).map(String),
      assistantSourceEntryId: row.assistant_source_entry_id,
      query: row.query,
      retrievedCount: row.retrieved_count,
      selectedCount: row.selected_count,
      injectedItems: this.parseArray(row.injected_json) as MemoryInjectionItem[],
      writeReceipts: this.parseArray(row.writes_json) as MemoryWriteReceipt[],
      createdAt: row.created_at
    };
  }

  private getFeedbackEventByKey(idempotencyKey: string): MemoryFeedbackEvent | null {
    const row = this.db.prepare(`SELECT * FROM memory_feedback_events WHERE idempotency_key = ?`).get(idempotencyKey) as Record<string, unknown> | undefined;
    return row ? this.feedbackEventFromRow(row) : null;
  }

  private feedbackEventFromRow(row: Record<string, unknown>): MemoryFeedbackEvent {
    return {
      id: String(row.id),
      idempotencyKey: String(row.idempotency_key),
      traceId: String(row.trace_id),
      memoryId: String(row.memory_id),
      value: String(row.value) as MemoryTraceFeedbackValue,
      previousValue: row.previous_value ? String(row.previous_value) as MemoryTraceFeedbackValue : undefined,
      comment: row.comment ? String(row.comment) : undefined,
      createdAt: String(row.created_at)
    };
  }

  private effectFromRow(row: Record<string, unknown>): MemoryFeedbackEffect {
    return {
      traceId: String(row.trace_id),
      memoryId: String(row.memory_id),
      value: String(row.value) as MemoryTraceFeedbackValue,
      utilityContribution: Number(row.utility_contribution),
      ownsDispute: Number(row.owns_dispute) === 1,
      previousConfidence: typeof row.previous_confidence === "number" ? row.previous_confidence : undefined,
      ownsExpiry: Number(row.owns_expiry) === 1,
      previousExpiresAt: row.previous_expires_at ? String(row.previous_expires_at) : undefined,
      updatedAt: String(row.updated_at)
    };
  }

  private parseScope(value: string, row: Pick<TraceRow, "chat_id" | "session_id">): MemoryScope {
    try {
      const parsed = JSON.parse(value) as Partial<MemoryScope>;
      if (parsed && typeof parsed.channel === "string" && typeof parsed.externalUserId === "string") return parsed as MemoryScope;
    } catch {
      // Legacy traces did not persist a scope snapshot.
    }
    return { channel: "web", externalUserId: row.chat_id, conversationId: row.session_id };
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
