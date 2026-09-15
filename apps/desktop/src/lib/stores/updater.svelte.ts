import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";

export interface UpdaterState {
  currentVersion: string;
  checking: boolean;
  available: boolean;
  error: string | null;
  newVersion: string | null;
  releaseNotes: string | null;
  releaseDate: string | null;
  downloading: boolean;
  downloadProgress: number;
  downloadedBytes: number;
  totalBytes: number;
  readyToRestart: boolean;
  isTranslocated: boolean;
  lastChecked: number | null;
  showDialog: boolean;
  manualCheck: boolean;
}

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

let currentUpdate: Update | null = null;

export const updaterStore = $state<UpdaterState>({
  currentVersion: "",
  checking: false,
  available: false,
  error: null,
  newVersion: null,
  releaseNotes: null,
  releaseDate: null,
  downloading: false,
  downloadProgress: 0,
  downloadedBytes: 0,
  totalBytes: 0,
  readyToRestart: false,
  isTranslocated: false,
  lastChecked: null,
  showDialog: false,
  manualCheck: false
});

export async function initUpdater(): Promise<void> {
  if (!isTauri) return;
  try {
    updaterStore.currentVersion = await getVersion();
  } catch (err) {
    console.warn("Failed to get desktop app version:", err);
  }
}

export async function checkForUpdates(manual = false): Promise<void> {
  if (!isTauri) {
    if (manual) {
      updaterStore.error = "Only available in desktop app";
      updaterStore.showDialog = true;
    }
    return;
  }

  if (updaterStore.checking || updaterStore.downloading) {
    if (manual) updaterStore.showDialog = true;
    return;
  }

  updaterStore.checking = true;
  updaterStore.error = null;
  updaterStore.manualCheck = manual;
  if (manual) {
    updaterStore.showDialog = true;
  }

  try {
    if (!updaterStore.currentVersion) {
      updaterStore.currentVersion = await getVersion();
    }

    try {
      updaterStore.isTranslocated = await invoke<boolean>("check_app_translocation");
    } catch {
      updaterStore.isTranslocated = false;
    }

    const update = await check();
    updaterStore.lastChecked = Date.now();

    if (update) {
      currentUpdate = update;
      updaterStore.available = true;
      updaterStore.newVersion = update.version;
      updaterStore.releaseNotes = update.body ?? "";
      updaterStore.releaseDate = update.date ?? "";
      updaterStore.showDialog = true;
    } else {
      currentUpdate = null;
      updaterStore.available = false;
      updaterStore.newVersion = null;
      updaterStore.releaseNotes = null;
      updaterStore.releaseDate = null;
    }
  } catch (err) {
    console.error("Update check failed:", err);
    updaterStore.error = err instanceof Error ? err.message : String(err);
  } finally {
    updaterStore.checking = false;
  }
}

export async function downloadAndInstallUpdate(): Promise<void> {
  if (!isTauri || !currentUpdate || updaterStore.downloading) return;

  updaterStore.downloading = true;
  updaterStore.downloadProgress = 0;
  updaterStore.downloadedBytes = 0;
  updaterStore.totalBytes = 0;
  updaterStore.error = null;

  try {
    let accumulatedBytes = 0;
    await currentUpdate.downloadAndInstall((event) => {
      if (event.event === "Started") {
        updaterStore.totalBytes = event.data.contentLength ?? 0;
      } else if (event.event === "Progress") {
        accumulatedBytes += event.data.chunkLength;
        updaterStore.downloadedBytes = accumulatedBytes;
        if (updaterStore.totalBytes > 0) {
          updaterStore.downloadProgress = Math.min(
            100,
            Math.round((accumulatedBytes / updaterStore.totalBytes) * 100)
          );
        }
      } else if (event.event === "Finished") {
        updaterStore.downloading = false;
        updaterStore.readyToRestart = true;
        updaterStore.downloadProgress = 100;
      }
    });

    updaterStore.downloading = false;
    updaterStore.readyToRestart = true;
  } catch (err) {
    console.error("Update download/installation failed:", err);
    updaterStore.error = err instanceof Error ? err.message : String(err);
    updaterStore.downloading = false;
  }
}

export async function relaunchApp(): Promise<void> {
  if (!isTauri) return;
  try {
    await invoke("relaunch_desktop_for_update");
  } catch (err) {
    console.error("Failed to relaunch desktop app:", err);
    updaterStore.error = err instanceof Error ? err.message : String(err);
  }
}

export function closeUpdateDialog(): void {
  updaterStore.showDialog = false;
}
