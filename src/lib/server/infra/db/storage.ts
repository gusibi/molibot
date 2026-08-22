import fs from "node:fs";
import path from "node:path";
import { config } from "$lib/server/app/env.js";
import { ensureBuiltinPlugins } from "$lib/server/plugins/contract/builtinBootstrap.js";

export const storagePaths = {
  dataDir: path.resolve(config.dataDir),
  dbDir: path.resolve(config.databaseDir),
  agentsDir: path.resolve(config.dataDir, "agents"),
  settingsFile: path.resolve(config.settingsFile),
  settingsDbFile: path.resolve(config.settingsDbFile),
  inboundQueueDbFile: path.resolve(config.databaseDir, "inbound-queue.sqlite"),
  outboxDbFile: path.resolve(config.databaseDir, "outbox.sqlite"),
  moryDbFile: path.resolve(config.databaseDir, "mory.sqlite"),
  durableExecutionDbFile: path.resolve(config.databaseDir, "durable-execution.sqlite"),
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
  miniAppDataDir: path.resolve(config.dataDir, "miniapps", "data"),
  /**
   * Installable plugin platform (issue #34). Code, config, durable data and
   * cache are siblings with independent lifecycles - the same contract as the
   * Mini App platform above: `packages/` is replaceable (an upgrade swaps only
   * that directory), while `config/` and `data/` survive install, upgrade and -
   * at the owner's choice - uninstall. `cache/` is disposable.
   *
   * Legacy channel/provider plugin manifests live in sibling
   * `plugins/channels|providers` directories; they predate this contract and
   * are not part of it.
   */
  pluginsPackagesDir: path.resolve(config.dataDir, "plugins", "packages"),
  pluginsConfigDir: path.resolve(config.dataDir, "plugins", "config"),
  pluginsDataDir: path.resolve(config.dataDir, "plugins", "data"),
  pluginsCacheDir: path.resolve(config.dataDir, "plugins", "cache"),
  /**
   * Service-owned runtime state: the ownership lock, the state file the desktop
   * supervisor reads, rolled service logs, crash reports, and the extracted
   * runtime generations. Private to the service (mode 0700).
   *
   * The Rust supervisor and `scripts/runtime/runtime-paths.mjs` derive the same
   * layout independently — they run before, and partly outside, this module.
   * Whenever one of the three changes, all three change.
   */
  runtimeDir: path.resolve(config.dataDir, "runtime"),
  /**
   * Agent tool dependencies: the Python venv and its caches, plus GOPATH and
   * GOCACHE when `MOLIBOT_TOOLING_DIR` is set. This is a *working* directory —
   * `wrapCommandWithVenv` puts it on the Agent's PATH and points TMPDIR at it,
   * so the Agent has full write access here by design.
   *
   * That is precisely why it is a sibling of `runtimeDir` and must never become
   * a child of it: the two have opposite owners (Agent vs supervisor), opposite
   * lifecycles (accumulates across versions vs replaced per version) and
   * opposite exposure. Nesting them would put `service.lock`, the service's own
   * state and the running runtime code inside a tree the Agent may delete.
   * `storage.test.ts` asserts the separation so a future tidy-up cannot undo it.
   */
  toolingDir: path.resolve(config.dataDir, "tooling"),
  toolingPythonDir: path.resolve(config.dataDir, "tooling", "python"),
  /**
   * Throwaway artifacts produced by the Settings pages' "test this provider"
   * actions (generated images, TTS samples, video downloads). They used to be
   * written as three separate top-level directories in the data dir, which is
   * how `~/.molibot` accumulated entries that look like real user data.
   */
  settingsTestsDir: path.resolve(config.dataDir, "cache", "settings-tests")
};

/**
 * Directories that need a mode other than the process default. Applied at
 * creation only, so this never fights whoever already owns an existing
 * directory (the service lease creates `runtimeDir` at 0700 before the runtime
 * boots, and chmods it on every acquisition).
 */
const DIR_MODES: Partial<Record<keyof typeof storagePaths, number>> = {
  runtimeDir: 0o700
};

/**
 * Where one Settings provider-test action writes its throwaway output.
 *
 * A single entry point for all three kinds so they cannot drift back into
 * separate top-level directories; `clean-data-dir.mjs` knows the legacy names.
 */
export function settingsTestRoot(kind: "image" | "tts" | "video"): string {
  return path.resolve(storagePaths.settingsTestsDir, kind);
}

/** The same location as a data-dir-relative artifact segment. */
export function settingsTestArtifactDir(kind: "image" | "tts" | "video"): string {
  return path.relative(storagePaths.dataDir, settingsTestRoot(kind)).split(path.sep).join("/");
}

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
  "miniAppDataDir",
  "pluginsPackagesDir",
  "pluginsConfigDir",
  "pluginsDataDir",
  "pluginsCacheDir",
  "runtimeDir",
  "toolingDir",
  "toolingPythonDir",
  "settingsTestsDir"
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
  for (const key of REQUIRED_DIR_KEYS) {
    const dir = storagePaths[key];
    try {
      // `recursive` returns the first path it had to create, or undefined when
      // the directory already existed — exactly the "what changed" signal we
      // want to log on an upgrade.
      const mode = DIR_MODES[key];
      const created = mode === undefined
        ? fs.mkdirSync(dir, { recursive: true })
        : fs.mkdirSync(dir, { recursive: true, mode });
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

  try {
    ensureBuiltinPlugins();
  } catch {
    // best-effort
  }
}
