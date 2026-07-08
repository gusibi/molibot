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
}

interface ProjectRow {
  id: string;
  name: string;
  root_path: string;
  instructions: string | null;
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
        sandbox_profile_id TEXT,
        approval_profile_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_root_path ON projects(root_path);
    `);
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
        id, name, root_path, instructions, sandbox_profile_id, approval_profile_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)`)
        .run(id, name, validation.resolved, String(input.instructions ?? "").trim() || null, now, now);
      return rowToProject(db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as unknown as ProjectRow);
    } catch (error) {
      if (createdRoot) fs.rmSync(createdRoot, { recursive: true, force: true });
      throw error;
    } finally {
      db?.close();
    }
  }

  update(id: string, patch: { name?: string; rootPath?: string; instructions?: string }): ProjectRecord | null {
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
    const db = this.openDb();
    try {
      db.prepare("UPDATE projects SET name = ?, root_path = ?, instructions = ?, updated_at = ? WHERE id = ?")
        .run(name, rootPath, instructions ?? null, new Date().toISOString(), existing.id);
      return rowToProject(db.prepare("SELECT * FROM projects WHERE id = ?").get(existing.id) as unknown as ProjectRow);
    } finally {
      db.close();
    }
  }

  remove(id: string): boolean {
    const db = this.openDb();
    try {
      return Number(db.prepare("DELETE FROM projects WHERE id = ?").run(String(id ?? "").trim()).changes) > 0;
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
