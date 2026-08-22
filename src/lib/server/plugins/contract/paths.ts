import fs from "node:fs";
import path from "node:path";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { isInside, resolveContainedPath } from "$lib/server/infra/pathSafety.js";

/**
 * Path derivation for the installable-plugin platform.
 *
 * Every plugin filesystem decision funnels through here. Callers get
 * validated absolute paths or null - they never do their own `join` +
 * `startsWith` check, because that is the check symlinks defeat.
 *
 * All roots come from the central storage registry, so an alternate `DATA_DIR`
 * instance stays isolated by construction (the same guarantee the rest of the
 * data tree relies on).
 */

/**
 * `^[a-z][a-z0-9-]{1,62}$` for contract packages - also the on-disk directory
 * name under `plugins/packages`.
 */
const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9-]{1,62}$/;

/**
 * Scope ids additionally accept pi extension directory names (which pi's
 * discovery rules, not us, define), so config/data/cache roots can be keyed by
 * either kind of plugin. Still a single safe path segment: no separators, no
 * leading dot, no `.`/`..`, bounded length.
 */
const SCOPE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** True for a contract-plugin id (package directory name). */
export function isValidPluginId(value: unknown): value is string {
  return typeof value === "string" && PLUGIN_ID_PATTERN.test(value);
}

/**
 * True for any id we are willing to key a config/data/cache directory by -
 * contract plugin ids and pi extension ids alike.
 */
export function isSafePluginScopeId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value === "." || value === "..") return false;
  return SCOPE_ID_PATTERN.test(value);
}

/**
 * The plugin's package directory, proven to be a real directory directly
 * under `plugins/packages` (not a symlink pointing elsewhere). Null when
 * absent, unsafe, or escaping.
 */
export function pluginPackageDir(pluginId: string): string | null {
  if (!isValidPluginId(pluginId)) return null;
  const direct = path.join(storagePaths.pluginsPackagesDir, pluginId);
  try {
    // lstat first: a symlinked package directory is rejected outright rather
    // than silently granting whatever it points at.
    if (!fs.lstatSync(direct).isDirectory()) return null;
  } catch {
    return null;
  }
  return resolveContainedPath(storagePaths.pluginsPackagesDir, pluginId);
}

/** The plugin's durable configuration directory (not required to exist yet). */
export function pluginConfigDir(pluginId: string, root = storagePaths.pluginsConfigDir): string | null {
  return scopedDir(root, pluginId);
}

/** The plugin's durable domain-data directory (not required to exist yet). */
export function pluginDataDir(pluginId: string, root = storagePaths.pluginsDataDir): string | null {
  return scopedDir(root, pluginId);
}

/** The plugin's disposable cache directory (not required to exist yet). */
export function pluginCacheDir(pluginId: string, root = storagePaths.pluginsCacheDir): string | null {
  return scopedDir(root, pluginId);
}

function scopedDir(root: string, pluginId: string): string | null {
  if (!isSafePluginScopeId(pluginId)) return null;
  const resolved = path.resolve(root, pluginId);
  // Belt and braces: the pattern already excludes separators and dot segments,
  // but the containment check is what makes traversal structurally impossible.
  if (!isInside(path.resolve(root), resolved)) return null;
  return resolved;
}

/** `config/<plugin-id>/settings.json` (non-secret settings). */
export function pluginSettingsFilePath(pluginId: string, root = storagePaths.pluginsConfigDir): string | null {
  const dir = pluginConfigDir(pluginId, root);
  return dir === null ? null : path.join(dir, "settings.json");
}

/** `config/<plugin-id>/secrets.json` - owner-only (0600 on POSIX). */
export function pluginSecretsFilePath(pluginId: string, root = storagePaths.pluginsConfigDir): string | null {
  const dir = pluginConfigDir(pluginId, root);
  return dir === null ? null : path.join(dir, "secrets.json");
}

/**
 * True when `candidate` is the plugin's own directory inside `root` - the
 * guard uninstall / delete-retained-state / clear-cache paths use before any
 * `rm -rf`, so a bad id can never delete a sibling's (or the root's) files.
 */
export function isScopedDirPath(root: string, pluginId: string, candidate: string): boolean {
  const expected = scopedDir(root, pluginId);
  return expected !== null && path.resolve(candidate) === expected;
}
