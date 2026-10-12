<script lang="ts">
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

  let sharedRulesOpen = $state(false);
  let deletingAgent = $state<NonNullable<typeof agentsStore.agents>["items"][number] | null>(null);

  $effect(() => {
    if (session.serviceReady && session.endpoint && session.endpoint !== agentsStore.endpoint) {
      void loadAgents(session.endpoint);
    }
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
{:else if agentsStore.loading || !agentsStore.agents}
  <SettingGroup><div class="settings-row"><p>{session.text.loading}</p></div></SettingGroup>
{:else}
  <SettingGroup title={session.locale === "zh-CN" ? "共享配置" : "Shared configuration"}>
    <SettingRow title={session.locale === "zh-CN" ? "共享规则" : "Shared rules"} description={session.locale === "zh-CN" ? "所有 Agent 都会读取。专属规则在此基础上补充，模型等明确选择优先于共享默认值。" : "Read by every Agent. Agent rules extend this baseline; explicit model choices take priority over shared defaults."}>
      <Button onclick={() => sharedRulesOpen = true}>{session.text.agentEdit}</Button>
    </SettingRow><SettingRow title={session.locale === "zh-CN" ? "默认 Agent" : "Default Agent"} description={session.locale === "zh-CN" ? "用于全局新对话；已有机器人绑定和对话归属不变。" : "Used for global new conversations. Existing bot bindings and conversations keep their Agent."}>
    <SelectControl value={agentsStore.agents?.defaultAgentId ?? "default"} options={agentsStore.agents.items.filter(agent => agent.enabled).map(agent => ({ value: agent.id, label: agent.name }))} ariaLabel={session.locale === "zh-CN" ? "默认 Agent" : "Default Agent"} onChange={async id => { if (!session.endpoint) return; try { await setDesktopDefaultAgent(session.endpoint, id); await loadAgents(session.endpoint); notifySettingsChanged(); } catch (cause) { session.error = String(cause); } }} />
  </SettingRow></SettingGroup>

  <SettingGroup title={session.text.agents} description={`${session.locale === "zh-CN" ? "选择一个 Agent 进行编辑。" : "Choose an Agent to edit."} ${session.text.agentsTotal}: ${agentsStore.agents.counts.total} · ${session.text.agentsEnabledCount}: ${agentsStore.agents.counts.enabled}`}>
    <svelte:fragment slot="action">
      <button class="secondary-button" type="button" disabled={agentsStore.agentEdit !== null} onclick={beginNewAgent}>{session.text.agentAdd}</button>
    </svelte:fragment>
    {#if agentsStore.agents.counts.total === 0}
      <EmptyState title={session.text.agentsEmpty} description={session.text.agentsHint} icon="robot" />
    {:else}
      {#each agentsStore.agents.items as agent (agent.id)}
        <div class="settings-row agent-management-row" in:listIn out:listOut animate:listFlip>
          <AgentAvatar name={agent.name} src={agent.avatar || ""} />
          <div class="profile-info">
            <strong>{agent.name}</strong>
            {#if agent.description}<p>{agent.description}</p>{/if}
            <p>{session.text.agentPermissionMode}: {agent.permissionMode === null ? session.text.agentPermissionModeInherit : { plan: session.text.permissionModePlan, manual: session.text.permissionModeManual, accept_edits: session.text.permissionModeAcceptEdits, auto: session.text.permissionModeAuto }[agent.permissionMode]} · {session.text.agentModelOverrides}: {agent.modelOverrides}</p>
          </div>
          <span class="status-badge" data-state={agent.enabled ? "ready" : "disconnected"}>{agent.enabled ? session.text.providerEnabled : session.text.providerDisabled}</span>
          <div class="settings-row-actions">
            <Button disabled={agentsStore.editorLoading} ariaLabel={session.locale === "zh-CN" ? `编辑 ${agent.name} 的设置` : `Edit settings for ${agent.name}`} onclick={() => void beginAgentEdit(agent.id)}>{session.text.agentEdit}</Button>
            <button class="secondary-button danger-action" type="button" disabled={agentsStore.saving} onclick={() => (deletingAgent = agent)}>{session.text.agentDelete}</button>
          </div>
        </div>
      {/each}
    {/if}
  </SettingGroup>
  {#if !agentsStore.agentEdit && agentsStore.templates.length > 0}
    <SettingGroup title={session.text.agentTemplates} description={session.text.agentTemplatesHint}>
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
  {/if}

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
