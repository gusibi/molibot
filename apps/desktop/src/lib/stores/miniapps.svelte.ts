// Mini App catalog — state + orchestration for the sidebar and the Settings group.
import {
  clearDesktopMiniAppBadge,
  installDesktopBuiltinMiniApp,
  installDesktopMiniApp,
  loadDesktopMiniApps,
  loadDesktopModels,
  setDesktopMiniAppEnabled,
  uninstallDesktopMiniApp,
  updateDesktopMiniApp,
  type DesktopMiniAppCatalogs
} from "../api";
import type { DesktopMiniAppInstallRequest } from "@molibot/desktop-contract";
import type { DesktopMiniAppBuiltinItem, DesktopMiniAppItem } from "@molibot/desktop-contract";
import { session, setError } from "./session.svelte";
import { invalidateComposerSuggestions } from "../chat/composerSuggestions.svelte";
import { toStore } from "svelte/store";

/** Most-recently-opened app ids, newest first. Purely a desktop preference. */
const RECENT_KEY = "molibot-desktop-miniapps-recent";
const RECENT_LIMIT = 10;

function readRecent(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export const miniAppsStore = $state({
  items: [] as DesktopMiniAppItem[],
  /** Every built-in this build ships, installed or not. */
  builtin: [] as DesktopMiniAppBuiltinItem[],
  loading: false,
  loaded: false,
  busyId: "",
  actionMessage: "",
  installing: false,
  /** Set after a successful install: the new code only runs after a restart. */
  restartRequired: false,
  /**
   * Whether the host has any model that can serve each Mini App AI capability.
   *
   * Lives here rather than in the surfaces that read it: the app list needs it
   * to warn on a row whose declared capability cannot run, and the settings
   * section needs the same answer. One loader means the warning and the
   * selector can never disagree about what is configured.
   */
  aiAvailability: { text: false, transcription: false },
  recentIds: readRecent()
});

/**
 * Applies a route's answer to both catalogs at once.
 *
 * Every lifecycle action changes what is installed *and* what the built-in tab
 * should say about it, so the two are never assigned separately — that is how
 * one of them ends up a click behind.
 */
function applyCatalogs(catalogs: DesktopMiniAppCatalogs): void {
  miniAppsStore.items = catalogs.items;
  miniAppsStore.builtin = catalogs.builtin;
}

/** Legacy `$:` chat containers subscribe here instead of reading runes state naked. */
export const miniAppsCatalog = toStore(() => miniAppsStore.items);

/**
 * Records that an app was opened, so the sidebar can show recent apps instead
 * of an unbounded list. Ordering is newest-first with no duplicates.
 */
export function markMiniAppUsed(appId: string): void {
  const next = [appId, ...miniAppsStore.recentIds.filter((id) => id !== appId)].slice(0, RECENT_LIMIT * 4);
  miniAppsStore.recentIds = next;
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // A full or unavailable localStorage must not break opening an app.
  }
}

/**
 * Recently used apps for the sidebar, filtered to what is actually openable and
 * capped. Apps never opened are not listed here — the manager shows everything.
 */
export function recentMiniApps(): DesktopMiniAppItem[] {
  const openable = openableMiniApps();
  const byId = new Map(openable.map((item) => [item.id, item]));
  const recent = miniAppsStore.recentIds
    .map((id) => byId.get(id))
    .filter((item): item is DesktopMiniAppItem => Boolean(item));
  // Before anything has been opened, showing nothing would read as "no apps".
  // Fall back to the natural order so the section is useful on first run.
  const filler = openable.filter((item) => !miniAppsStore.recentIds.includes(item.id));
  return [...recent, ...filler].slice(0, RECENT_LIMIT);
}

export function hasMoreThanRecent(): boolean {
  return openableMiniApps().length > RECENT_LIMIT;
}

/**
 * Apps the sidebar may offer. An app that is disabled or failed to load belongs
 * in Settings, where the reason is visible — not in a list of things to click.
 */
export function openableMiniApps(): DesktopMiniAppItem[] {
  return miniAppsStore.items.filter((item) => item.enabled && item.status === "active" && !item.error);
}

/**
 * Retires an app's badge because the owner opened it.
 *
 * Fire-and-forget from the caller's point of view, but the *catalog* it answers
 * with is applied rather than the count being cleared locally: the server is
 * the only writer, so guessing here is how the sidebar and the host drift
 * apart. A failure leaves the badge up, which is the honest outcome.
 */
export async function clearMiniAppBadge(appId: string, endpoint = session.endpoint): Promise<void> {
  if (!endpoint) return;
  const current = miniAppsStore.items.find((item) => item.id === appId);
  // Nothing to clear: skip the round trip rather than spending one per open.
  if (!current?.badge) return;
  try {
    applyCatalogs(await clearDesktopMiniAppBadge(endpoint, appId));
  } catch {
    // A badge that fails to clear is cosmetic; opening the app must not fail
    // because of it, and surfacing an error here would be noise.
  }
}

export async function loadMiniApps(endpoint = session.endpoint): Promise<void> {
  if (!endpoint) return;
  miniAppsStore.loading = true;
  try {
    applyCatalogs(await loadDesktopMiniApps(endpoint));
    miniAppsStore.loaded = true;
  } catch (cause) {
    setError(cause);
  } finally {
    miniAppsStore.loading = false;
  }
  // Separate from the catalog load and deliberately not fatal: a failure here
  // costs a per-app warning, and must not stop the app list from rendering.
  try {
    const [text, transcription] = await Promise.all([
      loadDesktopModels(endpoint, "text"),
      loadDesktopModels(endpoint, "stt")
    ]);
    miniAppsStore.aiAvailability = {
      text: text.options.length > 0,
      transcription: transcription.options.length > 0
    };
  } catch {
    // Leave the last known answer rather than claiming nothing is configured.
  }
}

export async function toggleMiniApp(appId: string, enabled: boolean): Promise<void> {
  const endpoint = session.endpoint;
  if (!endpoint || miniAppsStore.busyId) return;
  miniAppsStore.busyId = appId;
  miniAppsStore.actionMessage = "";
  try {
    // The route answers with the whole catalog, so a toggle that also changed
    // an app's status (loaded, failed) is reflected without a second fetch.
    applyCatalogs(await setDesktopMiniAppEnabled(endpoint, appId, enabled));
    invalidateComposerSuggestions();
    miniAppsStore.actionMessage = enabled
      ? session.text.miniAppEnabledMessage
      : session.text.miniAppDisabledMessage;
  } catch (cause) {
    setError(cause);
  } finally {
    miniAppsStore.busyId = "";
  }
}

/**
 * Installs from a directory, a ZIP or a GitHub repo.
 *
 * The caller is responsible for confirming a remote source with the owner
 * first: app server code runs in-process without a sandbox, so where it came
 * from is the owner's decision to make, not a detail to bury.
 */
export async function installMiniApp(request: DesktopMiniAppInstallRequest): Promise<string> {
  const endpoint = session.endpoint;
  if (!endpoint || miniAppsStore.installing) return "";
  miniAppsStore.installing = true;
  miniAppsStore.actionMessage = "";
  try {
    const result = await installDesktopMiniApp(endpoint, request);
    applyCatalogs(result);
    invalidateComposerSuggestions();
    miniAppsStore.restartRequired = true;
    miniAppsStore.actionMessage = result.replaced
      ? session.text.miniAppReplacedMessage
      : session.text.miniAppInstalledMessage;
    return result.installedId;
  } catch (cause) {
    setError(cause);
    return "";
  } finally {
    miniAppsStore.installing = false;
  }
}

/**
 * Reinstalls a built-in from the copy this build ships. Code only — the app's
 * data is untouched, so this needs no confirmation the way uninstall does.
 *
 * Shares `busyId` with the other per-app actions so one row can never run two
 * lifecycle operations at once.
 */
export async function updateMiniApp(appId: string): Promise<void> {
  const endpoint = session.endpoint;
  if (!endpoint || miniAppsStore.busyId) return;
  miniAppsStore.busyId = appId;
  miniAppsStore.actionMessage = "";
  try {
    const result = await updateDesktopMiniApp(endpoint, appId);
    applyCatalogs(result);
    invalidateComposerSuggestions();
    // Same as an install: the replaced module is already in the ESM cache, so
    // the new code only runs after the service restarts.
    miniAppsStore.restartRequired = true;
    miniAppsStore.actionMessage = session.text.miniAppUpdatedMessage.replace("{version}", result.version);
  } catch (cause) {
    setError(cause);
  } finally {
    miniAppsStore.busyId = "";
  }
}

/**
 * Installs a built-in from the copy this build ships.
 *
 * Unlike {@link installMiniApp} there is no source to confirm: the code shipped
 * inside the app the owner is already running. It shares `busyId` with the
 * other per-app actions so one row can never run two lifecycle operations.
 *
 * Reinstalling a previously uninstalled built-in is the same call — the host
 * clears the removal tombstone, so it does not get wiped on the next start.
 */
export async function installBuiltinMiniApp(appId: string): Promise<void> {
  const endpoint = session.endpoint;
  if (!endpoint || miniAppsStore.busyId) return;
  miniAppsStore.busyId = appId;
  miniAppsStore.actionMessage = "";
  try {
    const result = await installDesktopBuiltinMiniApp(endpoint, appId);
    applyCatalogs(result);
    invalidateComposerSuggestions();
    // Same as any other install: the code is on disk, but the service loads app
    // modules once, so it runs after a restart.
    miniAppsStore.restartRequired = true;
    miniAppsStore.actionMessage = session.text.miniAppInstalledMessage;
  } catch (cause) {
    setError(cause);
  } finally {
    miniAppsStore.busyId = "";
  }
}

export async function uninstallMiniApp(appId: string, deleteData: boolean): Promise<void> {
  const endpoint = session.endpoint;
  if (!endpoint || miniAppsStore.busyId) return;
  miniAppsStore.busyId = appId;
  miniAppsStore.actionMessage = "";
  try {
    applyCatalogs(await uninstallDesktopMiniApp(endpoint, appId, deleteData));
    invalidateComposerSuggestions();
    miniAppsStore.actionMessage = deleteData
      ? session.text.miniAppUninstalledWithData
      : session.text.miniAppUninstalledKeepData;
  } catch (cause) {
    setError(cause);
  } finally {
    miniAppsStore.busyId = "";
  }
}
