import fs from "node:fs";
import path from "node:path";
import { storagePaths } from "$lib/server/infra/db/storage.js";

/**
 * Stages bundled plugin packages into `<dataDir>/plugins/packages/` on boot.
 * Follows the same pattern as built-in Mini Apps: code is staged from the
 * source / bundle directory into the owner's packages root, version-gated.
 */

const BUILTIN_PACKAGES: Array<{ id: string; sourceRelative: string }> = [
  { id: "external-subagent", sourceRelative: "package/external-subagent" },
  { id: "cloudflare-html", sourceRelative: "package/cloudflare-html" }
];

function readVersion(packageJsonPath: string): string | null {
  try {
    const raw = fs.readFileSync(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw);
    return typeof parsed?.version === "string" ? parsed.version : null;
  } catch {
    return null;
  }
}

export function ensureBuiltinPlugins(): void {
  const appRoot = process.env.MOLIBOT_APP_ROOT?.trim() || process.cwd();
  const packagesRoot = storagePaths.pluginsPackagesDir;
  if (!fs.existsSync(packagesRoot)) {
    fs.mkdirSync(packagesRoot, { recursive: true });
  }

  for (const item of BUILTIN_PACKAGES) {
    const sourceDir = path.join(appRoot, item.sourceRelative);
    const targetDir = path.join(packagesRoot, item.id);

    if (!fs.existsSync(sourceDir)) continue;

    const sourceVersion = readVersion(path.join(sourceDir, "package.json"));
    const targetVersion = fs.existsSync(targetDir)
      ? readVersion(path.join(targetDir, "package.json"))
      : null;

    if (targetVersion === null || (sourceVersion && sourceVersion !== targetVersion)) {
      // Stage / replace package code (replaceable root)
      try {
        if (fs.existsSync(targetDir)) {
          const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
          fs.cpSync(targetDir, `${targetDir}.backup-${timestamp}`, { recursive: true });
        }
        fs.cpSync(sourceDir, targetDir, { recursive: true, force: true });
      } catch (e) {
        console.error(`[plugins] Failed to stage built-in plugin "${item.id}":`, e);
      }
    }
  }
}
