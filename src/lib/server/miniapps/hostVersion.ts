import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The running Molibot version, used only for a Mini App's
 * `engines.molibot` compatibility check.
 *
 * Resolution walks up from this module and from the process cwd looking for the
 * app's own `package.json` (the release script copies it next to the bundle).
 * An unresolvable version returns null, and the manifest validator then treats
 * every range as satisfied — refusing to load an owner's apps because the host
 * could not read its own version would be a worse failure than skipping a
 * compatibility hint.
 */

function findPackageVersion(startDir: string): string | null {
  let dir = startDir;
  for (let depth = 0; depth < 12; depth += 1) {
    const candidate = path.join(dir, "package.json");
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, "utf8")) as { name?: string; version?: string };
      if (parsed.name === "molibot" && typeof parsed.version === "string") return parsed.version;
    } catch {
      // keep walking
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

let cached: string | null | undefined;

export function getMolibotVersion(): string | null {
  if (cached !== undefined) return cached;
  const fromEnv = process.env.MOLIBOT_VERSION?.trim();
  if (fromEnv) {
    cached = fromEnv;
    return cached;
  }
  let moduleDir: string | null = null;
  try {
    moduleDir = path.dirname(fileURLToPath(import.meta.url));
  } catch {
    moduleDir = null;
  }
  cached = (moduleDir ? findPackageVersion(moduleDir) : null) ?? findPackageVersion(process.cwd());
  return cached;
}

/** Test seam: forget the memoized lookup. */
export function resetMolibotVersionCache(): void {
  cached = undefined;
}
