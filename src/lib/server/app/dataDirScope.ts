import path from "node:path";

/**
 * Layering rules for the paths derived from `DATA_DIR`.
 *
 * Every persistent location (database dir, settings file, sessions, channel
 * workspaces, the pi agent dir) defaults to a subdirectory of `DATA_DIR`, but
 * each also has its own override variable. Those two facts combined produced a
 * silent split-brain: `dotenv` merges the repository's `.env` into
 * `process.env` before anything resolves a path, so a repo-level
 * `DB_DIR=~/.molibot/db` stayed pinned to the *production* database even when
 * the process was started with `DATA_DIR=/tmp/throwaway`. Five smoke instances
 * ran for twelve days that way: sessions and workspaces went to `/tmp`, while
 * `settings.sqlite` — and with it the live WeChat token — was opened read-write
 * on the owner's real data directory (prd.md §3.41).
 *
 * The rule that prevents it: an override is honoured only when it comes from
 * the same configuration layer as `DATA_DIR`, or from a layer that is itself
 * scoped to the data directory.
 *
 *   layer 0  OS environment          — explicit, wins
 *   layer 1  cwd `.env`              — repository-wide, NOT specific to a run
 *   layer 2  `<dataDir>/.env`        — inside the data dir, so always in scope
 *
 * When `DATA_DIR` is chosen at layer 0 and an override exists only at layer 1,
 * the override is a leftover from the repository rather than a decision about
 * this run, and is dropped in favour of the `DATA_DIR`-relative default.
 */
export class DataDirScopeError extends Error {
  readonly code = "MOLIBOT_DATA_DIR_SCOPE";

  constructor(message: string) {
    super(message);
    this.name = "DataDirScopeError";
  }
}

export const ALLOW_EXTERNAL_PATHS_ENV = "MOLIBOT_ALLOW_EXTERNAL_DATA_PATHS";

/**
 * Where a launcher hands over the layer-0 key set it saw before merging `.env`.
 *
 * `scripts/start-server.mjs` must read the repository `.env` to resolve
 * `DATA_DIR` and the port before the runtime loads, and that merge erases the
 * very distinction this module is built on: afterwards, a `DB_DIR` the
 * repository pinned looks exactly like one the operator exported. So the
 * launcher records `Object.keys(process.env)` on its side of the merge and
 * publishes it here.
 */
export const OS_ENV_KEYS_VAR = "MOLIBOT_OS_ENV_KEYS";

/**
 * The OS environment layer, preferring a launcher's hand-off over a local
 * snapshot that may already be contaminated.
 *
 * A malformed hand-off falls back to the local snapshot rather than throwing or
 * treating the layer as empty: too-permissive is what the code did before this
 * existed, while an empty layer-0 would make every variable look repository-
 * scoped and silently drop overrides the operator really did set.
 */
export function resolveOsEnvKeys(
  env: NodeJS.ProcessEnv,
  onWarn: (message: string) => void = () => {}
): Set<string> {
  const published = env[OS_ENV_KEYS_VAR];
  if (published) {
    try {
      const parsed = JSON.parse(published);
      if (Array.isArray(parsed)) return new Set(parsed.map(String));
      onWarn(`${OS_ENV_KEYS_VAR} is not a list of names; falling back to the local snapshot`);
    } catch {
      onWarn(`${OS_ENV_KEYS_VAR} is not valid JSON; falling back to the local snapshot`);
    }
  }
  return new Set(Object.keys(env));
}

export function isInsideDir(parent: string, target: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  if (relative === "") return true;
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

export interface DataDirScopeOptions {
  dataDir: string;
  /** True when `DATA_DIR` itself was set in the OS environment (layer 0). */
  dataDirFromOsEnv: boolean;
  /** True when `DATA_DIR` was not set anywhere and fell back to `~/.molibot`. */
  dataDirIsDefault: boolean;
  /** True for a variable introduced by the cwd `.env` and absent from the OS env. */
  isCwdEnvOnly: (name: string) => boolean;
  /** Escape hatch for deployments that deliberately place data on another volume. */
  allowExternal: boolean;
  expandHomePath: (input: string) => string;
}

export interface DataDirScope {
  /**
   * Resolve one `DATA_DIR`-derived path. `fallback` must already be the
   * `DATA_DIR`-relative default.
   */
  resolve(name: string, raw: string | undefined, fallback: string): string;
  /** Variables dropped because they came from the wrong layer. */
  ignoredOverrides(): string[];
}

export function createDataDirScope(options: DataDirScopeOptions): DataDirScope {
  const ignored: string[] = [];

  function assertContained(name: string, value: string): void {
    // With the default data directory there is no isolation claim to break.
    if (options.dataDirIsDefault || options.allowExternal) return;
    if (isInsideDir(options.dataDir, value)) return;
    throw new DataDirScopeError(
      `${name} resolves to ${value}, which is outside DATA_DIR (${options.dataDir}). ` +
        `Refusing to start: a non-default DATA_DIR whose data still points at another ` +
        `directory shares that directory's database and credentials. Either drop ${name} ` +
        `so it follows DATA_DIR, or set ${ALLOW_EXTERNAL_PATHS_ENV}=1 to confirm this is intended.`
    );
  }

  return {
    resolve(name, raw, fallback) {
      if (raw === undefined || raw.trim() === "") return fallback;
      if (options.dataDirFromOsEnv && options.isCwdEnvOnly(name)) {
        ignored.push(name);
        return fallback;
      }
      const value = options.expandHomePath(raw);
      assertContained(name, value);
      return value;
    },
    ignoredOverrides() {
      return [...ignored];
    }
  };
}
