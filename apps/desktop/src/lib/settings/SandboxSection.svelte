<script lang="ts">
  import type { DesktopSandboxPreset } from "../api";
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
</script>

{#if !session.serviceReady}
  <div class="settings-card"><div class="settings-row"><p>{session.text.sandboxUnavailable}</p></div></div>
{:else if sandboxStore.loading || !sandboxStore.sandbox || !sandboxStore.sandboxEdit}
  <div class="settings-card"><div class="settings-row"><p>{session.text.loading}</p></div></div>
{:else}
  <form id="desktop-sandbox-form" class="sandbox-form" onsubmit={(event) => { event.preventDefault(); void saveSandboxPolicy(); }}>
  <div class="channel-section-head sandbox-section-head"><div><p class="settings-group-title">{session.text.sandboxPresets}</p><p class="settings-section-hint">{session.text.sandboxPresetsHint}</p></div>{#if activeSandboxPreset === "custom"}<span class="status-badge" data-state="disconnected">{session.text.sandboxPresetCustom}</span>{/if}</div>
  <div class="sandbox-presets">
    {#each [
      { id: "observe", icon: "eye", title: session.text.sandboxPresetObserve, description: session.text.sandboxPresetObserveHint },
      { id: "build", icon: "hammer", title: session.text.sandboxPresetBuild, description: session.text.sandboxPresetBuildHint },
      { id: "strict", icon: "lock-key", title: session.text.sandboxPresetStrict, description: session.text.sandboxPresetStrictHint }
    ] as preset (preset.id)}
      <button class:active={activeSandboxPreset === preset.id} class="sandbox-preset-card" type="button" aria-pressed={activeSandboxPreset === preset.id} onclick={() => applySandboxPreset(preset.id as DesktopSandboxPreset)}>
        <span class="sandbox-preset-icon"><i class="ph ph-{preset.icon}"></i></span>
        <span><strong>{preset.title}</strong><small>{preset.description}</small></span>
      </button>
    {/each}
  </div>

  <p class="settings-group-title">{session.text.sandboxRuntime}</p>
  <div class="settings-card provider-editor">
    <div class="settings-row">
      <div>
        <strong>{session.text.sandboxEnabled}</strong>
        <p>{session.text.sandboxEnabledDesc}</p>
      </div>
      <button
        class:active={sandboxStore.sandboxEdit.enabled}
        class="switch"
        type="button"
        role="switch"
        aria-label={session.text.sandboxEnabled}
        aria-checked={sandboxStore.sandboxEdit.enabled}
        onclick={() => updateSandboxEdit((draft) => ({ ...draft, enabled: !draft.enabled }))}
      >
        <span></span>
      </button>
    </div>
    <label class="settings-row"><div><strong>{session.text.sandboxInitFailure}</strong><p>{session.text.sandboxInitFailureHint}</p></div><select value={sandboxStore.sandboxEdit.initFailureMode} onchange={(event) => updateSandboxEdit((draft) => ({ ...draft, initFailureMode: event.currentTarget.value as SandboxEditor["initFailureMode"] }))}><option value="warn-disable">{session.text.sandboxInitWarnDisable}</option><option value="block">{session.text.sandboxInitBlock}</option></select></label>
    <label class="settings-row"><div><strong>{session.text.sandboxEnvInherit}</strong><p>{session.text.sandboxEnvInheritHint}</p></div><select value={sandboxStore.sandboxEdit.envInheritMode} onchange={(event) => updateSandboxEdit((draft) => ({ ...draft, envInheritMode: event.currentTarget.value as SandboxEditor["envInheritMode"] }))}><option value="minimal">{session.text.sandboxEnvMinimal}</option><option value="allowlist">{session.text.sandboxEnvAllowlist}</option><option value="full">{session.text.sandboxEnvFull}</option></select></label>
  </div>

  <p class="settings-group-title">{session.text.sandboxEnvironment}</p>
  <div class="settings-card provider-editor">
    <div class="settings-form sandbox-policy-form">
      <label class="settings-field settings-field-wide"><span>{session.text.sandboxEnvFile}</span><input value={sandboxStore.sandboxEdit.envFilePath} placeholder=".env" oninput={(event) => updateSandboxEdit((draft) => ({ ...draft, envFilePath: event.currentTarget.value }))} /><small>{sandboxStore.sandboxEdit.preserveExternalEnvFilePath && !sandboxStore.sandboxEdit.envFilePath ? session.text.sandboxEnvPathExternal : session.text.sandboxEnvPathHint}</small></label>
      <label class="settings-field"><span>{session.text.sandboxEnvAllow}</span><textarea rows="6" value={sandboxStore.sandboxEdit.envAllowText} placeholder={'OPENAI_API_KEY\nTAVILY_API_KEY'} oninput={(event) => updateSandboxEdit((draft) => ({ ...draft, envAllowText: event.currentTarget.value }))}></textarea></label>
      <label class="settings-field"><span>{session.text.sandboxEnvDeny}</span><textarea rows="6" value={sandboxStore.sandboxEdit.envDenyText} placeholder={'TELEGRAM_BOT_TOKEN\nMOLIBOT_*'} oninput={(event) => updateSandboxEdit((draft) => ({ ...draft, envDenyText: event.currentTarget.value }))}></textarea></label>
    </div>
  </div>

  <div class="sandbox-policy-grid">
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
