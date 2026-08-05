import type { MiniAppCatalogEntry } from "$lib/server/miniapps/types.js";
import type { DesktopMiniAppItem } from "$lib/shared/desktop.js";

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

/**
 * Apps the sidebar may offer to open: enabled, loaded, and carrying a UI. An
 * app in error or disabled belongs in Settings, where its reason is visible —
 * not in a list of things to click.
 */
export function openableMiniApps(items: DesktopMiniAppItem[]): DesktopMiniAppItem[] {
  return items.filter((item) => item.enabled && item.status === "active" && !item.error);
}
