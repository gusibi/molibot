// MCP server settings — state + orchestration.
import { deleteDesktopMcp, loadDesktopMcp, reconnectAllDesktopMcp, reconnectDesktopMcp, saveDesktopMcp, toggleDesktopMcp } from "../api";
import type { DesktopMcpSaveRequest, DesktopMcpSummary } from "@molibot/desktop-contract";
import { session, setError } from "./session.svelte";

export type McpEditor = DesktopMcpSaveRequest & { isNew: boolean; argsDraft: string; envDraft: string; headerDraft: string };

export const mcpStore = $state({
  mcp: null as DesktopMcpSummary | null,
  loading: false,
  endpoint: "",
  mcpEdit: null as McpEditor | null,
  saving: false,
  busyId: "",
  actionMessage: ""
});

export async function loadMcp(endpoint: string): Promise<void> {
  mcpStore.endpoint = endpoint;
  mcpStore.loading = true;
  session.error = "";
  try {
    mcpStore.mcp = await loadDesktopMcp(endpoint);
    // Auto-reconnect enabled servers that are not connected on app reopen, so
    // MCP comes back online without the user clicking Reconnect for each one.
    // Fire-and-forget: the list is already shown; the summary updates when the
    // shared reconcile (idempotent - already-connected servers are skipped)
    // settles. Guarded by endpoint so a later load can't be overwritten.
    if (mcpStore.mcp?.items.some((server) => server.enabled && server.connectionState !== "connected")) {
      void reconnectAllDesktopMcp(endpoint)
        .then((summary) => { if (endpoint === mcpStore.endpoint) mcpStore.mcp = summary; })
        .catch(() => { /* best-effort; the manual Reconnect button remains */ });
    }
  } catch (cause) {
    mcpStore.endpoint = "";
    setError(cause);
  } finally {
    mcpStore.loading = false;
  }
}

export function beginNewMcp(): void {
  mcpStore.mcpEdit = { isNew: true, id: `mcp-${Math.random().toString(36).slice(2, 10)}`, name: "", enabled: true, transport: "stdio", toolNamePrefix: "", command: "", url: "", argsDraft: "", envDraft: "", headerDraft: "", clearEnvKeys: [], clearHeaderKeys: [] };
  mcpStore.actionMessage = "";
}

export function beginMcpEdit(server: DesktopMcpSummary["items"][number]): void {
  mcpStore.mcpEdit = { isNew: false, previousId: server.id, id: server.id, name: server.name, enabled: server.enabled, transport: server.transport, toolNamePrefix: server.toolNamePrefix, command: server.command, url: server.url, argsDraft: "", envDraft: "", headerDraft: "", clearEnvKeys: [], clearHeaderKeys: [] };
  mcpStore.actionMessage = "";
}

export function updateMcpEdit(updater: (draft: McpEditor) => McpEditor): void {
  if (mcpStore.mcpEdit) mcpStore.mcpEdit = updater(mcpStore.mcpEdit);
}

function parseReplacementMap(value: string): Record<string, string> | undefined {
  if (!value.trim()) return undefined;
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(session.text.mcpMapInvalid);
  return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).map(([key, item]) => [key.trim(), String(item ?? "")]).filter(([key]) => Boolean(key)));
}

export async function saveMcpEditor(): Promise<void> {
  const endpoint = session.endpoint;
  const mcpEdit = mcpStore.mcpEdit;
  if (!endpoint || !mcpEdit || mcpStore.saving) return;
  mcpStore.saving = true;
  session.error = "";
  try {
    const args = mcpEdit.argsDraft.trim() ? mcpEdit.argsDraft.split("\n").map((value) => value.trim()).filter(Boolean) : mcpEdit.isNew ? [] : undefined;
    mcpStore.mcp = await saveDesktopMcp(endpoint, {
      previousId: mcpEdit.isNew ? undefined : mcpEdit.previousId,
      id: mcpEdit.id,
      name: mcpEdit.name,
      enabled: mcpEdit.enabled,
      transport: mcpEdit.transport,
      toolNamePrefix: mcpEdit.toolNamePrefix,
      command: mcpEdit.command,
      url: mcpEdit.url,
      args,
      clearArgs: mcpEdit.clearArgs,
      envValues: parseReplacementMap(mcpEdit.envDraft),
      clearEnvKeys: mcpEdit.clearEnvKeys,
      cwdValue: mcpEdit.cwdValue,
      clearCwd: mcpEdit.clearCwd,
      headerValues: parseReplacementMap(mcpEdit.headerDraft),
      clearHeaderKeys: mcpEdit.clearHeaderKeys
    });
    mcpStore.mcpEdit = null;
    mcpStore.actionMessage = session.text.mcpSaved;
  } catch (cause) {
    setError(cause);
  } finally {
    mcpStore.saving = false;
  }
}

export async function removeMcpServer(id: string): Promise<void> {
  const endpoint = session.endpoint;
  if (!endpoint || mcpStore.saving || !window.confirm(session.text.mcpDeleteConfirm)) return;
  mcpStore.saving = true;
  try {
    mcpStore.mcp = await deleteDesktopMcp(endpoint, id);
    if (mcpStore.mcpEdit?.previousId === id) mcpStore.mcpEdit = null;
    mcpStore.actionMessage = session.text.mcpDeleted;
  } catch (cause) {
    setError(cause);
  } finally {
    mcpStore.saving = false;
  }
}

export async function toggleMcpServer(id: string, enabled: boolean): Promise<void> {
  const endpoint = session.endpoint;
  if (!endpoint || mcpStore.busyId) return;
  mcpStore.busyId = id;
  session.error = "";
  try {
    mcpStore.mcp = await toggleDesktopMcp(endpoint, id, enabled);
    mcpStore.actionMessage = enabled ? session.text.mcpEnabledMessage : session.text.mcpDisabledMessage;
  } catch (cause) {
    setError(cause);
  } finally {
    mcpStore.busyId = "";
  }
}

export async function reconnectMcp(id: string): Promise<void> {
  const endpoint = session.endpoint;
  if (!endpoint || mcpStore.busyId) return;
  mcpStore.busyId = id;
  session.error = "";
  try {
    mcpStore.mcp = await reconnectDesktopMcp(endpoint, id);
    mcpStore.actionMessage = session.text.mcpReconnectFinished;
  } catch (cause) {
    setError(cause);
  } finally {
    mcpStore.busyId = "";
  }
}
