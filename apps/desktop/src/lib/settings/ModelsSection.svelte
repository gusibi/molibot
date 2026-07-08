<script lang="ts">
  import type { DesktopModelRoute } from "../api";
  import type { DesktopModelRoutingSettings } from "@molibot/desktop-contract";
  import { session } from "../stores/session.svelte";
  import { timezoneOptions } from "./timezones";
  import { PROVIDERS_CHANGED_EVENT } from "../stores/providers.svelte";
  import {
    modelsStore,
    MODEL_ROUTES,
    changeModel,
    compactionTriggerPreview,
    discardModelRouting,
    loadModels,
    routeLabel,
    saveAdvancedModelRouting,
    updateAdvancedModelRouting
  } from "../stores/models.svelte";

  $effect(() => {
    if (session.serviceReady && session.endpoint && session.endpoint !== modelsStore.loadedEndpoint) {
      void loadModels(session.endpoint);
    }
  });

  $effect(() => {
    const refreshAfterProviderChange = () => {
      if (session.serviceReady && session.endpoint) void loadModels(session.endpoint);
    };
    window.addEventListener(PROVIDERS_CHANGED_EVENT, refreshAfterProviderChange);
    return () => window.removeEventListener(PROVIDERS_CHANGED_EVENT, refreshAfterProviderChange);
  });
</script>

<p class="settings-section-hint">{session.text.modelsHint}</p>
{#if !session.serviceReady}
  <div class="settings-card"><div class="settings-row"><p>{session.text.modelsUnavailable}</p></div></div>
{:else}
  <div class="settings-card">
    {#each MODEL_ROUTES as route (route)}
      <div class="settings-row">
        <div>
          <strong>{routeLabel(route, session.text)}</strong>
        </div>
        <select
          value={modelsStore.modelStates[route]?.currentKey ?? ""}
          disabled={modelsStore.loading || modelsStore.switchingRoute !== null || !modelsStore.modelStates[route]}
          onchange={(event) => changeModel(route, event)}
        >
          {#each modelsStore.modelStates[route]?.options ?? [] as option (option.key)}
            <option value={option.key}>{option.label}</option>
          {/each}
        </select>
      </div>
    {/each}
  </div>
  {#if modelsStore.routing}
    <p class="settings-group-title">{session.text.modelSubagentLevels}</p>
    <div class="settings-card">
      {#each [
        { key: "subagentHaikuModelKey", label: session.text.modelLevelHaiku },
        { key: "subagentSonnetModelKey", label: session.text.modelLevelSonnet },
        { key: "subagentOpusModelKey", label: session.text.modelLevelOpus },
        { key: "subagentThinkingModelKey", label: session.text.modelLevelThinking }
      ] as level (level.key)}
        <div class="settings-row">
          <div><strong>{level.label}</strong></div>
          <select value={modelsStore.routing[level.key as keyof DesktopModelRoutingSettings] as string} onchange={(event) => updateAdvancedModelRouting((draft) => ({ ...draft, [level.key]: event.currentTarget.value }))}>
            <option value="">{session.text.modelUseSubagentFallback}</option>
            {#each modelsStore.routing.textOptions as option (option.key)}<option value={option.key}>{option.label}</option>{/each}
          </select>
        </div>
      {/each}
    </div>

    <p class="settings-group-title">{session.text.modelRuntimeDefaults}</p>
    <div class="settings-card">
      <div class="settings-row">
        <div><strong>{session.text.modelFallbackPolicy}</strong><p>{session.text.modelFallbackHint}</p></div>
        <select value={modelsStore.routing.modelFallback.mode} onchange={(event) => updateAdvancedModelRouting((draft) => ({ ...draft, modelFallback: { ...draft.modelFallback, mode: event.currentTarget.value as DesktopModelRoutingSettings["modelFallback"]["mode"] } }))}>
          <option value="off">{session.text.modelFallbackOff}</option><option value="same-provider">{session.text.modelFallbackSame}</option><option value="any-enabled">{session.text.modelFallbackAny}</option>
        </select>
      </div>
      <label class="settings-row"><div><strong>{session.text.modelFirstTokenTimeout}</strong><p>{session.text.modelFirstTokenTimeoutHint}</p></div><input class="row-input model-number-input" type="number" min="0" step="1000" value={modelsStore.routing.modelFallback.firstTokenTimeoutMs} oninput={(event) => updateAdvancedModelRouting((draft) => ({ ...draft, modelFallback: { ...draft.modelFallback, firstTokenTimeoutMs: Number(event.currentTarget.value) } }))} /></label>
      <div class="settings-row">
        <div><strong>{session.text.modelDefaultThinking}</strong></div>
        <select value={modelsStore.routing.defaultThinkingLevel} onchange={(event) => updateAdvancedModelRouting((draft) => ({ ...draft, defaultThinkingLevel: event.currentTarget.value as DesktopModelRoutingSettings["defaultThinkingLevel"] }))}>
          <option value="off">{session.text.thinkingOff}</option><option value="low">{session.text.thinkingLow}</option><option value="medium">{session.text.thinkingMedium}</option><option value="high">{session.text.thinkingHigh}</option>
        </select>
      </div>
    </div>

    <p class="settings-group-title">{session.text.modelCompaction}</p>
    <div class="settings-card provider-editor">
      <div class="settings-row"><div><strong>{session.text.modelCompactionEnabled}</strong><p>{session.text.modelCompactionEnabledHint}</p></div><button class:active={modelsStore.routing.compaction.enabled} class="switch" type="button" role="switch" aria-label={session.text.modelCompactionEnabled} aria-checked={modelsStore.routing.compaction.enabled} onclick={() => updateAdvancedModelRouting((draft) => ({ ...draft, compaction: { ...draft.compaction, enabled: !draft.compaction.enabled } }))}><span></span></button></div>
      <div class="settings-row"><div><strong>{session.text.modelCompactionModel}</strong></div><select value={modelsStore.routing.compactionModelKey} onchange={(event) => updateAdvancedModelRouting((draft) => ({ ...draft, compactionModelKey: event.currentTarget.value }))}><option value="">{session.text.modelUseTextRoute}</option>{#each modelsStore.routing.textOptions as option (option.key)}<option value={option.key}>{option.label}</option>{/each}</select></div>
      <div class="settings-form model-routing-number-grid">
        {#each [
          { key: "defaultContextWindow", label: session.text.modelDefaultContext, min: 1024, step: 1000 },
          { key: "thresholdPercent", label: session.text.modelCompactionThreshold, min: 10, step: 5 },
          { key: "reserveTokens", label: session.text.modelReserveTokens, min: 1024, step: 256 },
          { key: "keepRecentTokens", label: session.text.modelKeepRecentTokens, min: 2048, step: 512 }
        ] as field (field.key)}
          <label class="settings-field"><span>{field.label}</span><input type="number" min={field.min} step={field.step} value={modelsStore.routing.compaction[field.key as keyof typeof modelsStore.routing.compaction]} oninput={(event) => updateAdvancedModelRouting((draft) => ({ ...draft, compaction: { ...draft.compaction, [field.key]: Number(event.currentTarget.value) } }))} /></label>
        {/each}
      </div>
      <div class="routing-preview-callout">
        <strong>{session.text.modelCompactionPreview}</strong> — {session.text.modelCompactionPreviewWindow} <strong>{(compactionTriggerPreview().window / 1000)}K</strong>，{session.text.modelCompactionFires} <strong>{(compactionTriggerPreview().trigger / 1000).toFixed(compactionTriggerPreview().trigger % 1000 !== 0 ? 1 : 0)}K</strong>（{compactionTriggerPreview().reason}）
        <span class="routing-preview-note">{compactionTriggerPreview().fromModel ? session.text.modelCompactionWindowFromMetadata : session.text.modelCompactionWindowFromDefault}</span>
      </div>
    </div>

    <p class="settings-group-title">{session.text.modelRuntimeEnvironment}</p>
    <div class="settings-card"><label class="settings-row"><div><strong>{session.text.modelTimezone}</strong><p>{session.text.modelTimezoneHint}</p></div><select class="row-input model-timezone-input" value={modelsStore.routing.timezone} onchange={(event) => updateAdvancedModelRouting((draft) => ({ ...draft, timezone: (event.currentTarget as HTMLSelectElement).value }))}>{#if modelsStore.routing.timezone && !timezoneOptions().includes(modelsStore.routing.timezone)}<option value={modelsStore.routing.timezone}>{modelsStore.routing.timezone}</option>{/if}{#each timezoneOptions() as tz (tz)}<option value={tz}>{tz}</option>{/each}</select></label></div>
    {#if modelsStore.routingMessage}<p class="settings-action-message">{modelsStore.routingMessage}</p>{/if}
  {/if}
{/if}

{#if modelsStore.routingDirty}
  <footer class="settings-footbar">
    <span class="settings-footbar-label">{session.text.settingsUnsaved}</span>
    <div class="settings-footbar-actions">
      <button class="secondary-button" type="button" disabled={modelsStore.routingSaving} onclick={discardModelRouting}>{session.text.discardChanges}</button>
      <button class="primary-button" type="button" disabled={modelsStore.routingSaving} onclick={() => void saveAdvancedModelRouting()}>{modelsStore.routingSaving ? session.text.onboardingProviderSaving : session.text.save}</button>
    </div>
  </footer>
{/if}
