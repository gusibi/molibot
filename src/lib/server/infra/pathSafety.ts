import fs from "node:fs";
import path from "node:path";

/**
 * Filesystem containment helpers shared by every host-managed plugin-style
 * surface (Mini Apps, installable plugins). Callers get booleans and resolved
 * absolute paths; they never do their own `join` + `startsWith` check, because
 * that is the check symlinks defeat.
 */

/**
 * True when `relative` is a plain, forward-only relative path: no absolute
 * form, no `..` segment, no null byte, no Windows drive letter, no backslash.
 * This is the *syntactic* gate; containment below is the real one.
 */
export function isSafeRelativePath(relative: string): boolean {
  if (typeof relative !== "string" || relative.length === 0) return false;
  if (relative.includes("\0")) return false;
  if (relative.includes("\\")) return false;
  if (path.isAbsolute(relative)) return false;
  if (/^[a-zA-Z]:/.test(relative)) return false;
  const segments = relative.split("/");
  return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/**
 * Resolves `relative` under `root` and proves the result is really inside
 * `root` *after* following symlinks. Returns null when the path escapes, does
 * not exist, or is not a regular file when `requireFile` is set.
 *
 * Realpath is applied to the deepest existing ancestor so a missing leaf is
 * reported as "not found" rather than silently passing containment.
 */
export function resolveContainedPath(
  root: string,
  relative: string,
  options: { requireFile?: boolean } = {}
): string | null {
  if (!isSafeRelativePath(relative)) return null;
  let realRoot: string;
  try {
    realRoot = fs.realpathSync(root);
  } catch {
    return null;
  }

  const candidate = path.resolve(realRoot, relative);
  let realCandidate: string;
  try {
    realCandidate = fs.realpathSync(candidate);
  } catch {
    return null;
  }

  if (!isInside(realRoot, realCandidate)) return null;
  if (options.requireFile) {
    try {
      if (!fs.statSync(realCandidate).isFile()) return null;
    } catch {
      return null;
    }
  }
  return realCandidate;
}

/** True when `child` is `parent` itself or lives beneath it. */
export function isInside(parent: string, child: string): boolean {
  if (child === parent) return true;
  const relative = path.relative(parent, child);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}
