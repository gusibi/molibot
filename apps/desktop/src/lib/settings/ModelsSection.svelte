<script lang="ts">
  import type { DesktopModelOption, DesktopModelRoutingSettings } from "@molibot/desktop-contract";
  import EmptyState from "../components/ui/EmptyState.svelte";
  import SelectControl from "../components/ui/SelectControl.svelte";
  import SettingGroup from "../components/ui/SettingGroup.svelte";
  import SettingRow from "../components/ui/SettingRow.svelte";
  import SkeletonRows from "../components/ui/SkeletonRows.svelte";
  import { humanizeModelOption } from "../presentation";
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
    routeDescription,
    saveAdvancedModelRouting,
    updateAdvancedModelRouting
  } from "../stores/models.svelte";

  let advancedOpen = $state(false);

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

  function displayOption(option: DesktopModelOption): { value: string; label: string } {
    return { value: option.key, label: humanizeModelOption(option.label, option.key).label };
  }

  function modelOptions(options: DesktopModelOption[], emptyLabel?: string): Array<{ value: string; label: string }> {
    return [
      ...(emptyLabel ? [{ value: "", label: emptyLabel }] : []),
      ...options.map(displayOption)
    ];
  }
</script>

{#if !session.serviceReady}
  <SettingGroup><EmptyState icon="cpu" title={session.text.modelsUnavailable} /></SettingGroup>
{:else if modelsStore.loading || MODEL_ROUTES.some((route) => !modelsStore.modelStates[route])}
  <SettingGroup><SkeletonRows count={4} label={session.text.loading} /></SettingGroup>
{:else}
  <SettingGroup ariaLabel={session.text.models}>
    {#each MODEL_ROUTES as route (route)}
      {@const state = modelsStore.modelStates[route]!}
      <SettingRow title={routeLabel(route, session.text)} description={routeDescription(route, session.text)}>
        <SelectControl
          value={state.currentKey}
          ariaLabel={routeLabel(route, session.text)}
          disabled={modelsStore.switchingRoute !== null}
          options={modelOptions(state.options, state.currentKey ? undefined : session.text.modelUnconfigured)}
          technicalId={state.currentKey}
          technicalLabel={session.text.technicalDetails}
          onChange={(value) => void changeModel(route, value)}
        />
      </SettingRow>
    {/each}
  </SettingGroup>

  {#if modelsStore.routing}
    <div class="settings-disclosure">
      <button class="secondary-button disclosure-button" type="button" aria-expanded={advancedOpen} onclick={() => (advancedOpen = !advancedOpen)}>
        <i class="ph ph-sliders-horizontal" aria-hidden="true"></i>
        {advancedOpen ? session.text.modelAdvancedHide : session.text.modelAdvancedShow}
      </button>
    </div>

    {#if advancedOpen}
      <SettingGroup title={session.text.modelSubagentLevels}>
        {#each [
          { key: "subagentHaikuModelKey", label: session.text.modelLevelHaiku },
          { key: "subagentSonnetModelKey", label: session.text.modelLevelSonnet },
          { key: "subagentOpusModelKey", label: session.text.modelLevelOpus },
          { key: "subagentThinkingModelKey", label: session.text.modelLevelThinking }
        ] as level (level.key)}
          <SettingRow title={level.label}>
            <SelectControl
              value={modelsStore.routing[level.key as keyof DesktopModelRoutingSettings] as string}
              ariaLabel={level.label}
              options={modelOptions(modelsStore.routing.textOptions, session.text.modelUseSubagentFallback)}
              technicalId={modelsStore.routing[level.key as keyof DesktopModelRoutingSettings] as string}
              technicalLabel={session.text.technicalDetails}
              onChange={(value) => updateAdvancedModelRouting((draft) => ({ ...draft, [level.key]: value }))}
            />
          </SettingRow>
        {/each}
      </SettingGroup>

      <SettingGroup title={session.text.modelRuntimeDefaults}>
        <SettingRow title={session.text.modelFallbackPolicy} description={session.text.modelFallbackHint}>
          <SelectControl
            value={modelsStore.routing.modelFallback.mode}
            ariaLabel={session.text.modelFallbackPolicy}
            options={[{ value: "off", label: session.text.modelFallbackOff }, { value: "same-provider", label: session.text.modelFallbackSame }, { value: "any-enabled", label: session.text.modelFallbackAny }]}
            onChange={(value) => updateAdvancedModelRouting((draft) => ({ ...draft, modelFallback: { ...draft.modelFallback, mode: value as DesktopModelRoutingSettings["modelFallback"]["mode"] } }))}
          />
        </SettingRow>
        <SettingRow title={session.text.modelFirstTokenTimeout} description={session.text.modelFirstTokenTimeoutHint}>
          <input class="row-input model-number-input" type="number" min="0" step="1000" value={modelsStore.routing.modelFallback.firstTokenTimeoutMs} oninput={(event) => updateAdvancedModelRouting((draft) => ({ ...draft, modelFallback: { ...draft.modelFallback, firstTokenTimeoutMs: Number(event.currentTarget.value) } }))} />
        </SettingRow>
        <SettingRow title={session.text.modelDefaultThinking}>
          <SelectControl
            value={modelsStore.routing.defaultThinkingLevel}
            ariaLabel={session.text.modelDefaultThinking}
            options={[{ value: "off", label: session.text.thinkingOff }, { value: "low", label: session.text.thinkingLow }, { value: "medium", label: session.text.thinkingMedium }, { value: "high", label: session.text.thinkingHigh }]}
            onChange={(value) => updateAdvancedModelRouting((draft) => ({ ...draft, defaultThinkingLevel: value as DesktopModelRoutingSettings["defaultThinkingLevel"] }))}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title={session.text.modelCompaction} contentClass="provider-editor">
        <SettingRow title={session.text.modelCompactionEnabled} description={session.text.modelCompactionEnabledHint}>
          <button class:active={modelsStore.routing.compaction.enabled} class="switch" type="button" role="switch" aria-label={session.text.modelCompactionEnabled} aria-checked={modelsStore.routing.compaction.enabled} onclick={() => updateAdvancedModelRouting((draft) => ({ ...draft, compaction: { ...draft.compaction, enabled: !draft.compaction.enabled } }))}><span></span></button>
        </SettingRow>
        <SettingRow title={session.text.modelCompactionModel}>
          <SelectControl
            value={modelsStore.routing.compactionModelKey}
            ariaLabel={session.text.modelCompactionModel}
            options={modelOptions(modelsStore.routing.textOptions, session.text.modelUseTextRoute)}
            technicalId={modelsStore.routing.compactionModelKey}
            technicalLabel={session.text.technicalDetails}
            onChange={(value) => updateAdvancedModelRouting((draft) => ({ ...draft, compactionModelKey: value }))}
          />
        </SettingRow>
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
      </SettingGroup>

      <SettingGroup title={session.text.modelRuntimeEnvironment}>
        <SettingRow title={session.text.modelTimezone} description={session.text.modelTimezoneHint}>
          <SelectControl
            value={modelsStore.routing.timezone}
            ariaLabel={session.text.modelTimezone}
            options={(modelsStore.routing.timezone && !timezoneOptions().includes(modelsStore.routing.timezone) ? [modelsStore.routing.timezone, ...timezoneOptions()] : timezoneOptions()).map((timezone) => ({ value: timezone, label: timezone }))}
            onChange={(value) => updateAdvancedModelRouting((draft) => ({ ...draft, timezone: value }))}
          />
        </SettingRow>
      </SettingGroup>
    {/if}
    {#if modelsStore.routingMessage}<p class="settings-action-message" role="status">{modelsStore.routingMessage}</p>{/if}
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
