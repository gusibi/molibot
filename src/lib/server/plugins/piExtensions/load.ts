import { readFileSync } from "node:fs";
import { join } from "node:path";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import type { Extension } from "@earendil-works/pi-coding-agent";
import { momError, momLog } from "$lib/server/agent/common/log.js";
import {
  extensionIdFromEntryPath,
  extensionInstallDir,
  piExtensionsAgentDir,
  piExtensionsRootDir
} from "$lib/server/plugins/piExtensions/paths.js";
import type {
  LoadedPiExtension,
  PiExtensionLoadResult,
  UnsupportedPiCapability
} from "$lib/server/plugins/piExtensions/types.js";

function collectUnsupported(extension: Extension): UnsupportedPiCapability[] {
  const unsupported: UnsupportedPiCapability[] = [];
  if (extension.shortcuts.size > 0) unsupported.push("shortcuts");
  if (extension.messageRenderers.size > 0) unsupported.push("messageRenderers");
  if ((extension.entryRenderers?.size ?? 0) > 0) unsupported.push("entryRenderers");
  return unsupported;
}

/** Best-effort package.json metadata for the extension's install directory. */
function readPackageMeta(id: string): { name: string; version: string; description?: string } {
  const dir = extensionInstallDir(id);
  const fallback = { name: id, version: "unknown" };
  if (!dir) return fallback;
  try {
    const parsed = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Record<string, unknown>;
    return {
      name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim() : id,
      version: typeof parsed.version === "string" && parsed.version.trim() ? parsed.version.trim() : "unknown",
      description: typeof parsed.description === "string" && parsed.description.trim()
        ? parsed.description.trim()
        : undefined
    };
  } catch {
    return fallback;
  }
}

function describe(extension: Extension): Omit<LoadedPiExtension, "extension"> {
  const entryPath = extension.resolvedPath || extension.path;
  const id = extensionIdFromEntryPath(entryPath);
  return {
    id,
    ...readPackageMeta(id),
    entryPath,
    toolNames: [...extension.tools.keys()],
    eventNames: [...extension.handlers.keys()],
    commandNames: [...extension.commands.keys()],
    flagNames: [...extension.flags.keys()],
    unsupported: collectUnsupported(extension)
  };
}

/**
 * Load every installed pi extension from `${DATA_DIR}/extensions`.
 *
 * pi's loader is reused as-is (jiti + its `index.ts` / `package.json#pi.extensions`
 * discovery rules); pi's ExtensionRunner is not, because it requires pi's own
 * SessionManager and ModelRegistry, which Molibot does not have. Loading never
 * throws: a broken extension becomes an error row in the catalog.
 */
export async function loadPiExtensions(): Promise<PiExtensionLoadResult> {
  const agentDir = piExtensionsAgentDir();
  const cwd = agentDir;

  try {
    const result = await discoverAndLoadExtensions([], cwd, agentDir);

    const extensions = result.extensions.map((extension) => ({
      ...describe(extension),
      extension
    }));

    const errors = result.errors.map((entry) => ({
      id: extensionIdFromEntryPath(entry.path),
      entryPath: entry.path,
      error: entry.error
    }));

    momLog("plugins", "pi_extensions_loaded", {
      root: piExtensionsRootDir(),
      loaded: extensions.length,
      failed: errors.length,
      ids: extensions.map((entry) => entry.id)
    });

    return { extensions, errors, runtime: result.runtime };
  } catch (error) {
    momError("plugins", "pi_extensions_load_failed", {
      root: piExtensionsRootDir(),
      error: error instanceof Error ? error.message : String(error)
    });
    return { extensions: [], errors: [], runtime: null };
  }
}
