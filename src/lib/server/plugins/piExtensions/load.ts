import { momError, momLog } from "$lib/server/agent/common/log.js";
import {
  piExtensionsAgentDir,
  piExtensionsRootDir
} from "$lib/server/plugins/piExtensions/paths.js";
import type { PiExtensionLoadResult } from "$lib/server/plugins/piExtensions/types.js";
import { loadPiExtensionsInProcess } from "$lib/server/plugins/piExtensions/processClient.js";

/**
 * Load every installed pi extension from `${DATA_DIR}/extensions`.
 *
 * Official package discovery runs inside the bounded worker, without project
 * settings or context files. Broken packages become catalog errors. Server
 * invocation and native interactive execution bind their own runtime later.
 */
export async function loadPiExtensions(): Promise<PiExtensionLoadResult> {
  const agentDir = piExtensionsAgentDir();
  const cwd = agentDir;

  try {
    const result = await loadPiExtensionsInProcess({ cwd, agentDir });
    const extensions = result.extensions.map((extension) => ({ ...extension, client: result.client }));

    const errors = result.errors;

    momLog("plugins", "pi_extensions_loaded", {
      root: piExtensionsRootDir(),
      loaded: extensions.length,
      failed: errors.length,
      ids: extensions.map((entry) => entry.id)
    });

    return { extensions, errors, runtime: null, client: result.client };
  } catch (error) {
    momError("plugins", "pi_extensions_load_failed", {
      root: piExtensionsRootDir(),
      error: error instanceof Error ? error.message : String(error)
    });
    return { extensions: [], errors: [], runtime: null };
  }
}
