<script lang="ts">
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
</script>

{#if !session.serviceReady}
  <div class="settings-card"><div class="settings-row"><p>{session.text.channelsUnavailable}</p></div></div>
{:else if channelsStore.loading || !channelsStore.channels}
  <div class="settings-card"><div class="settings-row"><p>{session.text.loading}</p></div></div>
{:else}
  <div class="settings-card">
    <div class="settings-row"><strong>{session.text.channelsTotal}</strong><span class="diag-value">{channelsStore.channels.counts.totalInstances} · {session.text.agentsEnabledCount}: {channelsStore.channels.counts.enabledInstances}</span></div>
  </div>
  {#each DESKTOP_CHANNELS as channel (channel)}
    {@const group = channelsStore.channels.groups.find((item) => item.channel === channel)}
    <div class="channel-section-head">
      <p class="settings-section-hint">{externalChannelLabel(channel, session.locale)} · {group?.enabled ?? 0}/{group?.total ?? 0}</p>
      <button class="secondary-button" type="button" disabled={channelsStore.channelEdit !== null} onclick={() => beginNewChannel(channel)}>{session.text.channelAdd}</button>
    </div>
    {#if !group || group.instances.length === 0}
      <div class="settings-card"><div class="settings-row"><p>{session.text.channelsEmpty}</p></div></div>
    {:else}
      <div class="settings-card">
        {#each group.instances as inst (inst.id)}
          <div class="settings-row">
            <div class="profile-info">
              <strong>{inst.name}</strong>
              <p>{inst.agentId ? `${session.text.channelLinkedAgent}: ${inst.agentId}` : session.text.noLinkedAgent} · {session.text.channelAllowedChats}: {inst.allowedChatCount} · {session.text.channelSandbox}: {inst.sandboxEnabled === null ? session.text.agentSandboxInherit : inst.sandboxEnabled ? session.text.yes : session.text.no}</p>
            </div>
            <div class="settings-row-actions">
              <span class="status-badge" data-state={inst.enabled ? "ready" : "disconnected"}>{inst.enabled ? session.text.providerEnabled : session.text.providerDisabled}</span>
              <button class="secondary-button" type="button" disabled={channelsStore.editorLoading} onclick={() => void beginChannelEdit(channel, inst.id)}>{session.text.channelEdit}</button>
              <button class="secondary-button danger-action" type="button" disabled={channelsStore.saving} onclick={() => void removeChannelInstance(channel, inst.id)}>{session.text.channelDelete}</button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  {/each}
  {#if channelsStore.channelEdit}
    {@const savedInstance = channelsStore.channels.groups.find((group) => group.channel === channelsStore.channelEdit?.channel)?.instances.find((instance) => instance.id === channelsStore.channelEdit?.previousId)}
    <form id="desktop-channel-form" class="settings-card provider-editor" aria-label={session.text.channels} onsubmit={(event) => { event.preventDefault(); void saveChannelEditor(); }}>
      <header class="entity-editor-head"><strong>{session.text.channels} · {externalChannelLabel(channelsStore.channelEdit.channel, session.locale)}</strong><button class="modal-close" type="button" aria-label={session.text.cancel} disabled={channelsStore.saving} onclick={() => (channelsStore.channelEdit = null)}><i class="ph ph-x"></i></button></header>
      <div class="settings-form">
        <label class="settings-field"><span>{session.text.channelInstanceId}</span><input value={channelsStore.channelEdit.id} disabled={!channelsStore.channelEdit.isNew} oninput={(event) => updateChannelEdit((draft) => ({ ...draft, id: (event.currentTarget as HTMLInputElement).value }))} /></label>
        <label class="settings-field"><span>{session.text.channelInstanceName}</span><input value={channelsStore.channelEdit.name} oninput={(event) => updateChannelEdit((draft) => ({ ...draft, name: (event.currentTarget as HTMLInputElement).value }))} /></label>
        <label class="settings-field"><span>{session.text.channelLinkedAgent}</span><select value={channelsStore.channelEdit.agentId} onchange={(event) => updateChannelEdit((draft) => ({ ...draft, agentId: (event.currentTarget as HTMLSelectElement).value }))}><option value="">{session.text.profileNoAgent}</option>{#each agentsStore.agents?.items.filter((agent) => agent.enabled) ?? [] as agent (agent.id)}<option value={agent.id}>{agent.name}</option>{/each}</select></label>
        <label class="settings-field"><span>{session.text.profileSandbox}</span><select value={channelsStore.channelEdit.sandboxEnabled === null ? "inherit" : channelsStore.channelEdit.sandboxEnabled ? "on" : "off"} onchange={(event) => { const value = (event.currentTarget as HTMLSelectElement).value; updateChannelEdit((draft) => ({ ...draft, sandboxEnabled: value === "inherit" ? null : value === "on" })); }}><option value="inherit">{session.text.profileSandboxInherit}</option><option value="on">{session.text.profileSandboxOn}</option><option value="off">{session.text.profileSandboxOff}</option></select></label>
        <label class="settings-field settings-field-wide"><span>{session.text.channelAllowedChatIds}</span><textarea rows="3" value={channelsStore.channelEdit.allowedChatIds.join("\n")} placeholder={session.text.channelAllowedChatHint} oninput={(event) => updateChannelEdit((draft) => ({ ...draft, allowedChatIds: (event.currentTarget as HTMLTextAreaElement).value.split(/[\n,]/).map((value) => value.trim()).filter(Boolean) }))}></textarea></label>
      </div>
      <div class="provider-inline-options"><div class="inline-switch-row"><span>{session.text.channelEnabled}</span><button class:active={channelsStore.channelEdit.enabled} class="switch" type="button" role="switch" aria-label={session.text.channelEnabled} aria-checked={channelsStore.channelEdit.enabled} onclick={() => updateChannelEdit((draft) => ({ ...draft, enabled: !draft.enabled }))}><span></span></button></div></div>
      <div class="provider-editor-toolbar"><strong>{session.text.channelCredentials}</strong>{#if channelsStore.channelEdit.channel === "feishu"}<button class="secondary-button" type="button" disabled={channelsStore.testing} onclick={() => void testChannelEditor()}>{channelsStore.testing ? session.text.loading : session.text.channelTest}</button>{/if}</div>
      <div class="settings-form">
        {#each CHANNEL_FIELD_CONFIG[channelsStore.channelEdit.channel].visible as key (key)}
          {#if key === "streamOutput"}
            <label class="settings-field"><span>{session.text.channelStreamOutput}</span><select value={channelsStore.channelEdit.fields[key] ?? "true"} onchange={(event) => updateChannelEdit((draft) => ({ ...draft, fields: { ...draft.fields, [key]: (event.currentTarget as HTMLSelectElement).value } }))}><option value="true">{session.text.yes}</option><option value="false">{session.text.no}</option></select></label>
          {:else}
            <label class="settings-field"><span>{key === "appId" ? session.text.channelAppId : session.text.channelBaseUrl}</span><input value={channelsStore.channelEdit.fields[key] ?? ""} oninput={(event) => updateChannelEdit((draft) => ({ ...draft, fields: { ...draft.fields, [key]: (event.currentTarget as HTMLInputElement).value } }))} /></label>
          {/if}
        {/each}
        {#each CHANNEL_FIELD_CONFIG[channelsStore.channelEdit.channel].secret as key (key)}
          <label class="settings-field">
            <span>{key === "token" ? session.text.channelToken : key === "appSecret" ? session.text.channelAppSecret : key === "verificationToken" ? session.text.channelVerificationToken : key === "encryptKey" ? session.text.channelEncryptKey : session.text.channelClientSecret}</span>
            <input type="password" value={channelsStore.channelEdit.secretValues?.[key] ?? ""} placeholder={savedInstance?.configuredSecrets.includes(key) ? session.text.channelSecretConfigured : ""} autocomplete="new-password" oninput={(event) => updateChannelEdit((draft) => ({ ...draft, secretValues: { ...(draft.secretValues ?? {}), [key]: (event.currentTarget as HTMLInputElement).value } }))} />
            {#if savedInstance?.configuredSecrets.includes(key)}<label class="inline-check"><input type="checkbox" checked={channelsStore.channelEdit.clearSecrets?.includes(key)} onchange={() => toggleChannelSecretClear(key)} /> {session.text.channelClearSecret}</label>{/if}
          </label>
        {/each}
      </div>
      <div class="provider-editor-toolbar"><strong>{session.text.channelBotFiles}</strong></div>
      <div class="profile-files-editor">
        {#each PROFILE_FILE_NAMES as fileName (fileName)}
          <label class="settings-field"><span>{fileName}</span><textarea rows="7" value={channelsStore.channelEdit.files[fileName] ?? ""} oninput={(event) => updateChannelEdit((draft) => ({ ...draft, files: { ...draft.files, [fileName]: (event.currentTarget as HTMLTextAreaElement).value } }))}></textarea></label>
        {/each}
      </div>
      {#if channelsStore.channelEdit.channel === "weixin"}
        <div class="provider-editor-toolbar"><strong>{session.text.channelQrTitle}</strong></div>
        <p class="settings-section-hint">{session.text.channelQrHint}</p>
        <label class="settings-field settings-field-wide"><span>{session.text.channelQrLink}</span><textarea rows="3" bind:value={channelsStore.qrLink} placeholder={session.text.channelQrLinkPlaceholder}></textarea></label>
        <div class="settings-row-actions channel-qr-actions">
          <button class="secondary-button" type="button" disabled={channelsStore.qrLoading} onclick={() => void generateChannelQr()}>{channelsStore.qrLoading ? session.text.loading : session.text.channelQrGenerate}</button>
          <button class="secondary-button" type="button" onclick={clearChannelQr}>{session.text.channelQrClear}</button>
          {#if channelsStore.qrLink}<a class="secondary-button" href={channelsStore.qrLink} target="_blank" rel="noreferrer">{session.text.channelQrOpen}</a>{/if}
        </div>
        {#if channelsStore.qrImage}<div class="channel-qr-result"><img src={channelsStore.qrImage} alt="WeChat login QR code" /><p>{session.text.channelQrScan}</p></div>{/if}
        {#if channelsStore.qrError}<p class="settings-action-message error-text">{channelsStore.qrError}</p>{/if}
      {/if}
      <footer class="entity-editor-foot"><button class="secondary-button" type="button" disabled={channelsStore.saving} onclick={() => (channelsStore.channelEdit = null)}>{session.text.cancel}</button><button class="primary-button" type="submit" disabled={channelsStore.saving || !channelsStore.channelEdit.id.trim()}>{channelsStore.saving ? session.text.onboardingProviderSaving : session.text.save}</button></footer>
    </form>
  {/if}
  {#if channelsStore.actionMessage}<p class="settings-action-message">{channelsStore.actionMessage}</p>{/if}
{/if}
