<script lang="ts">
  import { session } from "../stores/session.svelte";
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
</script>

<p class="settings-section-hint">{session.text.webSearchHint}</p>
{#if !session.serviceReady}
  <div class="settings-card"><div class="settings-row"><p>{session.text.webSearchUnavailable}</p></div></div>
{:else if toolsStore.webSearchLoading || !toolsStore.webSearchEdit}
  <div class="settings-card"><div class="settings-row"><p>{session.text.loading}</p></div></div>
{:else}
  <div class="settings-card">
    <div class="settings-row"><div><strong>{session.text.webSearchEnabled}</strong></div><button class:active={toolsStore.webSearchEdit.enabled} class="switch" type="button" role="switch" aria-checked={toolsStore.webSearchEdit.enabled} aria-label={session.text.webSearchEnabled} onclick={() => { if (toolsStore.webSearchEdit) toolsStore.webSearchEdit = { ...toolsStore.webSearchEdit, enabled: !toolsStore.webSearchEdit.enabled }; markToolSettingsDirty("webSearch"); }}><span></span></button></div>
    <div class="settings-row"><strong>{session.text.webSearchDefaultRoute}</strong><select bind:value={toolsStore.webSearchEdit.defaultRoute} onchange={() => markToolSettingsDirty("webSearch")}><option value="auto">{session.text.searchRouteAuto}</option><option value="china">{session.text.searchRouteChina}</option><option value="global">{session.text.searchRouteGlobal}</option><option value="official_docs">{session.text.searchRouteOfficialDocs}</option><option value="research">{session.text.searchRouteResearch}</option></select></div>
    <div class="settings-row"><strong>{session.text.webSearchDefaultEngine}</strong><select bind:value={toolsStore.webSearchEdit.defaultEngine} onchange={() => markToolSettingsDirty("webSearch")}><option value="auto">{session.text.searchEngineAuto}</option>{#each toolsStore.webSearchEdit.engines as engine (engine.id)}<option value={engine.id}>{webSearchEngineLabel(engine.id, session.text)}</option>{/each}</select></div>
    <div class="settings-row"><strong>{session.text.webSearchStrategy}</strong><select bind:value={toolsStore.webSearchEdit.engineSelectionStrategy} onchange={() => markToolSettingsDirty("webSearch")}><option value="priority">{session.text.searchStrategyPriority}</option><option value="random">{session.text.searchStrategyRandom}</option><option value="round_robin">{session.text.searchStrategyRoundRobin}</option></select></div>
  </div>
  <p class="settings-group-title">{session.text.toolLimits}</p>
  <div class="settings-card"><label class="settings-row"><strong>{session.text.webSearchMaxResults}</strong><input class="row-input model-number-input" type="number" min="1" max="20" bind:value={toolsStore.webSearchEdit.maxResults} oninput={() => markToolSettingsDirty("webSearch")} /></label><label class="settings-row"><strong>{session.text.toolTimeout}</strong><input class="row-input model-number-input" type="number" min="1000" max="120000" bind:value={toolsStore.webSearchEdit.timeoutMs} oninput={() => markToolSettingsDirty("webSearch")} /></label><label class="settings-row"><strong>{session.text.toolRetryTimeout}</strong><input class="row-input model-number-input" type="number" min="1000" max="180000" bind:value={toolsStore.webSearchEdit.retryTimeoutMs} oninput={() => markToolSettingsDirty("webSearch")} /></label></div>
  <p class="settings-group-title">{session.text.webSearchEngines}</p>
  <div class="settings-card tool-engine-list">{#each toolsStore.webSearchEdit.engines as engine (engine.id)}<details class="tool-engine-card"><summary><span>{webSearchEngineLabel(engine.id, session.text)}</span><span class="status-badge" data-state={engine.enabled ? "ready" : "disconnected"}>{engine.enabled ? session.text.providerEnabled : session.text.providerDisabled}</span></summary><div class="tool-engine-body"><div class="settings-row"><strong>{session.text.providerEnabledLabel}</strong><button class:active={engine.enabled} class="switch" type="button" role="switch" aria-checked={engine.enabled} aria-label={webSearchEngineLabel(engine.id, session.text)} onclick={() => { if (toolsStore.webSearchEdit) toolsStore.webSearchEdit = { ...toolsStore.webSearchEdit, engines: toolsStore.webSearchEdit.engines.map((item) => item.id === engine.id ? { ...item, enabled: !item.enabled } : item) }; markToolSettingsDirty("webSearch"); }}><span></span></button></div><div class="settings-form"><label class="settings-field settings-field-wide"><span>{session.text.toolBaseUrl}</span><input bind:value={engine.baseUrl} oninput={() => markToolSettingsDirty("webSearch")} /></label><label class="settings-field settings-field-wide"><span>{session.text.webSearchApiKey}</span><div class="secret-input"><input type={secretRevealed(`webSearch:${engine.id}`) ? "text" : "password"} bind:value={engine.apiKey} placeholder={engine.hasApiKey ? session.text.channelSecretConfigured : ""} autocomplete="new-password" oninput={() => markToolSettingsDirty("webSearch")} /><button class="secret-reveal" type="button" aria-label={session.text.toggleReveal} onclick={(event) => { event.preventDefault(); toggleRevealSecret(`webSearch:${engine.id}`); }}><i class={`ph ${secretRevealed(`webSearch:${engine.id}`) ? "ph-eye-slash" : "ph-eye"}`}></i></button></div>{#if engine.hasApiKey}<label class="inline-check"><input type="checkbox" bind:checked={engine.clearApiKey} onchange={() => markToolSettingsDirty("webSearch")} /> {session.text.channelClearSecret}</label>{/if}</label></div></div></details>{/each}</div>
  <p class="settings-group-title">{session.text.toolTest}</p><div class="settings-card tool-test-card"><div class="settings-form"><label class="settings-field"><span>{session.text.webSearchDefaultEngine}</span><select bind:value={toolsStore.testEngine}><option value="auto">{session.text.searchEngineAuto}</option>{#each toolsStore.webSearchEdit.engines as engine (engine.id)}<option value={engine.id}>{webSearchEngineLabel(engine.id, session.text)}</option>{/each}</select></label><label class="settings-field"><span>{session.text.toolTestQuery}</span><input bind:value={toolsStore.testQuery} /></label></div><div class="settings-row-actions tool-test-actions"><button class="secondary-button" type="button" disabled={toolsStore.testBusy} onclick={() => void testToolSettings("webSearch")}>{toolsStore.testBusy ? session.text.loading : session.text.toolTest}</button></div>{#if toolsStore.testResult}<pre class:run-history-failed={!toolsStore.testResult.ok} class="tool-test-result">{JSON.stringify(toolsStore.testResult.result ?? toolsStore.testResult.error, null, 2)}</pre>{/if}</div>
{/if}

{#if toolsStore.message}<p class="settings-action-message">{toolsStore.message}</p>{/if}
{#if toolsStore.dirty.has("webSearch")}
  <footer class="settings-footbar">
    <span class="settings-footbar-label">{session.text.settingsUnsaved}</span>
    <div class="settings-footbar-actions">
      <button class="primary-button" type="button" disabled={toolsStore.saving} onclick={() => void saveToolSettings("webSearch")}>{toolsStore.saving ? session.text.onboardingProviderSaving : session.text.save}</button>
    </div>
  </footer>
{/if}
