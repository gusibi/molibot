import { DatabaseSync } from "node:sqlite";
import { storagePaths } from "$lib/server/infra/db/storage.js";

export interface ImageTaskRecord {
  id: string;
  engine: string;
  sessionId: string;
  status: "processing" | "completed" | "failed";
  prompt: string;
  imagePath?: string;
  imageUrl?: string;
  requestParams?: any;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export class SqliteImageTaskStore {
  private readonly db: DatabaseSync;

  constructor(dbPath = storagePaths.settingsDbFile) {
    this.db = new DatabaseSync(dbPath);
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS image_tasks (
        id TEXT PRIMARY KEY,
        engine TEXT NOT NULL,
        session_id TEXT NOT NULL,
        status TEXT NOT NULL,
        prompt TEXT NOT NULL,
        image_path TEXT,
        image_url TEXT,
        request_params TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_image_tasks_session ON image_tasks(session_id);
      CREATE INDEX IF NOT EXISTS idx_image_tasks_created ON image_tasks(created_at);
    `);
  }

  public createTask(id: string, engine: string, sessionId: string, prompt: string, requestParams?: any): ImageTaskRecord {
    const now = new Date().toISOString();
    const requestParamsJson = requestParams ? JSON.stringify(requestParams) : null;
    
    const stmt = this.db.prepare(`
      INSERT INTO image_tasks (id, engine, session_id, status, prompt, request_params, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, engine, sessionId, "processing", prompt, requestParamsJson, now, now);

    return {
      id,
      engine,
      sessionId,
      status: "processing",
      prompt,
      requestParams,
      createdAt: now,
      updatedAt: now
    };
  }

  public updateTaskProgress(
    id: string,
    status: "completed" | "failed",
    imagePath?: string,
    errorMessage?: string,
    imageUrl?: string
  ): void {
    const now = new Date().toISOString();
    
    const stmt = this.db.prepare(`
      UPDATE image_tasks
      SET status = ?, 
          image_path = COALESCE(?, image_path), 
          error_message = COALESCE(?, error_message), 
          image_url = COALESCE(?, image_url), 
          updated_at = ?
      WHERE id = ?
    `);
    stmt.run(status, imagePath ?? null, errorMessage ?? null, imageUrl ?? null, now, id);
  }

  public getTask(id: string): ImageTaskRecord | null {
    const stmt = this.db.prepare(`
      SELECT id, engine, session_id, status, prompt, image_path, error_message, image_url, request_params, created_at, updated_at
      FROM image_tasks
      WHERE id = ?
    `);
    const row = stmt.get(id) as any;
    if (!row) return null;

    return {
      id: row.id,
      engine: row.engine,
      sessionId: row.session_id,
      status: row.status,
      prompt: row.prompt,
      imagePath: row.image_path ?? undefined,
      imageUrl: row.image_url ?? undefined,
      requestParams: row.request_params ? JSON.parse(row.request_params) : undefined,
      errorMessage: row.error_message ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  public getRecentTasks(limit = 50): ImageTaskRecord[] {
    const stmt = this.db.prepare(`
      SELECT id, engine, session_id, status, prompt, image_path, error_message, image_url, request_params, created_at, updated_at
      FROM image_tasks
      ORDER BY created_at DESC
      LIMIT ?
    `);
    const rows = stmt.all(limit) as any[];
    return rows.map(row => ({
      id: row.id,
      engine: row.engine,
      sessionId: row.session_id,
      status: row.status,
      prompt: row.prompt,
      imagePath: row.image_path ?? undefined,
      imageUrl: row.image_url ?? undefined,
      requestParams: row.request_params ? JSON.parse(row.request_params) : undefined,
      errorMessage: row.error_message ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  public deleteTask(id: string): void {
    const stmt = this.db.prepare("DELETE FROM image_tasks WHERE id = ?");
    stmt.run(id);
  }
}
