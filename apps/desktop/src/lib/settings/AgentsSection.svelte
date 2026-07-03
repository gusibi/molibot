<script lang="ts">
  import type { DesktopModelRoute } from "../api";
  import { session } from "../stores/session.svelte";
  import { modelsStore, loadModels } from "../stores/models.svelte";
  import {
    agentsStore,
    AGENT_FILE_NAMES,
    beginAgentEdit,
    beginNewAgent,
    loadAgents,
    removeAgent,
    saveAgentEditor,
    updateAgentEdit
  } from "../stores/agents.svelte";

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
</script>

<p class="settings-section-hint">{session.text.agentsHint}</p>
{#if session.serviceReady && !agentsStore.agentEdit}<div class="settings-section-actions"><button class="secondary-button" type="button" onclick={beginNewAgent}>{session.text.agentAdd}</button></div>{/if}
{#if !session.serviceReady}
  <div class="settings-card"><div class="settings-row"><p>{session.text.agentsUnavailable}</p></div></div>
{:else if agentsStore.loading || !agentsStore.agents}
  <div class="settings-card"><div class="settings-row"><p>{session.text.loading}</p></div></div>
{:else if agentsStore.agents.counts.total === 0}
  <div class="settings-card"><div class="settings-row"><p>{session.text.agentsEmpty}</p></div></div>
{:else}
  <div class="settings-card">
    <div class="settings-row"><strong>{session.text.agentsTotal}</strong><span class="diag-value">{agentsStore.agents.counts.total} · {session.text.agentsEnabledCount}: {agentsStore.agents.counts.enabled}</span></div>
  </div>
  <div class="settings-card">
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
          <button class="secondary-button danger-action" type="button" disabled={agentsStore.saving} onclick={() => void removeAgent(agent.id)}>{session.text.agentDelete}</button>
        </div>
      </div>
    {/each}
  </div>
{/if}
{#if agentsStore.agentEdit}
  <form id="desktop-agent-form" class="settings-card provider-editor" aria-label={session.text.agents} onsubmit={(event) => { event.preventDefault(); void saveAgentEditor(); }}>
    <header class="entity-editor-head"><strong>{session.text.agents}</strong><button class="modal-close" type="button" aria-label={session.text.cancel} disabled={agentsStore.saving} onclick={() => (agentsStore.agentEdit = null)}><i class="ph ph-x"></i></button></header>
    <div class="settings-form">
      <label class="settings-field"><span>{session.text.agentId}</span><input value={agentsStore.agentEdit.id} disabled={!agentsStore.agentEdit.isNew} oninput={(event) => updateAgentEdit((draft) => ({ ...draft, id: (event.currentTarget as HTMLInputElement).value }))} /></label>
      <label class="settings-field"><span>{session.text.agentName}</span><input value={agentsStore.agentEdit.name} oninput={(event) => updateAgentEdit((draft) => ({ ...draft, name: (event.currentTarget as HTMLInputElement).value }))} /></label>
      <label class="settings-field settings-field-wide"><span>{session.text.agentDescription}</span><textarea rows="3" value={agentsStore.agentEdit.description} oninput={(event) => updateAgentEdit((draft) => ({ ...draft, description: (event.currentTarget as HTMLTextAreaElement).value }))}></textarea></label>
      <label class="settings-field"><span>{session.text.profileSandbox}</span><select value={agentsStore.agentEdit.sandboxEnabled === null ? "inherit" : agentsStore.agentEdit.sandboxEnabled ? "on" : "off"} onchange={(event) => { const value = (event.currentTarget as HTMLSelectElement).value; updateAgentEdit((draft) => ({ ...draft, sandboxEnabled: value === "inherit" ? null : value === "on" })); }}><option value="inherit">{session.text.profileSandboxInherit}</option><option value="on">{session.text.profileSandboxOn}</option><option value="off">{session.text.profileSandboxOff}</option></select></label>
      {#each [{ key: "textModelKey", route: "text", label: session.text.agentTextModel }, { key: "visionModelKey", route: "vision", label: session.text.agentVisionModel }, { key: "sttModelKey", route: "stt", label: session.text.agentSttModel }] as field (field.key)}
        <label class="settings-field"><span>{field.label}</span><select value={agentsStore.agentEdit.modelRouting[field.key as keyof typeof agentsStore.agentEdit.modelRouting]} onchange={(event) => updateAgentEdit((draft) => ({ ...draft, modelRouting: { ...draft.modelRouting, [field.key]: (event.currentTarget as HTMLSelectElement).value } }))}><option value="">{session.text.agentFollowGlobal}</option>{#each modelsStore.modelStates[field.route as DesktopModelRoute]?.options ?? [] as option (option.key)}<option value={option.key}>{option.label}</option>{/each}</select></label>
      {/each}
    </div>
    <div class="provider-inline-options"><div class="inline-switch-row"><span>{session.text.agentEnabled}</span><button class:active={agentsStore.agentEdit.enabled} class="switch" type="button" role="switch" aria-label={session.text.agentEnabled} aria-checked={agentsStore.agentEdit.enabled} onclick={() => updateAgentEdit((draft) => ({ ...draft, enabled: !draft.enabled }))}><span></span></button></div></div>
    <div class="provider-editor-toolbar"><strong>{session.text.agentFiles}</strong></div>
    <div class="profile-files-editor">
      {#each AGENT_FILE_NAMES as fileName (fileName)}
        <label class="settings-field"><span>{fileName}</span><textarea rows="7" value={agentsStore.agentEdit.files[fileName] ?? ""} oninput={(event) => updateAgentEdit((draft) => ({ ...draft, files: { ...draft.files, [fileName]: (event.currentTarget as HTMLTextAreaElement).value } }))}></textarea></label>
      {/each}
    </div>
    <footer class="entity-editor-foot"><button class="secondary-button" type="button" disabled={agentsStore.saving} onclick={() => (agentsStore.agentEdit = null)}>{session.text.cancel}</button><button class="primary-button" type="submit" disabled={agentsStore.saving || !agentsStore.agentEdit.id.trim()}>{agentsStore.saving ? session.text.onboardingProviderSaving : session.text.save}</button></footer>
  </form>
{/if}
{#if agentsStore.actionMessage}<p class="settings-action-message">{agentsStore.actionMessage}</p>{/if}
