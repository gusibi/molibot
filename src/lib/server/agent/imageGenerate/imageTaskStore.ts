import { DatabaseSync } from "node:sqlite";
import { ensureSqliteParentDir, storagePaths } from "$lib/server/infra/db/storage.js";
import type { Usage } from "@earendil-works/pi-ai";

export interface ImageTaskArtifact {
  index: number;
  path: string;
  mimeType: string;
  byteLength: number;
}

export interface ImageTaskRecord {
  id: string;
  engine: string;
  sessionId: string;
  status: "processing" | "completed" | "failed" | "cancelled";
  prompt: string;
  imagePath?: string;
  imageUrl?: string;
  requestParams?: any;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  artifacts?: ImageTaskArtifact[];
  textOutput?: string;
  usage?: Usage;
}

export class SqliteImageTaskStore {
  private readonly db: DatabaseSync;

  constructor(dbPath = storagePaths.settingsDbFile) {
    ensureSqliteParentDir(dbPath);
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
      CREATE TABLE IF NOT EXISTS image_task_artifacts (
        task_id TEXT NOT NULL, output_index INTEGER NOT NULL, path TEXT NOT NULL,
        mime_type TEXT NOT NULL, byte_length INTEGER NOT NULL,
        PRIMARY KEY (task_id, output_index)
      );
      CREATE TABLE IF NOT EXISTS image_task_deletions (task_id TEXT PRIMARY KEY, deleted_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS image_task_results (
        task_id TEXT PRIMARY KEY, text_output TEXT, usage_json TEXT
      );
    `);
  }

  public recordArtifact(taskId: string, artifact: ImageTaskArtifact): void {
    this.db.prepare("INSERT INTO image_task_artifacts (task_id, output_index, path, mime_type, byte_length) SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM image_task_deletions WHERE task_id = ?)")
      .run(taskId, artifact.index, artifact.path, artifact.mimeType, artifact.byteLength, taskId);
  }

  public recordResult(taskId: string, text?: string, usage?: Usage): void {
    this.db.prepare("INSERT INTO image_task_results (task_id, text_output, usage_json) SELECT ?, CASE WHEN EXISTS (SELECT 1 FROM image_task_deletions WHERE task_id = ?) THEN NULL ELSE ? END, ? ON CONFLICT(task_id) DO UPDATE SET text_output = excluded.text_output, usage_json = excluded.usage_json")
      .run(taskId, taskId, text ?? null, usage ? JSON.stringify(usage) : null);
  }

  private outputFor(taskId: string): Pick<ImageTaskRecord, "artifacts" | "textOutput" | "usage"> {
    const artifacts = this.db.prepare("SELECT output_index AS 'index', path, mime_type AS mimeType, byte_length AS byteLength FROM image_task_artifacts WHERE task_id = ? ORDER BY output_index").all(taskId) as unknown as ImageTaskArtifact[];
    const result = this.db.prepare("SELECT text_output, usage_json FROM image_task_results WHERE task_id = ?").get(taskId) as { text_output?: string; usage_json?: string } | undefined;
    return { artifacts, textOutput: result?.text_output ?? undefined, usage: result?.usage_json ? JSON.parse(result.usage_json) : undefined };
  }

  public close(): void { this.db.close(); }

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
    status: "completed" | "failed" | "cancelled",
    imagePath?: string,
    errorMessage?: string,
    imageUrl?: string
  ): void {
    const now = new Date().toISOString();
    
    const stmt = this.db.prepare(`
      UPDATE image_tasks
      SET status = ?, 
          image_path = CASE WHEN EXISTS (SELECT 1 FROM image_task_deletions WHERE task_id = image_tasks.id) THEN NULL ELSE COALESCE(?, image_path) END,
          error_message = CASE WHEN EXISTS (SELECT 1 FROM image_task_deletions WHERE task_id = image_tasks.id) THEN NULL ELSE COALESCE(?, error_message) END,
          image_url = CASE WHEN EXISTS (SELECT 1 FROM image_task_deletions WHERE task_id = image_tasks.id) THEN NULL ELSE COALESCE(?, image_url) END,
          updated_at = ?
      WHERE id = ?
    `);
    stmt.run(status, imagePath ?? null, errorMessage ?? null, imageUrl ?? null, now, id);
  }

  public getTask(id: string): ImageTaskRecord | null {
    const stmt = this.db.prepare(`
      SELECT id, engine, session_id, status, prompt, image_path, error_message, image_url, request_params, created_at, updated_at
      FROM image_tasks
      WHERE id = ? AND NOT EXISTS (SELECT 1 FROM image_task_deletions WHERE task_id = image_tasks.id)
    `);
    const row = stmt.get(id) as any;
    if (!row) return null;

    return {
      ...this.outputFor(id),
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

  public getRecentTasks(limit = 50): ImageTaskRecord[] { return this.listTasks(limit, false); }

  /** Billing facts outlive deletion of the media presentation. */
  public getUsageTasks(): Pick<ImageTaskRecord, "id" | "engine" | "sessionId" | "status" | "requestParams" | "createdAt" | "usage">[] {
    const rows = this.db.prepare(`SELECT t.id, t.engine, t.session_id, t.status, t.request_params, t.created_at, r.usage_json
      FROM image_tasks t LEFT JOIN image_task_results r ON r.task_id = t.id
      WHERE t.engine = 'pi' ORDER BY t.created_at DESC`).all() as unknown as Array<{
        id: string; engine: string; session_id: string; status: ImageTaskRecord["status"];
        request_params: string | null; created_at: string; usage_json: string | null;
      }>;
    return rows.map(row => ({ id: row.id, engine: row.engine, sessionId: row.session_id,
      status: row.status, createdAt: row.created_at,
      requestParams: row.request_params ? JSON.parse(row.request_params) : undefined,
      usage: row.usage_json ? JSON.parse(row.usage_json) : undefined }));
  }

  private listTasks(limit: number, includeDeleted: boolean): ImageTaskRecord[] {
    const stmt = this.db.prepare(`
      SELECT id, engine, session_id, status, prompt, image_path, error_message, image_url, request_params, created_at, updated_at
      FROM image_tasks
      ${includeDeleted ? "" : "WHERE NOT EXISTS (SELECT 1 FROM image_task_deletions WHERE task_id = image_tasks.id)"}
      ORDER BY created_at DESC
      LIMIT ?
    `);
    const rows = stmt.all(limit) as any[];
    return rows.map(row => ({
      ...this.outputFor(row.id),
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
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM image_task_artifacts WHERE task_id = ?").run(id);
      const task = this.db.prepare("SELECT request_params FROM image_tasks WHERE id = ?").get(id) as { request_params?: string } | undefined;
      const params = task?.request_params ? JSON.parse(task.request_params) : {};
      this.db.prepare("UPDATE image_tasks SET prompt = '', image_path = NULL, image_url = NULL, error_message = NULL, request_params = ? WHERE id = ?")
        .run(JSON.stringify({ model: params.model, usageScope: params.usageScope }), id);
      this.db.prepare("UPDATE image_task_results SET text_output = NULL WHERE task_id = ?").run(id);
      this.db.prepare("INSERT OR IGNORE INTO image_task_deletions (task_id, deleted_at) VALUES (?, ?)").run(id, new Date().toISOString());
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
