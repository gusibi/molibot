<script lang="ts">
  import SelectControl from "../components/ui/SelectControl.svelte";
  import type { DesktopSandboxPreset } from "../api";
  import IosSwitch from "../components/ui/IosSwitch.svelte";
  import { session } from "../stores/session.svelte";
  import {
    sandboxStore,
    applySandboxPreset,
    detectSandboxPreset,
    loadSandbox,
    refreshSandboxDiagnostics,
    resetSandboxEditor,
    saveSandboxPolicy,
    updateSandboxEdit,
    type SandboxEditor
  } from "../stores/sandbox.svelte";

  // Load whenever this section is mounted (i.e. active) and the endpoint changed.
  $effect(() => {
    if (session.serviceReady && session.endpoint && session.endpoint !== sandboxStore.endpoint) {
      void loadSandbox(session.endpoint);
    }
  });

  const activeSandboxPreset = $derived(sandboxStore.sandboxEdit ? detectSandboxPreset(sandboxStore.sandboxEdit) : "custom");
  const sandboxDirty = $derived(sandboxStore.sandboxEdit !== null && JSON.stringify(sandboxStore.sandboxEdit) !== sandboxStore.pristine);

  // Strictest → most permissive, mirrored from the web settings page.
  const SLIDER_LEVELS = $derived([
    {
      id: "locked",
      title: session.text.sandboxPresetLocked,
      hint: session.text.sandboxPresetLockedHint,
      badge: session.text.sandboxPresetLockedBadge,
      network: session.text.sandboxPresetNetOffline,
      filesystem: session.text.sandboxPresetFsTemp,
      env: session.text.sandboxPresetEnvMinimal
    },
    {
      id: "readonly",
      title: session.text.sandboxPresetReadonly,
      hint: session.text.sandboxPresetReadonlyHint,
      badge: session.text.sandboxPresetReadonlyBadge,
      network: session.text.sandboxPresetNetAll,
      filesystem: session.text.sandboxPresetFsReadonly,
      env: session.text.sandboxPresetEnvMinimal
    },
    {
      id: "standard",
      title: session.text.sandboxPresetStandard,
      hint: session.text.sandboxPresetStandardHint,
      badge: session.text.sandboxPresetStandardBadge,
      network: session.text.sandboxPresetNetDev,
      filesystem: session.text.sandboxPresetFsWorkspace,
      env: session.text.sandboxPresetEnvAllowlist
    },
    {
      id: "full",
      title: session.text.sandboxPresetFull,
      hint: session.text.sandboxPresetFullHint,
      badge: session.text.sandboxPresetFullBadge,
      network: session.text.sandboxPresetNetAll,
      filesystem: session.text.sandboxPresetFsWorkspace,
      env: session.text.sandboxPresetEnvMinimal
    }
  ] as const);
  const sliderIndex = $derived(SLIDER_LEVELS.findIndex((level) => level.id === activeSandboxPreset));
  const isCustom = $derived(sliderIndex === -1);

  function applyLevelByIndex(index: number): void {
    const level = SLIDER_LEVELS[index];
    if (level) applySandboxPreset(level.id as DesktopSandboxPreset);
  }
</script>

{#if !session.serviceReady}
  <div class="settings-card"><div class="settings-row"><p>{session.text.sandboxUnavailable}</p></div></div>
{:else if sandboxStore.loading || !sandboxStore.sandbox || !sandboxStore.sandboxEdit}
  <div class="settings-card"><div class="settings-row"><p>{session.text.loading}</p></div></div>
{:else}
  <form id="desktop-sandbox-form" class="sandbox-form" onsubmit={(event) => { event.preventDefault(); void saveSandboxPolicy(); }}>
  <div class="channel-section-head sandbox-section-head">
    <div>
      <p class="settings-group-title">{session.text.sandboxPresets}</p>
      <p class="settings-section-hint">{session.text.sandboxPresetsHint}</p>
    </div>
    {#if isCustom}
      <span class="status-badge" data-state="disconnected">{session.text.sandboxPresetCustom}</span>
    {/if}
  </div>

  <div class="sandbox-presets-panel" data-level={isCustom ? "custom" : SLIDER_LEVELS[sliderIndex].id}>
    <!-- 4-Card Preset Selection Matrix -->
    <div class="sandbox-tier-cards" role="radiogroup" aria-label={session.text.sandboxPresets}>
      {#each SLIDER_LEVELS as level, index (level.id)}
        {@const selected = !isCustom && sliderIndex === index}
        <button
          type="button"
          role="radio"
          aria-checked={selected}
          class="sandbox-tier-card"
          class:active={selected}
          data-tier={level.id}
          onclick={() => applyLevelByIndex(index)}
        >
          <div class="sandbox-tier-card-header">
            <div class="sandbox-tier-icon-wrap" data-tier={level.id}>
              {#if level.id === "locked"}
                <svg class="sandbox-tier-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M10 2.5L3.5 5.5v5c0 5 3.5 8 6.5 9 3-1 6.5-4 6.5-9v-5L10 2.5z"/>
                  <path d="M8 10l1.5 1.5L13 8"/>
                </svg>
              {:else if level.id === "readonly"}
                <svg class="sandbox-tier-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="10" cy="10" r="7.5"/>
                  <path d="M2.5 10h15M10 2.5a11 11 0 0 1 0 15M10 2.5a11 11 0 0 0 0 15"/>
                </svg>
              {:else if level.id === "standard"}
                <svg class="sandbox-tier-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M13 3l4 4-10 10H3v-4L13 3zM11 5l4 4"/>
                </svg>
              {:else}
                <svg class="sandbox-tier-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3.5" y="8.5" width="13" height="9" rx="2"/>
                  <path d="M7 8.5V5.5a3 3 0 0 1 6 0v1.5"/>
                </svg>
              {/if}
            </div>
            <div class="sandbox-tier-title-group">
              <span class="sandbox-tier-title">{level.title}</span>
              <span class="sandbox-tier-badge" data-tier={level.id}>{level.badge}</span>
            </div>
            {#if selected}
              <div class="sandbox-tier-check-mark" aria-hidden="true">
                <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M3 7.2l2.8 2.8L11 4"/>
                </svg>
              </div>
            {/if}
          </div>

          <p class="sandbox-tier-desc">{level.hint}</p>

          <div class="sandbox-tier-tags">
            <span class="sandbox-tier-tag" title={session.text.sandboxNetwork}>
              <svg class="sandbox-pill-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                <circle cx="8" cy="8" r="6"/>
                <path d="M2 8h12M8 2a9 9 0 0 1 0 12M8 2a9 9 0 0 0 0 12"/>
              </svg>
              {level.network}
            </span>
            <span class="sandbox-tier-tag" title={session.text.sandboxFilesystem}>
              <svg class="sandbox-pill-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M2.5 4.5h3l1.5 2h6.5v6.5h-11z"/>
              </svg>
              {level.filesystem}
            </span>
            <span class="sandbox-tier-tag" title={session.text.sandboxEnvironment}>
              <svg class="sandbox-pill-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="2.5" y="3.5" width="11" height="9" rx="1.5"/>
                <path d="M5.5 7l2 2-2 2M9.5 11h2"/>
              </svg>
              {level.env}
            </span>
          </div>
        </button>
      {/each}
    </div>

    <!-- Integrated Spectrum Track Bar -->
    <div class="sandbox-slider" data-level={isCustom ? "custom" : SLIDER_LEVELS[sliderIndex].id}>
      <div class="sandbox-spectrum-meta">
        <span class="sandbox-spectrum-bound">
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M7 1.5L2 3.8v3.5c0 3.5 2.5 5.7 5 6.4 2.5-.7 5-2.9 5-6.4V3.8L7 1.5z"/>
          </svg>
          {session.text.sandboxPresetStrictest}
        </span>
        <span class="sandbox-spectrum-status">
          {#if isCustom}
            <span class="status-badge" data-state="disconnected">{session.text.sandboxPresetCustom}</span>
          {:else}
            <span class="sandbox-slider-badge">{SLIDER_LEVELS[sliderIndex].title} · {SLIDER_LEVELS[sliderIndex].badge}</span>
          {/if}
        </span>
        <span class="sandbox-spectrum-bound">
          {session.text.sandboxPresetPermissive}
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M7.5 1.5l-5 6h4.5l-1 5 6-7h-4.5l1-4z"/>
          </svg>
        </span>
      </div>

      <div class="sandbox-slider-track-wrap">
        <div class="sandbox-slider-track" aria-hidden="true"></div>
        <div
          class="sandbox-slider-fill"
          style="width: {isCustom ? '0%' : `${(sliderIndex / (SLIDER_LEVELS.length - 1)) * 100}%`}"
          aria-hidden="true"
        ></div>
        <input
          class="sandbox-slider-input"
          type="range"
          min="0"
          max={SLIDER_LEVELS.length - 1}
          step="1"
          value={isCustom ? 0 : sliderIndex}
          aria-label={session.text.sandboxPresets}
          oninput={(event) => applyLevelByIndex(Number(event.currentTarget.value))}
        />
        {#each SLIDER_LEVELS as level, index (level.id)}
          <button
            class="sandbox-slider-stop"
            class:active={!isCustom && sliderIndex === index}
            style="left: {(index / (SLIDER_LEVELS.length - 1)) * 100}%"
            type="button"
            aria-label={level.title}
            aria-pressed={!isCustom && sliderIndex === index}
            onclick={() => applyLevelByIndex(index)}
          ></button>
        {/each}
      </div>
    </div>

    <!-- Custom Policy Notice when fine-tuning details below -->
    {#if isCustom}
      <div class="sandbox-custom-callout">
        <div class="sandbox-custom-callout-icon">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M2.5 13.5l11-11M9 2.5h4.5v4.5M10.5 9.5l3 3M2.5 5.5l3 3"/>
          </svg>
        </div>
        <div class="sandbox-custom-callout-text">
          <strong>{session.text.sandboxPresetCustom}</strong>
          <p>{session.text.sandboxCustomInEffect}</p>
        </div>
        <button
          type="button"
          class="secondary-button sandbox-custom-reset-btn"
          onclick={() => applySandboxPreset("standard")}
        >
          {session.text.sandboxResetToStandard}
        </button>
      </div>
    {/if}
  </div>

  <p class="settings-group-title">{session.text.sandboxRuntime}</p>
  <div class="settings-card provider-editor">
    <div class="settings-row">
      <div>
        <strong>{session.text.sandboxEnabled}</strong>
        <p>{session.text.sandboxEnabledDesc}</p>
      </div>
      <IosSwitch
        checked={sandboxStore.sandboxEdit.enabled}
        ariaLabel={session.text.sandboxEnabled}
        onCheckedChange={(checked) => updateSandboxEdit((draft) => ({ ...draft, enabled: checked }))}
      />
    </div>
    <label class="settings-row"><div><strong>{session.text.sandboxInitFailure}</strong><p>{session.text.sandboxInitFailureHint}</p></div><SelectControl value={sandboxStore.sandboxEdit.initFailureMode} ariaLabel={session.text.sandboxInitFailure} options={[{ value: "block", label: session.text.sandboxInitBlock }]} onChange={(value) => updateSandboxEdit((draft) => ({ ...draft, initFailureMode: value as SandboxEditor["initFailureMode"] }))} /></label>
    <label class="settings-row"><div><strong>{session.text.sandboxEnvInherit}</strong><p>{session.text.sandboxEnvInheritHint}</p></div><SelectControl value={sandboxStore.sandboxEdit.envInheritMode} ariaLabel={session.text.sandboxEnvInherit} options={[{ value: "minimal", label: session.text.sandboxEnvMinimal }, { value: "allowlist", label: session.text.sandboxEnvAllowlist }, { value: "full", label: session.text.sandboxEnvFull }]} onChange={(value) => updateSandboxEdit((draft) => ({ ...draft, envInheritMode: value as SandboxEditor["envInheritMode"] }))} /></label>
  </div>

  <p class="settings-group-title">{session.text.sandboxEnvironment}</p>
  <div class="settings-card provider-editor">
    <div class="settings-form sandbox-policy-form">
      <label class="settings-field settings-field-wide"><span>{session.text.sandboxEnvFile}</span><input value={sandboxStore.sandboxEdit.envFilePath} placeholder=".env" oninput={(event) => updateSandboxEdit((draft) => ({ ...draft, envFilePath: event.currentTarget.value }))} /><small>{sandboxStore.sandboxEdit.preserveExternalEnvFilePath && !sandboxStore.sandboxEdit.envFilePath ? session.text.sandboxEnvPathExternal : session.text.sandboxEnvPathHint}</small></label>
      <label class="settings-field"><span>{session.text.sandboxEnvAllow}</span><textarea rows="6" value={sandboxStore.sandboxEdit.envAllowText} placeholder={'OPENAI_API_KEY\nTAVILY_API_KEY'} oninput={(event) => updateSandboxEdit((draft) => ({ ...draft, envAllowText: event.currentTarget.value }))}></textarea></label>
      <label class="settings-field"><span>{session.text.sandboxEnvDeny}</span><textarea rows="6" value={sandboxStore.sandboxEdit.envDenyText} placeholder={'TELEGRAM_BOT_TOKEN\nMOLIBOT_*'} oninput={(event) => updateSandboxEdit((draft) => ({ ...draft, envDenyText: event.currentTarget.value }))}></textarea></label>
    </div>
  </div>

  <div class="sandbox-policy-grid sandbox-policy-stack">
    <div class="settings-card provider-editor">
      <div class="provider-editor-toolbar"><div><strong>{session.text.sandboxNetwork}</strong><p>{session.text.sandboxNetworkHint}</p></div></div>
      <div class="settings-form sandbox-policy-form single-column">
        <label class="settings-field"><span>{session.text.sandboxNetworkAllow}</span><textarea rows="8" value={sandboxStore.sandboxEdit.networkAllowText} oninput={(event) => updateSandboxEdit((draft) => ({ ...draft, networkAllowText: event.currentTarget.value }))}></textarea></label>
        <label class="settings-field"><span>{session.text.sandboxNetworkDeny}</span><textarea rows="4" value={sandboxStore.sandboxEdit.networkDenyText} oninput={(event) => updateSandboxEdit((draft) => ({ ...draft, networkDenyText: event.currentTarget.value }))}></textarea></label>
      </div>
    </div>
    <div class="settings-card provider-editor">
      <div class="provider-editor-toolbar"><div><strong>{session.text.sandboxFilesystem}</strong><p>{session.text.sandboxFilesystemHint}</p></div></div>
      <div class="settings-form sandbox-policy-form single-column">
        <label class="settings-field"><span>{session.text.sandboxFilesystemAllowWrite}</span><textarea rows="4" value={sandboxStore.sandboxEdit.allowWriteText} oninput={(event) => updateSandboxEdit((draft) => ({ ...draft, allowWriteText: event.currentTarget.value }))}></textarea></label>
        <label class="settings-field"><span>{session.text.sandboxFilesystemDenyRead}</span><textarea rows="4" value={sandboxStore.sandboxEdit.denyReadText} oninput={(event) => updateSandboxEdit((draft) => ({ ...draft, denyReadText: event.currentTarget.value }))}></textarea></label>
        <label class="settings-field"><span>{session.text.sandboxFilesystemDenyWrite}</span><textarea rows="4" value={sandboxStore.sandboxEdit.denyWriteText} oninput={(event) => updateSandboxEdit((draft) => ({ ...draft, denyWriteText: event.currentTarget.value }))}></textarea></label>
      </div>
    </div>
  </div>

  <div class="channel-section-head sandbox-section-head"><div><p class="settings-group-title">{session.text.sandboxDiagnostics}</p><p class="settings-section-hint">{session.text.sandboxDiagnosticsHint}</p></div><button class="secondary-button" type="button" disabled={sandboxStore.diagnosing} onclick={() => void refreshSandboxDiagnostics()}>{sandboxStore.diagnosing ? session.text.loading : session.text.sandboxRunDiagnostics}</button></div>
  <div class="settings-card">
    <div class="settings-row"><strong>{session.text.sandboxSupported}</strong><span class="status-badge" data-state={sandboxStore.sandbox.diagnostics.supportedPlatform ? "ready" : "error"}>{sandboxStore.sandbox.diagnostics.supportedPlatform ? session.text.yes : session.text.no}</span></div>
    <div class="settings-row"><strong>{session.text.sandboxDeps}</strong><span class="status-badge" data-state={sandboxStore.sandbox.diagnostics.dependenciesAvailable ? "ready" : "error"}>{sandboxStore.sandbox.diagnostics.dependenciesAvailable ? session.text.yes : session.text.no}</span></div>
    <div class="settings-row"><strong>{session.text.sandboxInitialized}</strong><span class="status-badge" data-state={!sandboxStore.sandbox.enabled || sandboxStore.sandbox.diagnostics.sandboxInitialized ? "ready" : "error"}>{sandboxStore.sandbox.diagnostics.sandboxInitialized ? session.text.yes : sandboxStore.sandbox.enabled ? session.text.no : session.text.sandboxDisabledState}</span></div>
    {#if sandboxStore.sandbox.diagnostics.sandboxError}<div class="settings-row"><strong>{session.text.sandboxError}</strong><span class="diag-value run-history-failed">{sandboxStore.sandbox.diagnostics.sandboxError}</span></div>{/if}
    <div class="settings-row"><strong>{session.text.sandboxEnvFile}</strong><span class="diag-value">{sandboxStore.sandbox.diagnostics.envFileExists ? session.text.sandboxEnvFileExists : session.text.sandboxEnvFileMissing} · {sandboxStore.sandbox.diagnostics.envKeysInjected}/{sandboxStore.sandbox.diagnostics.envKeysAvailable} {session.text.sandboxEnvKeysInjected} · {sandboxStore.sandbox.diagnostics.envKeysDenied} {session.text.sandboxDenied}</span></div>
  </div>
  {#if sandboxStore.actionMessage}<p class="settings-action-message">{sandboxStore.actionMessage}</p>{/if}
  </form>
{/if}

{#if sandboxDirty}
  <footer class="settings-footbar">
    <span class="settings-footbar-label">{session.text.settingsUnsaved}</span>
    <div class="settings-footbar-actions">
      <button class="secondary-button" type="button" disabled={sandboxStore.saving} onclick={resetSandboxEditor}>{session.text.discardChanges}</button>
      <button class="primary-button" type="submit" form="desktop-sandbox-form" disabled={sandboxStore.saving || (!sandboxStore.sandboxEdit?.preserveExternalEnvFilePath && !sandboxStore.sandboxEdit?.envFilePath.trim())}>{sandboxStore.saving ? session.text.onboardingProviderSaving : session.text.sandboxSave}</button>
    </div>
  </footer>
{/if}
