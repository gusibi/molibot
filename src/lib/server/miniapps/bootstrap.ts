import fs from "node:fs";
import path from "node:path";
import todoManifestSource from "./builtin/todo/manifest.json?raw";
import todoServerSource from "./builtin/todo/server/index.mjs?raw";
import todoUiHtmlSource from "./builtin/todo/ui/index.html?raw";
import todoUiScriptSource from "./builtin/todo/ui/app.js?raw";
import todoUiStyleSource from "./builtin/todo/ui/styles.css?raw";
import todoUiIconSource from "./builtin/todo/ui/icon.svg?raw";
import noteManifestSource from "./builtin/note/manifest.json?raw";
import noteServerSource from "./builtin/note/server/index.mjs?raw";
import noteUiHtmlSource from "./builtin/note/ui/index.html?raw";
import noteUiScriptSource from "./builtin/note/ui/app.js?raw";
import noteUiStyleSource from "./builtin/note/ui/styles.css?raw";
import noteUiIconSource from "./builtin/note/ui/icon.svg?raw";
import meetingNotesManifestSource from "./builtin/meeting-notes/manifest.json?raw";
import meetingNotesServerSource from "./builtin/meeting-notes/server/index.mjs?raw";
import meetingNotesUiHtmlSource from "./builtin/meeting-notes/ui/index.html?raw";
import meetingNotesUiScriptSource from "./builtin/meeting-notes/ui/app.js?raw";
import meetingNotesUiStyleSource from "./builtin/meeting-notes/ui/styles.css?raw";
import meetingNotesUiIconSource from "./builtin/meeting-notes/ui/icon.svg?raw";
import {
  materializeBuiltinMiniApp,
  type BuiltinMiniApp
} from "$lib/server/miniapps/builtinPackage.js";
import { isValidMiniAppId } from "$lib/server/miniapps/paths.js";
import type { MiniAppEnablementEntry } from "$lib/server/miniapps/host.js";

/**
 * Built-in Mini App bootstrap.
 *
 * The app's files are embedded into the server bundle at build time (`?raw`)
 * rather than copied from a source directory, so a packaged desktop build does
 * not depend on the layout of the machine it was built on.
 *
 * Three rules keep this from ever surprising the owner:
 *
 * 1. **Never overwrite.** If the app directory exists, bootstrap does nothing —
 *    an owner who edited or upgraded the app keeps their version.
 * 2. **Honour the tombstone.** An owner who uninstalled a built-in gets a
 *    `removedBuiltin` record; without checking it, every restart would silently
 *    reinstall the thing they deliberately removed.
 * 3. **Only `autoInstall` apps arrive unasked.** Every other built-in is listed
 *    in the manager as an offer the owner installs deliberately, so shipping a
 *    new app never plants it in someone's workspace on upgrade.
 */

const BUILTIN_APPS: BuiltinMiniApp[] = [
  {
    id: "todo",
    // The reference app, and the one an empty workspace has always started
    // with. Kept on so an existing owner's first run does not change meaning.
    autoInstall: true,
    files: {
      "manifest.json": todoManifestSource,
      "server/index.mjs": todoServerSource,
      "ui/index.html": todoUiHtmlSource,
      "ui/app.js": todoUiScriptSource,
      "ui/styles.css": todoUiStyleSource,
      "ui/icon.svg": todoUiIconSource
    }
  },
  {
    id: "note",
    files: {
      "manifest.json": noteManifestSource,
      "server/index.mjs": noteServerSource,
      "ui/index.html": noteUiHtmlSource,
      "ui/app.js": noteUiScriptSource,
      "ui/styles.css": noteUiStyleSource,
      "ui/icon.svg": noteUiIconSource
    }
  },
  {
    id: "meeting-notes",
    files: {
      "manifest.json": meetingNotesManifestSource,
      "server/index.mjs": meetingNotesServerSource,
      "ui/index.html": meetingNotesUiHtmlSource,
      "ui/app.js": meetingNotesUiScriptSource,
      "ui/styles.css": meetingNotesUiStyleSource,
      "ui/icon.svg": meetingNotesUiIconSource
    }
  }
];

/** The bundled copy of a built-in, or null when the id is not one we ship. */
export function getBuiltinMiniApp(appId: string): BuiltinMiniApp | null {
  return BUILTIN_APPS.find((app) => app.id === appId) ?? null;
}

/**
 * Every built-in this build ships, in catalog order.
 *
 * The single source of truth for "which apps are built-in": the host's
 * `builtinAppIds` and the manager's catalog both derive from it, so a new entry
 * above cannot be half-registered (labelled built-in in one surface and
 * unknown in another).
 */
export function listBuiltinMiniApps(): BuiltinMiniApp[] {
  return [...BUILTIN_APPS];
}

export function builtinMiniAppIds(): string[] {
  return BUILTIN_APPS.map((app) => app.id);
}

export interface EnsureBuiltinMiniAppsOptions {
  codeRoot: string;
  getEnablement: () => Record<string, MiniAppEnablementEntry>;
  /** Test seam: override the shipped set. */
  apps?: BuiltinMiniApp[];
}

export interface EnsureBuiltinMiniAppsResult {
  installed: string[];
  skipped: Array<{
    id: string;
    reason: "already-installed" | "removed-by-owner" | "opt-in" | "failed";
  }>;
}

export function ensureBuiltinMiniApps(
  options: EnsureBuiltinMiniAppsOptions
): EnsureBuiltinMiniAppsResult {
  const result: EnsureBuiltinMiniAppsResult = { installed: [], skipped: [] };
  const enablement = options.getEnablement();

  for (const app of options.apps ?? BUILTIN_APPS) {
    if (!isValidMiniAppId(app.id)) continue;

    if (!app.autoInstall) {
      result.skipped.push({ id: app.id, reason: "opt-in" });
      continue;
    }

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
      materializeBuiltinMiniApp(options.codeRoot, app);
      result.installed.push(app.id);
    } catch {
      result.skipped.push({ id: app.id, reason: "failed" });
    }
  }

  return result;
}
