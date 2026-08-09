import { momLog } from "$lib/server/agent/common/log.js";
import { loadPiExtensions } from "$lib/server/plugins/piExtensions/load.js";
import type {
  LoadedPiExtension,
  PiExtensionCatalogEntry,
  PiExtensionLoadResult
} from "$lib/server/plugins/piExtensions/types.js";
import type { PiExtensionEntrySettings, RuntimeSettings } from "$lib/server/settings/index.js";

const EMPTY_RESULT: PiExtensionLoadResult = { extensions: [], errors: [], runtime: null };

function entryFor(
  settings: RuntimeSettings,
  id: string
): PiExtensionEntrySettings {
  const configured = settings.plugins?.piExtensions?.entries?.[id];
  return {
    enabled: configured?.enabled ?? true,
    disabledBots: configured?.disabledBots ?? [],
    flags: configured?.flags
  };
}

/**
 * Process-wide holder for loaded third-party pi extensions.
 *
 * Loading happens once at service start (and again after install / uninstall /
 * toggle via `reload`). Whether a loaded extension is *active* is a settings
 * question answered per call, so a toggle takes effect without reloading.
 */
export class PiExtensionHost {
  private result: PiExtensionLoadResult = EMPTY_RESULT;
  private loading: Promise<void> | null = null;
  private loaded = false;
  /** Tool names an extension asked for that a built-in already owns. */
  private toolConflicts = new Map<string, Set<string>>();

  async load(): Promise<void> {
    if (this.loaded) return;
    if (!this.loading) {
      this.loading = loadPiExtensions()
        .then((result) => {
          this.result = result;
          this.loaded = true;
          result.client?.onFault((error) => {
            this.result = {
              extensions: [],
              errors: [{ id: "extension-runtime", entryPath: "", error: error.message }],
              runtime: null
            };
            this.loaded = false;
            this.toolConflicts.clear();
          });
        })
        .finally(() => {
          this.loading = null;
        });
    }
    await this.loading;
  }

  async reload(): Promise<void> {
    this.result.client?.dispose();
    this.loaded = false;
    this.result = EMPTY_RESULT;
    this.toolConflicts.clear();
    await this.load();
    momLog("plugins", "pi_extensions_reloaded", { count: this.result.extensions.length });
  }

  dispose(): void {
    this.result.client?.dispose();
    this.result = EMPTY_RESULT;
    this.loaded = false;
    this.loading = null;
    this.toolConflicts.clear();
  }

  /** True once the initial load finished; callers must not block a turn on loading. */
  isLoaded(): boolean {
    return this.loaded;
  }

  /**
   * Extensions that should run for this bot: master switch on, extension
   * enabled, and the bot not excluded.
   */
  getActiveExtensions(settings: RuntimeSettings, botId?: string): LoadedPiExtension[] {
    if (settings.plugins?.piExtensions?.enabled === false) return [];
    return this.result.extensions.filter((extension) => {
      const entry = entryFor(settings, extension.id);
      if (!entry.enabled) return false;
      if (botId && entry.disabledBots.includes(botId)) return false;
      return true;
    });
  }

  /**
   * Remember tool names that lost to a built-in, so the settings page can say
   * why part of an extension is inert instead of leaving it silently dropped.
   */
  recordToolConflicts(conflicts: Array<{ extensionId: string; toolName: string }>): void {
    for (const conflict of conflicts) {
      const names = this.toolConflicts.get(conflict.extensionId) ?? new Set<string>();
      names.add(conflict.toolName);
      this.toolConflicts.set(conflict.extensionId, names);
    }
  }

  /** Flag values an extension declared, overlaid with the configured ones. */
  applyFlagValues(settings: RuntimeSettings): void {
    if (this.result.client) {
      const flags: Record<string, unknown> = {};
      for (const extension of this.result.extensions) {
        const configured = entryFor(settings, extension.id).flags ?? {};
        for (const [name, value] of Object.entries(configured)) {
          if (extension.flagNames.includes(name)) flags[name] = value;
        }
      }
      this.result.client.setFlags(flags);
      return;
    }
    const runtime = this.result.runtime;
    if (!runtime) return;
    for (const extension of this.result.extensions) {
      const configured = entryFor(settings, extension.id).flags ?? {};
      for (const [name, value] of Object.entries(configured)) {
        if (!extension.flagNames.includes(name)) continue;
        runtime.flagValues.set(name, value);
      }
    }
  }

  listCatalog(settings: RuntimeSettings): PiExtensionCatalogEntry[] {
    const rows: PiExtensionCatalogEntry[] = this.result.extensions.map((extension) => {
      const entry = entryFor(settings, extension.id);
      const conflicts = this.toolConflicts.get(extension.id);
      return {
        error: conflicts && conflicts.size > 0
          ? `Tool name(s) already used by built-in tools, not registered: ${[...conflicts].join(", ")}`
          : undefined,
        id: extension.id,
        name: extension.name,
        version: extension.version,
        description: extension.description,
        entryPath: extension.entryPath,
        enabled: entry.enabled,
        disabledBots: entry.disabledBots,
        toolNames: extension.toolNames,
        eventNames: extension.eventNames,
        commandNames: extension.commandNames,
        unsupported: extension.unsupported
      };
    });

    for (const failure of this.result.errors) {
      rows.push({
        id: failure.id,
        name: failure.id,
        version: "unknown",
        entryPath: failure.entryPath,
        enabled: entryFor(settings, failure.id).enabled,
        disabledBots: entryFor(settings, failure.id).disabledBots,
        toolNames: [],
        eventNames: [],
        commandNames: [],
        unsupported: [],
        error: failure.error
      });
    }

    return rows.sort((a, b) => a.id.localeCompare(b.id));
  }
}

let host: PiExtensionHost | null = null;

export function getPiExtensionHost(): PiExtensionHost {
  if (!host) host = new PiExtensionHost();
  return host;
}

/** Test seam: drops the singleton so a fresh host loads from disk again. */
export function resetPiExtensionHost(): void {
  host?.dispose();
  host = null;
}
