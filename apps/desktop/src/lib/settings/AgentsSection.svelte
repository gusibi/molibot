<script lang="ts">
  import { untrack } from "svelte";
  import DirectoryActions from "../components/ui/DirectoryActions.svelte";
  import DirectoryToolbar from "../components/ui/DirectoryToolbar.svelte";
  import SkeletonRows from "../components/ui/SkeletonRows.svelte";
  import SharedAgentRulesSection from "./SharedAgentRulesSection.svelte";
  import AgentAvatar from "../components/ui/AgentAvatar.svelte";
  import Button from "../components/ui/Button.svelte";
  import AlertDialog from "../components/ui/AlertDialog.svelte";
  import EmptyState from "../components/ui/EmptyState.svelte";
  import SelectControl from "../components/ui/SelectControl.svelte";
  import SettingGroup from "../components/ui/SettingGroup.svelte";
  import SettingRow from "../components/ui/SettingRow.svelte";
  import { setDesktopDefaultAgent } from "../api";
  import { notifySettingsChanged } from "../stores/session.svelte";
  import { session } from "../stores/session.svelte";
  import { listFlip, listIn, listOut } from "../motion/listMotion";
  import {
    agentsStore,
    beginAgentEdit,
    beginNewAgent,
    installAgentFromTemplate,
    loadAgents,
    removeAgent,
    updateAgentFromTemplate
  } from "../stores/agents.svelte";

  let query = $state("");
  let status = $state<"all" | "enabled" | "disabled">("all");
  const filteredAgents = $derived.by(() => {
    const term = query.trim().toLocaleLowerCase(session.locale);
    return (agentsStore.agents?.items ?? []).filter(agent => (status === "all" || agent.enabled === (status === "enabled")) && (!term || [agent.name, agent.description, agent.id].join("\n").toLocaleLowerCase(session.locale).includes(term)));
  });
  let sharedRulesOpen = $state(false);
  let deletingAgent = $state<NonNullable<typeof agentsStore.agents>["items"][number] | null>(null);

  $effect(() => {
    const endpoint = session.serviceReady ? session.endpoint : null;
    if (endpoint) untrack(() => void loadAgents(endpoint));
  });

  async function handleConfirmDelete(): Promise<void> {
    if (!deletingAgent) return;
    const id = deletingAgent.id;
    deletingAgent = null;
    await removeAgent(id);
  }
</script>

{#if sharedRulesOpen}
  <SharedAgentRulesSection onClose={() => sharedRulesOpen = false} />
{:else if !session.serviceReady}
  <SettingGroup><EmptyState title={session.text.agentsUnavailable} icon="robot" /></SettingGroup>
{:else if agentsStore.error && !agentsStore.agents}
  <SettingGroup><div class="directory-load-error" role="alert"><strong>{session.text.directoryLoadFailed}</strong><p>{agentsStore.error}</p><Button onclick={() => session.endpoint && loadAgents(session.endpoint)}>{session.text.retryLoading}</Button></div></SettingGroup>
{:else if !agentsStore.agents}
  <SettingGroup><SkeletonRows count={4} label={session.text.loading} /></SettingGroup>
{:else}
  <div class="directory-shell agent-directory" aria-busy={agentsStore.loading}>
  {#if agentsStore.error}<div class="directory-load-error" role="alert"><p>{agentsStore.error}</p><Button onclick={() => session.endpoint && loadAgents(session.endpoint)}>{session.text.retryLoading}</Button></div>{/if}
  <SettingGroup title={session.text.directoryShared} contentClass="directory-shared-settings">
    <SettingRow title={session.text.directorySharedRules}>
      <svelte:fragment slot="detail"><details class="directory-shared-detail"><summary>{session.text.directoryDetails}</summary><p>{session.text.directorySharedHint}</p></details></svelte:fragment>
      <Button onclick={() => sharedRulesOpen = true}>{session.text.agentEdit}</Button>
    </SettingRow><SettingRow title={session.text.directoryDefaultAgent}>
    <svelte:fragment slot="detail"><details class="directory-shared-detail"><summary>{session.text.directoryDetails}</summary><p>{session.text.directoryDefaultHint}</p></details></svelte:fragment>
    <SelectControl value={agentsStore.agents?.defaultAgentId ?? "default"} options={agentsStore.agents.items.filter(agent => agent.enabled).map(agent => ({ value: agent.id, label: agent.name }))} ariaLabel={session.text.directoryDefaultAgent} onChange={async id => { if (!session.endpoint) return; try { await setDesktopDefaultAgent(session.endpoint, id); await loadAgents(session.endpoint); notifySettingsChanged(); } catch (cause) { session.error = String(cause); } }} />
  </SettingRow></SettingGroup>

  <DirectoryToolbar {query} {status} summary={`${session.text.agentsTotal}: ${agentsStore.agents.counts.total}`} total={agentsStore.agents.counts.total} enabled={agentsStore.agents.counts.enabled} shown={filteredAgents.length} searchLabel={session.text.directoryAgentSearch} onQuery={value => query = value} onStatus={value => status = value}>
    {#snippet actions()}<Button variant="primary" disabled={agentsStore.agentEdit !== null} onclick={beginNewAgent}>{session.text.agentAdd}</Button>{/snippet}
  </DirectoryToolbar>
  <SettingGroup ariaLabel={session.text.agents}>
    {#if agentsStore.agents.counts.total === 0}
      <EmptyState title={session.text.agentsEmpty} description={session.text.agentsHint} icon="robot" />
    {:else if filteredAgents.length === 0}
      <EmptyState title={session.text.directoryNoMatches} description={session.text.directoryNoMatchesHint} icon="magnifying-glass"><Button onclick={() => { query = ""; status = "all"; }}>{session.text.directoryClear}</Button></EmptyState>
    {:else}
      {#each filteredAgents as agent (agent.id)}
        <div class="settings-row agent-management-row directory-entity-row" data-agent-id={agent.id}>
          <AgentAvatar name={agent.name} src={agent.avatar || ""} />
          <div class="profile-info">
            <div class="directory-entity-title"><strong>{agent.name}</strong>{#if agent.id === agentsStore.agents.defaultAgentId}<span class="directory-default-label">{session.text.directoryDefault}</span>{/if}</div>
            {#if agent.description}<p class="directory-description" title={agent.description}>{agent.description}</p>{/if}
            <details class="directory-row-details"><summary>{session.text.directoryDetails}</summary><dl><div><dt>ID</dt><dd><code>{agent.id}</code></dd></div><div><dt>{session.text.agentPermissionMode}</dt><dd>{agent.permissionMode === null ? session.text.agentPermissionModeInherit : { plan: session.text.permissionModePlan, manual: session.text.permissionModeManual, accept_edits: session.text.permissionModeAcceptEdits, auto: session.text.permissionModeAuto }[agent.permissionMode]}</dd></div><div><dt>{session.text.agentModelOverrides}</dt><dd>{agent.modelOverrides}</dd></div></dl></details>
          </div>
          <span class="directory-enabled-state" data-enabled={agent.enabled}><i aria-hidden="true"></i>{agent.enabled ? session.text.providerEnabled : session.text.providerDisabled}</span>
          <div class="settings-row-actions">
            <Button variant="text" disabled={agentsStore.editorLoading} ariaLabel={session.locale === "zh-CN" ? `编辑 ${agent.name} 的设置` : `Edit settings for ${agent.name}`} onclick={() => void beginAgentEdit(agent.id)}>{session.text.agentEdit}</Button>
            <DirectoryActions label={session.text.directoryMoreActions.replace("{name}", agent.name)} disabled={agentsStore.saving} items={[{ label: session.text.agentDelete, danger: true, onSelect: () => deletingAgent = agent }]} />
          </div>
        </div>
      {/each}
    {/if}
  </SettingGroup>
  {#if !agentsStore.agentEdit && agentsStore.templates.length > 0}
    <details class="directory-template-disclosure"><summary>{session.text.agentTemplates}<span>{agentsStore.templates.length}{#if agentsStore.templates.some(template => template.updateAvailable || template.modified)} · {session.text.agentTemplateUpdateAvailable}{/if}</span></summary>
    <SettingGroup ariaLabel={session.text.agentTemplates} description={session.text.agentTemplatesHint}>
      {#each agentsStore.templates as template (template.id)}
        <div class="settings-row" in:listIn out:listOut animate:listFlip>
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
    </details>
  {/if}
  </div>
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
    <div class="modal-body"><p id="agent-delete-description"><strong>{deletingAgent.name}</strong> · {session.text.agentDeleteConfirm}</p></div>
    <footer class="provider-modal-foot">
      <button class="secondary-button" type="button" onclick={() => (deletingAgent = null)}>{session.text.cancel}</button>
      <button class="primary-button danger-action" type="button" onclick={() => void handleConfirmDelete()}>{session.text.agentDelete}</button>
    </footer>
  </AlertDialog>
{/if}

{#if agentsStore.actionMessage}<p class="settings-action-message" aria-live="polite">{agentsStore.actionMessage}</p>{/if}
