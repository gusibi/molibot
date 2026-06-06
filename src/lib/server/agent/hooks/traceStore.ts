import { DatabaseSync } from "node:sqlite";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import type { HookStage } from "$lib/server/agent/hooks/types.js";

export interface TraceEventRecord {
  id: string;
  runId: string;
  stage: HookStage;
  channel: string;
  chatId: string;
  sessionId: string;
  workspaceId?: string;
  createdAt: string;
  payload: Record<string, unknown>;
}

export class SqliteTraceStore {
  private readonly db: DatabaseSync;

  constructor(dbFile = storagePaths.settingsDbFile) {
    this.db = new DatabaseSync(dbFile);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_trace_events (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        stage TEXT NOT NULL,
        channel TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        workspace_id TEXT,
        created_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agent_trace_events_run_id ON agent_trace_events(run_id);
      CREATE INDEX IF NOT EXISTS idx_agent_trace_events_stage ON agent_trace_events(stage);
      CREATE INDEX IF NOT EXISTS idx_agent_trace_events_created_at ON agent_trace_events(created_at);
    `);
  }

  append(record: TraceEventRecord): void {
    this.db.prepare(`
      INSERT INTO agent_trace_events (
        id, run_id, stage, channel, chat_id, session_id, workspace_id, created_at, payload_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.runId,
      record.stage,
      record.channel,
      record.chatId,
      record.sessionId,
      record.workspaceId ?? null,
      record.createdAt,
      JSON.stringify(record.payload)
    );
  }

  listByRunId(runId: string): TraceEventRecord[] {
    const rows = this.db.prepare(`
      SELECT id, run_id, stage, channel, chat_id, session_id, workspace_id, created_at, payload_json
      FROM agent_trace_events
      WHERE run_id = ?
      ORDER BY created_at ASC, id ASC
    `).all(runId) as Array<{
      id: string;
      run_id: string;
      stage: HookStage;
      channel: string;
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
      chatId: row.chat_id,
      sessionId: row.session_id,
      workspaceId: row.workspace_id ?? undefined,
      createdAt: row.created_at,
      payload: JSON.parse(row.payload_json) as Record<string, unknown>
    }));
  }

  close(): void {
    this.db.close();
  }
}
