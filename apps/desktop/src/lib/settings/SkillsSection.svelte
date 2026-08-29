<script lang="ts">
  import { onDestroy } from "svelte";
  import EmptyState from "../components/ui/EmptyState.svelte";
  import SelectControl from "../components/ui/SelectControl.svelte";
  import IosSwitch from "../components/ui/IosSwitch.svelte";
  import SettingGroup from "../components/ui/SettingGroup.svelte";
  import SettingRow from "../components/ui/SettingRow.svelte";
  import { session } from "../stores/session.svelte";
  import { trackUnsaved } from "../unsavedGuard";
  import { skillsStore, discardSkillsSearch, loadSkills, saveSkillsSearch, toggleSkill, updateBuiltinSkill } from "../stores/skills.svelte";

  $effect(() => {
    if (session.serviceReady && session.endpoint && session.endpoint !== skillsStore.endpoint) {
      void loadSkills(session.endpoint);
    }
  });

  const skillsSearchDirty = $derived(skillsStore.searchDraft !== null && JSON.stringify(skillsStore.searchDraft) !== skillsStore.searchPristine);

  onDestroy(trackUnsaved(() => skillsSearchDirty));
</script>

{#if !session.serviceReady}
  <SettingGroup><EmptyState title={session.text.skillsUnavailable} icon="sparkle" /></SettingGroup>
{:else if skillsStore.loading || !skillsStore.skills}
  <SettingGroup><div class="settings-row"><p>{session.text.loading}</p></div></SettingGroup>
{:else}
  <SettingGroup ariaLabel={session.text.skillsTotal}>
    <SettingRow title={session.text.skillsTotal}>
      <span class="diag-value">{skillsStore.skills.counts.total} · {session.text.agentsEnabledCount}: {skillsStore.skills.counts.enabled} · {session.text.skillScopeGlobal}: {skillsStore.skills.counts.global} · {session.text.skillScopeBot}: {skillsStore.skills.counts.bot} · {session.text.skillScopeChat}: {skillsStore.skills.counts.chat}</span>
    </SettingRow>
  </SettingGroup>
  {#if skillsStore.skills.builtins.length > 0}
    <SettingGroup title={session.text.skillBuiltins} description={session.text.skillBuiltinsHint}>
      {#each skillsStore.skills.builtins as builtin (builtin.id)}
        <div class="settings-row">
          <div class="profile-info">
            <strong>{builtin.id}</strong>
            <p>
              v{builtin.version}
              {#if builtin.installed && builtin.installedVersion && builtin.installedVersion !== builtin.version}
                · {session.text.agentTemplateInstalledVersion}: v{builtin.installedVersion}
              {/if}
              {#if !builtin.installed}
                · {session.text.skillBuiltinRemoved}
              {:else if builtin.modified}
                · {session.text.agentTemplateModified}
              {/if}
            </p>
          </div>
          {#if builtin.updateAvailable || !builtin.installed}
            <span class="status-badge" data-state="warning">{builtin.installed ? session.text.agentTemplateUpdateAvailable : session.text.skillBuiltinRemoved}</span>
          {/if}
          <div class="settings-row-actions">
            <button
              class="secondary-button"
              type="button"
              disabled={builtin.installed && !builtin.updateAvailable && !builtin.modified || Boolean(skillsStore.updatingBuiltinId)}
              onclick={() => void updateBuiltinSkill(builtin.id)}
            >
              {skillsStore.updatingBuiltinId === builtin.id
                ? session.text.agentTemplateUpdating
                : !builtin.installed
                  ? session.text.agentTemplateInstall
                  : builtin.updateAvailable || builtin.modified
                    ? session.text.agentTemplateUpdate
                    : session.text.agentTemplateInstalled}
            </button>
          </div>
        </div>
      {/each}
    </SettingGroup>
  {/if}
  {#if skillsStore.searchDraft}
    {@const selectedSkillProvider = skillsStore.searchDraft.providers.find((provider) => provider.id === skillsStore.searchDraft?.apiProvider)}
    <details class="skills-search-config settings-card">
      <summary><span>{session.text.skillsSearchConfig}</span><i class="ph ph-caret-down" aria-hidden="true"></i></summary>
      <form id="desktop-skills-search-form" onsubmit={(event) => { event.preventDefault(); void saveSkillsSearch(); }}>
        <div class="settings-row">
          <strong>{session.text.skillSearchLocal}</strong>
          <IosSwitch checked={skillsStore.searchDraft.localEnabled} ariaLabel={session.text.skillSearchLocal} onCheckedChange={(checked) => (skillsStore.searchDraft = skillsStore.searchDraft ? { ...skillsStore.searchDraft, localEnabled: checked } : null)} />
        </div>
        <div class="settings-row">
          <strong>{session.text.skillSearchApi}</strong>
          <IosSwitch checked={skillsStore.searchDraft.apiEnabled} ariaLabel={session.text.skillSearchApi} onCheckedChange={(checked) => (skillsStore.searchDraft = skillsStore.searchDraft ? { ...skillsStore.searchDraft, apiEnabled: checked } : null)} />
        </div>
        <div class="settings-form">
          <label class="settings-field"><span>{session.text.skillsSearchProvider}</span><SelectControl value={skillsStore.searchDraft.apiProvider} ariaLabel={session.text.skillsSearchProvider} options={[{ value: "", label: session.text.unavailable }, ...skillsStore.searchDraft.providers.map((provider) => ({ value: provider.id, label: provider.name }))]} onChange={(value) => { const provider = skillsStore.searchDraft?.providers.find((item) => item.id === value); if (skillsStore.searchDraft) skillsStore.searchDraft = { ...skillsStore.searchDraft, apiProvider: provider?.id ?? "", apiModel: provider?.models.includes(skillsStore.searchDraft.apiModel) ? skillsStore.searchDraft.apiModel : provider?.defaultModel ?? provider?.models[0] ?? "" }; }} /></label>
          <label class="settings-field"><span>{session.text.skillsSearchModel}</span><SelectControl value={skillsStore.searchDraft.apiModel} ariaLabel={session.text.skillsSearchModel} options={[{ value: "", label: session.text.unavailable }, ...(selectedSkillProvider?.models ?? []).map((model) => ({ value: model, label: model }))]} onChange={(value) => { if (skillsStore.searchDraft) skillsStore.searchDraft = { ...skillsStore.searchDraft, apiModel: value }; }} /></label>
          <label class="settings-field"><span>{session.text.skillsMaxTokens}</span><input type="number" min="128" max="4096" autocomplete="off" aria-label={session.text.skillsMaxTokens} value={skillsStore.searchDraft.maxTokens} oninput={(event) => { if (skillsStore.searchDraft) skillsStore.searchDraft = { ...skillsStore.searchDraft, maxTokens: Number(event.currentTarget.value) }; }} /></label>
          <label class="settings-field"><span>{session.text.skillsTemperature}</span><input type="number" min="0" max="1" step="0.1" autocomplete="off" aria-label={session.text.skillsTemperature} value={skillsStore.searchDraft.temperature} oninput={(event) => { if (skillsStore.searchDraft) skillsStore.searchDraft = { ...skillsStore.searchDraft, temperature: Number(event.currentTarget.value) }; }} /></label>
          <label class="settings-field"><span>{session.text.skillsTimeout}</span><input type="number" min="1000" max="60000" step="500" autocomplete="off" aria-label={session.text.skillsTimeout} value={skillsStore.searchDraft.timeoutMs} oninput={(event) => { if (skillsStore.searchDraft) skillsStore.searchDraft = { ...skillsStore.searchDraft, timeoutMs: Number(event.currentTarget.value) }; }} /></label>
          <label class="settings-field"><span>{session.text.skillsConfidence}</span><input type="number" min="0" max="1" step="0.05" autocomplete="off" aria-label={session.text.skillsConfidence} value={skillsStore.searchDraft.minConfidence} oninput={(event) => { if (skillsStore.searchDraft) skillsStore.searchDraft = { ...skillsStore.searchDraft, minConfidence: Number(event.currentTarget.value) }; }} /></label>
        </div>
      </form>
    </details>
  {/if}
  {#if skillsStore.skills.counts.total === 0}
    <EmptyState title={session.text.skillsEmpty} description={session.text.skillsHint} icon="sparkle" />
  {:else}
    <SettingGroup ariaLabel={session.text.skillsTotal}>
      {#each skillsStore.skills.items as skill (skill.id)}
        <div class="settings-row">
          <div class="profile-info">
            <strong>{skill.name}</strong>
            {#if skill.description}<p>{skill.description}</p>{/if}
            <p>{skill.scope === "global" ? session.text.skillScopeGlobal : skill.scope === "bot" ? session.text.skillScopeBot : session.text.skillScopeChat}{skill.botId ? ` · ${skill.botId}` : ""}{skill.chatId ? ` / ${skill.chatId}` : ""}{skill.mcpServerCount > 0 ? ` · ${session.text.skillMcpServers}: ${skill.mcpServerCount}` : ""}</p>
          </div>
          <IosSwitch checked={skill.enabled} ariaLabel={skill.name} disabled={skillsStore.savingId === skill.id} onCheckedChange={(checked) => void toggleSkill(skill.id, checked)} />
        </div>
      {/each}
    </SettingGroup>
  {/if}
  {#if skillsStore.actionMessage}<p class="settings-action-message" aria-live="polite">{skillsStore.actionMessage}</p>{/if}
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
