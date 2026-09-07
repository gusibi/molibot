import { DatabaseSync } from "node:sqlite";
import { ensureSqliteParentDir } from "$lib/server/infra/db/storage.js";

export type AutoArchiveRunStatus = "running" | "completed" | "interrupted";

export interface AutoArchiveRunRecord {
  runId: string;
  startedAt: string;
  finishedAt: string | null;
  status: AutoArchiveRunStatus;
  candidateCount: number;
  archivedCount: number;
  skippedCount: number;
  failedCount: number;
}

interface RunRowRaw {
  run_id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  candidate_count: number;
  archived_count: number;
  skipped_count: number;
  failed_count: number;
}

function toRecord(raw: RunRowRaw): AutoArchiveRunRecord {
  return {
    runId: raw.run_id,
    startedAt: raw.started_at,
    finishedAt: raw.finished_at,
    status: raw.status as AutoArchiveRunStatus,
    candidateCount: raw.candidate_count,
    archivedCount: raw.archived_count,
    skippedCount: raw.skipped_count,
    failedCount: raw.failed_count
  };
}

/**
 * Owning-store persistence for automatic-archive sweep progress and the
 * last-run result shown in management. Lives in the Session-owned state
 * store (`sessions.db`), next to the lifecycle table — never in settings, a
 * memory note or a JSON side index.
 */
export class SessionAutoArchiveStore {
  private readonly db: DatabaseSync;
  private readonly clock: () => Date;

  constructor(dbFile: string, opts?: { clock?: () => Date }) {
    ensureSqliteParentDir(dbFile);
    this.db = new DatabaseSync(dbFile);
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.clock = opts?.clock ?? (() => new Date());
    this.ensureSchema();
  }

  close(): void {
    this.db.close();
  }

  private nowIso(): string {
    return this.clock().toISOString();
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS auto_archive_runs (
        run_id TEXT PRIMARY KEY,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        status TEXT NOT NULL DEFAULT 'running',
        candidate_count INTEGER NOT NULL DEFAULT 0,
        archived_count INTEGER NOT NULL DEFAULT 0,
        skipped_count INTEGER NOT NULL DEFAULT 0,
        failed_count INTEGER NOT NULL DEFAULT 0
      );
    `);
  }

  beginRun(runId: string): AutoArchiveRunRecord {
    const id = String(runId ?? "").trim();
    if (!id) throw new Error("runId is required");
    this.db
      .prepare(
        "INSERT INTO auto_archive_runs (run_id, started_at, finished_at, status) VALUES (?, ?, NULL, 'running')"
      )
      .run(id, this.nowIso());
    const record = this.get(id);
    if (!record) throw new Error(`Failed to create auto-archive run ${id}`);
    return record;
  }

  finishRun(
    runId: string,
    counts: { candidateCount: number; archivedCount: number; skippedCount: number; failedCount: number }
  ): AutoArchiveRunRecord {
    this.db
      .prepare(
        `UPDATE auto_archive_runs
         SET finished_at = ?, status = 'completed',
             candidate_count = ?, archived_count = ?, skipped_count = ?, failed_count = ?
         WHERE run_id = ?`
      )
      .run(
        this.nowIso(),
        counts.candidateCount,
        counts.archivedCount,
        counts.skippedCount,
        counts.failedCount,
        String(runId ?? "").trim()
      );
    const record = this.get(runId);
    if (!record) throw new Error(`Auto-archive run disappeared: ${runId}`);
    return record;
  }

  /**
   * Startup/downtime reconciliation: a crash between begin and finish leaves
   * `running` rows behind. Mark them `interrupted` and let the next daily
   * sweep do a fresh pass — never one replay per missed day.
   */
  reconcileInterrupted(): number {
    const result = this.db
      .prepare("UPDATE auto_archive_runs SET finished_at = ?, status = 'interrupted' WHERE status = 'running'")
      .run(this.nowIso());
    return Number(result.changes ?? 0);
  }

  get(runId: string): AutoArchiveRunRecord | null {
    const raw = this.db
      .prepare("SELECT * FROM auto_archive_runs WHERE run_id = ?")
      .get(String(runId ?? "").trim()) as unknown as RunRowRaw | null;
    return raw ? toRecord(raw) : null;
  }

  /** Last finished (or interrupted) run — what the management page displays. */
  getLastRun(): AutoArchiveRunRecord | null {
    const raw = this.db
      .prepare(
        "SELECT * FROM auto_archive_runs WHERE status != 'running' ORDER BY finished_at DESC, started_at DESC, rowid DESC LIMIT 1"
      )
      .get() as unknown as RunRowRaw | null;
    return raw ? toRecord(raw) : null;
  }
}
