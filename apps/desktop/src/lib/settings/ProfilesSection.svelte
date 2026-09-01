<script lang="ts">
  import X from "reicon-svelte/icons/X";
  import { hasEnabledWebProfile } from "../api";
  import type { DesktopWebProfile } from "@molibot/desktop-contract";
  import AlertDialog from "../components/ui/AlertDialog.svelte";
  import Dialog from "../components/ui/Dialog.svelte";
  import EmptyState from "../components/ui/EmptyState.svelte";
  import IosSwitch from "../components/ui/IosSwitch.svelte";
  import SelectControl from "../components/ui/SelectControl.svelte";
  import SettingGroup from "../components/ui/SettingGroup.svelte";
  import SettingRow from "../components/ui/SettingRow.svelte";
  import { session } from "../stores/session.svelte";
  import { agentsStore, loadAgents } from "../stores/agents.svelte";
  import { PROFILE_FILE_NAMES } from "./profileFiles";
  import {
    profilesStore,
    beginNewProfile,
    beginProfileEdit,
    loadWebProfiles,
    removeProfile,
    saveProfileEditor,
    toggleProfile,
    updateProfileEdit
  } from "../stores/profiles.svelte";

  let deletingProfile = $state<DesktopWebProfile | null>(null);

  $effect(() => {
    if (session.serviceReady && session.endpoint && session.endpoint !== profilesStore.endpoint) {
      void loadWebProfiles(session.endpoint);
    }
  });
  $effect(() => {
    if (session.serviceReady && session.endpoint && session.endpoint !== agentsStore.endpoint) {
      void loadAgents(session.endpoint);
    }
  });

  async function handleConfirmDelete(): Promise<void> {
    if (!deletingProfile) return;
    const id = deletingProfile.id;
    deletingProfile = null;
    await removeProfile(id);
  }
</script>

{#if !session.serviceReady}
  <SettingGroup><EmptyState title={session.text.profilesUnavailable} icon="user" /></SettingGroup>
{:else if profilesStore.loading}
  <SettingGroup><div class="settings-row"><p>{session.text.loading}</p></div></SettingGroup>
{:else}
  {#if !hasEnabledWebProfile(profilesStore.webProfiles)}
    <SettingGroup><div class="settings-row"><p class="error-message">{session.text.profilesNoneEnabled}</p></div></SettingGroup>
  {/if}
  <SettingGroup title={session.text.profiles} description={`${session.text.profiles}: ${profilesStore.webProfiles.length}`}>
    <svelte:fragment slot="action">
      <button class="secondary-button" type="button" disabled={profilesStore.profileEdit !== null} onclick={beginNewProfile}>{session.text.profileAdd}</button>
    </svelte:fragment>
    {#if profilesStore.webProfiles.length === 0}
      <EmptyState title={session.text.profilesEmpty} description={session.text.profilesHint} icon="user" />
    {:else}
      {#each profilesStore.webProfiles as profile (profile.id)}
        <div class="settings-row">
          <div class="profile-info">
            <strong>{profile.name}</strong>
            <p>{profile.agentName ? `${session.text.linkedAgent}: ${profile.agentName}` : session.text.noLinkedAgent}</p>
            <div class="profile-edit-actions">
              <button class="secondary-button" type="button" disabled={profilesStore.editorLoading} onclick={() => void beginProfileEdit(profile)}>{session.text.profileEdit}</button>
              <button class="secondary-button danger-action" type="button" disabled={profilesStore.saving} onclick={() => (deletingProfile = profile)}>{session.text.profileDelete}</button>
            </div>
          </div>
          <IosSwitch
            checked={profile.enabled}
            ariaLabel={profile.name}
            disabled={profilesStore.patchingProfileId === profile.id}
            onCheckedChange={() => void toggleProfile(profile)}
          />
        </div>
      {/each}
    {/if}
  </SettingGroup>
{/if}
{#if profilesStore.profileEdit}
  <Dialog open={true} busy={profilesStore.saving} contentClass="entity-editor-dialog" labelledBy="profile-editor-title" onOpenChange={(next) => { if (!next) profilesStore.profileEdit = null; }}>
  <form id="desktop-profile-form" class="entity-editor-form" aria-label={session.text.profiles} onsubmit={(event) => { event.preventDefault(); void saveProfileEditor(); }}>
    <header class="entity-editor-head"><strong id="profile-editor-title">{session.text.profiles}</strong><button class="modal-close" type="button" aria-label={session.text.dialogClose} disabled={profilesStore.saving} onclick={() => (profilesStore.profileEdit = null)}><X size={16} aria-hidden="true" /></button></header>
    <div class="entity-editor-body">
    <div class="settings-form">
      <label class="settings-field"><span>{session.text.profileId}</span><input value={profilesStore.profileEdit.id} disabled={!profilesStore.profileEdit.isNew} autocomplete="off" spellcheck="false" oninput={(event) => updateProfileEdit((draft) => ({ ...draft, id: (event.currentTarget as HTMLInputElement).value }))} /></label>
      <label class="settings-field"><span>{session.text.profileName}</span><input value={profilesStore.profileEdit.name} autocomplete="off" oninput={(event) => updateProfileEdit((draft) => ({ ...draft, name: (event.currentTarget as HTMLInputElement).value }))} /></label>
      <label class="settings-field"><span>{session.text.profileAgent}</span><SelectControl value={profilesStore.profileEdit.agentId} ariaLabel={session.text.profileAgent} options={[{ value: "", label: session.text.profileNoAgent }, ...(agentsStore.agents?.items.filter((agent) => agent.enabled).map((agent) => ({ value: agent.id, label: agent.name })) ?? [])]} onChange={(value) => updateProfileEdit((draft) => ({ ...draft, agentId: value }))} /></label>
      <label class="settings-field"><span>{session.text.profileSandbox}</span><SelectControl value={profilesStore.profileEdit.sandboxEnabled === undefined ? "inherit" : profilesStore.profileEdit.sandboxEnabled ? "on" : "off"} ariaLabel={session.text.profileSandbox} options={[{ value: "inherit", label: session.text.profileSandboxInherit }, { value: "on", label: session.text.profileSandboxOn }, { value: "off", label: session.text.profileSandboxOff }]} onChange={(value) => updateProfileEdit((draft) => ({ ...draft, sandboxEnabled: value === "inherit" ? undefined : value === "on" }))} /></label>
    </div>
    <div class="provider-inline-options"><div class="inline-switch-row"><span>{session.text.profileEnabled}</span><IosSwitch checked={profilesStore.profileEdit.enabled} ariaLabel={session.text.profileEnabled} onCheckedChange={(checked) => updateProfileEdit((draft) => ({ ...draft, enabled: checked }))} /></div></div>
    <div class="provider-editor-toolbar"><strong>{session.text.profileFiles}</strong></div>
    <div class="profile-files-editor">
      {#each PROFILE_FILE_NAMES as fileName (fileName)}
        <label class="settings-field"><span>{fileName}</span><textarea rows="7" value={profilesStore.profileEdit.files[fileName] ?? ""} autocomplete="off" spellcheck="false" oninput={(event) => updateProfileEdit((draft) => ({ ...draft, files: { ...draft.files, [fileName]: (event.currentTarget as HTMLTextAreaElement).value } }))}></textarea></label>
      {/each}
    </div>
    </div>
    <footer class="entity-editor-foot"><button class="secondary-button" type="button" disabled={profilesStore.saving} onclick={() => (profilesStore.profileEdit = null)}>{session.text.cancel}</button><button class="primary-button" type="submit" disabled={profilesStore.saving || !profilesStore.profileEdit.id.trim()}>{profilesStore.saving ? session.text.onboardingProviderSaving : session.text.save}</button></footer>
  </form>
  </Dialog>
{/if}

{#if deletingProfile}
  <AlertDialog
    open={true}
    contentClass="modal-card"
    labelledBy="profile-delete-title"
    describedBy="profile-delete-description"
    onOpenChange={(next) => { if (!next) deletingProfile = null; }}
  >
    <header class="modal-head"><strong id="profile-delete-title">{session.text.profileDelete}</strong></header>
    <div class="modal-body"><p id="profile-delete-description">{session.text.profileDeleteConfirm}</p></div>
    <footer class="provider-modal-foot">
      <button class="secondary-button" type="button" onclick={() => (deletingProfile = null)}>{session.text.cancel}</button>
      <button class="primary-button danger-action" type="button" onclick={() => void handleConfirmDelete()}>{session.text.profileDelete}</button>
    </footer>
  </AlertDialog>
{/if}

{#if profilesStore.actionMessage}<p class="settings-action-message" aria-live="polite">{profilesStore.actionMessage}</p>{/if}
