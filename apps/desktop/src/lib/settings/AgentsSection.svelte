<script lang="ts">
  import X from "reicon-svelte/icons/X";
  import AlertDialog from "../components/ui/AlertDialog.svelte";
  import Dialog from "../components/ui/Dialog.svelte";
  import EmptyState from "../components/ui/EmptyState.svelte";
  import IosSwitch from "../components/ui/IosSwitch.svelte";
  import SelectControl from "../components/ui/SelectControl.svelte";
  import SettingGroup from "../components/ui/SettingGroup.svelte";
  import SettingRow from "../components/ui/SettingRow.svelte";
  import { modelOptionCopy } from "../presentation";
  import type { DesktopModelRoute } from "../api";
  import { session } from "../stores/session.svelte";
  import { modelsStore, loadModels } from "../stores/models.svelte";
  import {
    agentsStore,
    AGENT_FILE_NAMES,
    beginAgentEdit,
    beginNewAgent,
    installAgentFromTemplate,
    loadAgents,
    removeAgent,
    saveAgentEditor,
    updateAgentEdit,
    updateAgentFromTemplate
  } from "../stores/agents.svelte";

  let deletingAgent = $state<NonNullable<typeof agentsStore.agents>["items"][number] | null>(null);

  $effect(() => {
    if (session.serviceReady && session.endpoint && session.endpoint !== agentsStore.endpoint) {
      void loadAgents(session.endpoint);
    }
  });
  // The per-agent overrides editor needs the available model options.
  $effect(() => {
    if (session.serviceReady && session.endpoint && session.endpoint !== modelsStore.loadedEndpoint) {
      void loadModels(session.endpoint);
    }
  });

  async function handleConfirmDelete(): Promise<void> {
    if (!deletingAgent) return;
    const id = deletingAgent.id;
    deletingAgent = null;
    await removeAgent(id);
  }
</script>

{#if !session.serviceReady}
  <SettingGroup><EmptyState title={session.text.agentsUnavailable} icon="robot" /></SettingGroup>
{:else if agentsStore.loading || !agentsStore.agents}
  <SettingGroup><div class="settings-row"><p>{session.text.loading}</p></div></SettingGroup>
{:else}
  {#if !agentsStore.agentEdit && agentsStore.templates.length > 0}
    <SettingGroup title={session.text.agentTemplates} description={session.text.agentTemplatesHint}>
      {#each agentsStore.templates as template (template.id)}
        <div class="settings-row">
          <div class="profile-info">
            <strong>{template.name}</strong>
            {#if template.description}<p>{template.description}</p>{/if}
            <p>
              {template.category} · {template.id} · {template.source} · v{template.version}
              {#if template.installed && template.installedVersion && template.installedVersion !== template.version}
                · {session.text.agentTemplateInstalledVersion}: v{template.installedVersion}
              {/if}
              {#if template.installed && template.modified}
                · {session.text.agentTemplateModified}
              {/if}
            </p>
          </div>
          {#if template.updateAvailable}
            <span class="status-badge" data-state="warning">{session.text.agentTemplateUpdateAvailable}</span>
          {/if}
          <div class="settings-row-actions">
            {#if template.installed}
              <button
                class="secondary-button"
                type="button"
                disabled={!template.updateAvailable && !template.modified || Boolean(agentsStore.updatingTemplateId)}
                onclick={() => void updateAgentFromTemplate(template.id)}
              >
                {agentsStore.updatingTemplateId === template.id
                  ? session.text.agentTemplateUpdating
                  : template.updateAvailable || template.modified
                    ? session.text.agentTemplateUpdate
                    : session.text.agentTemplateInstalled}
              </button>
            {:else}
              <button
                class="secondary-button"
                type="button"
                disabled={Boolean(agentsStore.installingTemplateId)}
                onclick={() => void installAgentFromTemplate(template.id)}
              >
                {agentsStore.installingTemplateId === template.id ? session.text.agentTemplateInstalling : session.text.agentTemplateInstall}
              </button>
            {/if}
          </div>
        </div>
      {/each}
    </SettingGroup>
  {/if}

  <SettingGroup title={session.text.agents} description={`${session.text.agentsTotal}: ${agentsStore.agents.counts.total} · ${session.text.agentsEnabledCount}: ${agentsStore.agents.counts.enabled}`}>
    <svelte:fragment slot="action">
      <button class="secondary-button" type="button" disabled={agentsStore.agentEdit !== null} onclick={beginNewAgent}>{session.text.agentAdd}</button>
    </svelte:fragment>
    {#if agentsStore.agents.counts.total === 0}
      <EmptyState title={session.text.agentsEmpty} description={session.text.agentsHint} icon="robot" />
    {:else}
      {#each agentsStore.agents.items as agent (agent.id)}
        <div class="settings-row">
          <div class="profile-info">
            <strong>{agent.name}</strong>
            {#if agent.description}<p>{agent.description}</p>{/if}
            <p>{session.text.agentSandbox}: {agent.sandboxEnabled === null ? session.text.agentSandboxInherit : agent.sandboxEnabled ? session.text.yes : session.text.no} · {session.text.agentModelOverrides}: {agent.modelOverrides}</p>
          </div>
          <span class="status-badge" data-state={agent.enabled ? "ready" : "disconnected"}>{agent.enabled ? session.text.providerEnabled : session.text.providerDisabled}</span>
          <div class="settings-row-actions">
            <button class="secondary-button" type="button" disabled={agentsStore.editorLoading} onclick={() => void beginAgentEdit(agent.id)}>{session.text.agentEdit}</button>
            <button class="secondary-button danger-action" type="button" disabled={agentsStore.saving} onclick={() => (deletingAgent = agent)}>{session.text.agentDelete}</button>
          </div>
        </div>
      {/each}
    {/if}
  </SettingGroup>
{/if}
{#if agentsStore.agentEdit}
  <Dialog open={true} busy={agentsStore.saving} contentClass="entity-editor-dialog" labelledBy="agent-editor-title" onOpenChange={(next) => { if (!next) agentsStore.agentEdit = null; }}>
  <form id="desktop-agent-form" class="entity-editor-form" aria-label={session.text.agents} onsubmit={(event) => { event.preventDefault(); void saveAgentEditor(); }}>
    <header class="entity-editor-head"><strong id="agent-editor-title">{session.text.agents}</strong><button class="modal-close" type="button" aria-label={session.text.dialogClose} disabled={agentsStore.saving} onclick={() => (agentsStore.agentEdit = null)}><X size={16} aria-hidden="true" /></button></header>
    <div class="entity-editor-body">
    <div class="settings-form">
      <label class="settings-field"><span>{session.text.agentId}</span><input value={agentsStore.agentEdit.id} disabled={!agentsStore.agentEdit.isNew} autocomplete="off" spellcheck="false" oninput={(event) => updateAgentEdit((draft) => ({ ...draft, id: (event.currentTarget as HTMLInputElement).value }))} /></label>
      <label class="settings-field"><span>{session.text.agentName}</span><input value={agentsStore.agentEdit.name} autocomplete="off" oninput={(event) => updateAgentEdit((draft) => ({ ...draft, name: (event.currentTarget as HTMLInputElement).value }))} /></label>
      <label class="settings-field settings-field-wide"><span>{session.text.agentDescription}</span><textarea rows="3" value={agentsStore.agentEdit.description} autocomplete="off" oninput={(event) => updateAgentEdit((draft) => ({ ...draft, description: (event.currentTarget as HTMLTextAreaElement).value }))}></textarea></label>
      <label class="settings-field"><span>{session.text.profileSandbox}</span><SelectControl value={agentsStore.agentEdit.sandboxEnabled === null ? "inherit" : agentsStore.agentEdit.sandboxEnabled ? "on" : "off"} ariaLabel={session.text.profileSandbox} options={[{ value: "inherit", label: session.text.profileSandboxInherit }, { value: "on", label: session.text.profileSandboxOn }, { value: "off", label: session.text.profileSandboxOff }]} onChange={(value) => updateAgentEdit((draft) => ({ ...draft, sandboxEnabled: value === "inherit" ? null : value === "on" }))} /></label>
      {#each [{ key: "textModelKey", route: "text", label: session.text.agentTextModel }, { key: "sttModelKey", route: "stt", label: session.text.agentSttModel }] as field (field.key)}
        <label class="settings-field"><span>{field.label}</span><SelectControl value={agentsStore.agentEdit.modelRouting[field.key as keyof typeof agentsStore.agentEdit.modelRouting]} ariaLabel={field.label} options={[{ value: "", label: session.text.agentFollowGlobal }, ...(modelsStore.modelStates[field.route as DesktopModelRoute]?.options ?? []).map((option) => ({ value: option.key, label: modelOptionCopy(option).name }))]} onChange={(value) => updateAgentEdit((draft) => ({ ...draft, modelRouting: { ...draft.modelRouting, [field.key]: value } }))} /></label>
      {/each}
    </div>
    <div class="provider-inline-options"><div class="inline-switch-row"><span>{session.text.agentEnabled}</span><IosSwitch checked={agentsStore.agentEdit.enabled} ariaLabel={session.text.agentEnabled} onCheckedChange={(checked) => updateAgentEdit((draft) => ({ ...draft, enabled: checked }))} /></div></div>
    <div class="provider-editor-toolbar"><strong>{session.text.agentFiles}</strong></div>
    <div class="profile-files-editor">
      {#each AGENT_FILE_NAMES as fileName (fileName)}
        <label class="settings-field"><span>{fileName}</span><textarea rows="7" value={agentsStore.agentEdit.files[fileName] ?? ""} autocomplete="off" spellcheck="false" oninput={(event) => updateAgentEdit((draft) => ({ ...draft, files: { ...draft.files, [fileName]: (event.currentTarget as HTMLTextAreaElement).value } }))}></textarea></label>
      {/each}
    </div>
    </div>
    <footer class="entity-editor-foot"><button class="secondary-button" type="button" disabled={agentsStore.saving} onclick={() => (agentsStore.agentEdit = null)}>{session.text.cancel}</button><button class="primary-button" type="submit" disabled={agentsStore.saving || !agentsStore.agentEdit.id.trim()}>{agentsStore.saving ? session.text.onboardingProviderSaving : session.text.save}</button></footer>
  </form>
  </Dialog>
{/if}

{#if deletingAgent}
  <AlertDialog
    open={true}
    contentClass="modal-card"
    labelledBy="agent-delete-title"
    describedBy="agent-delete-description"
    onOpenChange={(next) => { if (!next) deletingAgent = null; }}
  >
    <header class="modal-head"><strong id="agent-delete-title">{session.text.agentDelete}</strong></header>
    <div class="modal-body"><p id="agent-delete-description">{session.text.agentDeleteConfirm}</p></div>
    <footer class="provider-modal-foot">
      <button class="secondary-button" type="button" onclick={() => (deletingAgent = null)}>{session.text.cancel}</button>
      <button class="primary-button danger-action" type="button" onclick={() => void handleConfirmDelete()}>{session.text.agentDelete}</button>
    </footer>
  </AlertDialog>
{/if}

{#if agentsStore.actionMessage}<p class="settings-action-message" aria-live="polite">{agentsStore.actionMessage}</p>{/if}
