// Web profile settings — state + orchestration.
import { deleteDesktopWebProfile, loadDesktopProfileFiles, loadDesktopWebProfiles, patchDesktopWebProfile, saveDesktopProfileFiles, saveDesktopWebProfile } from "../api";
import type { DesktopWebProfile } from "@molibot/desktop-contract";
import { emptyProfileFiles } from "../settings/profileFiles";
import { session, setError } from "./session.svelte";

export type ProfileEditor = { previousId?: string; isNew: boolean; id: string; name: string; enabled: boolean; agentId: string; sandboxEnabled?: boolean; files: Record<string, string> };

export const profilesStore = $state({
  webProfiles: [] as DesktopWebProfile[],
  loading: false,
  endpoint: "",
  patchingProfileId: null as string | null,
  profileEdit: null as ProfileEditor | null,
  saving: false,
  editorLoading: false,
  actionMessage: ""
});

function newProfileId(): string {
  const suffix = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `web-${suffix}`;
}

export async function loadWebProfiles(endpoint: string): Promise<void> {
  profilesStore.endpoint = endpoint;
  profilesStore.loading = true;
  session.error = "";
  try {
    profilesStore.webProfiles = await loadDesktopWebProfiles(endpoint);
  } catch (cause) {
    profilesStore.endpoint = "";
    setError(cause);
  } finally {
    profilesStore.loading = false;
  }
}

export async function toggleProfile(profile: DesktopWebProfile): Promise<void> {
  const endpoint = session.endpoint;
  if (!endpoint || profilesStore.patchingProfileId) return;
  profilesStore.patchingProfileId = profile.id;
  session.error = "";
  try {
    const updated = await patchDesktopWebProfile(endpoint, profile.id, { enabled: !profile.enabled });
    profilesStore.webProfiles = profilesStore.webProfiles.map((item) => (item.id === updated.id ? updated : item));
  } catch (cause) {
    setError(cause);
  } finally {
    profilesStore.patchingProfileId = null;
  }
}

export function beginNewProfile(): void {
  profilesStore.profileEdit = { isNew: true, id: newProfileId(), name: "", enabled: true, agentId: "", files: emptyProfileFiles() };
  profilesStore.actionMessage = "";
}

export async function beginProfileEdit(profile: DesktopWebProfile): Promise<void> {
  const endpoint = session.endpoint;
  if (!endpoint || profilesStore.editorLoading) return;
  profilesStore.editorLoading = true;
  profilesStore.actionMessage = "";
  try {
    profilesStore.profileEdit = {
      previousId: profile.id,
      isNew: false,
      id: profile.id,
      name: profile.name,
      enabled: profile.enabled,
      agentId: profile.agentId,
      sandboxEnabled: profile.sandboxEnabled,
      files: { ...emptyProfileFiles(), ...(await loadDesktopProfileFiles(endpoint, profile.id)) }
    };
  } catch (cause) {
    setError(cause);
  } finally {
    profilesStore.editorLoading = false;
  }
}

export function updateProfileEdit(updater: (draft: ProfileEditor) => ProfileEditor): void {
  if (profilesStore.profileEdit) profilesStore.profileEdit = updater(profilesStore.profileEdit);
}

export async function saveProfileEditor(): Promise<void> {
  const endpoint = session.endpoint;
  const profileEdit = profilesStore.profileEdit;
  if (!endpoint || !profileEdit || profilesStore.saving || !profileEdit.id.trim()) return;
  profilesStore.saving = true;
  session.error = "";
  try {
    const saved = await saveDesktopWebProfile(endpoint, {
      previousId: profileEdit.isNew ? undefined : profileEdit.previousId,
      id: profileEdit.id.trim(),
      name: profileEdit.name.trim(),
      enabled: profileEdit.enabled,
      agentId: profileEdit.agentId,
      sandboxEnabled: profileEdit.sandboxEnabled
    });
    await saveDesktopProfileFiles(endpoint, saved.id, profileEdit.files);
    profilesStore.endpoint = "";
    await loadWebProfiles(endpoint);
    profilesStore.profileEdit = null;
    profilesStore.actionMessage = session.text.profileSaved;
  } catch (cause) {
    setError(cause);
  } finally {
    profilesStore.saving = false;
  }
}

export async function removeProfile(profileId: string): Promise<void> {
  const endpoint = session.endpoint;
  if (!endpoint || profilesStore.saving || !window.confirm(session.text.profileDeleteConfirm)) return;
  profilesStore.saving = true;
  session.error = "";
  try {
    await deleteDesktopWebProfile(endpoint, profileId);
    profilesStore.webProfiles = profilesStore.webProfiles.filter((profile) => profile.id !== profileId);
    if (profilesStore.profileEdit?.previousId === profileId) profilesStore.profileEdit = null;
    profilesStore.actionMessage = session.text.profileDeleted;
  } catch (cause) {
    setError(cause);
  } finally {
    profilesStore.saving = false;
  }
}
