// Host bash whitelist settings — state + orchestration.
import { loadDesktopHostBash, toggleDesktopHostBashWhitelist } from "../api";
import type { DesktopHostBashSummary } from "@molibot/desktop-contract";
import { session, setError } from "./session.svelte";

export const hostBashStore = $state({
  hostBash: null as DesktopHostBashSummary | null,
  loading: false,
  endpoint: "",
  togglingId: null as string | null
});

export async function loadHostBash(endpoint: string): Promise<void> {
  hostBashStore.endpoint = endpoint;
  hostBashStore.loading = true;
  session.error = "";
  try {
    hostBashStore.hostBash = await loadDesktopHostBash(endpoint);
  } catch (cause) {
    hostBashStore.endpoint = "";
    setError(cause);
  } finally {
    hostBashStore.loading = false;
  }
}

export async function toggleHostBashWhitelist(id: string, enabled: boolean): Promise<void> {
  const endpoint = session.endpoint;
  if (!endpoint || hostBashStore.togglingId) return;
  hostBashStore.togglingId = id;
  session.error = "";
  try {
    hostBashStore.hostBash = await toggleDesktopHostBashWhitelist(endpoint, id, enabled);
  } catch (cause) {
    setError(cause);
  } finally {
    hostBashStore.togglingId = null;
  }
}
