<script lang="ts">
  import { onDestroy } from "svelte";
  import EmptyState from "../components/ui/EmptyState.svelte";
  import SelectControl from "../components/ui/SelectControl.svelte";
  import IosSwitch from "../components/ui/IosSwitch.svelte";
  import SettingGroup from "../components/ui/SettingGroup.svelte";
  import SettingRow from "../components/ui/SettingRow.svelte";
  import { session } from "../stores/session.svelte";
  import { trackUnsaved } from "../unsavedGuard";
  import {
    toolsStore,
    loadWebSearch,
    markToolSettingsDirty,
    saveToolSettings,
    secretRevealed,
    testToolSettings,
    toggleRevealSecret,
    webSearchEngineLabel
  } from "../stores/tools.svelte";

  $effect(() => {
    if (session.serviceReady && session.endpoint && session.endpoint !== toolsStore.webSearchEndpoint) {
      void loadWebSearch(session.endpoint);
    }
  });

  onDestroy(trackUnsaved(() => toolsStore.dirty.has("webSearch")));
</script>

{#if !session.serviceReady}
  <SettingGroup><EmptyState title={session.text.webSearchUnavailable} icon="magnifying-glass" /></SettingGroup>
{:else if toolsStore.webSearchLoading || !toolsStore.webSearchEdit}
  <SettingGroup><div class="settings-row"><p>{session.text.loading}</p></div></SettingGroup>
{:else}
  <SettingGroup ariaLabel={session.text.webSearch}>
    <SettingRow title={session.text.webSearchEnabled}>
      <IosSwitch checked={toolsStore.webSearchEdit.enabled} ariaLabel={session.text.webSearchEnabled} onCheckedChange={(checked) => { if (toolsStore.webSearchEdit) toolsStore.webSearchEdit = { ...toolsStore.webSearchEdit, enabled: checked }; markToolSettingsDirty("webSearch"); }} />
    </SettingRow>
    <SettingRow title={session.text.webSearchDefaultRoute}>
      <SelectControl value={toolsStore.webSearchEdit.defaultRoute} ariaLabel={session.text.webSearchDefaultRoute} options={[{ value: "auto", label: session.text.searchRouteAuto }, { value: "china", label: session.text.searchRouteChina }, { value: "global", label: session.text.searchRouteGlobal }, { value: "official_docs", label: session.text.searchRouteOfficialDocs }, { value: "research", label: session.text.searchRouteResearch }]} onChange={(value) => { toolsStore.webSearchEdit!.defaultRoute = value as typeof toolsStore.webSearchEdit.defaultRoute; markToolSettingsDirty("webSearch"); }} />
    </SettingRow>
    <SettingRow title={session.text.webSearchDefaultEngine}>
      <SelectControl value={toolsStore.webSearchEdit.defaultEngine} ariaLabel={session.text.webSearchDefaultEngine} options={[{ value: "auto", label: session.text.searchEngineAuto }, ...toolsStore.webSearchEdit.engines.map((engine) => ({ value: engine.id, label: webSearchEngineLabel(engine.id, session.text) }))]} onChange={(value) => { toolsStore.webSearchEdit!.defaultEngine = value; markToolSettingsDirty("webSearch"); }} />
    </SettingRow>
    <SettingRow title={session.text.webSearchStrategy}>
      <SelectControl value={toolsStore.webSearchEdit.engineSelectionStrategy} ariaLabel={session.text.webSearchStrategy} options={[{ value: "priority", label: session.text.searchStrategyPriority }, { value: "random", label: session.text.searchStrategyRandom }, { value: "round_robin", label: session.text.searchStrategyRoundRobin }]} onChange={(value) => { toolsStore.webSearchEdit!.engineSelectionStrategy = value as typeof toolsStore.webSearchEdit.engineSelectionStrategy; markToolSettingsDirty("webSearch"); }} />
    </SettingRow>
  </SettingGroup>

  <SettingGroup title={session.text.toolLimits}>
    <SettingRow title={session.text.webSearchMaxResults}>
      <input class="row-input model-number-input" type="number" min="1" max="20" autocomplete="off" aria-label={session.text.webSearchMaxResults} bind:value={toolsStore.webSearchEdit.maxResults} oninput={() => markToolSettingsDirty("webSearch")} />
    </SettingRow>
    <SettingRow title={session.text.toolTimeout}>
      <input class="row-input model-number-input" type="number" min="1000" max="120000" autocomplete="off" aria-label={session.text.toolTimeout} bind:value={toolsStore.webSearchEdit.timeoutMs} oninput={() => markToolSettingsDirty("webSearch")} />
    </SettingRow>
    <SettingRow title={session.text.toolRetryTimeout}>
      <input class="row-input model-number-input" type="number" min="1000" max="180000" autocomplete="off" aria-label={session.text.toolRetryTimeout} bind:value={toolsStore.webSearchEdit.retryTimeoutMs} oninput={() => markToolSettingsDirty("webSearch")} />
    </SettingRow>
  </SettingGroup>

  <SettingGroup title={session.text.webSearchEngines} contentClass="tool-engine-list">
    {#each toolsStore.webSearchEdit.engines as engine (engine.id)}
      <details class="tool-engine-card">
        <summary>
          <span>{webSearchEngineLabel(engine.id, session.text)}</span>
          <span class="status-badge" data-state={engine.enabled ? "ready" : "disconnected"}>{engine.enabled ? session.text.providerEnabled : session.text.providerDisabled}</span>
        </summary>
        <div class="tool-engine-body">
          <div class="settings-row">
            <strong>{session.text.providerEnabledLabel}</strong>
            <IosSwitch checked={engine.enabled} ariaLabel={webSearchEngineLabel(engine.id, session.text)} onCheckedChange={(checked) => { if (toolsStore.webSearchEdit) toolsStore.webSearchEdit = { ...toolsStore.webSearchEdit, engines: toolsStore.webSearchEdit.engines.map((item) => item.id === engine.id ? { ...item, enabled: checked } : item) }; markToolSettingsDirty("webSearch"); }} />
          </div>
          <div class="settings-form">
            <label class="settings-field settings-field-wide">
              <span>{session.text.toolBaseUrl}</span>
              <input bind:value={engine.baseUrl} autocomplete="off" spellcheck="false" oninput={() => markToolSettingsDirty("webSearch")} />
            </label>
            <label class="settings-field settings-field-wide">
              <span>{session.text.webSearchApiKey}</span>
              <div class="secret-input">
                <input type={secretRevealed(`webSearch:${engine.id}`) ? "text" : "password"} aria-label={session.text.webSearchApiKey} bind:value={engine.apiKey} placeholder={engine.hasApiKey ? session.text.channelSecretConfigured : ""} autocomplete="new-password" spellcheck="false" oninput={() => markToolSettingsDirty("webSearch")} />
                <button class="secret-reveal" type="button" aria-label={session.text.toggleReveal} onclick={(event) => { event.preventDefault(); toggleRevealSecret(`webSearch:${engine.id}`); }}>
                  <i class={`ph ${secretRevealed(`webSearch:${engine.id}`) ? "ph-eye-slash" : "ph-eye"}`} aria-hidden="true"></i>
                </button>
              </div>
              {#if engine.hasApiKey}
                <label class="inline-check">
                  <input type="checkbox" bind:checked={engine.clearApiKey} onchange={() => markToolSettingsDirty("webSearch")} />
                  {session.text.channelClearSecret}
                </label>
              {/if}
            </label>
          </div>
        </div>
      </details>
    {/each}
  </SettingGroup>

  <SettingGroup title={session.text.toolTest} contentClass="tool-test-card">
    <div class="settings-form">
      <label class="settings-field">
        <span>{session.text.webSearchDefaultEngine}</span>
        <SelectControl value={toolsStore.testEngine} ariaLabel={session.text.webSearchDefaultEngine} options={[{ value: "auto", label: session.text.searchEngineAuto }, ...toolsStore.webSearchEdit.engines.map((engine) => ({ value: engine.id, label: webSearchEngineLabel(engine.id, session.text) }))]} onChange={(value) => toolsStore.testEngine = value} />
      </label>
      <label class="settings-field">
        <span>{session.text.toolTestQuery}</span>
        <input bind:value={toolsStore.testQuery} autocomplete="off" />
      </label>
    </div>
    <div class="settings-row-actions tool-test-actions">
      <button class="secondary-button" type="button" disabled={toolsStore.testBusy} onclick={() => void testToolSettings("webSearch")}>{toolsStore.testBusy ? session.text.loading : session.text.toolTest}</button>
    </div>
    {#if toolsStore.testResult}
      <pre class:run-history-failed={!toolsStore.testResult.ok} class="tool-test-result">{JSON.stringify(toolsStore.testResult.result ?? toolsStore.testResult.error, null, 2)}</pre>
    {/if}
  </SettingGroup>
{/if}

{#if toolsStore.message}<p class="settings-action-message" aria-live="polite">{toolsStore.message}</p>{/if}
{#if toolsStore.dirty.has("webSearch")}
  <footer class="settings-footbar">
    <span class="settings-footbar-label">{session.text.settingsUnsaved}</span>
    <div class="settings-footbar-actions">
      <button class="primary-button" type="button" disabled={toolsStore.saving} onclick={() => void saveToolSettings("webSearch")}>{toolsStore.saving ? session.text.onboardingProviderSaving : session.text.save}</button>
    </div>
  </footer>
{/if}
