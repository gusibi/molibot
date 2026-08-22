import fs from "node:fs";
import path from "node:path";
import { resolveContainedPath } from "$lib/server/infra/pathSafety.js";

export { isSafeRelativePath, resolveContainedPath, isInside } from "$lib/server/infra/pathSafety.js";

/**
 * Path safety for the Mini App platform.
 *
 * Every filesystem decision the host makes about an app - where its code lives,
 * whether a manifest-declared entry is legal, whether a UI asset request stays
 * inside `ui/` - funnels through here. The generic containment helpers
 * (`isSafeRelativePath`, `resolveContainedPath`, `isInside`) live in
 * `infra/pathSafety.ts` and are re-exported below for the existing import
 * sites; new surfaces should import them from the infra module directly.
 */

/** `^[a-z][a-z0-9-]{1,62}$` — also the on-disk directory name. */
const APP_ID_PATTERN = /^[a-z][a-z0-9-]{1,62}$/;
/** `^[a-z][a-z0-9_-]{0,63}$` — unique inside one app. */
const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

export function isValidMiniAppId(value: unknown): value is string {
  return typeof value === "string" && APP_ID_PATTERN.test(value);
}

export function isValidMiniAppToolName(value: unknown): value is string {
  return typeof value === "string" && TOOL_NAME_PATTERN.test(value);
}

/**
 * The app's code directory, proven to be a real directory directly under
 * `codeRoot` (not a symlink pointing elsewhere). Null when absent or escaping.
 */
export function resolveAppCodeDir(codeRoot: string, appId: string): string | null {
  if (!isValidMiniAppId(appId)) return null;
  const direct = path.join(codeRoot, appId);
  try {
    // lstat first: a symlinked app directory is rejected outright rather than
    // silently granting whatever it points at.
    if (!fs.lstatSync(direct).isDirectory()) return null;
  } catch {
    return null;
  }
  const resolved = resolveContainedPath(codeRoot, appId);
  return resolved;
}

/** The app's data directory path (not required to exist yet). */
export function appDataDirPath(dataRoot: string, appId: string): string | null {
  if (!isValidMiniAppId(appId)) return null;
  return path.join(dataRoot, appId);
}

/**
 * Normalizes a UI asset request path from the URL into a safe relative path
 * under the app's `ui/` directory. Rejects double encoding, dot files, escapes
 * and empty segments; an empty request maps to the manifest's `ui.entry`.
 */
export function normalizeUiAssetPath(rawPath: string): string | null {
  if (typeof rawPath !== "string") return null;
  if (rawPath.includes("\0")) return null;
  // A `%` surviving one decode means the client double-encoded; reject rather
  // than decode twice (decoding twice is exactly how `..` sneaks through).
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  if (decoded.includes("%")) return null;
  if (decoded.includes("\0")) return null;

  const trimmed = decoded.replace(/^\/+/, "");
  if (trimmed === "") return "";
  const segments = trimmed.split("/");
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") return null;
    if (segment.startsWith(".")) return null;
  }
  return segments.join("/");
}
