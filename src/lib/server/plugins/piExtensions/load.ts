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
 * pi's loader is reused as-is (jiti + its `index.ts` / `package.json#pi.extensions`
 * discovery rules); pi's ExtensionRunner is not, because it requires pi's own
 * SessionManager and ModelRegistry, which Molibot does not have. Loading never
 * throws: a broken extension becomes an error row in the catalog.
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
