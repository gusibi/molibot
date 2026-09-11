<script lang="ts">
  import ChevronDown from "reicon-svelte/icons/ChevronDown";
  import Shield from "reicon-svelte/icons/Shield";
  import { onDestroy } from "svelte";
  import SelectControl from "../components/ui/SelectControl.svelte";
  import SettingGroup from "../components/ui/SettingGroup.svelte";
  import SettingRow from "../components/ui/SettingRow.svelte";
  import StatusBadge from "../components/ui/StatusBadge.svelte";
  import EmptyState from "../components/ui/EmptyState.svelte";
  import { session } from "../stores/session.svelte";
  import { trackUnsaved } from "../unsavedGuard";
  import {
    sandboxStore,
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

  const sandboxDirty = $derived(sandboxStore.sandboxEdit !== null && JSON.stringify(sandboxStore.sandboxEdit) !== sandboxStore.pristine);

  // Declared backend capabilities decide which advanced settings exist; with
  // one backend there is no selector of unimplemented choices to show.
  const backend = $derived(sandboxStore.sandbox?.backend ?? null);
  const backendReady = $derived(backend !== null && backend.supportedPlatform && backend.dependenciesAvailable);

  onDestroy(trackUnsaved(() => sandboxDirty));
</script>

{#if !session.serviceReady}
  <SettingGroup><EmptyState title={session.text.sandboxUnavailable} icon="shield-slash" /></SettingGroup>
{:else if sandboxStore.loading || !sandboxStore.sandbox || !sandboxStore.sandboxEdit || !backend}
  <SettingGroup><div class="settings-row"><p>{session.text.loading}</p></div></SettingGroup>
{:else}
  <form id="desktop-sandbox-form" onsubmit={(event) => { event.preventDefault(); void saveSandboxPolicy(); }}>
  <SettingGroup title={session.text.executionEnvBackend} description={session.text.executionEnvBackendHint}>
    <SettingRow title={session.text.executionEnvBackendName}>
      <span class="diag-value"><Shield size={12} style="vertical-align:-2px" aria-hidden="true" /> {backend.name}</span>
    </SettingRow>
    <SettingRow title={session.text.sandboxSupported}>
      <StatusBadge label={backend.supportedPlatform ? session.text.yes : session.text.no} state={backend.supportedPlatform ? "ready" : "error"} />
    </SettingRow>
    <SettingRow title={session.text.sandboxDeps}>
      <StatusBadge label={backend.dependenciesAvailable ? session.text.yes : session.text.no} state={backend.dependenciesAvailable ? "ready" : "error"} />
    </SettingRow>
    {#if !backendReady}
      <SettingRow title={session.text.executionEnvBackendUnavailable}>
        <span class="diag-value run-history-failed">{session.text.executionEnvBackendUnavailableHint}</span>
      </SettingRow>
    {/if}
    <SettingRow title={session.text.executionEnvModeNote}>
      <span class="diag-value">{session.text.executionEnvModeNoteValue}</span>
    </SettingRow>
  </SettingGroup>

  <details class="settings-advanced-group">
    <summary>
      <ChevronDown class="settings-advanced-chevron" size={14} aria-hidden="true" />
      {session.text.sandboxAdvanced}
    </summary>
    <p class="settings-section-hint">{session.text.sandboxAdvancedHint}</p>

    <SettingGroup title={session.text.sandboxEnvironment} contentClass="provider-editor">
      <div class="settings-form sandbox-policy-form">
        <label class="settings-field settings-field-wide"><span>{session.text.sandboxEnvFile}</span><input value={sandboxStore.sandboxEdit.envFilePath} placeholder=".env…" autocomplete="off" spellcheck="false" oninput={(event) => updateSandboxEdit((draft) => ({ ...draft, envFilePath: event.currentTarget.value }))} /><small>{sandboxStore.sandboxEdit.preserveExternalEnvFilePath && !sandboxStore.sandboxEdit.envFilePath ? session.text.sandboxEnvPathExternal : session.text.sandboxEnvPathHint}</small></label>
        <label class="settings-field"><span>{session.text.sandboxEnvInherit}</span><SelectControl value={sandboxStore.sandboxEdit.envInheritMode} ariaLabel={session.text.sandboxEnvInherit} options={[{ value: "minimal", label: session.text.sandboxEnvMinimal }, { value: "allowlist", label: session.text.sandboxEnvAllowlist }, { value: "full", label: session.text.sandboxEnvFull }]} onChange={(value) => updateSandboxEdit((draft) => ({ ...draft, envInheritMode: value as SandboxEditor["envInheritMode"] }))} /></label>
        <label class="settings-field"><span>{session.text.sandboxEnvAllow}</span><textarea rows="6" value={sandboxStore.sandboxEdit.envAllowText} placeholder={'OPENAI_API_KEY\nTAVILY_API_KEY\n…'} oninput={(event) => updateSandboxEdit((draft) => ({ ...draft, envAllowText: event.currentTarget.value }))}></textarea></label>
        <label class="settings-field"><span>{session.text.sandboxEnvDeny}</span><textarea rows="6" value={sandboxStore.sandboxEdit.envDenyText} placeholder={'TELEGRAM_BOT_TOKEN\nMOLIBOT_*\n…'} oninput={(event) => updateSandboxEdit((draft) => ({ ...draft, envDenyText: event.currentTarget.value }))}></textarea></label>
      </div>
    </SettingGroup>

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
  </details>

  <SettingGroup title={session.text.sandboxDiagnostics} description={session.text.sandboxDiagnosticsHint}>
    <svelte:fragment slot="action">
      <button class="secondary-button" type="button" disabled={sandboxStore.diagnosing} onclick={() => void refreshSandboxDiagnostics()}>{sandboxStore.diagnosing ? session.text.loading : session.text.sandboxRunDiagnostics}</button>
    </svelte:fragment>
    <SettingRow title={session.text.sandboxInitialized}>
      <StatusBadge label={sandboxStore.sandbox.diagnostics.sandboxInitialized ? session.text.yes : session.text.no} state={sandboxStore.sandbox.diagnostics.sandboxInitialized ? "ready" : "error"} />
    </SettingRow>
    {#if sandboxStore.sandbox.diagnostics.sandboxError}
      <SettingRow title={session.text.sandboxError}>
        <span class="diag-value run-history-failed">{sandboxStore.sandbox.diagnostics.sandboxError}</span>
      </SettingRow>
    {/if}
    <SettingRow title={session.text.sandboxEnvFile}>
      <span class="diag-value">{sandboxStore.sandbox.diagnostics.envFileExists ? session.text.sandboxEnvFileExists : session.text.sandboxEnvFileMissing} · {sandboxStore.sandbox.diagnostics.envKeysInjected}/{sandboxStore.sandbox.diagnostics.envKeysAvailable} {session.text.sandboxEnvKeysInjected} · {sandboxStore.sandbox.diagnostics.envKeysDenied} {session.text.sandboxDenied}</span>
    </SettingRow>
  </SettingGroup>
  {#if sandboxStore.actionMessage}<p class="settings-action-message" aria-live="polite">{sandboxStore.actionMessage}</p>{/if}
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
