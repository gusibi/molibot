// Skill state: the unified manager catalogue, and the search configuration the
// settings page owns. They are separate entities and are saved separately.
import {
  loadConsolidatePreflight,
  loadDesktopSkillSearch,
  loadSkillManager as fetchSkillManager,
  loadSkillPreflight,
  runSkillManagerAction,
  saveDesktopSkillSearch
} from "../api";
import type {
  DesktopSkillBackup,
  DesktopSkillBackupRestoreRequest,
  DesktopSkillBackupRestoreResult,
  DesktopSkillCheckUpdateResult,
  DesktopSkillConsolidatePreflight,
  DesktopSkillConsolidateRequest,
  DesktopSkillConsolidateResult,
  DesktopSkillContentRequest,
  DesktopSkillContentResult,
  DesktopSkillCreateRequest,
  DesktopSkillCreateResult,
  DesktopSkillDistributeRequest,
  DesktopSkillDistributeResult,
  DesktopSkillInstallResult,
  DesktopSkillManagerSummary,
  DesktopSkillPlatformSaveRequest,
  DesktopSkillPreflightRequest,
  DesktopSkillPreflightResult,
  DesktopSkillRemoveDiscoveredResult,
  DesktopSkillSearchConfig,
  DesktopSkillUninstallResult,
  DesktopSkillUpdatePreview
} from "@molibot/desktop-contract";
import { session, setError } from "./session.svelte";

/** Search configuration (settings page). */
export const skillsStore = $state({
  searchDraft: null as DesktopSkillSearchConfig | null,
  searchPristine: "",
  loading: false,
  saving: false,
  saved: false,
  error: "",
  endpoint: "",
  /** New key typed this session; never hydrated from the server. */
  apiKeyDraft: ""
});

export async function loadSkills(endpoint: string): Promise<void> {
  skillsStore.endpoint = endpoint;
  skillsStore.loading = true;
  skillsStore.saved = false;
  skillsStore.error = "";
  try {
    const search = await loadDesktopSkillSearch(endpoint);
    skillsStore.apiKeyDraft = "";
    skillsStore.searchDraft = { ...search, providers: search.providers.map((provider) => ({ ...provider, models: [...provider.models] })) };
    skillsStore.searchPristine = JSON.stringify(skillsStore.searchDraft);
  } catch (cause) {
    skillsStore.endpoint = "";
    setError(cause);
    skillsStore.error = session.error;
  } finally {
    skillsStore.loading = false;
  }
}

export async function saveSkillsSearch(): Promise<void> {
  const endpoint = session.endpoint;
  const draft = skillsStore.searchDraft;
  if (!endpoint || !draft || skillsStore.saving) return;
  skillsStore.saving = true;
  skillsStore.saved = false;
  session.error = "";
  try {
    const search = await saveDesktopSkillSearch(endpoint, {
      localEnabled: draft.localEnabled,
      apiEnabled: draft.apiEnabled,
      apiProvider: draft.apiProvider,
      apiModel: draft.apiModel,
      maxTokens: draft.maxTokens,
      temperature: draft.temperature,
      timeoutMs: draft.timeoutMs,
      minConfidence: draft.minConfidence,
      apiBaseUrl: draft.apiBaseUrl,
      apiPath: draft.apiPath,
      ...(skillsStore.apiKeyDraft ? { apiKey: skillsStore.apiKeyDraft } : {})
    });
    skillsStore.apiKeyDraft = "";
    skillsStore.searchDraft = { ...search, providers: search.providers.map((provider) => ({ ...provider, models: [...provider.models] })) };
    skillsStore.searchPristine = JSON.stringify(skillsStore.searchDraft);
    skillsStore.saved = true;
  } catch (cause) {
    setError(cause);
    skillsStore.error = session.error;
  } finally {
    skillsStore.saving = false;
  }
}

export function discardSkillsSearch(): void {
  if (skillsStore.searchPristine) skillsStore.searchDraft = JSON.parse(skillsStore.searchPristine);
  skillsStore.apiKeyDraft = "";
  skillsStore.saved = false;
}

/** Unified manager catalogue. */
export const skillManagerStore = $state({
  summary: null as DesktopSkillManagerSummary | null,
  endpoint: "",
  loading: false,
  error: "",
  /** Which action is currently in flight, so the row and the sheet agree. */
  busyId: "",
  actionError: "",
  notice: "" as "" | "installed" | "replaced" | "removed" | "builtin",
  lastInstall: null as DesktopSkillInstallResult | null
});

export async function loadSkillManager(endpoint: string): Promise<void> {
  skillManagerStore.endpoint = endpoint;
  skillManagerStore.loading = true;
  skillManagerStore.error = "";
  try {
    skillManagerStore.summary = await fetchSkillManager(endpoint);
  } catch (cause) {
    skillManagerStore.endpoint = "";
    setError(cause);
    skillManagerStore.error = session.error;
  } finally {
    skillManagerStore.loading = false;
  }
}

function applySummary(summary: DesktopSkillManagerSummary | undefined): void {
  if (summary) skillManagerStore.summary = summary;
}

/** Notices describe one completed action; they should not become permanent chrome. */
function announce(notice: typeof skillManagerStore.notice): void {
  skillManagerStore.notice = notice;
  setTimeout(() => {
    if (skillManagerStore.notice === notice) skillManagerStore.notice = "";
  }, 4000);
}

async function run<T>(
  endpoint: string,
  busyId: string,
  action: Parameters<typeof runSkillManagerAction>[1]
): Promise<Partial<T> | null> {
  skillManagerStore.busyId = busyId;
  skillManagerStore.actionError = "";
  skillManagerStore.notice = "";
  try {
    const payload = await runSkillManagerAction<T>(endpoint, action);
    applySummary(payload.summary);
    return payload;
  } catch (cause) {
    skillManagerStore.actionError = cause instanceof Error ? cause.message : String(cause);
    return null;
  } finally {
    skillManagerStore.busyId = "";
  }
}

export async function toggleManagedSkill(id: string, enabled: boolean): Promise<void> {
  const endpoint = session.endpoint;
  if (!endpoint) return;
  await run(endpoint, id, { action: "toggle", request: { id, enabled } });
}

export async function createManagedSkill(request: DesktopSkillCreateRequest): Promise<DesktopSkillCreateResult> {
  const endpoint = session.endpoint;
  if (!endpoint) throw new Error("The service is not connected");
  const payload = await run<{ created: DesktopSkillCreateResult }>(endpoint, "create", {
    action: "create-skill",
    request
  });
  if (!payload?.created) throw new Error(skillManagerStore.actionError || "Could not create the Skill");
  return payload.created;
}

export async function previewManagedSkillUpdate(id: string): Promise<DesktopSkillUpdatePreview> {
  const endpoint = session.endpoint;
  if (!endpoint) throw new Error("The service is not connected");
  const payload = await run<{ preview: DesktopSkillUpdatePreview }>(endpoint, `preview:${id}`, {
    action: "preview-update",
    request: { id }
  });
  if (!payload?.preview) throw new Error(skillManagerStore.actionError || "Could not build the update preview");
  return payload.preview;
}

export async function listManagedSkillBackups(id: string): Promise<DesktopSkillBackup[]> {
  const endpoint = session.endpoint;
  if (!endpoint) return [];
  const payload = await run<{ backups: DesktopSkillBackup[] }>(endpoint, `backups:${id}`, {
    action: "list-backups",
    request: { id }
  });
  return payload?.backups ?? [];
}

export async function restoreManagedSkillBackup(request: DesktopSkillBackupRestoreRequest): Promise<DesktopSkillBackupRestoreResult> {
  const endpoint = session.endpoint;
  if (!endpoint) throw new Error("The service is not connected");
  const payload = await run<{ result: DesktopSkillBackupRestoreResult }>(endpoint, request.id, {
    action: "restore-backup",
    request
  });
  if (!payload?.result) throw new Error(skillManagerStore.actionError || "Could not restore the backup");
  return payload.result;
}

export async function saveManagedSkillContent(request: DesktopSkillContentRequest): Promise<DesktopSkillContentResult> {
  const endpoint = session.endpoint;
  if (!endpoint) throw new Error("The service is not connected");
  const payload = await run<{ saved: DesktopSkillContentResult }>(endpoint, request.id, {
    action: "save-skill-content",
    request
  });
  if (!payload?.saved) throw new Error(skillManagerStore.actionError || "Could not save the Skill");
  return payload.saved;
}

export async function updateBuiltinSkill(id: string): Promise<void> {
  const endpoint = session.endpoint;
  if (!endpoint) return;
  const result = await run(endpoint, `builtin:${id}`, { action: "update-builtin", request: { id } });
  if (result) announce("builtin");
}

export async function loadPreflight(request: DesktopSkillPreflightRequest): Promise<DesktopSkillPreflightResult> {
  const endpoint = session.endpoint;
  if (!endpoint) throw new Error("The service is not connected");
  return loadSkillPreflight(endpoint, request);
}

export async function installManagedSkill(
  request: DesktopSkillPreflightRequest & { token: string; replace: boolean }
): Promise<DesktopSkillInstallResult> {
  const endpoint = session.endpoint;
  if (!endpoint) throw new Error("The service is not connected");
  const payload = await run<{ result: DesktopSkillInstallResult }>(endpoint, "install", {
    action: "install",
    request
  });
  if (!payload?.result) throw new Error(skillManagerStore.actionError || "Installation failed");
  skillManagerStore.lastInstall = payload.result;
  if (payload.result.ok) {
    announce(payload.result.status === "replaced" ? "replaced" : "installed");
  }
  return payload.result;
}

export async function distributeManagedSkill(
  request: DesktopSkillDistributeRequest
): Promise<DesktopSkillDistributeResult> {
  const endpoint = session.endpoint;
  if (!endpoint) throw new Error("The service is not connected");
  const payload = await run<{ result: DesktopSkillDistributeResult }>(endpoint, "distribute", {
    action: "distribute",
    request
  });
  if (!payload?.result) throw new Error(skillManagerStore.actionError || "Distribution failed");
  return payload.result;
}

export async function uninstallManagedSkill(id: string): Promise<DesktopSkillUninstallResult> {
  const endpoint = session.endpoint;
  if (!endpoint) throw new Error("The service is not connected");
  const payload = await run<{ result: DesktopSkillUninstallResult }>(endpoint, id, {
    action: "uninstall",
    request: { id }
  });
  if (!payload?.result) throw new Error(skillManagerStore.actionError || "Removal failed");
  if (payload.result.ok) announce("removed");
  return payload.result;
}

export async function consolidateManagedSkill(
  request: DesktopSkillConsolidateRequest & { token: string }
): Promise<DesktopSkillConsolidateResult> {
  const endpoint = session.endpoint;
  if (!endpoint) throw new Error("The service is not connected");
  const payload = await run<{ result: DesktopSkillConsolidateResult }>(endpoint, "consolidate", {
    action: "consolidate",
    request
  });
  if (!payload?.result) throw new Error(skillManagerStore.actionError || "Consolidation failed");
  if (payload.result.ok) announce("installed");
  return payload.result;
}

export async function loadConsolidateCheck(request: DesktopSkillConsolidateRequest): Promise<DesktopSkillConsolidatePreflight> {
  const endpoint = session.endpoint;
  if (!endpoint) throw new Error("The service is not connected");
  return loadConsolidatePreflight(endpoint, request);
}

export async function removeDiscoveredSkill(
  id: string,
  entryDir?: string
): Promise<DesktopSkillRemoveDiscoveredResult> {
  const endpoint = session.endpoint;
  if (!endpoint) throw new Error("The service is not connected");
  const payload = await run<{ result: DesktopSkillRemoveDiscoveredResult }>(endpoint, `discovered:${id}`, {
    action: "remove-discovered",
    request: entryDir ? { id, entryDir } : { id }
  });
  if (!payload?.result) throw new Error(skillManagerStore.actionError || "Removal failed");
  return payload.result;
}

export async function checkManagedSkillUpdate(id: string): Promise<DesktopSkillCheckUpdateResult> {
  const endpoint = session.endpoint;
  if (!endpoint) throw new Error("The service is not connected");
  const payload = await run<{ result: DesktopSkillCheckUpdateResult }>(endpoint, `check-update:${id}`, {
    action: "check-update",
    request: { id }
  });
  if (!payload?.result) throw new Error(skillManagerStore.actionError || "The update check failed");
  return payload.result;
}

export async function unlinkDistribution(id: string, deleteFiles: boolean): Promise<boolean> {
  const endpoint = session.endpoint;
  if (!endpoint) return false;
  const result = await run(endpoint, `distribution:${id}`, {
    action: "unlink-distribution",
    request: { id, deleteFiles }
  });
  return Boolean(result);
}

export async function saveSkillPlatforms(request: DesktopSkillPlatformSaveRequest): Promise<boolean> {
  const endpoint = session.endpoint;
  if (!endpoint) return false;
  const result = await run(endpoint, "platforms", { action: "save-platforms", request });
  return Boolean(result);
}

export async function revealManagedSkill(id: string): Promise<void> {
  const endpoint = session.endpoint;
  if (!endpoint) return;
  await run(endpoint, `reveal:${id}`, { action: "reveal", request: { id } });
}
