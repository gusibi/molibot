<script lang="ts">
  import { session } from "../stores/session.svelte";
  import { skillsStore, discardSkillsSearch, loadSkills, saveSkillsSearch, toggleSkill } from "../stores/skills.svelte";

  $effect(() => {
    if (session.serviceReady && session.endpoint && session.endpoint !== skillsStore.endpoint) {
      void loadSkills(session.endpoint);
    }
  });

  const skillsSearchDirty = $derived(skillsStore.searchDraft !== null && JSON.stringify(skillsStore.searchDraft) !== skillsStore.searchPristine);
</script>

<p class="settings-section-hint">{session.text.skillsHint}</p>
{#if !session.serviceReady}
  <div class="settings-card"><div class="settings-row"><p>{session.text.skillsUnavailable}</p></div></div>
{:else if skillsStore.loading || !skillsStore.skills}
  <div class="settings-card"><div class="settings-row"><p>{session.text.loading}</p></div></div>
{:else}
  <div class="settings-card">
    <div class="settings-row"><strong>{session.text.skillsTotal}</strong><span class="diag-value">{skillsStore.skills.counts.total} · {session.text.agentsEnabledCount}: {skillsStore.skills.counts.enabled} · {session.text.skillScopeGlobal}: {skillsStore.skills.counts.global} · {session.text.skillScopeBot}: {skillsStore.skills.counts.bot} · {session.text.skillScopeChat}: {skillsStore.skills.counts.chat}</span></div>
  </div>
  {#if skillsStore.searchDraft}
    {@const selectedSkillProvider = skillsStore.searchDraft.providers.find((provider) => provider.id === skillsStore.searchDraft?.apiProvider)}
    <form id="desktop-skills-search-form" class="settings-card provider-editor" onsubmit={(event) => { event.preventDefault(); void saveSkillsSearch(); }}>
      <div class="provider-editor-toolbar"><strong>{session.text.skillsSearchConfig}</strong></div>
      <div class="settings-row"><strong>{session.text.skillSearchLocal}</strong><button class:active={skillsStore.searchDraft.localEnabled} class="switch" type="button" role="switch" aria-label={session.text.skillSearchLocal} aria-checked={skillsStore.searchDraft.localEnabled} onclick={() => (skillsStore.searchDraft = skillsStore.searchDraft ? { ...skillsStore.searchDraft, localEnabled: !skillsStore.searchDraft.localEnabled } : null)}><span></span></button></div>
      <div class="settings-row"><strong>{session.text.skillSearchApi}</strong><button class:active={skillsStore.searchDraft.apiEnabled} class="switch" type="button" role="switch" aria-label={session.text.skillSearchApi} aria-checked={skillsStore.searchDraft.apiEnabled} onclick={() => (skillsStore.searchDraft = skillsStore.searchDraft ? { ...skillsStore.searchDraft, apiEnabled: !skillsStore.searchDraft.apiEnabled } : null)}><span></span></button></div>
      <div class="settings-form">
        <label class="settings-field"><span>{session.text.skillsSearchProvider}</span><select value={skillsStore.searchDraft.apiProvider} onchange={(event) => { const provider = skillsStore.searchDraft?.providers.find((item) => item.id === event.currentTarget.value); if (skillsStore.searchDraft) skillsStore.searchDraft = { ...skillsStore.searchDraft, apiProvider: provider?.id ?? "", apiModel: provider?.models.includes(skillsStore.searchDraft.apiModel) ? skillsStore.searchDraft.apiModel : provider?.defaultModel ?? provider?.models[0] ?? "" }; }}><option value="">{session.text.unavailable}</option>{#each skillsStore.searchDraft.providers as provider (provider.id)}<option value={provider.id}>{provider.name}</option>{/each}</select></label>
        <label class="settings-field"><span>{session.text.skillsSearchModel}</span><select value={skillsStore.searchDraft.apiModel} onchange={(event) => { if (skillsStore.searchDraft) skillsStore.searchDraft = { ...skillsStore.searchDraft, apiModel: event.currentTarget.value }; }}><option value="">{session.text.unavailable}</option>{#each selectedSkillProvider?.models ?? [] as model (model)}<option value={model}>{model}</option>{/each}</select></label>
        <label class="settings-field"><span>{session.text.skillsMaxTokens}</span><input type="number" min="128" max="4096" value={skillsStore.searchDraft.maxTokens} oninput={(event) => { if (skillsStore.searchDraft) skillsStore.searchDraft = { ...skillsStore.searchDraft, maxTokens: Number(event.currentTarget.value) }; }} /></label>
        <label class="settings-field"><span>{session.text.skillsTemperature}</span><input type="number" min="0" max="1" step="0.1" value={skillsStore.searchDraft.temperature} oninput={(event) => { if (skillsStore.searchDraft) skillsStore.searchDraft = { ...skillsStore.searchDraft, temperature: Number(event.currentTarget.value) }; }} /></label>
        <label class="settings-field"><span>{session.text.skillsTimeout}</span><input type="number" min="1000" max="60000" step="500" value={skillsStore.searchDraft.timeoutMs} oninput={(event) => { if (skillsStore.searchDraft) skillsStore.searchDraft = { ...skillsStore.searchDraft, timeoutMs: Number(event.currentTarget.value) }; }} /></label>
        <label class="settings-field"><span>{session.text.skillsConfidence}</span><input type="number" min="0" max="1" step="0.05" value={skillsStore.searchDraft.minConfidence} oninput={(event) => { if (skillsStore.searchDraft) skillsStore.searchDraft = { ...skillsStore.searchDraft, minConfidence: Number(event.currentTarget.value) }; }} /></label>
      </div>
    </form>
  {/if}
  {#if skillsStore.skills.counts.total === 0}
    <div class="settings-card"><div class="settings-row"><p>{session.text.skillsEmpty}</p></div></div>
  {:else}
    <div class="settings-card">
      {#each skillsStore.skills.items as skill (skill.id)}
        <div class="settings-row">
          <div class="profile-info">
            <strong>{skill.name}</strong>
            {#if skill.description}<p>{skill.description}</p>{/if}
            <p>{skill.scope === "global" ? session.text.skillScopeGlobal : skill.scope === "bot" ? session.text.skillScopeBot : session.text.skillScopeChat}{skill.botId ? ` · ${skill.botId}` : ""}{skill.chatId ? ` / ${skill.chatId}` : ""}{skill.mcpServerCount > 0 ? ` · ${session.text.skillMcpServers}: ${skill.mcpServerCount}` : ""}</p>
          </div>
          <button class:active={skill.enabled} class="switch" type="button" role="switch" aria-label={skill.name} aria-checked={skill.enabled} disabled={skillsStore.savingId === skill.id} onclick={() => void toggleSkill(skill.id, !skill.enabled)}><span></span></button>
        </div>
      {/each}
    </div>
  {/if}
  {#if skillsStore.actionMessage}<p class="settings-action-message">{skillsStore.actionMessage}</p>{/if}
{/if}

{#if skillsSearchDirty}
  <footer class="settings-footbar">
    <span class="settings-footbar-label">{session.text.settingsUnsaved}</span>
    <div class="settings-footbar-actions">
      <button class="secondary-button" type="button" disabled={skillsStore.saving} onclick={discardSkillsSearch}>{session.text.discardChanges}</button>
      <button class="primary-button" type="submit" form="desktop-skills-search-form" disabled={skillsStore.saving}>{skillsStore.saving ? session.text.onboardingProviderSaving : session.text.save}</button>
    </div>
  </footer>
{/if}
