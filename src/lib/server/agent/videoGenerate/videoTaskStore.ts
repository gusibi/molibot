import { DatabaseSync } from "node:sqlite";
import { storagePaths } from "$lib/server/infra/db/storage.js";

export interface VideoTaskRecord {
  id: string;
  engine: string;
  sessionId: string;
  status: "processing" | "completed" | "failed";
  progress: number;
  prompt: string;
  pollParams: any;
  videoPath?: string;
  videoUrl?: string;
  requestParams?: any;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export class SqliteVideoTaskStore {
  private readonly db: DatabaseSync;

  constructor(dbPath = storagePaths.settingsDbFile) {
    this.db = new DatabaseSync(dbPath);
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS video_tasks (
        id TEXT PRIMARY KEY,
        engine TEXT NOT NULL,
        session_id TEXT NOT NULL,
        status TEXT NOT NULL,
        progress INTEGER DEFAULT 0,
        prompt TEXT NOT NULL,
        poll_params_json TEXT NOT NULL,
        video_path TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_video_tasks_session ON video_tasks(session_id);
      CREATE INDEX IF NOT EXISTS idx_video_tasks_created ON video_tasks(created_at);
    `);
    try {
      this.db.exec(`ALTER TABLE video_tasks ADD COLUMN video_url TEXT;`);
    } catch {
      // Ignore if column already exists
    }
    try {
      this.db.exec(`ALTER TABLE video_tasks ADD COLUMN request_params TEXT;`);
    } catch {
      // Ignore if column already exists
    }
  }

  public createTask(id: string, engine: string, sessionId: string, prompt: string, pollParams: any, requestParams?: any): VideoTaskRecord {
    const now = new Date().toISOString();
    const pollParamsJson = JSON.stringify(pollParams ?? {});
    const requestParamsJson = requestParams ? JSON.stringify(requestParams) : null;
    
    const stmt = this.db.prepare(`
      INSERT INTO video_tasks (id, engine, session_id, status, progress, prompt, poll_params_json, request_params, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, engine, sessionId, "processing", 0, prompt, pollParamsJson, requestParamsJson, now, now);

    return {
      id,
      engine,
      sessionId,
      status: "processing",
      progress: 0,
      prompt,
      pollParams,
      requestParams,
      createdAt: now,
      updatedAt: now
    };
  }

  public updateTaskProgress(
    id: string,
    status: "processing" | "completed" | "failed",
    progress: number,
    videoPath?: string,
    errorMessage?: string,
    videoUrl?: string
  ): void {
    const now = new Date().toISOString();
    
    const stmt = this.db.prepare(`
      UPDATE video_tasks
      SET status = ?, 
          progress = ?, 
          video_path = COALESCE(?, video_path), 
          error_message = COALESCE(?, error_message), 
          video_url = COALESCE(?, video_url), 
          updated_at = ?
      WHERE id = ?
    `);
    stmt.run(status, progress, videoPath ?? null, errorMessage ?? null, videoUrl ?? null, now, id);
  }

  public getTask(id: string): VideoTaskRecord | null {
    const stmt = this.db.prepare(`
      SELECT id, engine, session_id, status, progress, prompt, poll_params_json, video_path, error_message, video_url, request_params, created_at, updated_at
      FROM video_tasks
      WHERE id = ?
    `);
    const row = stmt.get(id) as any;
    if (!row) return null;

    return {
      id: row.id,
      engine: row.engine,
      sessionId: row.session_id,
      status: row.status,
      progress: row.progress,
      prompt: row.prompt,
      pollParams: JSON.parse(row.poll_params_json || "{}"),
      videoPath: row.video_path ?? undefined,
      videoUrl: row.video_url ?? undefined,
      requestParams: row.request_params ? JSON.parse(row.request_params) : undefined,
      errorMessage: row.error_message ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  public getRecentTasks(limit = 50): VideoTaskRecord[] {
    const stmt = this.db.prepare(`
      SELECT id, engine, session_id, status, progress, prompt, poll_params_json, video_path, error_message, video_url, request_params, created_at, updated_at
      FROM video_tasks
      ORDER BY created_at DESC
      LIMIT ?
    `);
    const rows = stmt.all(limit) as any[];
    return rows.map(row => ({
      id: row.id,
      engine: row.engine,
      sessionId: row.session_id,
      status: row.status,
      progress: row.progress,
      prompt: row.prompt,
      pollParams: JSON.parse(row.poll_params_json || "{}"),
      videoPath: row.video_path ?? undefined,
      videoUrl: row.video_url ?? undefined,
      requestParams: row.request_params ? JSON.parse(row.request_params) : undefined,
      errorMessage: row.error_message ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  public deleteTask(id: string): void {
    const stmt = this.db.prepare("DELETE FROM video_tasks WHERE id = ?");
    stmt.run(id);
  }
}
