// Sandbox policy settings — state + orchestration.
//
// Wraps the pure transport helpers in `../api` with the UI state (loading
// flags, working draft, pristine snapshot for dirty detection) consumed by
// `settings/SandboxSection.svelte`.
import {
  applyDesktopSandboxPreset,
  detectDesktopSandboxPreset,
  loadDesktopSandbox,
  parseDesktopSandboxList,
  saveDesktopSandbox,
  type DesktopSandboxPreset
} from "../api";
import type { DesktopSandboxSummary, DesktopSandboxUpdateRequest } from "@molibot/desktop-contract";
import { session, setError } from "./session.svelte";

export type SandboxEditor = {
  enabled: boolean;
  initFailureMode: "warn-disable" | "block";
  envFilePath: string;
  preserveExternalEnvFilePath: boolean;
  envInheritMode: "minimal" | "allowlist" | "full";
  envAllowText: string;
  envDenyText: string;
  networkAllowText: string;
  networkDenyText: string;
  denyReadText: string;
  allowWriteText: string;
  denyWriteText: string;
};

export const sandboxStore = $state({
  sandbox: null as DesktopSandboxSummary | null,
  sandboxEdit: null as SandboxEditor | null,
  loading: false,
  endpoint: "",
  saving: false,
  diagnosing: false,
  actionMessage: "",
  pristine: ""
});

export function sandboxSummaryToEditor(summary: DesktopSandboxSummary): SandboxEditor {
  return {
    enabled: summary.enabled,
    initFailureMode: summary.initFailureMode,
    envFilePath: summary.envFilePath ?? "",
    preserveExternalEnvFilePath: summary.envFilePathConfiguredExternally,
    envInheritMode: summary.env.inheritMode,
    envAllowText: summary.env.allow.join("\n"),
    envDenyText: summary.env.deny.join("\n"),
    networkAllowText: summary.network.allowedDomains.join("\n"),
    networkDenyText: summary.network.deniedDomains.join("\n"),
    denyReadText: summary.filesystem.denyRead.join("\n"),
    allowWriteText: summary.filesystem.allowWrite.join("\n"),
    denyWriteText: summary.filesystem.denyWrite.join("\n")
  };
}

export function buildSandboxRequest(draft: SandboxEditor): DesktopSandboxUpdateRequest {
  const request: DesktopSandboxUpdateRequest = {
    enabled: draft.enabled,
    initFailureMode: draft.initFailureMode,
    env: {
      inheritMode: draft.envInheritMode,
      allow: parseDesktopSandboxList(draft.envAllowText),
      deny: parseDesktopSandboxList(draft.envDenyText)
    },
    network: {
      allowedDomains: parseDesktopSandboxList(draft.networkAllowText),
      deniedDomains: parseDesktopSandboxList(draft.networkDenyText)
    },
    filesystem: {
      denyRead: parseDesktopSandboxList(draft.denyReadText),
      allowWrite: parseDesktopSandboxList(draft.allowWriteText),
      denyWrite: parseDesktopSandboxList(draft.denyWriteText)
    }
  };
  if (!draft.preserveExternalEnvFilePath || draft.envFilePath.trim()) request.envFilePath = draft.envFilePath.trim();
  return request;
}

/** Preset detected from the current draft, or "custom" when nothing matches. */
export function detectSandboxPreset(draft: SandboxEditor): DesktopSandboxPreset | "custom" {
  return detectDesktopSandboxPreset(buildSandboxRequest(draft));
}

export function updateSandboxEdit(updater: (draft: SandboxEditor) => SandboxEditor): void {
  if (sandboxStore.sandboxEdit) sandboxStore.sandboxEdit = updater(sandboxStore.sandboxEdit);
}

export function applySandboxPreset(name: DesktopSandboxPreset): void {
  const preset = applyDesktopSandboxPreset(name);
  if (!preset.env || !preset.network || !preset.filesystem) return;
  sandboxStore.sandboxEdit = {
    enabled: preset.enabled ?? true,
    initFailureMode: preset.initFailureMode ?? "warn-disable",
    envFilePath: preset.envFilePath ?? ".env",
    preserveExternalEnvFilePath: false,
    envInheritMode: preset.env.inheritMode ?? "minimal",
    envAllowText: (preset.env.allow ?? []).join("\n"),
    envDenyText: (preset.env.deny ?? []).join("\n"),
    networkAllowText: (preset.network.allowedDomains ?? []).join("\n"),
    networkDenyText: (preset.network.deniedDomains ?? []).join("\n"),
    denyReadText: (preset.filesystem.denyRead ?? []).join("\n"),
    allowWriteText: (preset.filesystem.allowWrite ?? []).join("\n"),
    denyWriteText: (preset.filesystem.denyWrite ?? []).join("\n")
  };
  sandboxStore.actionMessage = "";
}

export function resetSandboxEditor(): void {
  if (sandboxStore.sandbox) sandboxStore.sandboxEdit = sandboxSummaryToEditor(sandboxStore.sandbox);
  sandboxStore.actionMessage = "";
}

export async function loadSandbox(endpoint: string): Promise<void> {
  sandboxStore.endpoint = endpoint;
  sandboxStore.loading = true;
  session.error = "";
  try {
    sandboxStore.sandbox = await loadDesktopSandbox(endpoint);
    sandboxStore.sandboxEdit = sandboxSummaryToEditor(sandboxStore.sandbox);
    sandboxStore.pristine = JSON.stringify(sandboxStore.sandboxEdit);
    sandboxStore.actionMessage = "";
  } catch (cause) {
    sandboxStore.endpoint = "";
    setError(cause);
  } finally {
    sandboxStore.loading = false;
  }
}

export async function saveSandboxPolicy(): Promise<void> {
  const endpoint = session.endpoint;
  if (!endpoint || !sandboxStore.sandboxEdit || sandboxStore.saving) return;
  sandboxStore.saving = true;
  session.error = "";
  try {
    sandboxStore.sandbox = await saveDesktopSandbox(endpoint, buildSandboxRequest(sandboxStore.sandboxEdit));
    sandboxStore.sandboxEdit = sandboxSummaryToEditor(sandboxStore.sandbox);
    sandboxStore.pristine = JSON.stringify(sandboxStore.sandboxEdit);
    sandboxStore.actionMessage = session.text.sandboxSaved;
  } catch (cause) {
    setError(cause);
  } finally {
    sandboxStore.saving = false;
  }
}

export async function refreshSandboxDiagnostics(): Promise<void> {
  const endpoint = session.endpoint;
  if (!endpoint || sandboxStore.diagnosing) return;
  sandboxStore.diagnosing = true;
  session.error = "";
  try {
    const refreshed = await loadDesktopSandbox(endpoint);
    sandboxStore.sandbox = sandboxStore.sandbox ? { ...sandboxStore.sandbox, diagnostics: refreshed.diagnostics } : refreshed;
    sandboxStore.actionMessage = session.text.sandboxDiagnosticsUpdated;
  } catch (cause) {
    setError(cause);
  } finally {
    sandboxStore.diagnosing = false;
  }
}
