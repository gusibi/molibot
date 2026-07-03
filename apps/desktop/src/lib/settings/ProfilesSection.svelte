<script lang="ts">
  import { hasEnabledWebProfile } from "../api";
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
</script>

<p class="settings-section-hint">{session.text.profilesHint}</p>
{#if session.serviceReady && !profilesStore.profileEdit}
  <div class="settings-section-actions"><button class="secondary-button" type="button" onclick={beginNewProfile}>{session.text.profileAdd}</button></div>
{/if}
{#if !session.serviceReady}
  <div class="settings-card"><div class="settings-row"><p>{session.text.profilesUnavailable}</p></div></div>
{:else if profilesStore.loading}
  <div class="settings-card"><div class="settings-row"><p>{session.text.loading}</p></div></div>
{:else if profilesStore.webProfiles.length === 0}
  <div class="settings-card"><div class="settings-row"><p>{session.text.profilesEmpty}</p></div></div>
{:else}
  {#if !hasEnabledWebProfile(profilesStore.webProfiles)}
    <div class="settings-card"><div class="settings-row"><p class="error-message">{session.text.profilesNoneEnabled}</p></div></div>
  {/if}
  <div class="settings-card">
    {#each profilesStore.webProfiles as profile (profile.id)}
      <div class="settings-row">
        <div class="profile-info">
          <strong>{profile.name}</strong>
          <p>{profile.agentName ? `${session.text.linkedAgent}: ${profile.agentName}` : session.text.noLinkedAgent}</p>
          <div class="profile-edit-actions">
            <button class="secondary-button" type="button" disabled={profilesStore.editorLoading} onclick={() => void beginProfileEdit(profile)}>{session.text.profileEdit}</button>
            <button class="secondary-button danger-action" type="button" disabled={profilesStore.saving} onclick={() => void removeProfile(profile.id)}>{session.text.profileDelete}</button>
          </div>
        </div>
        <button
          class:active={profile.enabled}
          class="switch"
          type="button"
          role="switch"
          aria-label={profile.name}
          aria-checked={profile.enabled}
          disabled={profilesStore.patchingProfileId === profile.id}
          onclick={() => void toggleProfile(profile)}
        >
          <span></span>
        </button>
      </div>
    {/each}
  </div>
{/if}
{#if profilesStore.profileEdit}
  <form id="desktop-profile-form" class="settings-card provider-editor" aria-label={session.text.profiles} onsubmit={(event) => { event.preventDefault(); void saveProfileEditor(); }}>
    <header class="entity-editor-head"><strong>{session.text.profiles}</strong><button class="modal-close" type="button" aria-label={session.text.cancel} disabled={profilesStore.saving} onclick={() => (profilesStore.profileEdit = null)}><i class="ph ph-x"></i></button></header>
    <div class="settings-form">
      <label class="settings-field"><span>{session.text.profileId}</span><input value={profilesStore.profileEdit.id} disabled={!profilesStore.profileEdit.isNew} oninput={(event) => updateProfileEdit((draft) => ({ ...draft, id: (event.currentTarget as HTMLInputElement).value }))} /></label>
      <label class="settings-field"><span>{session.text.profileName}</span><input value={profilesStore.profileEdit.name} oninput={(event) => updateProfileEdit((draft) => ({ ...draft, name: (event.currentTarget as HTMLInputElement).value }))} /></label>
      <label class="settings-field"><span>{session.text.profileAgent}</span><select value={profilesStore.profileEdit.agentId} onchange={(event) => updateProfileEdit((draft) => ({ ...draft, agentId: (event.currentTarget as HTMLSelectElement).value }))}><option value="">{session.text.profileNoAgent}</option>{#each agentsStore.agents?.items.filter((agent) => agent.enabled) ?? [] as agent (agent.id)}<option value={agent.id}>{agent.name}</option>{/each}</select></label>
      <label class="settings-field"><span>{session.text.profileSandbox}</span><select value={profilesStore.profileEdit.sandboxEnabled === undefined ? "inherit" : profilesStore.profileEdit.sandboxEnabled ? "on" : "off"} onchange={(event) => { const value = (event.currentTarget as HTMLSelectElement).value; updateProfileEdit((draft) => ({ ...draft, sandboxEnabled: value === "inherit" ? undefined : value === "on" })); }}><option value="inherit">{session.text.profileSandboxInherit}</option><option value="on">{session.text.profileSandboxOn}</option><option value="off">{session.text.profileSandboxOff}</option></select></label>
    </div>
    <div class="provider-inline-options"><div class="inline-switch-row"><span>{session.text.profileEnabled}</span><button class:active={profilesStore.profileEdit.enabled} class="switch" type="button" role="switch" aria-label={session.text.profileEnabled} aria-checked={profilesStore.profileEdit.enabled} onclick={() => updateProfileEdit((draft) => ({ ...draft, enabled: !draft.enabled }))}><span></span></button></div></div>
    <div class="provider-editor-toolbar"><strong>{session.text.profileFiles}</strong></div>
    <div class="profile-files-editor">
      {#each PROFILE_FILE_NAMES as fileName (fileName)}
        <label class="settings-field"><span>{fileName}</span><textarea rows="7" value={profilesStore.profileEdit.files[fileName] ?? ""} oninput={(event) => updateProfileEdit((draft) => ({ ...draft, files: { ...draft.files, [fileName]: (event.currentTarget as HTMLTextAreaElement).value } }))}></textarea></label>
      {/each}
    </div>
    <footer class="entity-editor-foot"><button class="secondary-button" type="button" disabled={profilesStore.saving} onclick={() => (profilesStore.profileEdit = null)}>{session.text.cancel}</button><button class="primary-button" type="submit" disabled={profilesStore.saving || !profilesStore.profileEdit.id.trim()}>{profilesStore.saving ? session.text.onboardingProviderSaving : session.text.save}</button></footer>
  </form>
{/if}
{#if profilesStore.actionMessage}<p class="settings-action-message">{profilesStore.actionMessage}</p>{/if}
