import { DatabaseSync } from "node:sqlite";
import { ensureSqliteParentDir, storagePaths } from "$lib/server/infra/db/storage.js";

export const DEFAULT_WORKSPACE_ID = "personal";

export type WorkspaceMemoryScope = "global" | "workspace" | "session";

export interface WorkspaceRecord {
  id: string;
  name: string;
  rootPath?: string;
  enabledSkillPaths: string[];
  enabledToolIds: string[];
  sandboxProfileId?: string;
  approvalProfileId?: string;
  memoryScope: WorkspaceMemoryScope;
  createdAt: string;
  updatedAt: string;
}

interface WorkspaceRow {
  id: string;
  name: string;
  root_path: string | null;
  enabled_skill_paths: string;
  enabled_tool_ids: string;
  sandbox_profile_id: string | null;
  approval_profile_id: string | null;
  memory_scope: string;
  created_at: string;
  updated_at: string;
}

function sanitizeId(value: unknown, fallback = DEFAULT_WORKSPACE_ID): string {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function parseStringList(raw: unknown): string[] {
  try {
    const parsed = JSON.parse(String(raw ?? "[]")) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => String(item ?? "").trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function stringifyStringList(values: unknown): string {
  if (!Array.isArray(values)) return "[]";
  return JSON.stringify(values.map((item) => String(item ?? "").trim()).filter(Boolean));
}

function sanitizeMemoryScope(value: unknown): WorkspaceMemoryScope {
  return value === "global" || value === "session" ? value : "workspace";
}

function rowToWorkspace(row: WorkspaceRow): WorkspaceRecord {
  return {
    id: row.id,
    name: row.name,
    rootPath: row.root_path || undefined,
    enabledSkillPaths: parseStringList(row.enabled_skill_paths),
    enabledToolIds: parseStringList(row.enabled_tool_ids),
    sandboxProfileId: row.sandbox_profile_id || undefined,
    approvalProfileId: row.approval_profile_id || undefined,
    memoryScope: sanitizeMemoryScope(row.memory_scope),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class WorkspaceStore {
  constructor(private readonly dbFile = storagePaths.settingsDbFile) {}

  private openDb(): DatabaseSync {
    ensureSqliteParentDir(this.dbFile);
    const db = new DatabaseSync(this.dbFile);
    db.exec(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        root_path TEXT,
        enabled_skill_paths TEXT NOT NULL DEFAULT '[]',
        enabled_tool_ids TEXT NOT NULL DEFAULT '[]',
        sandbox_profile_id TEXT,
        approval_profile_id TEXT,
        memory_scope TEXT NOT NULL DEFAULT 'workspace',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_workspaces_updated_at ON workspaces(updated_at);
    `);
    return db;
  }

  ensureDefaultWorkspace(): WorkspaceRecord {
    const db = this.openDb();
    try {
      const existing = db.prepare("SELECT * FROM workspaces WHERE id = ?").get(DEFAULT_WORKSPACE_ID) as unknown as WorkspaceRow | undefined;
      if (existing) return rowToWorkspace(existing);

      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO workspaces (
          id,
          name,
          root_path,
          enabled_skill_paths,
          enabled_tool_ids,
          sandbox_profile_id,
          approval_profile_id,
          memory_scope,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        DEFAULT_WORKSPACE_ID,
        "Personal",
        null,
        "[]",
        "[]",
        null,
        null,
        "workspace",
        now,
        now
      );
      const inserted = db.prepare("SELECT * FROM workspaces WHERE id = ?").get(DEFAULT_WORKSPACE_ID) as unknown as WorkspaceRow;
      return rowToWorkspace(inserted);
    } finally {
      db.close();
    }
  }

  getWorkspace(id: string): WorkspaceRecord | null {
    const workspaceId = sanitizeId(id);
    const db = this.openDb();
    try {
      const row = db.prepare("SELECT * FROM workspaces WHERE id = ?").get(workspaceId) as unknown as WorkspaceRow | undefined;
      return row ? rowToWorkspace(row) : null;
    } finally {
      db.close();
    }
  }

  listWorkspaces(): WorkspaceRecord[] {
    const db = this.openDb();
    try {
      const rows = db.prepare("SELECT * FROM workspaces ORDER BY updated_at DESC, id ASC").all() as unknown as WorkspaceRow[];
      return rows.map(rowToWorkspace);
    } finally {
      db.close();
    }
  }

  upsertWorkspace(input: {
    id: string;
    name: string;
    rootPath?: string;
    enabledSkillPaths?: string[];
    enabledToolIds?: string[];
    sandboxProfileId?: string;
    approvalProfileId?: string;
    memoryScope?: WorkspaceMemoryScope;
  }): WorkspaceRecord {
    const id = sanitizeId(input.id);
    const now = new Date().toISOString();
    const existing = this.getWorkspace(id);
    const createdAt = existing?.createdAt ?? now;
    const db = this.openDb();
    try {
      db.prepare(`
        INSERT INTO workspaces (
          id,
          name,
          root_path,
          enabled_skill_paths,
          enabled_tool_ids,
          sandbox_profile_id,
          approval_profile_id,
          memory_scope,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          root_path = excluded.root_path,
          enabled_skill_paths = excluded.enabled_skill_paths,
          enabled_tool_ids = excluded.enabled_tool_ids,
          sandbox_profile_id = excluded.sandbox_profile_id,
          approval_profile_id = excluded.approval_profile_id,
          memory_scope = excluded.memory_scope,
          updated_at = excluded.updated_at
      `).run(
        id,
        String(input.name ?? "").trim() || id,
        input.rootPath ? String(input.rootPath).trim() : null,
        stringifyStringList(input.enabledSkillPaths),
        stringifyStringList(input.enabledToolIds),
        input.sandboxProfileId ? String(input.sandboxProfileId).trim() : null,
        input.approvalProfileId ? String(input.approvalProfileId).trim() : null,
        sanitizeMemoryScope(input.memoryScope),
        createdAt,
        now
      );
      const row = db.prepare("SELECT * FROM workspaces WHERE id = ?").get(id) as unknown as WorkspaceRow;
      return rowToWorkspace(row);
    } finally {
      db.close();
    }
  }
}

let workspaceStore: WorkspaceStore | null = null;

export function getWorkspaceStore(): WorkspaceStore {
  workspaceStore ??= new WorkspaceStore();
  return workspaceStore;
}

export function resolveWorkspaceId(input?: string | null): string {
  const candidate = sanitizeId(input, "");
  if (candidate) return candidate;
  return getWorkspaceStore().ensureDefaultWorkspace().id;
}
