import fs from "node:fs";
import path from "node:path";
import { config } from "$lib/server/app/env.js";

export const storagePaths = {
  dataDir: path.resolve(config.dataDir),
  dbDir: path.resolve(config.databaseDir),
  agentsDir: path.resolve(config.dataDir, "agents"),
  settingsFile: path.resolve(config.settingsFile),
  settingsDbFile: path.resolve(config.settingsDbFile),
  inboundQueueDbFile: path.resolve(config.databaseDir, "inbound-queue.sqlite"),
  outboxDbFile: path.resolve(config.databaseDir, "outbox.sqlite"),
  moryDbFile: path.resolve(config.databaseDir, "mory.sqlite"),
  memoryDir: path.resolve(config.dataDir, "memory"),
  projectsDir: path.resolve(config.dataDir, "projects"),
  webWorkspaceDir: path.resolve(config.webWorkspaceDir),
  sessionsDir: path.resolve(config.sessionsDir),
  sessionsIndexFile: path.resolve(config.sessionsIndexFile),
  /**
   * The global (owner-wide) Skill root. Must stay in step with
   * `resolveGlobalSkillsDirFromWorkspacePath`, which is how the loader derives
   * the same directory from a workspace path.
   */
  globalSkillsDir: path.resolve(config.dataDir, "skills"),
  // Mini App platform. Code and data are siblings with independent lifecycles:
  // `apps/` is replaceable (an upgrade swaps the whole directory), `data/`
  // survives install, upgrade and — at the owner's choice — uninstall.
  miniAppsDir: path.resolve(config.dataDir, "miniapps"),
  miniAppCodeDir: path.resolve(config.dataDir, "miniapps", "apps"),
  miniAppDataDir: path.resolve(config.dataDir, "miniapps", "data")
};

const SQLITE_SIDE_SUFFIXES = ["-wal", "-shm"];

/**
 * Keys of {@link storagePaths} that name a directory the service must be able
 * to count on, in creation order (parents before children).
 *
 * This is data rather than a hand-written sequence of `mkdirSync` calls for one
 * reason: a release that adds a storage location and forgets to bootstrap it
 * only breaks on an *upgraded* install, where the directory a fresh install
 * would have created never existed. `storage.test.ts` asserts that every
 * `*Dir` key in `storagePaths` appears here, so the omission fails the suite
 * instead of an owner's machine.
 */
const REQUIRED_DIR_KEYS = [
  "dataDir",
  "dbDir",
  "agentsDir",
  "memoryDir",
  "projectsDir",
  "webWorkspaceDir",
  "sessionsDir",
  "globalSkillsDir",
  "miniAppsDir",
  "miniAppCodeDir",
  "miniAppDataDir"
] as const satisfies ReadonlyArray<keyof typeof storagePaths>;

/** Test seam: the same list the bootstrap walks, as absolute paths. */
export function requiredStorageDirs(): string[] {
  return REQUIRED_DIR_KEYS.map((key) => storagePaths[key]);
}

export interface EnsureStorageDirsResult {
  /** Directories that did not exist and were created by this call. */
  created: string[];
  failed: Array<{ path: string; error: string }>;
}

/**
 * Creates every required directory, independently.
 *
 * Each `mkdir` gets its own try/catch on purpose: one unwritable location (a
 * stale symlink, a permission change, a path the owner moved) must not stop
 * the remaining directories from being created. The caller decides what a
 * failure means; this function always attempts all of them.
 */
export function ensureStorageDirs(): EnsureStorageDirsResult {
  const result: EnsureStorageDirsResult = { created: [], failed: [] };
  for (const dir of requiredStorageDirs()) {
    try {
      // `recursive` returns the first path it had to create, or undefined when
      // the directory already existed — exactly the "what changed" signal we
      // want to log on an upgrade.
      const created = fs.mkdirSync(dir, { recursive: true });
      if (created) result.created.push(dir);
    } catch (error) {
      result.failed.push({ path: dir, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}

export function readJsonFile<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJsonFile(filePath: string, value: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tmpPath, filePath);
}

function moveFileIfTargetMissing(fromPath: string, toPath: string): void {
  if (fromPath === toPath) return;
  if (!fs.existsSync(fromPath) || fs.existsSync(toPath)) return;
  fs.mkdirSync(path.dirname(toPath), { recursive: true });
  fs.renameSync(fromPath, toPath);
}

function migrateSqliteFile(fromPath: string, toPath: string): void {
  moveFileIfTargetMissing(fromPath, toPath);
  for (const suffix of SQLITE_SIDE_SUFFIXES) {
    moveFileIfTargetMissing(`${fromPath}${suffix}`, `${toPath}${suffix}`);
  }
}

export function ensureSqliteParentDir(dbFile: string): void {
  if (dbFile === ":memory:") return;
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
}

function migrateLegacyDbFiles(): void {
  migrateSqliteFile(path.resolve(config.dataDir, "settings.sqlite"), storagePaths.settingsDbFile);
  migrateSqliteFile(path.resolve(config.dataDir, "inbound-queue.sqlite"), storagePaths.inboundQueueDbFile);
  migrateSqliteFile(path.resolve(config.dataDir, "outbox.sqlite"), storagePaths.outboxDbFile);
  migrateSqliteFile(path.resolve(config.dataDir, "memory", "mory.sqlite"), storagePaths.moryDbFile);
  migrateSqliteFile(path.resolve(config.dataDir, "sessions.db"), path.resolve(storagePaths.dbDir, "sessions.db"));
  migrateSqliteFile(
    path.resolve(config.dataDir, "moli-t", "settings.sqlite"),
    path.resolve(storagePaths.dbDir, "moli-t", "settings.sqlite")
  );
}

export function initDb(): void {
  const dirs = ensureStorageDirs();
  if (dirs.created.length > 0) {
    // An upgrade that introduces a storage location creates it here, on the
    // first start after the update. Logging it is what makes "the feature was
    // installed but its directory never appeared" diagnosable.
    console.log(`[storage] bootstrap_created_dirs count=${dirs.created.length} paths=[${dirs.created.join(", ")}]`);
  }
  if (dirs.failed.length > 0) {
    throw new Error(
      `Failed to create required storage directories: ${dirs.failed
        .map((entry) => `${entry.path} (${entry.error})`)
        .join("; ")}`
    );
  }
  ensureSqliteParentDir(storagePaths.settingsDbFile);
  // Legacy relocation is best-effort: it moves files that a *previous* layout
  // left behind, and a failure there (a cross-device rename, a file another
  // process still holds) must not stop a working install from booting.
  try {
    migrateLegacyDbFiles();
  } catch (error) {
    console.error("[storage] Failed to migrate legacy database files:", error);
  }

  if (!fs.existsSync(storagePaths.settingsFile)) {
    writeJsonFile(storagePaths.settingsFile, {});
  }
  if (!fs.existsSync(storagePaths.sessionsIndexFile)) {
    writeJsonFile(storagePaths.sessionsIndexFile, {});
  }
}
