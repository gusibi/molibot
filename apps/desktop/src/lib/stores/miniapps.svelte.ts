// Mini App catalog — state + orchestration for the manager pane and the Settings group.
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

export const miniAppsStore = $state({
  items: [] as DesktopMiniAppItem[],
  /** Every built-in this build ships, installed or not. */
  builtin: [] as DesktopMiniAppBuiltinItem[],
  loading: false,
  loaded: false,
  busyId: "",
  actionMessage: "",
  installing: false,
  /**
   * Whether the host has any model that can serve each Mini App AI capability.
   *
   * Lives here rather than in the surfaces that read it: the app list needs it
   * to warn on a row whose declared capability cannot run, and the settings
   * section needs the same answer. One loader means the warning and the
   * selector can never disagree about what is configured.
   */
  aiAvailability: { text: false, transcription: false }
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
