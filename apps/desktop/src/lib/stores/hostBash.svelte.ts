// Host bash whitelist & approval settings — state + orchestration.
import type { DesktopApprovalDecision, DesktopApprovalResult } from "@molibot/desktop-contract";
import {
  loadDesktopHostBashSettings,
  toggleDesktopHostBashWhitelistItem,
  deleteDesktopHostBashWhitelistItem,
  deleteDesktopHostBashHistoryRecord,
  resolveDesktopHostBashById,
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
  resolvingId: null as string | null,
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

/**
 * Resolve a pending approval from the settings page. Returns the server's
 * outcome so the caller can surface "approved but the command itself failed" —
 * the row disappearing alone would hide that.
 */
export async function resolveHostBashApproval(requestId: string, decision: DesktopApprovalDecision): Promise<DesktopApprovalResult | null> {
  const endpoint = session.endpoint || hostBashStore.endpoint;
  if (!endpoint || hostBashStore.resolvingId) return null;
  hostBashStore.resolvingId = requestId;
  session.error = "";
  try {
    const result = await resolveDesktopHostBashById(endpoint, requestId, decision);
    await refreshHostBash();
    return result;
  } catch (cause) {
    setError(cause);
    return null;
  } finally {
    hostBashStore.resolvingId = null;
  }
}
