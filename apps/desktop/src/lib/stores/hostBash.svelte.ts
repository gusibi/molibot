// Host bash whitelist & approval settings — state + orchestration.
import {
  loadDesktopHostBashSettings,
  toggleDesktopHostBashWhitelistItem,
  deleteDesktopHostBashWhitelistItem,
  deleteDesktopHostBashHistoryRecord,
  type DesktopHostBashSettingsData
} from "../api";
import { session, setError } from "./session.svelte";

export type HostBashCategoryFilter = "all" | "bash" | "mcp" | "file_write" | "miniapp";
export type HostBashTab = "all" | "whitelist" | "pending" | "history";
export type HostBashStatusFilter = "all" | "approved" | "rejected" | "executed" | "failed";
export type HostBashModeFilter = "all" | "persistent" | "ephemeral" | "session";

export const hostBashStore = $state({
  data: null as DesktopHostBashSettingsData | null,
  loading: false,
  endpoint: "",
  togglingId: null as string | null,
  deletingId: null as string | null,
  query: "",
  categoryFilter: "all" as HostBashCategoryFilter,
  statusFilter: "all" as HostBashStatusFilter,
  modeFilter: "all" as HostBashModeFilter,
  activeTab: "all" as HostBashTab
});

export async function loadHostBash(endpoint: string): Promise<void> {
  hostBashStore.endpoint = endpoint;
  hostBashStore.loading = true;
  session.error = "";
  try {
    hostBashStore.data = await loadDesktopHostBashSettings(endpoint, {
      category: hostBashStore.categoryFilter,
      status: hostBashStore.statusFilter,
      mode: hostBashStore.modeFilter,
      query: hostBashStore.query
    });
  } catch (cause) {
    hostBashStore.endpoint = "";
    setError(cause);
  } finally {
    hostBashStore.loading = false;
  }
}

export async function refreshHostBash(): Promise<void> {
  const endpoint = session.endpoint || hostBashStore.endpoint;
  if (!endpoint) return;
  session.error = "";
  try {
    hostBashStore.data = await loadDesktopHostBashSettings(endpoint, {
      category: hostBashStore.categoryFilter,
      status: hostBashStore.statusFilter,
      mode: hostBashStore.modeFilter,
      query: hostBashStore.query
    });
  } catch (cause) {
    setError(cause);
  }
}

export async function toggleHostBashWhitelist(id: string, enabled: boolean): Promise<void> {
  const endpoint = session.endpoint || hostBashStore.endpoint;
  if (!endpoint || hostBashStore.togglingId) return;
  hostBashStore.togglingId = id;
  session.error = "";
  try {
    await toggleDesktopHostBashWhitelistItem(endpoint, id, enabled);
    await refreshHostBash();
  } catch (cause) {
    setError(cause);
  } finally {
    hostBashStore.togglingId = null;
  }
}

export async function deleteHostBashWhitelist(id: string): Promise<void> {
  const endpoint = session.endpoint || hostBashStore.endpoint;
  if (!endpoint || hostBashStore.deletingId) return;
  hostBashStore.deletingId = id;
  session.error = "";
  try {
    await deleteDesktopHostBashWhitelistItem(endpoint, id);
    await refreshHostBash();
  } catch (cause) {
    setError(cause);
  } finally {
    hostBashStore.deletingId = null;
  }
}

export async function deleteHostBashHistory(id: string): Promise<void> {
  const endpoint = session.endpoint || hostBashStore.endpoint;
  if (!endpoint || hostBashStore.deletingId) return;
  hostBashStore.deletingId = id;
  session.error = "";
  try {
    await deleteDesktopHostBashHistoryRecord(endpoint, id);
    await refreshHostBash();
  } catch (cause) {
    setError(cause);
  } finally {
    hostBashStore.deletingId = null;
  }
}
