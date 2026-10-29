import { DatabaseSync } from "node:sqlite";
import { ensureSqliteParentDir } from "$lib/server/infra/db/storage.js";
import type {
  SkillDistributionRecord,
  SkillHealth,
  SkillInstallationRecord,
  SkillOperationKind,
  SkillOperationRecord,
  SkillOperationStatus,
  SkillPlatformConfigRecord,
  SkillPlatformKind,
  SkillSourceKind,
  SkillSourceLocator,
  SkillSourceRecord
} from "$lib/server/skills/types.js";

/**
 * The Skill Manager's own state store.
 *
 * Filesystem truth stays authoritative: the store only keeps what a scan cannot
 * recover — where content came from, which installations Molibot owns, the
 * content baseline used to recognise local edits, and the receipt of every
 * mutation. A missing row is therefore a normal condition, and every reader must
 * fall back to scanning rather than printing a failure.
 */

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS skill_platforms (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    label TEXT NOT NULL,
    enabled INTEGER NOT NULL,
    extra_roots TEXT NOT NULL,
    removed_roots TEXT NOT NULL,
    writable INTEGER NOT NULL,
    verified INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS skill_sources (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    label TEXT NOT NULL,
    locator TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS skill_installations (
    id TEXT PRIMARY KEY,
    skill_name TEXT NOT NULL,
    entry_path TEXT NOT NULL UNIQUE,
    entry_dir TEXT NOT NULL,
    method TEXT NOT NULL,
    scope TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    managed INTEGER NOT NULL,
    source_id TEXT,
    status TEXT NOT NULL,
    baseline_hash TEXT NOT NULL,
    observed_hash TEXT NOT NULL,
    file_count INTEGER NOT NULL,
    installed_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS skill_distributions (
    id TEXT PRIMARY KEY,
    installation_id TEXT NOT NULL,
    target_path TEXT NOT NULL,
    target_label TEXT NOT NULL,
    platform_id TEXT NOT NULL,
    method TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS skill_distributions_by_installation
    ON skill_distributions (installation_id, status);

  CREATE TABLE IF NOT EXISTS skill_operations (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    target_path TEXT NOT NULL,
    staging_path TEXT NOT NULL,
    backup_path TEXT NOT NULL,
    payload TEXT NOT NULL,
    error TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS skill_operations_by_status
    ON skill_operations (status, created_at);
`;

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function bool(value: unknown): boolean {
  return Number(value) === 1;
}

function platformFromRow(row: Record<string, unknown>): SkillPlatformConfigRecord {
  return {
    id: String(row.id),
    kind: String(row.kind) as SkillPlatformKind,
    label: String(row.label),
    enabled: bool(row.enabled),
    extraRoots: parseJson<string[]>(row.extra_roots, []),
    removedRoots: parseJson<string[]>(row.removed_roots, []),
    writable: bool(row.writable),
    verified: bool(row.verified),
    updatedAt: String(row.updated_at)
  };
}

function sourceFromRow(row: Record<string, unknown>): SkillSourceRecord {
  return {
    id: String(row.id),
    kind: String(row.kind) as SkillSourceKind,
    label: String(row.label),
    locator: parseJson<SkillSourceLocator>(row.locator, {}),
    createdAt: String(row.created_at)
  };
}

function installationFromRow(row: Record<string, unknown>): SkillInstallationRecord {
  return {
    id: String(row.id),
    skillName: String(row.skill_name),
    entryPath: String(row.entry_path),
    entryDir: String(row.entry_dir),
    method: String(row.method) as SkillInstallationRecord["method"],
    scope: String(row.scope) as SkillInstallationRecord["scope"],
    ownerId: String(row.owner_id),
    managed: bool(row.managed),
    sourceId: row.source_id === null ? null : String(row.source_id),
    status: String(row.status) as SkillHealth,
    baselineHash: String(row.baseline_hash),
    observedHash: String(row.observed_hash),
    fileCount: Number(row.file_count),
    installedAt: String(row.installed_at),
    updatedAt: String(row.updated_at)
  };
}

function distributionFromRow(row: Record<string, unknown>): SkillDistributionRecord {
  return {
    id: String(row.id),
    installationId: String(row.installation_id),
    targetPath: String(row.target_path),
    targetLabel: String(row.target_label),
    platformId: String(row.platform_id),
    method: String(row.method) as SkillDistributionRecord["method"],
    status: String(row.status) as SkillDistributionRecord["status"],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function operationFromRow(row: Record<string, unknown>): SkillOperationRecord {
  return {
    id: String(row.id),
    kind: String(row.kind) as SkillOperationKind,
    status: String(row.status) as SkillOperationStatus,
    targetPath: String(row.target_path),
    stagingPath: String(row.staging_path),
    backupPath: String(row.backup_path),
    payload: parseJson<Record<string, unknown>>(row.payload, {}),
    error: String(row.error),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export class SkillManagerStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    ensureSqliteParentDir(dbPath);
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  // ── Platforms ─────────────────────────────────────────────────────────────

  listPlatforms(): SkillPlatformConfigRecord[] {
    const rows = this.db.prepare("SELECT * FROM skill_platforms ORDER BY kind ASC, id ASC").all();
    return rows.map((row) => platformFromRow(row as Record<string, unknown>));
  }

  getPlatform(id: string): SkillPlatformConfigRecord | null {
    const row = this.db.prepare("SELECT * FROM skill_platforms WHERE id = ?").get(id);
    return row ? platformFromRow(row as Record<string, unknown>) : null;
  }

  /** Entity-level save: only the rows in the patch are written. */
  savePlatforms(rows: readonly SkillPlatformConfigRecord[]): void {
    const statement = this.db.prepare(`
      INSERT INTO skill_platforms (id, kind, label, enabled, extra_roots, removed_roots, writable, verified, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        kind = excluded.kind,
        label = excluded.label,
        enabled = excluded.enabled,
        extra_roots = excluded.extra_roots,
        removed_roots = excluded.removed_roots,
        writable = excluded.writable,
        verified = excluded.verified,
        updated_at = excluded.updated_at
    `);
    for (const row of rows) {
      statement.run(
        row.id,
        row.kind,
        row.label,
        row.enabled ? 1 : 0,
        JSON.stringify(row.extraRoots),
        JSON.stringify(row.removedRoots),
        row.writable ? 1 : 0,
        row.verified ? 1 : 0,
        row.updatedAt
      );
    }
  }

  deletePlatform(id: string): void {
    this.db.prepare("DELETE FROM skill_platforms WHERE id = ? AND kind = 'custom'").run(id);
  }

  // ── Sources ───────────────────────────────────────────────────────────────

  getSource(id: string): SkillSourceRecord | null {
    const row = this.db.prepare("SELECT * FROM skill_sources WHERE id = ?").get(id);
    return row ? sourceFromRow(row as Record<string, unknown>) : null;
  }

  upsertSource(source: SkillSourceRecord): void {
    this.db.prepare(`
      INSERT INTO skill_sources (id, kind, label, locator, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, label = excluded.label, locator = excluded.locator
    `).run(source.id, source.kind, source.label, JSON.stringify(source.locator), source.createdAt);
  }

  // ── Installations ─────────────────────────────────────────────────────────

  listInstallations(): SkillInstallationRecord[] {
    return this.db.prepare("SELECT * FROM skill_installations ORDER BY installed_at ASC").all()
      .map((row) => installationFromRow(row as Record<string, unknown>));
  }

  getInstallationByEntry(entryPath: string): SkillInstallationRecord | null {
    const row = this.db.prepare("SELECT * FROM skill_installations WHERE entry_path = ?").get(entryPath);
    return row ? installationFromRow(row as Record<string, unknown>) : null;
  }

  getInstallation(id: string): SkillInstallationRecord | null {
    const row = this.db.prepare("SELECT * FROM skill_installations WHERE id = ?").get(id);
    return row ? installationFromRow(row as Record<string, unknown>) : null;
  }

  upsertInstallation(record: SkillInstallationRecord): void {
    this.db.prepare(`
      INSERT INTO skill_installations (
        id, skill_name, entry_path, entry_dir, method, scope, owner_id, managed, source_id,
        status, baseline_hash, observed_hash, file_count, installed_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(entry_path) DO UPDATE SET
        skill_name = excluded.skill_name,
        entry_dir = excluded.entry_dir,
        method = excluded.method,
        scope = excluded.scope,
        owner_id = excluded.owner_id,
        managed = excluded.managed,
        source_id = excluded.source_id,
        status = excluded.status,
        baseline_hash = excluded.baseline_hash,
        observed_hash = excluded.observed_hash,
        file_count = excluded.file_count,
        updated_at = excluded.updated_at
    `).run(
      record.id,
      record.skillName,
      record.entryPath,
      record.entryDir,
      record.method,
      record.scope,
      record.ownerId,
      record.managed ? 1 : 0,
      record.sourceId,
      record.status,
      record.baselineHash,
      record.observedHash,
      record.fileCount,
      record.installedAt,
      record.updatedAt
    );
  }

  deleteInstallation(id: string): void {
    this.db.prepare("DELETE FROM skill_installations WHERE id = ?").run(id);
  }

  // ── Distributions ─────────────────────────────────────────────────────────

  listDistributions(installationId?: string): SkillDistributionRecord[] {
    const rows = installationId
      ? this.db.prepare("SELECT * FROM skill_distributions WHERE installation_id = ? ORDER BY created_at ASC").all(installationId)
      : this.db.prepare("SELECT * FROM skill_distributions ORDER BY created_at ASC").all();
    return rows.map((row) => distributionFromRow(row as Record<string, unknown>));
  }

  upsertDistribution(record: SkillDistributionRecord): void {
    this.db.prepare(`
      INSERT INTO skill_distributions (
        id, installation_id, target_path, target_label, platform_id, method, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        target_path = excluded.target_path,
        target_label = excluded.target_label,
        platform_id = excluded.platform_id,
        method = excluded.method,
        status = excluded.status,
        updated_at = excluded.updated_at
    `).run(
      record.id,
      record.installationId,
      record.targetPath,
      record.targetLabel,
      record.platformId,
      record.method,
      record.status,
      record.createdAt,
      record.updatedAt
    );
  }

  // ── Operations ────────────────────────────────────────────────────────────

  beginOperation(record: SkillOperationRecord): void {
    this.db.prepare(`
      INSERT INTO skill_operations (
        id, kind, status, target_path, staging_path, backup_path, payload, error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.kind,
      record.status,
      record.targetPath,
      record.stagingPath,
      record.backupPath,
      JSON.stringify(record.payload),
      record.error,
      record.createdAt,
      record.updatedAt
    );
  }

  finishOperation(id: string, status: SkillOperationStatus, patch?: { error?: string; backupPath?: string; stagingPath?: string }): void {
    this.db.prepare(`
      UPDATE skill_operations
      SET status = ?, error = ?, backup_path = COALESCE(?, backup_path), staging_path = COALESCE(?, staging_path), updated_at = ?
      WHERE id = ?
    `).run(
      status,
      patch?.error ?? "",
      patch?.backupPath ?? null,
      patch?.stagingPath ?? null,
      new Date().toISOString(),
      id
    );
  }

  listOperations(limit = 20): SkillOperationRecord[] {
    return this.db.prepare("SELECT * FROM skill_operations ORDER BY created_at DESC LIMIT ?").all(limit)
      .map((row) => operationFromRow(row as Record<string, unknown>));
  }

  listPendingOperations(): SkillOperationRecord[] {
    return this.db.prepare("SELECT * FROM skill_operations WHERE status = 'pending' ORDER BY created_at ASC").all()
      .map((row) => operationFromRow(row as Record<string, unknown>));
  }
}
