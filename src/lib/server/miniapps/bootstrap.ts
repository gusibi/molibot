import fs from "node:fs";
import path from "node:path";
import manifestSource from "./builtin/todo/manifest.json?raw";
import serverSource from "./builtin/todo/server/index.mjs?raw";
import uiHtmlSource from "./builtin/todo/ui/index.html?raw";
import uiScriptSource from "./builtin/todo/ui/app.js?raw";
import uiStyleSource from "./builtin/todo/ui/styles.css?raw";
import uiIconSource from "./builtin/todo/ui/icon.svg?raw";
import { isValidMiniAppId } from "$lib/server/miniapps/paths.js";
import type { MiniAppEnablementEntry } from "$lib/server/miniapps/host.js";

/**
 * Built-in Mini App bootstrap.
 *
 * The app's files are embedded into the server bundle at build time (`?raw`)
 * rather than copied from a source directory, so a packaged desktop build does
 * not depend on the layout of the machine it was built on.
 *
 * Two rules keep this from ever surprising the owner:
 *
 * 1. **Never overwrite.** If the app directory exists, bootstrap does nothing —
 *    an owner who edited or upgraded the app keeps their version.
 * 2. **Honour the tombstone.** An owner who uninstalled a built-in gets a
 *    `removedBuiltin` record; without checking it, every restart would silently
 *    reinstall the thing they deliberately removed.
 */

interface BuiltinMiniApp {
  id: string;
  files: Record<string, string>;
}

const BUILTIN_APPS: BuiltinMiniApp[] = [
  {
    id: "todo",
    files: {
      "manifest.json": manifestSource,
      "server/index.mjs": serverSource,
      "ui/index.html": uiHtmlSource,
      "ui/app.js": uiScriptSource,
      "ui/styles.css": uiStyleSource,
      "ui/icon.svg": uiIconSource
    }
  }
];

export interface EnsureBuiltinMiniAppsOptions {
  codeRoot: string;
  getEnablement: () => Record<string, MiniAppEnablementEntry>;
  /** Test seam: override the shipped set. */
  apps?: BuiltinMiniApp[];
}

export interface EnsureBuiltinMiniAppsResult {
  installed: string[];
  skipped: Array<{ id: string; reason: "already-installed" | "removed-by-owner" | "failed" }>;
}

export function ensureBuiltinMiniApps(
  options: EnsureBuiltinMiniAppsOptions
): EnsureBuiltinMiniAppsResult {
  const result: EnsureBuiltinMiniAppsResult = { installed: [], skipped: [] };
  const enablement = options.getEnablement();

  for (const app of options.apps ?? BUILTIN_APPS) {
    if (!isValidMiniAppId(app.id)) continue;

    if (enablement[app.id]?.removedBuiltin) {
      result.skipped.push({ id: app.id, reason: "removed-by-owner" });
      continue;
    }

    const appDir = path.join(options.codeRoot, app.id);
    if (fs.existsSync(appDir)) {
      result.skipped.push({ id: app.id, reason: "already-installed" });
      continue;
    }

    try {
      // Materialise into a staging directory and rename into place, so a crash
      // mid-write cannot leave a half-written app that discovery would then
      // report as a broken manifest.
      const stagingDir = `${appDir}.installing`;
      fs.rmSync(stagingDir, { recursive: true, force: true });
      for (const [relativePath, content] of Object.entries(app.files)) {
        const target = path.join(stagingDir, relativePath);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content, "utf8");
      }
      fs.renameSync(stagingDir, appDir);
      result.installed.push(app.id);
    } catch {
      result.skipped.push({ id: app.id, reason: "failed" });
    }
  }

  return result;
}
