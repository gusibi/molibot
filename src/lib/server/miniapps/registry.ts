import { momLog } from "$lib/server/agent/common/log.js";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { getBuiltinMiniApp } from "$lib/server/miniapps/bootstrap.js";
import { createMiniAppHost, type MiniAppEnablementEntry, type MiniAppHost } from "$lib/server/miniapps/host.js";
import { createMiniAppInstaller, type MiniAppInstaller } from "$lib/server/miniapps/install.js";
import type { MiniAppInstallSource } from "$lib/server/miniapps/types.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";

/**
 * Process-wide MiniAppHost singleton.
 *
 * The host itself takes its settings access as constructor options so tests can
 * drive it against a temporary directory with a plain object. Production wires
 * it to the live runtime settings through {@link configureMiniAppSettings},
 * which `getRuntime()` calls before discovery.
 */

/** Apps Molibot ships and bootstraps into an empty owner workspace. */
export const BUILTIN_MINI_APP_IDS = ["todo"] as const;

interface MiniAppSettingsAccessor {
  getSettings: () => RuntimeSettings;
  updateSettings: (patch: Partial<RuntimeSettings>) => RuntimeSettings;
}

let accessor: MiniAppSettingsAccessor | null = null;
let host: MiniAppHost | null = null;
let installer: MiniAppInstaller | null = null;

export function configureMiniAppSettings(next: MiniAppSettingsAccessor): void {
  accessor = next;
}

function readEnablement(): Record<string, MiniAppEnablementEntry> {
  return accessor?.getSettings().plugins?.miniApps?.entries ?? {};
}

function readInstallSources(): Record<string, MiniAppInstallSource> {
  const entries = accessor?.getSettings().plugins?.miniApps?.entries ?? {};
  const sources: Record<string, MiniAppInstallSource> = {};
  for (const [appId, entry] of Object.entries(entries)) {
    if (entry?.source) sources[appId] = entry.source;
  }
  return sources;
}

function writeEnablement(appId: string, entry: MiniAppEnablementEntry | null): void {
  if (!accessor) throw new Error("Mini App settings accessor is not configured.");
  const current = accessor.getSettings().plugins?.miniApps?.entries ?? {};
  const entries = { ...current };
  if (entry === null) delete entries[appId];
  else entries[appId] = entry;
  accessor.updateSettings({
    plugins: {
      ...accessor.getSettings().plugins,
      miniApps: { entries }
    }
  } as Partial<RuntimeSettings>);
}

export function getMiniAppHost(): MiniAppHost {
  if (!host) {
    host = createMiniAppHost({
      codeRoot: storagePaths.miniAppCodeDir,
      dataRoot: storagePaths.miniAppDataDir,
      getEnablement: readEnablement,
      setEnablement: writeEnablement,
      builtinAppIds: [...BUILTIN_MINI_APP_IDS],
      getInstallSources: readInstallSources,
      // Lets the host compare an installed built-in against the copy this build
      // ships, and reinstall it on request.
      getBuiltinApp: getBuiltinMiniApp,
      logger: {
        info: (event, detail) => momLog("miniapps", event, detail ?? {}),
        warn: (event, detail) => momLog("miniapps", event, { level: "warn", ...(detail ?? {}) }),
        error: (event, detail) => momLog("miniapps", event, { level: "error", ...(detail ?? {}) })
      }
    });
  }
  return host;
}

/**
 * The installer shares the host's code root and records provenance into the
 * same settings block the host reads it from.
 */
export function getMiniAppInstaller(): MiniAppInstaller {
  if (!installer) {
    installer = createMiniAppInstaller({
      codeRoot: storagePaths.miniAppCodeDir,
      recordSource: (appId, source) => {
        if (!accessor) throw new Error("Mini App settings accessor is not configured.");
        const current = accessor.getSettings().plugins?.miniApps?.entries ?? {};
        const existing = current[appId];
        writeEnablement(appId, {
          // A reinstall must clear a built-in's removal tombstone, or the app
          // would be wiped again on the next start.
          enabled: existing?.enabled ?? true,
          ...(source.kind === "builtin" ? {} : { source })
        } as MiniAppEnablementEntry);
      }
    });
  }
  return installer;
}

/** Test seam: drops the singleton so a fresh host rescans from disk. */
export function resetMiniAppHost(): void {
  host = null;
  installer = null;
  accessor = null;
}
