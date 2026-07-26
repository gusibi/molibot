import { basename, relative, resolve, sep } from "node:path";
import { config } from "$lib/server/app/env.js";

/**
 * Install root for third-party pi extensions. One subdirectory per extension,
 * matching pi's own discovery rules (`index.ts` / `index.js` /
 * `package.json` with a `pi.extensions` list).
 */
export function piExtensionsRootDir(): string {
  return resolve(config.dataDir, "extensions");
}

/**
 * Directory handed to pi's `discoverAndLoadExtensions` as its "agent dir": pi
 * scans `<agentDir>/extensions`, which is exactly our install root.
 */
export function piExtensionsAgentDir(): string {
  return resolve(config.dataDir);
}

/**
 * Extension id = the first path segment below the install root, so every entry
 * of a multi-entry package shares one id (and one settings entry).
 * Falls back to the file basename for entries outside the root.
 */
export function extensionIdFromEntryPath(entryPath: string): string {
  const root = piExtensionsRootDir();
  const rel = relative(root, resolve(entryPath));
  if (rel && !rel.startsWith("..") && !rel.startsWith(sep)) {
    const [head] = rel.split(sep);
    if (head) return head.replace(/\.(ts|js|mts|mjs|cts|cjs)$/i, "");
  }
  return basename(entryPath).replace(/\.(ts|js|mts|mjs|cts|cjs)$/i, "");
}

/** Directory an extension is installed in, or null when the id is unsafe. */
export function extensionInstallDir(id: string): string | null {
  const trimmed = id.trim();
  if (!trimmed || trimmed === "." || trimmed === "..") return null;
  if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("\0")) return null;
  const root = piExtensionsRootDir();
  const target = resolve(root, trimmed);
  const rel = relative(root, target);
  if (!rel || rel.startsWith("..") || rel.startsWith(sep)) return null;
  return target;
}
