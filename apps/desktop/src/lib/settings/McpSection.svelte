<script lang="ts">
  import { session } from "../stores/session.svelte";
  import {
    mcpStore,
    beginMcpEdit,
    beginNewMcp,
    loadMcp,
    removeMcpServer,
    saveMcpEditor,
    updateMcpEdit
  } from "../stores/mcp.svelte";

  $effect(() => {
    if (session.serviceReady && session.endpoint && session.endpoint !== mcpStore.endpoint) {
      void loadMcp(session.endpoint);
    }
  });
</script>

<p class="settings-section-hint">{session.text.mcpHint}</p>
{#if !session.serviceReady}
  <div class="settings-card"><div class="settings-row"><p>{session.text.mcpUnavailable}</p></div></div>
{:else if mcpStore.loading || !mcpStore.mcp}
  <div class="settings-card"><div class="settings-row"><p>{session.text.loading}</p></div></div>
{:else}
  <div class="channel-section-head">
    <p class="settings-section-hint">{session.text.mcpTotal}: {mcpStore.mcp.counts.total} · {session.text.agentsEnabledCount}: {mcpStore.mcp.counts.enabled} · {session.text.mcpStdio}: {mcpStore.mcp.counts.stdio} · {session.text.mcpHttp}: {mcpStore.mcp.counts.http}</p>
    <button class="secondary-button" type="button" disabled={mcpStore.mcpEdit !== null} onclick={beginNewMcp}>{session.text.mcpAdd}</button>
  </div>
  {#if mcpStore.mcp.counts.total === 0}
    <div class="settings-card"><div class="settings-row"><p>{session.text.mcpEmpty}</p></div></div>
  {:else}
    <div class="settings-card">
      {#each mcpStore.mcp.items as server (server.id)}
        <div class="settings-row">
          <div class="profile-info">
            <strong>{server.name}</strong>
            {#if server.transport === "stdio"}
              <p>{session.text.mcpStdio} · {session.text.mcpCommand}: {server.command || session.text.unavailable} · {session.text.mcpArgs}: {server.argCount} · {session.text.mcpEnvKeys}: {server.envKeyCount}</p>
            {:else}
              <p>{session.text.mcpHttp} · {session.text.mcpUrl}: {server.url || session.text.unavailable} · {session.text.mcpHeaders}: {server.headerCount}</p>
            {/if}
            {#if server.toolNamePrefix}<p>{session.text.mcpPrefix}: {server.toolNamePrefix}</p>{/if}
          </div>
          <div class="settings-row-actions"><span class="status-badge" data-state={server.enabled ? "ready" : "disconnected"}>{server.enabled ? session.text.providerEnabled : session.text.providerDisabled}</span><button class="secondary-button" type="button" onclick={() => beginMcpEdit(server)}>{session.text.channelEdit}</button><button class="secondary-button danger-action" type="button" onclick={() => void removeMcpServer(server.id)}>{session.text.channelDelete}</button></div>
        </div>
      {/each}
    </div>
  {/if}
  {#if mcpStore.mcpEdit}
    {@const savedMcp = mcpStore.mcp.items.find((item) => item.id === mcpStore.mcpEdit?.previousId)}
    <form id="desktop-mcp-form" class="settings-card provider-editor" aria-label={session.text.mcp} onsubmit={(event) => { event.preventDefault(); void saveMcpEditor(); }}>
      <header class="entity-editor-head"><strong>{session.text.mcp}</strong><button class="modal-close" type="button" aria-label={session.text.cancel} disabled={mcpStore.saving} onclick={() => (mcpStore.mcpEdit = null)}><i class="ph ph-x"></i></button></header>
      <div class="settings-form">
        <label class="settings-field"><span>{session.text.mcpId}</span><input value={mcpStore.mcpEdit.id} disabled={!mcpStore.mcpEdit.isNew} oninput={(event) => updateMcpEdit((draft) => ({ ...draft, id: event.currentTarget.value }))} /></label>
        <label class="settings-field"><span>{session.text.mcpName}</span><input value={mcpStore.mcpEdit.name} oninput={(event) => updateMcpEdit((draft) => ({ ...draft, name: event.currentTarget.value }))} /></label>
        <label class="settings-field"><span>{session.text.mcpTransport}</span><select value={mcpStore.mcpEdit.transport} onchange={(event) => updateMcpEdit((draft) => ({ ...draft, transport: event.currentTarget.value as "stdio" | "http" }))}><option value="stdio">stdio</option><option value="http">http</option></select></label>
        <label class="settings-field"><span>{session.text.mcpPrefix}</span><input value={mcpStore.mcpEdit.toolNamePrefix} oninput={(event) => updateMcpEdit((draft) => ({ ...draft, toolNamePrefix: event.currentTarget.value }))} /></label>
      </div>
      <div class="provider-inline-options"><div class="inline-switch-row"><span>{session.text.mcpEnabled}</span><button class:active={mcpStore.mcpEdit.enabled} class="switch" type="button" role="switch" aria-label={session.text.mcpEnabled} aria-checked={mcpStore.mcpEdit.enabled} onclick={() => updateMcpEdit((draft) => ({ ...draft, enabled: !draft.enabled }))}><span></span></button></div></div>
      {#if mcpStore.mcpEdit.transport === "stdio"}
        <div class="settings-form">
          <label class="settings-field settings-field-wide"><span>{session.text.mcpCommand}</span><input value={mcpStore.mcpEdit.command} oninput={(event) => updateMcpEdit((draft) => ({ ...draft, command: event.currentTarget.value }))} /></label>
          <label class="settings-field settings-field-wide"><span>{session.text.mcpArgsReplace}</span><textarea rows="4" value={mcpStore.mcpEdit.argsDraft} placeholder={savedMcp?.argCount ? session.text.mcpPreserveConfigured.replace("{count}", String(savedMcp.argCount)) : session.text.mcpOnePerLine} oninput={(event) => updateMcpEdit((draft) => ({ ...draft, argsDraft: event.currentTarget.value }))}></textarea>{#if savedMcp?.argCount}<label class="inline-check"><input type="checkbox" checked={Boolean(mcpStore.mcpEdit.clearArgs)} onchange={(event) => updateMcpEdit((draft) => ({ ...draft, clearArgs: event.currentTarget.checked }))} /> {session.text.mcpClearConfigured}</label>{/if}</label>
          <label class="settings-field settings-field-wide"><span>{session.text.mcpCwdReplace}</span><input type="password" value={mcpStore.mcpEdit.cwdValue ?? ""} placeholder={savedMcp?.cwdConfigured ? session.text.channelSecretConfigured : ""} autocomplete="off" oninput={(event) => updateMcpEdit((draft) => ({ ...draft, cwdValue: event.currentTarget.value }))} />{#if savedMcp?.cwdConfigured}<label class="inline-check"><input type="checkbox" checked={Boolean(mcpStore.mcpEdit.clearCwd)} onchange={(event) => updateMcpEdit((draft) => ({ ...draft, clearCwd: event.currentTarget.checked }))} /> {session.text.mcpClearConfigured}</label>{/if}</label>
          <label class="settings-field settings-field-wide"><span>{session.text.mcpEnvReplace}</span><textarea rows="4" value={mcpStore.mcpEdit.envDraft} placeholder={session.text.mcpMapPlaceholder} oninput={(event) => updateMcpEdit((draft) => ({ ...draft, envDraft: event.currentTarget.value }))}></textarea>{#each savedMcp?.envKeys ?? [] as key (key)}<label class="inline-check"><input type="checkbox" checked={mcpStore.mcpEdit.clearEnvKeys?.includes(key)} onchange={() => updateMcpEdit((draft) => ({ ...draft, clearEnvKeys: draft.clearEnvKeys?.includes(key) ? draft.clearEnvKeys.filter((item) => item !== key) : [...(draft.clearEnvKeys ?? []), key] }))} /> {session.text.mcpClearKey}: {key}</label>{/each}</label>
        </div>
      {:else}
        <div class="settings-form">
          <label class="settings-field settings-field-wide"><span>{session.text.mcpUrl}</span><input value={mcpStore.mcpEdit.url} oninput={(event) => updateMcpEdit((draft) => ({ ...draft, url: event.currentTarget.value }))} /></label>
          <label class="settings-field settings-field-wide"><span>{session.text.mcpHeadersReplace}</span><textarea rows="4" value={mcpStore.mcpEdit.headerDraft} placeholder={session.text.mcpMapPlaceholder} oninput={(event) => updateMcpEdit((draft) => ({ ...draft, headerDraft: event.currentTarget.value }))}></textarea>{#each savedMcp?.headerKeys ?? [] as key (key)}<label class="inline-check"><input type="checkbox" checked={mcpStore.mcpEdit.clearHeaderKeys?.includes(key)} onchange={() => updateMcpEdit((draft) => ({ ...draft, clearHeaderKeys: draft.clearHeaderKeys?.includes(key) ? draft.clearHeaderKeys.filter((item) => item !== key) : [...(draft.clearHeaderKeys ?? []), key] }))} /> {session.text.mcpClearKey}: {key}</label>{/each}</label>
        </div>
      {/if}
      <footer class="entity-editor-foot"><button class="secondary-button" type="button" disabled={mcpStore.saving} onclick={() => (mcpStore.mcpEdit = null)}>{session.text.cancel}</button><button class="primary-button" type="submit" disabled={mcpStore.saving || !mcpStore.mcpEdit.id.trim() || (mcpStore.mcpEdit.transport === "stdio" ? !mcpStore.mcpEdit.command.trim() : !mcpStore.mcpEdit.url.trim())}>{mcpStore.saving ? session.text.onboardingProviderSaving : session.text.save}</button></footer>
    </form>
  {/if}
  {#if mcpStore.actionMessage}<p class="settings-action-message">{mcpStore.actionMessage}</p>{/if}
{/if}
