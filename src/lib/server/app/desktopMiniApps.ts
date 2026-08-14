import type { MiniAppBuiltinEntry, MiniAppCatalogEntry } from "$lib/server/miniapps/types.js";
import type { DesktopMiniAppBuiltinItem, DesktopMiniAppItem } from "$lib/shared/desktop.js";

/**
 * Maps the Mini App catalog into the Desktop contract.
 *
 * The host's catalog entry is already path-free, but this mapper is the place
 * that guarantees it: the WebView receives identity, version, status and the
 * declared tool names — never a manifest path, an entry path, or a data
 * directory. Adding a field here is a deliberate decision, not a spread.
 */
export function buildDesktopMiniAppItem(entry: MiniAppCatalogEntry): DesktopMiniAppItem {
  return {
    id: entry.id,
    name: entry.name,
    version: entry.version,
    description: entry.description ?? "",
    status: entry.status,
    enabled: entry.enabled,
    builtin: entry.builtin,
    toolNames: [...entry.toolNames],
    messageActions: entry.messageActions.map((action) => ({
      ...action,
      label: { ...action.label },
      accepts: [...action.accepts]
    })),
    aiCapabilities: [...entry.aiCapabilities],
    hostCapabilities: [...(entry.hostCapabilities ?? [])],
    badge: entry.badge ? { ...entry.badge } : null,
    iconDataUri: entry.iconDataUri,
    source: entry.source,
    updateAvailable: entry.updateAvailable,
    availableVersion: entry.availableVersion,
    error: entry.error ?? ""
  };
}

export function buildDesktopMiniApps(entries: MiniAppCatalogEntry[]): DesktopMiniAppItem[] {
  return entries.map(buildDesktopMiniAppItem);
}

export function buildDesktopBuiltinMiniApps(
  entries: MiniAppBuiltinEntry[]
): DesktopMiniAppBuiltinItem[] {
  return entries.map((entry) => ({
    id: entry.id,
    name: entry.name,
    description: entry.description,
    availableVersion: entry.availableVersion,
    iconDataUri: entry.iconDataUri,
    toolNames: [...entry.toolNames],
    installed: entry.installed,
    installedVersion: entry.installedVersion,
    updateAvailable: entry.updateAvailable,
    enabled: entry.enabled,
    status: entry.status,
    removedByOwner: entry.removedByOwner,
    error: entry.error ?? ""
  }));
}

/**
 * The one payload every Mini App route answers with.
 *
 * Both catalogs travel together on purpose: an install, an update or an
 * uninstall changes *both* lists, and a route that returned only the installed
 * items would leave the built-in tab showing the state before the click.
 *
 * Structurally typed rather than importing the host, so the projection layer
 * stays free of the registry singleton.
 */
export function buildDesktopMiniAppsPayload(host: {
  listCatalog(): MiniAppCatalogEntry[];
  listBuiltinCatalog(): MiniAppBuiltinEntry[];
}): { items: DesktopMiniAppItem[]; builtin: DesktopMiniAppBuiltinItem[] } {
  return {
    items: buildDesktopMiniApps(host.listCatalog()),
    builtin: buildDesktopBuiltinMiniApps(host.listBuiltinCatalog())
  };
}

/**
 * Apps the sidebar may offer to open: enabled, loaded, and carrying a UI. An
 * app in error or disabled belongs in Settings, where its reason is visible —
 * not in a list of things to click.
 */
export function openableMiniApps(items: DesktopMiniAppItem[]): DesktopMiniAppItem[] {
  return items.filter((item) => item.enabled && item.status === "active" && !item.error);
}
