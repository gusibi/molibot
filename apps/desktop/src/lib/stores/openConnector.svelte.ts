import { loadDesktopOpenConnector, refreshDesktopOpenConnector, revealDesktopOpenConnectorToken, saveDesktopOpenConnector } from "../api";
import type { DesktopOpenConnectorSummary } from "@molibot/desktop-contract";
import { session, setError } from "./session.svelte";

export const openConnectorStore = $state({
  summary: null as DesktopOpenConnectorSummary | null,
  endpoint: "",
  loading: false,
  saving: false,
  message: "",
  draft: { enabled: false, baseUrl: "https://opc.eztoolab.com", consoleUrl: "https://opc.eztoolab.com/providers", runtimeToken: "", clearRuntimeToken: false }
});

function hydrate(summary: DesktopOpenConnectorSummary): void {
  openConnectorStore.summary = summary;
  openConnectorStore.draft = {
    enabled: summary.config.enabled,
    baseUrl: summary.config.baseUrl,
    consoleUrl: summary.config.consoleUrl,
    runtimeToken: "",
    clearRuntimeToken: false
  };
}

export async function loadOpenConnector(endpoint: string): Promise<void> {
  openConnectorStore.endpoint = endpoint;
  openConnectorStore.loading = true;
  session.error = "";
  try { hydrate(await loadDesktopOpenConnector(endpoint)); }
  catch (cause) { openConnectorStore.endpoint = ""; setError(cause); }
  finally { openConnectorStore.loading = false; }
}

export async function refreshOpenConnector(): Promise<void> {
  if (!session.endpoint || openConnectorStore.loading) return;
  openConnectorStore.loading = true;
  session.error = "";
  try { hydrate(await refreshDesktopOpenConnector(session.endpoint)); }
  catch (cause) { setError(cause); }
  finally { openConnectorStore.loading = false; }
}

export async function saveOpenConnector(): Promise<void> {
  if (!session.endpoint || openConnectorStore.saving) return;
  openConnectorStore.saving = true;
  openConnectorStore.message = "";
  session.error = "";
  try {
    hydrate(await saveDesktopOpenConnector(session.endpoint, openConnectorStore.draft));
    openConnectorStore.message = session.text.openConnectorSaved;
  } catch (cause) { setError(cause); }
  finally { openConnectorStore.saving = false; }
}

export async function revealOpenConnectorToken(): Promise<string> {
  if (!session.endpoint) return "";
  try {
    const runtimeToken = await revealDesktopOpenConnectorToken(session.endpoint);
    openConnectorStore.draft.runtimeToken = runtimeToken;
    return runtimeToken;
  } catch (cause) {
    setError(cause);
    return "";
  }
}
