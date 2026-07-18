import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { ensureSqliteParentDir, storagePaths } from "$lib/server/infra/db/storage.js";
import type { MemoryInjectionItem } from "$lib/server/memory/types.js";

interface SnapshotRow {
  fingerprint: string;
  items_json: string;
}

interface SummaryRow {
  fingerprint: string;
  summary: string;
}

export class MemoryProfileSnapshotStore {
  private readonly db: DatabaseSync;

  constructor(dbFile = storagePaths.settingsDbFile) {
    ensureSqliteParentDir(dbFile);
    this.db = new DatabaseSync(dbFile);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_profile_snapshots (
        session_id TEXT NOT NULL,
        scope_key TEXT NOT NULL,
        version INTEGER NOT NULL,
        fingerprint TEXT NOT NULL,
        items_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(session_id, scope_key)
      );
      CREATE TABLE IF NOT EXISTS memory_profile_summaries (
        scope_key TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL,
        summary TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  getSummary(scopeKey: string, fingerprint: string): string | undefined {
    const row = this.db.prepare(`
      SELECT fingerprint, summary FROM memory_profile_summaries WHERE scope_key = ?
    `).get(scopeKey) as SummaryRow | undefined;
    return row && row.fingerprint === fingerprint ? row.summary : undefined;
  }

  setSummary(scopeKey: string, fingerprint: string, summary: string): void {
    this.db.prepare(`
      INSERT INTO memory_profile_summaries(scope_key, fingerprint, summary, created_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(scope_key) DO UPDATE SET fingerprint = excluded.fingerprint, summary = excluded.summary, created_at = excluded.created_at
    `).run(scopeKey, fingerprint, summary, new Date().toISOString());
  }

  getOrCreate(sessionId: string, scopeKey: string, items: MemoryInjectionItem[]): { version: 1; baseFingerprint: string; baseItems: MemoryInjectionItem[] } {
    const existing = this.db.prepare(`
      SELECT fingerprint, items_json FROM memory_profile_snapshots WHERE session_id = ? AND scope_key = ?
    `).get(sessionId, scopeKey) as SnapshotRow | undefined;
    if (existing) return { version: 1, baseFingerprint: existing.fingerprint, baseItems: this.parseItems(existing.items_json) };
    const stableItems = items.map((item) => ({ ...item, snapshot: { ...item.snapshot, tags: [...item.snapshot.tags] } }));
    const fingerprint = createHash("sha256").update(JSON.stringify(stableItems)).digest("hex");
    this.db.prepare(`
      INSERT OR IGNORE INTO memory_profile_snapshots(session_id, scope_key, version, fingerprint, items_json, created_at)
      VALUES (?, ?, 1, ?, ?, ?)
    `).run(sessionId, scopeKey, fingerprint, JSON.stringify(stableItems), new Date().toISOString());
    const row = this.db.prepare(`
      SELECT fingerprint, items_json FROM memory_profile_snapshots WHERE session_id = ? AND scope_key = ?
    `).get(sessionId, scopeKey) as unknown as SnapshotRow;
    return { version: 1, baseFingerprint: row.fingerprint, baseItems: this.parseItems(row.items_json) };
  }

  close(): void {
    this.db.close();
  }

  private parseItems(value: string): MemoryInjectionItem[] {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed as MemoryInjectionItem[] : [];
    } catch {
      return [];
    }
  }
}

let defaultStore: MemoryProfileSnapshotStore | undefined;

export function getMemoryProfileSnapshotStore(): MemoryProfileSnapshotStore {
  defaultStore ??= new MemoryProfileSnapshotStore();
  return defaultStore;
}
