<script lang="ts">
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
    channelsStore,
    CHANNEL_FIELD_CONFIG,
    DESKTOP_CHANNELS,
    beginChannelEdit,
    beginNewChannel,
    clearChannelQr,
    externalChannelLabel,
    generateChannelQr,
    loadChannels,
    removeChannelInstance,
    saveChannelEditor,
    testChannelEditor,
    toggleChannelSecretClear,
    updateChannelEdit
  } from "../stores/channels.svelte";

  let deletingChannelInstance = $state<{ channel: (typeof DESKTOP_CHANNELS)[number]; id: string; name: string } | null>(null);

  $effect(() => {
    if (session.serviceReady && session.endpoint && session.endpoint !== channelsStore.endpoint) {
      void loadChannels(session.endpoint);
    }
  });
  // The linked-agent dropdown needs the agents list.
  $effect(() => {
    if (session.serviceReady && session.endpoint && session.endpoint !== agentsStore.endpoint) {
      void loadAgents(session.endpoint);
    }
  });

  async function handleConfirmDelete(): Promise<void> {
    if (!deletingChannelInstance) return;
    const { channel, id } = deletingChannelInstance;
    deletingChannelInstance = null;
    await removeChannelInstance(channel, id);
  }
</script>

{#if !session.serviceReady}
  <SettingGroup><EmptyState title={session.text.channelsUnavailable} icon="chat-circle-dots" /></SettingGroup>
{:else if channelsStore.loading || !channelsStore.channels}
  <SettingGroup><div class="settings-row"><p>{session.text.loading}</p></div></SettingGroup>
{:else}
  <SettingGroup ariaLabel={session.text.channelsTotal}>
    <SettingRow title={session.text.channelsTotal}>
      <span class="diag-value">{channelsStore.channels.counts.totalInstances} · {session.text.agentsEnabledCount}: {channelsStore.channels.counts.enabledInstances}</span>
    </SettingRow>
  </SettingGroup>
  {#each DESKTOP_CHANNELS as channel (channel)}
    {@const group = channelsStore.channels.groups.find((item) => item.channel === channel)}
    <SettingGroup title={externalChannelLabel(channel, session.locale)} description={`${group?.enabled ?? 0}/${group?.total ?? 0}`}>
      <svelte:fragment slot="action">
        <button class="secondary-button" type="button" disabled={channelsStore.channelEdit !== null} onclick={() => beginNewChannel(channel)}>{session.text.channelAdd}</button>
      </svelte:fragment>
      {#if !group || group.instances.length === 0}
        <EmptyState title={session.text.channelsEmpty} icon="chat-circle-dots" />
      {:else}
        {#each group.instances as inst (inst.id)}
          <div class="settings-row">
            <div class="profile-info">
              <strong>{inst.name}</strong>
              <p>{inst.agentId ? `${session.text.channelLinkedAgent}: ${inst.agentId}` : session.text.noLinkedAgent} · {session.text.channelAllowedChats}: {inst.allowedChatCount} · {session.text.channelSandbox}: {inst.sandboxEnabled === null ? session.text.agentSandboxInherit : inst.sandboxEnabled ? session.text.yes : session.text.no}</p>
            </div>
            <div class="settings-row-actions">
              <span class="status-badge" data-state={inst.enabled ? "ready" : "disconnected"}>{inst.enabled ? session.text.providerEnabled : session.text.providerDisabled}</span>
              <button class="secondary-button" type="button" disabled={channelsStore.editorLoading} onclick={() => void beginChannelEdit(channel, inst.id)}>{session.text.channelEdit}</button>
              <button class="secondary-button danger-action" type="button" disabled={channelsStore.saving} onclick={() => (deletingChannelInstance = { channel, id: inst.id, name: inst.name })}>{session.text.channelDelete}</button>
            </div>
          </div>
        {/each}
      {/if}
    </SettingGroup>
  {/each}
  {#if channelsStore.channelEdit}
    {@const savedInstance = channelsStore.channels.groups.find((group) => group.channel === channelsStore.channelEdit?.channel)?.instances.find((instance) => instance.id === channelsStore.channelEdit?.previousId)}
    <Dialog open={true} busy={channelsStore.saving} contentClass="entity-editor-dialog" labelledBy="channel-editor-title" onOpenChange={(next) => { if (!next) channelsStore.channelEdit = null; }}>
    <form id="desktop-channel-form" class="entity-editor-form" aria-label={session.text.channels} onsubmit={(event) => { event.preventDefault(); void saveChannelEditor(); }}>
      <header class="entity-editor-head"><strong id="channel-editor-title">{session.text.channels} · {externalChannelLabel(channelsStore.channelEdit.channel, session.locale)}</strong><button class="modal-close" type="button" aria-label={session.text.dialogClose} disabled={channelsStore.saving} onclick={() => (channelsStore.channelEdit = null)}><i class="ph ph-x" aria-hidden="true"></i></button></header>
      <div class="entity-editor-body">
      <div class="settings-form">
        <label class="settings-field"><span>{session.text.channelInstanceId}</span><input value={channelsStore.channelEdit.id} disabled={!channelsStore.channelEdit.isNew} autocomplete="off" spellcheck="false" oninput={(event) => updateChannelEdit((draft) => ({ ...draft, id: (event.currentTarget as HTMLInputElement).value }))} /></label>
        <label class="settings-field"><span>{session.text.channelInstanceName}</span><input value={channelsStore.channelEdit.name} autocomplete="off" oninput={(event) => updateChannelEdit((draft) => ({ ...draft, name: (event.currentTarget as HTMLInputElement).value }))} /></label>
        <label class="settings-field"><span>{session.text.channelLinkedAgent}</span><SelectControl value={channelsStore.channelEdit.agentId} ariaLabel={session.text.channelLinkedAgent} options={[{ value: "", label: session.text.profileNoAgent }, ...(agentsStore.agents?.items.filter((agent) => agent.enabled).map((agent) => ({ value: agent.id, label: agent.name })) ?? [])]} onChange={(value) => updateChannelEdit((draft) => ({ ...draft, agentId: value }))} /></label>
        <label class="settings-field"><span>{session.text.profileSandbox}</span><SelectControl value={channelsStore.channelEdit.sandboxEnabled === null ? "inherit" : channelsStore.channelEdit.sandboxEnabled ? "on" : "off"} ariaLabel={session.text.profileSandbox} options={[{ value: "inherit", label: session.text.profileSandboxInherit }, { value: "on", label: session.text.profileSandboxOn }, { value: "off", label: session.text.profileSandboxOff }]} onChange={(value) => updateChannelEdit((draft) => ({ ...draft, sandboxEnabled: value === "inherit" ? null : value === "on" }))} /></label>
        <label class="settings-field settings-field-wide"><span>{session.text.channelAllowedChatIds}</span><textarea rows="3" value={channelsStore.channelEdit.allowedChatIds.join("\n")} placeholder={session.text.channelAllowedChatHint} autocomplete="off" spellcheck="false" oninput={(event) => updateChannelEdit((draft) => ({ ...draft, allowedChatIds: (event.currentTarget as HTMLTextAreaElement).value.split(/[\n,]/).map((value) => value.trim()).filter(Boolean) }))}></textarea></label>
      </div>
      <div class="provider-inline-options"><div class="inline-switch-row"><span>{session.text.channelEnabled}</span><IosSwitch checked={channelsStore.channelEdit.enabled} ariaLabel={session.text.channelEnabled} onCheckedChange={(checked) => updateChannelEdit((draft) => ({ ...draft, enabled: checked }))} /></div></div>
      <div class="provider-editor-toolbar"><strong>{session.text.channelCredentials}</strong>{#if channelsStore.channelEdit.channel === "feishu"}<button class="secondary-button" type="button" disabled={channelsStore.testing} onclick={() => void testChannelEditor()}>{channelsStore.testing ? session.text.loading : session.text.channelTest}</button>{/if}</div>
      <div class="settings-form">
        {#each CHANNEL_FIELD_CONFIG[channelsStore.channelEdit.channel].visible as key (key)}
          {#if key === "streamOutput"}
            <label class="settings-field"><span>{session.text.channelStreamOutput}</span><SelectControl value={channelsStore.channelEdit.fields[key] ?? "true"} ariaLabel={session.text.channelStreamOutput} options={[{ value: "true", label: session.text.yes }, { value: "false", label: session.text.no }]} onChange={(value) => updateChannelEdit((draft) => ({ ...draft, fields: { ...draft.fields, [key]: value } }))} /></label>
          {:else}
            <label class="settings-field"><span>{key === "appId" ? session.text.channelAppId : session.text.channelBaseUrl}</span><input value={channelsStore.channelEdit.fields[key] ?? ""} autocomplete="off" spellcheck="false" oninput={(event) => updateChannelEdit((draft) => ({ ...draft, fields: { ...draft.fields, [key]: (event.currentTarget as HTMLInputElement).value } }))} /></label>
          {/if}
        {/each}
        {#each CHANNEL_FIELD_CONFIG[channelsStore.channelEdit.channel].secret as key (key)}
          <label class="settings-field">
            <span>{key === "token" ? session.text.channelToken : key === "appSecret" ? session.text.channelAppSecret : key === "verificationToken" ? session.text.channelVerificationToken : key === "encryptKey" ? session.text.channelEncryptKey : session.text.channelClientSecret}</span>
            <input type="password" value={channelsStore.channelEdit.secretValues?.[key] ?? ""} placeholder={savedInstance?.configuredSecrets.includes(key) ? session.text.channelSecretConfigured : ""} autocomplete="new-password" spellcheck="false" oninput={(event) => updateChannelEdit((draft) => ({ ...draft, secretValues: { ...(draft.secretValues ?? {}), [key]: (event.currentTarget as HTMLInputElement).value } }))} />
            {#if savedInstance?.configuredSecrets.includes(key)}<label class="inline-check"><input type="checkbox" checked={channelsStore.channelEdit.clearSecrets?.includes(key)} onchange={() => toggleChannelSecretClear(key)} /> {session.text.channelClearSecret}</label>{/if}
          </label>
        {/each}
      </div>
      <div class="provider-editor-toolbar"><strong>{session.text.channelBotFiles}</strong></div>
      <div class="profile-files-editor">
        {#each PROFILE_FILE_NAMES as fileName (fileName)}
          <label class="settings-field"><span>{fileName}</span><textarea rows="7" value={channelsStore.channelEdit.files[fileName] ?? ""} autocomplete="off" spellcheck="false" oninput={(event) => updateChannelEdit((draft) => ({ ...draft, files: { ...draft.files, [fileName]: (event.currentTarget as HTMLTextAreaElement).value } }))}></textarea></label>
        {/each}
      </div>
      {#if channelsStore.channelEdit.channel === "weixin"}
        <div class="provider-editor-toolbar"><strong>{session.text.channelQrTitle}</strong></div>
        <p class="settings-section-hint">{session.text.channelQrHint}</p>
        <label class="settings-field settings-field-wide"><span>{session.text.channelQrLink}</span><textarea rows="3" bind:value={channelsStore.qrLink} placeholder={session.text.channelQrLinkPlaceholder} autocomplete="off"></textarea></label>
        <div class="settings-row-actions channel-qr-actions">
          <button class="secondary-button" type="button" disabled={channelsStore.qrLoading} onclick={() => void generateChannelQr()}>{channelsStore.qrLoading ? session.text.loading : session.text.channelQrGenerate}</button>
          <button class="secondary-button" type="button" onclick={clearChannelQr}>{session.text.channelQrClear}</button>
          {#if channelsStore.qrLink}<a class="secondary-button" href={channelsStore.qrLink} target="_blank" rel="noreferrer">{session.text.channelQrOpen}</a>{/if}
        </div>
        {#if channelsStore.qrImage}<div class="channel-qr-result"><img src={channelsStore.qrImage} alt="WeChat login QR code" width="220" height="220" /><p>{session.text.channelQrScan}</p></div>{/if}
        {#if channelsStore.qrError}<p class="settings-action-message error-text">{channelsStore.qrError}</p>{/if}
      {/if}
      </div>
      <footer class="entity-editor-foot"><button class="secondary-button" type="button" disabled={channelsStore.saving} onclick={() => (channelsStore.channelEdit = null)}>{session.text.cancel}</button><button class="primary-button" type="submit" disabled={channelsStore.saving || !channelsStore.channelEdit.id.trim()}>{channelsStore.saving ? session.text.onboardingProviderSaving : session.text.save}</button></footer>
    </form>
    </Dialog>
  {/if}

  {#if deletingChannelInstance}
    <AlertDialog
      open={true}
      contentClass="modal-card"
      labelledBy="channel-delete-title"
      describedBy="channel-delete-description"
      onOpenChange={(next) => { if (!next) deletingChannelInstance = null; }}
    >
      <header class="modal-head"><strong id="channel-delete-title">{session.text.channelDelete}</strong></header>
      <div class="modal-body"><p id="channel-delete-description">{session.text.channelDeleteConfirm}</p></div>
      <footer class="provider-modal-foot">
        <button class="secondary-button" type="button" onclick={() => (deletingChannelInstance = null)}>{session.text.cancel}</button>
        <button class="primary-button danger-action" type="button" onclick={() => void handleConfirmDelete()}>{session.text.channelDelete}</button>
      </footer>
    </AlertDialog>
  {/if}

  {#if channelsStore.actionMessage}<p class="settings-action-message" aria-live="polite">{channelsStore.actionMessage}</p>{/if}
{/if}
