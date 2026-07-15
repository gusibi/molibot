import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathCompareKey } from "$lib/server/agent/tools/path.js";
import { ensureSqliteParentDir, storagePaths } from "$lib/server/infra/db/storage.js";

export interface ProjectRecord {
  id: string;
  name: string;
  rootPath: string;
  instructions?: string;
  modelKey?: string;
  thinkingLevel?: "off" | "low" | "medium" | "high";
  sandboxEnabled?: boolean;
  toolProgress?: "off" | "new" | "all" | "verbose";
  showReasoning?: "off" | "on" | "stream" | "new";
  runLogNotice?: boolean;
  sandboxProfileId?: string;
  approvalProfileId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectInput {
  name: string;
  rootPath?: string;
  createDirectory?: boolean;
  instructions?: string;
  modelKey?: string;
  thinkingLevel?: "off" | "low" | "medium" | "high";
}

interface ProjectRow {
  id: string;
  name: string;
  root_path: string;
  instructions: string | null;
  model_key: string | null;
  thinking_level: string | null;
  sandbox_enabled: number | null;
  tool_progress: string | null;
  show_reasoning: string | null;
  run_log_notice: number | null;
  sandbox_profile_id: string | null;
  approval_profile_id: string | null;
  created_at: string;
  updated_at: string;
}

export type ProjectRootValidation =
  | { ok: true; resolved: string }
  | { ok: false; reason: string };

function isSameOrDescendant(candidate: string, root: string): boolean {
  const candidateKey = pathCompareKey(candidate);
  const rootKey = pathCompareKey(root);
  return candidateKey === rootKey || candidateKey.startsWith(`${rootKey}${path.sep}`);
}

function canonicalPath(input: string): string {
  const resolved = path.resolve(input);
  return fs.existsSync(resolved) ? fs.realpathSync(resolved) : resolved;
}

export function validateProjectRootPath(rootPath: string): ProjectRootValidation {
  const input = String(rootPath ?? "").trim();
  if (!path.isAbsolute(input)) return { ok: false, reason: "Project directory must be an absolute path." };

  const resolved = canonicalPath(input);
  if (path.parse(resolved).root === resolved) {
    return { ok: false, reason: "The filesystem root cannot be registered as a project." };
  }
  if (pathCompareKey(resolved) === pathCompareKey(canonicalPath(os.homedir()))) {
    return { ok: false, reason: "The home directory itself cannot be registered as a project." };
  }
  const dataDir = canonicalPath(storagePaths.dataDir);
  if (isSameOrDescendant(resolved, dataDir) || isSameOrDescendant(dataDir, resolved)) {
    return { ok: false, reason: "A project directory cannot contain or be inside the Molibot data directory." };
  }
  if (!fs.existsSync(resolved)) return { ok: false, reason: "Project directory does not exist." };
  try {
    if (!fs.statSync(resolved).isDirectory()) {
      return { ok: false, reason: "Project path must point to a directory." };
    }
  } catch {
    return { ok: false, reason: "Project directory cannot be accessed." };
  }
  return { ok: true, resolved };
}

function slugify(value: string): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "project";
}

function projectDirectoryName(value: string): string {
  return String(value ?? "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/[. ]+$/g, "") || "Untitled Project";
}

function rowToProject(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    rootPath: row.root_path,
    instructions: row.instructions || undefined,
    modelKey: row.model_key || undefined,
    thinkingLevel: (["off", "low", "medium", "high"] as const).includes(row.thinking_level as never) ? row.thinking_level as ProjectRecord["thinkingLevel"] : undefined,
    sandboxEnabled: row.sandbox_enabled === null ? undefined : row.sandbox_enabled === 1,
    toolProgress: (["off", "new", "all", "verbose"] as const).includes(row.tool_progress as never) ? row.tool_progress as ProjectRecord["toolProgress"] : undefined,
    showReasoning: (["off", "on", "stream", "new"] as const).includes(row.show_reasoning as never) ? row.show_reasoning as ProjectRecord["showReasoning"] : undefined,
    runLogNotice: row.run_log_notice === null ? undefined : row.run_log_notice === 1,
    sandboxProfileId: row.sandbox_profile_id || undefined,
    approvalProfileId: row.approval_profile_id || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class ProjectStore {
  constructor(
    private readonly dbFile = storagePaths.settingsDbFile,
    private readonly managedProjectsDir = path.join(os.homedir(), "Documents", "Molibot Projects")
  ) {}

  private createManagedRoot(name: string): string {
    fs.mkdirSync(this.managedProjectsDir, { recursive: true });
    const baseName = projectDirectoryName(name);
    for (let suffix = 1; ; suffix += 1) {
      const candidate = path.join(this.managedProjectsDir, suffix === 1 ? baseName : `${baseName} ${suffix}`);
      try {
        fs.mkdirSync(candidate);
        return candidate;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
  }

  private openDb(): DatabaseSync {
    ensureSqliteParentDir(this.dbFile);
    const db = new DatabaseSync(this.dbFile);
    db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        root_path TEXT NOT NULL,
        instructions TEXT,
        model_key TEXT,
        thinking_level TEXT,
        sandbox_enabled INTEGER,
        tool_progress TEXT,
        show_reasoning TEXT,
        run_log_notice INTEGER,
        sandbox_profile_id TEXT,
        approval_profile_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_root_path ON projects(root_path);
      CREATE TABLE IF NOT EXISTS channel_project_bindings (
        channel TEXT NOT NULL,
        bot_id TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (channel, bot_id, scope_id)
      );
      CREATE INDEX IF NOT EXISTS idx_channel_project_bindings_project ON channel_project_bindings(project_id);
    `);
    const columns = new Set((db.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>).map((row) => row.name));
    if (!columns.has("model_key")) db.exec("ALTER TABLE projects ADD COLUMN model_key TEXT");
    if (!columns.has("thinking_level")) db.exec("ALTER TABLE projects ADD COLUMN thinking_level TEXT");
    if (!columns.has("sandbox_enabled")) db.exec("ALTER TABLE projects ADD COLUMN sandbox_enabled INTEGER");
    if (!columns.has("tool_progress")) db.exec("ALTER TABLE projects ADD COLUMN tool_progress TEXT");
    if (!columns.has("show_reasoning")) db.exec("ALTER TABLE projects ADD COLUMN show_reasoning TEXT");
    if (!columns.has("run_log_notice")) db.exec("ALTER TABLE projects ADD COLUMN run_log_notice INTEGER");
    return db;
  }

  list(): ProjectRecord[] {
    const db = this.openDb();
    try {
      return (db.prepare("SELECT * FROM projects ORDER BY updated_at DESC, id ASC").all() as unknown as ProjectRow[])
        .map(rowToProject);
    } finally {
      db.close();
    }
  }

  get(id: string): ProjectRecord | null {
    const db = this.openDb();
    try {
      const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(String(id ?? "").trim()) as unknown as ProjectRow | undefined;
      return row ? rowToProject(row) : null;
    } finally {
      db.close();
    }
  }

  getChannelBinding(channel: string, botId: string, scopeId: string): ProjectRecord | null {
    const db = this.openDb();
    try {
      const row = db.prepare(`
        SELECT p.* FROM channel_project_bindings b
        JOIN projects p ON p.id = b.project_id
        WHERE b.channel = ? AND b.bot_id = ? AND b.scope_id = ?
      `).get(channel, botId, scopeId) as unknown as ProjectRow | undefined;
      return row ? rowToProject(row) : null;
    } finally {
      db.close();
    }
  }

  setChannelBinding(channel: string, botId: string, scopeId: string, projectId?: string | null): ProjectRecord | null {
    const normalizedProjectId = String(projectId ?? "").trim();
    const db = this.openDb();
    try {
      if (!normalizedProjectId) {
        db.prepare("DELETE FROM channel_project_bindings WHERE channel = ? AND bot_id = ? AND scope_id = ?")
          .run(channel, botId, scopeId);
        return null;
      }
      const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(normalizedProjectId) as unknown as ProjectRow | undefined;
      if (!row) throw new Error("Unknown Project.");
      db.prepare(`
        INSERT INTO channel_project_bindings (channel, bot_id, scope_id, project_id, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(channel, bot_id, scope_id) DO UPDATE SET
          project_id = excluded.project_id,
          updated_at = excluded.updated_at
      `).run(channel, botId, scopeId, normalizedProjectId, new Date().toISOString());
      return rowToProject(row);
    } finally {
      db.close();
    }
  }

  create(input: CreateProjectInput): ProjectRecord {
    const name = String(input.name ?? "").trim();
    if (!name) throw new Error("Project name is required.");
    const createdRoot = input.createDirectory ? this.createManagedRoot(name) : "";
    const validation = validateProjectRootPath(createdRoot || String(input.rootPath ?? ""));
    if (!validation.ok) {
      if (createdRoot) fs.rmSync(createdRoot, { recursive: true, force: true });
      throw new Error(validation.reason);
    }

    let db: DatabaseSync | null = null;
    try {
      db = this.openDb();
      const rows = db.prepare("SELECT id, root_path FROM projects").all() as unknown as Array<Pick<ProjectRow, "id" | "root_path">>;
      if (rows.some((row) => pathCompareKey(row.root_path) === pathCompareKey(validation.resolved))) {
        throw new Error("This project directory is already registered.");
      }
      const baseId = slugify(name);
      const ids = new Set(rows.map((row) => row.id));
      let id = baseId;
      for (let suffix = 2; ids.has(id); suffix += 1) id = `${baseId}-${suffix}`;
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO projects (
        id, name, root_path, instructions, model_key, thinking_level, sandbox_profile_id, approval_profile_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`)
        .run(id, name, validation.resolved, String(input.instructions ?? "").trim() || null, String(input.modelKey ?? "").trim() || null, input.thinkingLevel ?? null, now, now);
      return rowToProject(db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as unknown as ProjectRow);
    } catch (error) {
      if (createdRoot) fs.rmSync(createdRoot, { recursive: true, force: true });
      throw error;
    } finally {
      db?.close();
    }
  }

  update(id: string, patch: { name?: string; rootPath?: string; instructions?: string; modelKey?: string | null; thinkingLevel?: ProjectRecord["thinkingLevel"] | null; sandboxEnabled?: boolean | null; toolProgress?: ProjectRecord["toolProgress"] | null; showReasoning?: ProjectRecord["showReasoning"] | null; runLogNotice?: boolean | null }): ProjectRecord | null {
    const existing = this.get(id);
    if (!existing) return null;
    const name = patch.name === undefined ? existing.name : String(patch.name).trim();
    if (!name) throw new Error("Project name is required.");
    let rootPath = existing.rootPath;
    if (patch.rootPath !== undefined) {
      const validation = validateProjectRootPath(patch.rootPath);
      if (!validation.ok) throw new Error(validation.reason);
      rootPath = validation.resolved;
    }
    const duplicate = this.list().find((project) => project.id !== existing.id && pathCompareKey(project.rootPath) === pathCompareKey(rootPath));
    if (duplicate) throw new Error("This project directory is already registered.");
    const instructions = patch.instructions === undefined ? existing.instructions : String(patch.instructions).trim() || undefined;
    const modelKey = patch.modelKey === undefined ? existing.modelKey : String(patch.modelKey ?? "").trim() || undefined;
    const thinkingLevel = patch.thinkingLevel === undefined ? existing.thinkingLevel : patch.thinkingLevel ?? undefined;
    const sandboxEnabled = patch.sandboxEnabled === undefined ? existing.sandboxEnabled : patch.sandboxEnabled ?? undefined;
    const toolProgress = patch.toolProgress === undefined ? existing.toolProgress : patch.toolProgress ?? undefined;
    const showReasoning = patch.showReasoning === undefined ? existing.showReasoning : patch.showReasoning ?? undefined;
    const runLogNotice = patch.runLogNotice === undefined ? existing.runLogNotice : patch.runLogNotice ?? undefined;
    if (thinkingLevel && !["off", "low", "medium", "high"].includes(thinkingLevel)) throw new Error("Invalid Project thinking level.");
    if (toolProgress && !["off", "new", "all", "verbose"].includes(toolProgress)) throw new Error("Invalid Project tool progress setting.");
    if (showReasoning && !["off", "on", "stream", "new"].includes(showReasoning)) throw new Error("Invalid Project reasoning setting.");
    const db = this.openDb();
    try {
      db.prepare("UPDATE projects SET name = ?, root_path = ?, instructions = ?, model_key = ?, thinking_level = ?, sandbox_enabled = ?, tool_progress = ?, show_reasoning = ?, run_log_notice = ?, updated_at = ? WHERE id = ?")
        .run(name, rootPath, instructions ?? null, modelKey ?? null, thinkingLevel ?? null, sandboxEnabled === undefined ? null : Number(sandboxEnabled), toolProgress ?? null, showReasoning ?? null, runLogNotice === undefined ? null : Number(runLogNotice), new Date().toISOString(), existing.id);
      return rowToProject(db.prepare("SELECT * FROM projects WHERE id = ?").get(existing.id) as unknown as ProjectRow);
    } finally {
      db.close();
    }
  }

  remove(id: string): boolean {
    const db = this.openDb();
    try {
      const normalizedId = String(id ?? "").trim();
      db.exec("BEGIN");
      try {
        db.prepare("DELETE FROM channel_project_bindings WHERE project_id = ?").run(normalizedId);
        const removed = Number(db.prepare("DELETE FROM projects WHERE id = ?").run(normalizedId).changes) > 0;
        db.exec("COMMIT");
        return removed;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    } finally {
      db.close();
    }
  }
}

let projectStore: ProjectStore | null = null;

export function getProjectStore(): ProjectStore {
  projectStore ??= new ProjectStore();
  return projectStore;
}
