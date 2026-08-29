<script lang="ts">
  import AlertDialog from "../components/ui/AlertDialog.svelte";
  import Dialog from "../components/ui/Dialog.svelte";
  import EmptyState from "../components/ui/EmptyState.svelte";
  import IosSwitch from "../components/ui/IosSwitch.svelte";
  import SelectControl from "../components/ui/SelectControl.svelte";
  import SettingGroup from "../components/ui/SettingGroup.svelte";
  import SettingRow from "../components/ui/SettingRow.svelte";
  import { session } from "../stores/session.svelte";
  import {
    mcpStore,
    beginMcpEdit,
    beginNewMcp,
    loadMcp,
    reconnectMcp,
    removeMcpServer,
    saveMcpEditor,
    toggleMcpServer,
    updateMcpEdit
  } from "../stores/mcp.svelte";

  let deletingMcpServer = $state<NonNullable<typeof mcpStore.mcp>["items"][number] | null>(null);

  function statusLabel(state: string): string {
    if (state === "connected") return session.text.mcpConnected;
    if (state === "connecting") return session.text.mcpConnecting;
    if (state === "error") return session.text.mcpConnectionError;
    if (state === "disabled") return session.text.providerDisabled;
    return session.text.mcpDisconnected;
  }

  function statusTone(state: string): string {
    if (state === "connected") return "ready";
    if (state === "error") return "error";
    if (state === "connecting") return "warning";
    return "disconnected";
  }

  $effect(() => {
    if (session.serviceReady && session.endpoint && session.endpoint !== mcpStore.endpoint) {
      void loadMcp(session.endpoint);
    }
  });

  async function handleConfirmDelete(): Promise<void> {
    if (!deletingMcpServer) return;
    const id = deletingMcpServer.id;
    deletingMcpServer = null;
    await removeMcpServer(id);
  }
</script>

{#if !session.serviceReady}
  <SettingGroup><EmptyState title={session.text.mcpUnavailable} icon="plugs-connected" /></SettingGroup>
{:else if mcpStore.loading || !mcpStore.mcp}
  <SettingGroup><div class="settings-row"><p>{session.text.loading}</p></div></SettingGroup>
{:else}
  <SettingGroup title={session.text.mcp} description={`${session.text.mcpTotal}: ${mcpStore.mcp.counts.total} · ${session.text.agentsEnabledCount}: ${mcpStore.mcp.counts.enabled} · ${session.text.mcpStdio}: ${mcpStore.mcp.counts.stdio} · ${session.text.mcpHttp}: ${mcpStore.mcp.counts.http}`}>
    <svelte:fragment slot="action">
      <button class="secondary-button" type="button" disabled={mcpStore.mcpEdit !== null} onclick={beginNewMcp}>{session.text.mcpAdd}</button>
    </svelte:fragment>
    {#if mcpStore.mcp.counts.total === 0}
      <EmptyState title={session.text.mcpEmpty} description={session.text.mcpHint} icon="plugs-connected" />
    {:else}
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
            {#if server.connectionState === "connected"}<p>{session.text.mcpLoadedTools}: {server.toolCount}</p>{/if}
            {#if server.lastError}<p class="settings-error-copy">{server.lastError}</p>{/if}
          </div>
          <div class="settings-row-actions">
            {#if server.managed}<span class="status-badge" data-state="disconnected">{session.text.mcpManaged}</span>{/if}
            <span class="status-badge" data-state={statusTone(server.connectionState)}>{statusLabel(server.connectionState)}</span>
            {#if !server.managed}<IosSwitch checked={server.enabled} ariaLabel={`${session.text.mcpEnabled}: ${server.name}`} disabled={Boolean(mcpStore.busyId)} onCheckedChange={(enabled) => void toggleMcpServer(server.id, enabled)} />{/if}
            {#if server.enabled && server.connectionState !== "connected"}<button class="secondary-button" type="button" disabled={Boolean(mcpStore.busyId)} onclick={() => void reconnectMcp(server.id)}>{mcpStore.busyId === server.id ? session.text.mcpConnecting : session.text.mcpReconnect}</button>{/if}
            {#if !server.managed}
              <button class="secondary-button" type="button" disabled={Boolean(mcpStore.busyId)} onclick={() => beginMcpEdit(server)}>{session.text.edit}</button>
              <button class="secondary-button danger-action" type="button" disabled={Boolean(mcpStore.busyId)} onclick={() => (deletingMcpServer = server)}>{session.text.delete}</button>
            {/if}
          </div>
        </div>
      {/each}
    {/if}
  </SettingGroup>
  {#if mcpStore.mcpEdit}
    {@const savedMcp = mcpStore.mcp.items.find((item) => item.id === mcpStore.mcpEdit?.previousId)}
    <Dialog open={true} busy={mcpStore.saving} contentClass="entity-editor-dialog" labelledBy="mcp-editor-title" onOpenChange={(next) => { if (!next) mcpStore.mcpEdit = null; }}>
    <form id="desktop-mcp-form" class="entity-editor-form" aria-label={session.text.mcp} onsubmit={(event) => { event.preventDefault(); void saveMcpEditor(); }}>
      <header class="entity-editor-head"><strong id="mcp-editor-title">{session.text.mcp}</strong><button class="modal-close" type="button" aria-label={session.text.dialogClose} disabled={mcpStore.saving} onclick={() => (mcpStore.mcpEdit = null)}><i class="ph ph-x" aria-hidden="true"></i></button></header>
      <div class="entity-editor-body">
      <div class="settings-form">
        <label class="settings-field"><span>{session.text.mcpId}</span><input value={mcpStore.mcpEdit.id} disabled={!mcpStore.mcpEdit.isNew} autocomplete="off" spellcheck="false" oninput={(event) => updateMcpEdit((draft) => ({ ...draft, id: event.currentTarget.value }))} /></label>
        <label class="settings-field"><span>{session.text.mcpName}</span><input value={mcpStore.mcpEdit.name} autocomplete="off" oninput={(event) => updateMcpEdit((draft) => ({ ...draft, name: event.currentTarget.value }))} /></label>
        <label class="settings-field"><span>{session.text.mcpTransport}</span><SelectControl value={mcpStore.mcpEdit.transport} ariaLabel={session.text.mcpTransport} options={[{ value: "stdio", label: "stdio" }, { value: "http", label: "http" }]} onChange={(value) => updateMcpEdit((draft) => ({ ...draft, transport: value as "stdio" | "http" }))} /></label>
        <label class="settings-field"><span>{session.text.mcpPrefix}</span><input value={mcpStore.mcpEdit.toolNamePrefix} autocomplete="off" spellcheck="false" oninput={(event) => updateMcpEdit((draft) => ({ ...draft, toolNamePrefix: event.currentTarget.value }))} /></label>
      </div>
      <div class="provider-inline-options"><div class="inline-switch-row"><span>{session.text.mcpEnabled}</span><IosSwitch checked={mcpStore.mcpEdit.enabled} ariaLabel={session.text.mcpEnabled} onCheckedChange={(enabled) => updateMcpEdit((draft) => ({ ...draft, enabled }))} /></div></div>
      {#if mcpStore.mcpEdit.transport === "stdio"}
        <div class="settings-form">
          <label class="settings-field settings-field-wide"><span>{session.text.mcpCommand}</span><input value={mcpStore.mcpEdit.command} autocomplete="off" spellcheck="false" oninput={(event) => updateMcpEdit((draft) => ({ ...draft, command: event.currentTarget.value }))} /></label>
          <label class="settings-field settings-field-wide"><span>{session.text.mcpArgsReplace}</span><textarea rows="4" value={mcpStore.mcpEdit.argsDraft} placeholder={savedMcp?.argCount ? session.text.mcpPreserveConfigured.replace("{count}", String(savedMcp.argCount)) : session.text.mcpOnePerLine} autocomplete="off" spellcheck="false" oninput={(event) => updateMcpEdit((draft) => ({ ...draft, argsDraft: event.currentTarget.value }))}></textarea>{#if savedMcp?.argCount}<label class="inline-check"><input type="checkbox" checked={Boolean(mcpStore.mcpEdit.clearArgs)} onchange={(event) => updateMcpEdit((draft) => ({ ...draft, clearArgs: event.currentTarget.checked }))} /> {session.text.mcpClearConfigured}</label>{/if}</label>
          <label class="settings-field settings-field-wide"><span>{session.text.mcpCwdReplace}</span><input type="password" value={mcpStore.mcpEdit.cwdValue ?? ""} placeholder={savedMcp?.cwdConfigured ? session.text.channelSecretConfigured : ""} autocomplete="new-password" spellcheck="false" oninput={(event) => updateMcpEdit((draft) => ({ ...draft, cwdValue: event.currentTarget.value }))} />{#if savedMcp?.cwdConfigured}<label class="inline-check"><input type="checkbox" checked={Boolean(mcpStore.mcpEdit.clearCwd)} onchange={(event) => updateMcpEdit((draft) => ({ ...draft, clearCwd: event.currentTarget.checked }))} /> {session.text.mcpClearConfigured}</label>{/if}</label>
          <label class="settings-field settings-field-wide"><span>{session.text.mcpEnvReplace}</span><textarea rows="4" value={mcpStore.mcpEdit.envDraft} placeholder={session.text.mcpMapPlaceholder} autocomplete="off" spellcheck="false" oninput={(event) => updateMcpEdit((draft) => ({ ...draft, envDraft: event.currentTarget.value }))}></textarea>{#each savedMcp?.envKeys ?? [] as key (key)}<label class="inline-check"><input type="checkbox" checked={mcpStore.mcpEdit.clearEnvKeys?.includes(key)} onchange={() => updateMcpEdit((draft) => ({ ...draft, clearEnvKeys: draft.clearEnvKeys?.includes(key) ? draft.clearEnvKeys.filter((item) => item !== key) : [...(draft.clearEnvKeys ?? []), key] }))} /> {session.text.mcpClearKey}: {key}</label>{/each}</label>
        </div>
      {:else}
        <div class="settings-form">
          <label class="settings-field settings-field-wide"><span>{session.text.mcpUrl}</span><input value={mcpStore.mcpEdit.url} autocomplete="off" spellcheck="false" oninput={(event) => updateMcpEdit((draft) => ({ ...draft, url: event.currentTarget.value }))} /></label>
          <label class="settings-field settings-field-wide"><span>{session.text.mcpHeadersReplace}</span><textarea rows="4" value={mcpStore.mcpEdit.headerDraft} placeholder={session.text.mcpMapPlaceholder} autocomplete="off" spellcheck="false" oninput={(event) => updateMcpEdit((draft) => ({ ...draft, headerDraft: event.currentTarget.value }))}></textarea>{#each savedMcp?.headerKeys ?? [] as key (key)}<label class="inline-check"><input type="checkbox" checked={mcpStore.mcpEdit.clearHeaderKeys?.includes(key)} onchange={() => updateMcpEdit((draft) => ({ ...draft, clearHeaderKeys: draft.clearHeaderKeys?.includes(key) ? draft.clearHeaderKeys.filter((item) => item !== key) : [...(draft.clearHeaderKeys ?? []), key] }))} /> {session.text.mcpClearKey}: {key}</label>{/each}</label>
        </div>
      {/if}
      </div>
      <footer class="entity-editor-foot"><button class="secondary-button" type="button" disabled={mcpStore.saving} onclick={() => (mcpStore.mcpEdit = null)}>{session.text.cancel}</button><button class="primary-button" type="submit" disabled={mcpStore.saving || !mcpStore.mcpEdit.id.trim() || (mcpStore.mcpEdit.transport === "stdio" ? !mcpStore.mcpEdit.command.trim() : !mcpStore.mcpEdit.url.trim())}>{mcpStore.saving ? session.text.onboardingProviderSaving : session.text.save}</button></footer>
    </form>
    </Dialog>
  {/if}

  {#if deletingMcpServer}
    <AlertDialog
      open={true}
      contentClass="modal-card"
      labelledBy="mcp-delete-title"
      describedBy="mcp-delete-description"
      onOpenChange={(next) => { if (!next) deletingMcpServer = null; }}
    >
      <header class="modal-head"><strong id="mcp-delete-title">{session.text.delete}</strong></header>
      <div class="modal-body"><p id="mcp-delete-description">{session.text.mcpDeleteConfirm}</p></div>
      <footer class="provider-modal-foot">
        <button class="secondary-button" type="button" onclick={() => (deletingMcpServer = null)}>{session.text.cancel}</button>
        <button class="primary-button danger-action" type="button" onclick={() => void handleConfirmDelete()}>{session.text.delete}</button>
      </footer>
    </AlertDialog>
  {/if}

  {#if mcpStore.actionMessage}<p class="settings-action-message" aria-live="polite">{mcpStore.actionMessage}</p>{/if}
{/if}
