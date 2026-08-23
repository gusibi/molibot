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
import noteUiMarkdownSource from "./builtin/note/ui/markdown.js?raw";
import markedBrowserSource from "marked?raw";
import meetingNotesManifestSource from "./builtin/meeting-notes/manifest.json?raw";
import meetingNotesServerSource from "./builtin/meeting-notes/server/index.mjs?raw";
import meetingNotesUiHtmlSource from "./builtin/meeting-notes/ui/index.html?raw";
import meetingNotesUiScriptSource from "./builtin/meeting-notes/ui/app.js?raw";
import meetingNotesUiStyleSource from "./builtin/meeting-notes/ui/styles.css?raw";
import meetingNotesUiIconSource from "./builtin/meeting-notes/ui/icon.svg?raw";
import miniChatManifestSource from "./builtin/mini-chat/manifest.json?raw";
import miniChatNoticesSource from "./builtin/mini-chat/THIRD_PARTY_NOTICES.md?raw";
import miniChatServerSource from "./builtin/mini-chat/server/index.mjs?raw";
import miniChatUiHtmlSource from "./builtin/mini-chat/ui/index.html?raw";
import miniChatUiScriptSource from "./builtin/mini-chat/ui/app.js?raw";
import miniChatUiAstryxStyleSource from "./builtin/mini-chat/ui/astryx.css?raw";
import miniChatUiStyleSource from "./builtin/mini-chat/ui/styles.css?raw";
import miniChatUiIconSource from "./builtin/mini-chat/ui/icon.svg?raw";
import promptBoxManifestSource from "./builtin/prompt-box/manifest.json?raw";
import promptBoxNoticesSource from "./builtin/prompt-box/THIRD_PARTY_NOTICES.md?raw";
import promptBoxServerSource from "./builtin/prompt-box/server/index.mjs?raw";
import promptBoxUiHtmlSource from "./builtin/prompt-box/ui/index.html?raw";
import promptBoxUiScriptSource from "./builtin/prompt-box/ui/app.js?raw";
import promptBoxUiAstryxStyleSource from "./builtin/prompt-box/ui/astryx.css?raw";
import promptBoxUiStyleSource from "./builtin/prompt-box/ui/styles.css?raw";
import promptBoxUiIconSource from "./builtin/prompt-box/ui/icon.svg?raw";
import mdPreviewManifestSource from "./builtin/md-preview/manifest.json?raw";
import mdPreviewNoticesSource from "./builtin/md-preview/THIRD_PARTY_NOTICES.md?raw";
import mdPreviewServerSource from "./builtin/md-preview/server/index.mjs?raw";
import mdPreviewUiHtmlSource from "./builtin/md-preview/ui/index.html?raw";
import mdPreviewUiScriptSource from "./builtin/md-preview/ui/app.js?raw";
import mdPreviewUiRenderSource from "./builtin/md-preview/ui/render.js?raw";
import mdPreviewUiThemesSource from "./builtin/md-preview/ui/themes.js?raw";
import mdPreviewUiStyleSource from "./builtin/md-preview/ui/styles.css?raw";
import mdPreviewUiIconSource from "./builtin/md-preview/ui/icon.svg?raw";
import prismCoreSource from "prismjs/components/prism-core.min.js?raw";
import prismMarkupSource from "prismjs/components/prism-markup.min.js?raw";
import prismClikeSource from "prismjs/components/prism-clike.min.js?raw";
import prismCssSource from "prismjs/components/prism-css.min.js?raw";
import prismJavascriptSource from "prismjs/components/prism-javascript.min.js?raw";
import prismTypescriptSource from "prismjs/components/prism-typescript.min.js?raw";
import prismPythonSource from "prismjs/components/prism-python.min.js?raw";
import prismBashSource from "prismjs/components/prism-bash.min.js?raw";
import prismJsonSource from "prismjs/components/prism-json.min.js?raw";
import prismGoSource from "prismjs/components/prism-go.min.js?raw";
import prismRustSource from "prismjs/components/prism-rust.min.js?raw";
import prismSqlSource from "prismjs/components/prism-sql.min.js?raw";
import prismYamlSource from "prismjs/components/prism-yaml.min.js?raw";
import prismCSource from "prismjs/components/prism-c.min.js?raw";
import prismCppSource from "prismjs/components/prism-cpp.min.js?raw";
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
      "ui/markdown.js": noteUiMarkdownSource,
      "ui/vendor/marked.esm.js": markedBrowserSource,
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
  },
  {
    id: "mini-chat",
    files: {
      "THIRD_PARTY_NOTICES.md": miniChatNoticesSource,
      "manifest.json": miniChatManifestSource,
      "server/index.mjs": miniChatServerSource,
      "ui/index.html": miniChatUiHtmlSource,
      "ui/app.js": miniChatUiScriptSource,
      "ui/astryx.css": miniChatUiAstryxStyleSource,
      "ui/styles.css": miniChatUiStyleSource,
      "ui/icon.svg": miniChatUiIconSource
    }
  },
  {
    id: "prompt-box",
    files: {
      "THIRD_PARTY_NOTICES.md": promptBoxNoticesSource,
      "manifest.json": promptBoxManifestSource,
      "server/index.mjs": promptBoxServerSource,
      "ui/index.html": promptBoxUiHtmlSource,
      "ui/app.js": promptBoxUiScriptSource,
      "ui/astryx.css": promptBoxUiAstryxStyleSource,
      "ui/styles.css": promptBoxUiStyleSource,
      "ui/icon.svg": promptBoxUiIconSource
    }
  },
  {
    id: "md-preview",
    files: {
      "THIRD_PARTY_NOTICES.md": mdPreviewNoticesSource,
      "manifest.json": mdPreviewManifestSource,
      "server/index.mjs": mdPreviewServerSource,
      "ui/index.html": mdPreviewUiHtmlSource,
      "ui/app.js": mdPreviewUiScriptSource,
      "ui/render.js": mdPreviewUiRenderSource,
      "ui/themes.js": mdPreviewUiThemesSource,
      // One concatenated classic script: the iframe CSP allows same-origin
      // scripts, and Prism's components are plain IIFEs over a global Prism.
      // `manual` must be set before the core so it never auto-highlights -
      // render.js calls Prism.highlight itself.
      "ui/vendor/prism.js": `window.Prism = { manual: true };\n${prismCoreSource}\n${prismMarkupSource}\n${prismClikeSource}\n${prismCssSource}\n${prismJavascriptSource}\n${prismTypescriptSource}\n${prismPythonSource}\n${prismBashSource}\n${prismJsonSource}\n${prismGoSource}\n${prismRustSource}\n${prismSqlSource}\n${prismYamlSource}\n${prismCSource}\n${prismCppSource}\n`,
      "ui/vendor/marked.esm.js": markedBrowserSource,
      "ui/styles.css": mdPreviewUiStyleSource,
      "ui/icon.svg": mdPreviewUiIconSource
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
