import fs from "node:fs";
import path from "node:path";
import { readMolibotPluginManifest } from "./manifest.js";
import type { PluginManifestResult } from "./types.js";

/**
 * Validates a candidate plugin package directory without installing it.
 */
export function validatePluginCandidate(packageDir: string): PluginManifestResult {
  const pkgJsonPath = path.join(packageDir, "package.json");
  if (!fs.existsSync(pkgJsonPath)) {
    return { ok: false, error: "Missing package.json" };
  }

  let pkgId = path.basename(packageDir);
  try {
    const raw = fs.readFileSync(pkgJsonPath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed?.molibot?.plugin?.id) {
      pkgId = parsed.molibot.plugin.id;
    }
  } catch {
    return { ok: false, error: "Invalid package.json JSON" };
  }

  return readMolibotPluginManifest(packageDir, pkgId);
}
