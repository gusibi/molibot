// MCP server settings — state + orchestration.
import { deleteDesktopMcp, loadDesktopMcp, oauthLoginDesktopMcp, oauthLogoutDesktopMcp, reconnectAllDesktopMcp, reconnectDesktopMcp, saveDesktopMcp, toggleDesktopMcp } from "../api";
import type { DesktopMcpItem, DesktopMcpSaveRequest, DesktopMcpSummary } from "@molibot/desktop-contract";
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

// The loopback callback completes in the system browser; poll the status until
// the shared authorization attempt settles so the list reflects it without a
// manual refresh. Keyed on endpoint so a later navigation cannot be overwritten.
let oauthPoll: ReturnType<typeof setInterval> | undefined;

export function stopMcpOauthPoll(): void {
  if (oauthPoll) { clearInterval(oauthPoll); oauthPoll = undefined; }
}

function startMcpOauthPoll(id: string): void {
  stopMcpOauthPoll();
  const endpoint = session.endpoint ?? "";
  if (!endpoint) return;
  const deadline = Date.now() + 120_000;
  oauthPoll = setInterval(() => {
    void (async () => {
      if (Date.now() > deadline || session.endpoint !== endpoint) { stopMcpOauthPoll(); return; }
      let summary: DesktopMcpSummary;
      try {
        summary = await loadDesktopMcp(endpoint);
      } catch {
        return; // A transient failure must not end a live authorization.
      }
      if (session.endpoint !== endpoint) { stopMcpOauthPoll(); return; }
      mcpStore.mcp = summary;
      const server = summary.items.find((item) => item.id === id);
      if (server && server.authState !== "authorized" && server.authState !== "error" && server.authState !== "expired") return;
      stopMcpOauthPoll();
      // Authorized but still offline: reuse the shared idempotent reconcile so the
      // new credentials are picked up and the tools appear without a manual reconnect.
      if (server?.authState === "authorized" && server.enabled && server.connectionState !== "connected") {
        void reconnectAllDesktopMcp(endpoint)
          .then((next) => { if (session.endpoint === endpoint) mcpStore.mcp = next; })
          .catch(() => { /* best-effort; the manual Reconnect button remains */ });
      }
    })();
  }, 3_000);
}

/** Start OAuth in the system browser; returns the URL the caller must open. */
export async function oauthMcpLogin(id: string, reauthorize: boolean): Promise<string> {
  const endpoint = session.endpoint;
  if (!endpoint || mcpStore.busyId) return "";
  mcpStore.busyId = id;
  session.error = "";
  try {
    const response = await oauthLoginDesktopMcp(endpoint, id, reauthorize);
    mcpStore.mcp = response.summary;
    // A re-authorization can settle from a stored refresh token without a browser;
    // only announce the browser step when there is actually a URL to open.
    mcpStore.actionMessage = response.authorizationUrl ? session.text.mcpAuthPending : "";
    startMcpOauthPoll(id);
    return response.authorizationUrl ?? "";
  } catch (cause) {
    setError(cause);
    return "";
  } finally {
    mcpStore.busyId = "";
  }
}

export async function oauthMcpLogout(id: string): Promise<void> {
  const endpoint = session.endpoint;
  if (!endpoint || mcpStore.busyId) return;
  stopMcpOauthPoll();
  mcpStore.busyId = id;
  session.error = "";
  try {
    mcpStore.mcp = await oauthLogoutDesktopMcp(endpoint, id);
    mcpStore.actionMessage = session.text.mcpAuthSignedOut;
  } catch (cause) {
    setError(cause);
  } finally {
    mcpStore.busyId = "";
  }
}

export async function loadMcp(endpoint: string): Promise<void> {
  stopMcpOauthPoll();
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
  mcpStore.mcpEdit = { isNew: true, id: `mcp-${Math.random().toString(36).slice(2, 10)}`, name: "", enabled: true, transport: "stdio", toolNamePrefix: "", timeoutMs: 120_000, command: "", url: "", argsDraft: "", envDraft: "", headerDraft: "", authMode: "headers", authServerMetadataUrl: "", clientName: "", clearEnvKeys: [], clearHeaderKeys: [] };
  mcpStore.actionMessage = "";
}

export function beginMcpEdit(server: DesktopMcpItem): void {
  mcpStore.mcpEdit = { isNew: false, previousId: server.id, id: server.id, name: server.name, enabled: server.enabled, transport: server.transport, toolNamePrefix: server.toolNamePrefix, timeoutMs: server.timeoutMs ?? 120_000, command: server.command, url: server.url, argsDraft: "", envDraft: "", headerDraft: "", authMode: server.authMode, authServerMetadataUrl: "", clientName: "", clearEnvKeys: [], clearHeaderKeys: [] };
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
      timeoutMs: mcpEdit.timeoutMs,
      command: mcpEdit.command,
      url: mcpEdit.url,
      args,
      clearArgs: mcpEdit.clearArgs,
      envValues: parseReplacementMap(mcpEdit.envDraft),
      clearEnvKeys: mcpEdit.clearEnvKeys,
      cwdValue: mcpEdit.cwdValue,
      clearCwd: mcpEdit.clearCwd,
      headerValues: parseReplacementMap(mcpEdit.headerDraft),
      clearHeaderKeys: mcpEdit.clearHeaderKeys,
      authMode: mcpEdit.authMode,
      // Blank keeps the stored value (the server falls back to the existing
      // config); the desktop editor never echoes the saved override.
      ...(mcpEdit.authServerMetadataUrl?.trim() ? { authServerMetadataUrl: mcpEdit.authServerMetadataUrl.trim() } : {}),
      ...(mcpEdit.clientName?.trim() ? { clientName: mcpEdit.clientName.trim() } : {})
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
