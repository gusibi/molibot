import { DatabaseSync } from "node:sqlite";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import type { HookStage } from "$lib/server/agent/hooks/types.js";

export type TraceFactType =
  | "run"
  | "model_call"
  | "tool_call"
  | "skill_usage"
  | "subagent_task"
  | "runtime_notice"
  | "approval"
  | "input_enrichment";

export interface TraceEventRecord {
  id: string;
  runId: string;
  stage: HookStage;
  channel: string;
  botId?: string;
  chatId: string;
  sessionId: string;
  workspaceId?: string;
  createdAt: string;
  payload: Record<string, unknown>;
}

export interface TraceFactRecord {
  id: string;
  factType: TraceFactType;
  runId: string;
  factId: string;
  channel: string;
  botId?: string;
  chatId: string;
  sessionId: string;
  workspaceId?: string;
  name?: string;
  provider?: string;
  model?: string;
  api?: string;
  status: "started" | "success" | "error" | "blocked" | "waiting" | "aborted" | "info" | "warning";
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
  blockedBy?: string;
  errorPreview?: string;
  argsPreview?: string;
  resultPreview?: string;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

type TraceFactRow = {
  id: string;
  fact_type: TraceFactType;
  run_id: string;
  fact_id: string;
  channel: string;
  bot_id: string | null;
  chat_id: string;
  session_id: string;
  workspace_id: string | null;
  name: string | null;
  provider: string | null;
  model: string | null;
  api: string | null;
  status: TraceFactRecord["status"];
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  total_tokens: number | null;
  blocked_by: string | null;
  error_preview: string | null;
  args_preview: string | null;
  result_preview: string | null;
  payload_json: string;
  created_at: string;
  updated_at: string;
};

export class SqliteTraceStore {
  private readonly db: DatabaseSync;

  constructor(dbFile = storagePaths.settingsDbFile) {
    this.db = new DatabaseSync(dbFile);
    // Drop existing table in case it was created without seq in previous runs or tests
    try {
      this.db.exec(`ALTER TABLE agent_trace_events ADD COLUMN seq INTEGER;`);
    } catch {
      // ignore if already has it or doesn't exist
    }
    try {
      this.db.exec(`ALTER TABLE agent_trace_events ADD COLUMN bot_id TEXT;`);
    } catch {
      // ignore if already has it or doesn't exist
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_trace_events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        run_id TEXT NOT NULL,
        stage TEXT NOT NULL,
        channel TEXT NOT NULL,
        bot_id TEXT,
        chat_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        workspace_id TEXT,
        created_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agent_trace_events_run_id ON agent_trace_events(run_id);
      CREATE INDEX IF NOT EXISTS idx_agent_trace_events_stage ON agent_trace_events(stage);
      CREATE INDEX IF NOT EXISTS idx_agent_trace_events_created_at ON agent_trace_events(created_at);

      CREATE TABLE IF NOT EXISTS agent_trace_facts (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        fact_type TEXT NOT NULL,
        run_id TEXT NOT NULL,
        fact_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        bot_id TEXT,
        chat_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        workspace_id TEXT,
        name TEXT,
        provider TEXT,
        model TEXT,
        api TEXT,
        status TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        duration_ms INTEGER,
        input_tokens INTEGER,
        output_tokens INTEGER,
        cache_read_tokens INTEGER,
        cache_write_tokens INTEGER,
        total_tokens INTEGER,
        blocked_by TEXT,
        error_preview TEXT,
        args_preview TEXT,
        result_preview TEXT,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(fact_type, run_id, fact_id)
      );
      CREATE INDEX IF NOT EXISTS idx_agent_trace_facts_session_type ON agent_trace_facts(session_id, fact_type);
      CREATE INDEX IF NOT EXISTS idx_agent_trace_facts_run_type ON agent_trace_facts(run_id, fact_type);
      CREATE INDEX IF NOT EXISTS idx_agent_trace_facts_name ON agent_trace_facts(fact_type, name);
      CREATE INDEX IF NOT EXISTS idx_agent_trace_facts_status ON agent_trace_facts(fact_type, status);
      CREATE INDEX IF NOT EXISTS idx_agent_trace_facts_created_at ON agent_trace_facts(created_at);
    `);
    for (const statement of [
      `ALTER TABLE agent_trace_facts ADD COLUMN bot_id TEXT;`,
      `ALTER TABLE agent_trace_facts ADD COLUMN cache_read_tokens INTEGER;`,
      `ALTER TABLE agent_trace_facts ADD COLUMN cache_write_tokens INTEGER;`
    ]) {
      try {
        this.db.exec(statement);
      } catch {
        // ignore if already has it or table doesn't exist yet
      }
    }
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_trace_facts_bot_type ON agent_trace_facts(bot_id, fact_type);`);
  }

  append(record: TraceEventRecord): void {
    this.db.prepare(`
      INSERT INTO agent_trace_events (
        id, run_id, stage, channel, bot_id, chat_id, session_id, workspace_id, created_at, payload_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.runId,
      record.stage,
      record.channel,
      record.botId ?? null,
      record.chatId,
      record.sessionId,
      record.workspaceId ?? null,
      record.createdAt,
      JSON.stringify(record.payload)
    );
  }

  upsertFact(record: TraceFactRecord): void {
    this.db.prepare(`
      INSERT INTO agent_trace_facts (
        id, fact_type, run_id, fact_id, channel, bot_id, chat_id, session_id, workspace_id,
        name, provider, model, api, status, started_at, finished_at, duration_ms,
        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens, blocked_by, error_preview,
        args_preview, result_preview, payload_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(fact_type, run_id, fact_id) DO UPDATE SET
        channel = excluded.channel,
        bot_id = COALESCE(excluded.bot_id, agent_trace_facts.bot_id),
        chat_id = excluded.chat_id,
        session_id = excluded.session_id,
        workspace_id = excluded.workspace_id,
        name = COALESCE(excluded.name, agent_trace_facts.name),
        provider = COALESCE(excluded.provider, agent_trace_facts.provider),
        model = COALESCE(excluded.model, agent_trace_facts.model),
        api = COALESCE(excluded.api, agent_trace_facts.api),
        status = excluded.status,
        started_at = COALESCE(agent_trace_facts.started_at, excluded.started_at),
        finished_at = COALESCE(excluded.finished_at, agent_trace_facts.finished_at),
        duration_ms = COALESCE(excluded.duration_ms, agent_trace_facts.duration_ms),
        input_tokens = COALESCE(excluded.input_tokens, agent_trace_facts.input_tokens),
        output_tokens = COALESCE(excluded.output_tokens, agent_trace_facts.output_tokens),
        cache_read_tokens = COALESCE(excluded.cache_read_tokens, agent_trace_facts.cache_read_tokens),
        cache_write_tokens = COALESCE(excluded.cache_write_tokens, agent_trace_facts.cache_write_tokens),
        total_tokens = COALESCE(excluded.total_tokens, agent_trace_facts.total_tokens),
        blocked_by = COALESCE(excluded.blocked_by, agent_trace_facts.blocked_by),
        error_preview = COALESCE(excluded.error_preview, agent_trace_facts.error_preview),
        args_preview = COALESCE(excluded.args_preview, agent_trace_facts.args_preview),
        result_preview = COALESCE(excluded.result_preview, agent_trace_facts.result_preview),
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at
    `).run(
      record.id,
      record.factType,
      record.runId,
      record.factId,
      record.channel,
      record.botId ?? null,
      record.chatId,
      record.sessionId,
      record.workspaceId ?? null,
      record.name ?? null,
      record.provider ?? null,
      record.model ?? null,
      record.api ?? null,
      record.status,
      record.startedAt ?? null,
      record.finishedAt ?? null,
      record.durationMs ?? null,
      record.inputTokens ?? null,
      record.outputTokens ?? null,
      record.cacheReadTokens ?? null,
      record.cacheWriteTokens ?? null,
      record.totalTokens ?? null,
      record.blockedBy ?? null,
      record.errorPreview ?? null,
      record.argsPreview ?? null,
      record.resultPreview ?? null,
      JSON.stringify(record.payload),
      record.createdAt,
      record.updatedAt
    );
  }

  listByRunId(runId: string): TraceEventRecord[] {
    const rows = this.db.prepare(`
      SELECT id, run_id, stage, channel, bot_id, chat_id, session_id, workspace_id, created_at, payload_json
      FROM agent_trace_events
      WHERE run_id = ?
      ORDER BY seq ASC
    `).all(runId) as Array<{
      id: string;
      run_id: string;
      stage: HookStage;
      channel: string;
      bot_id: string | null;
      chat_id: string;
      session_id: string;
      workspace_id: string | null;
      created_at: string;
      payload_json: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      runId: row.run_id,
      stage: row.stage,
      channel: row.channel,
      botId: row.bot_id ?? undefined,
      chatId: row.chat_id,
      sessionId: row.session_id,
      workspaceId: row.workspace_id ?? undefined,
      createdAt: row.created_at,
      payload: JSON.parse(row.payload_json) as Record<string, unknown>
    }));
  }

  listFactsByRunId(runId: string): TraceFactRecord[] {
    return this.listFactsByColumn("run_id", runId);
  }

  listFactsBySessionId(sessionId: string): TraceFactRecord[] {
    return this.listFactsByColumn("session_id", sessionId);
  }

  listRecentFacts(limit = 5000): TraceFactRecord[] {
    const safeLimit = Math.max(1, Math.min(10000, Math.trunc(limit)));
    const rows = this.db.prepare(`
      SELECT id, fact_type, run_id, fact_id, channel, bot_id, chat_id, session_id, workspace_id,
        name, provider, model, api, status, started_at, finished_at, duration_ms,
        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens, blocked_by, error_preview,
        args_preview, result_preview, payload_json, created_at, updated_at
      FROM agent_trace_facts
      ORDER BY seq DESC
      LIMIT ?
    `).all(safeLimit) as TraceFactRow[];

    return rows.map((row) => this.mapFactRow(row));
  }

  private listFactsByColumn(column: "run_id" | "session_id", value: string): TraceFactRecord[] {
    const rows = this.db.prepare(`
      SELECT id, fact_type, run_id, fact_id, channel, bot_id, chat_id, session_id, workspace_id,
        name, provider, model, api, status, started_at, finished_at, duration_ms,
        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens, blocked_by, error_preview,
        args_preview, result_preview, payload_json, created_at, updated_at
      FROM agent_trace_facts
      WHERE ${column} = ?
      ORDER BY seq ASC
    `).all(value) as TraceFactRow[];

    return rows.map((row) => this.mapFactRow(row));
  }

  private mapFactRow(row: TraceFactRow): TraceFactRecord {
    return {
      id: row.id,
      factType: row.fact_type,
      runId: row.run_id,
      factId: row.fact_id,
      channel: row.channel,
      botId: row.bot_id ?? undefined,
      chatId: row.chat_id,
      sessionId: row.session_id,
      workspaceId: row.workspace_id ?? undefined,
      name: row.name ?? undefined,
      provider: row.provider ?? undefined,
      model: row.model ?? undefined,
      api: row.api ?? undefined,
      status: row.status,
      startedAt: row.started_at ?? undefined,
      finishedAt: row.finished_at ?? undefined,
      durationMs: row.duration_ms ?? undefined,
      inputTokens: row.input_tokens ?? undefined,
      outputTokens: row.output_tokens ?? undefined,
      cacheReadTokens: row.cache_read_tokens ?? undefined,
      cacheWriteTokens: row.cache_write_tokens ?? undefined,
      totalTokens: row.total_tokens ?? undefined,
      blockedBy: row.blocked_by ?? undefined,
      errorPreview: row.error_preview ?? undefined,
      argsPreview: row.args_preview ?? undefined,
      resultPreview: row.result_preview ?? undefined,
      payload: JSON.parse(row.payload_json) as Record<string, unknown>,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  close(): void {
    this.db.close();
  }
}
