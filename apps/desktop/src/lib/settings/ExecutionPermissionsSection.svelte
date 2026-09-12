<script lang="ts">
  import Check from "reicon-svelte/icons/Check";
  import Hand from "reicon-svelte/icons/Hand";
  import Lightning from "reicon-svelte/icons/Lightning";
  import ListCheck from "reicon-svelte/icons/ListCheck";
  import PenLine from "reicon-svelte/icons/PenLine";
  import Shield from "reicon-svelte/icons/Shield";
  import ChevronDown from "reicon-svelte/icons/ChevronDown";
  import { onDestroy } from "svelte";
  import type { ReiconComponent } from "../components/ui/iconTypes";
  import SelectControl from "../components/ui/SelectControl.svelte";
  import SettingGroup from "../components/ui/SettingGroup.svelte";
  import SettingRow from "../components/ui/SettingRow.svelte";
  import StatusBadge from "../components/ui/StatusBadge.svelte";
  import EmptyState from "../components/ui/EmptyState.svelte";
  import { session, setError } from "../stores/session.svelte";
  import { tablist } from "../a11y/tablist";
  import { trackUnsaved } from "../unsavedGuard";
  import { loadDesktopExecutionDefault, saveDesktopExecutionDefault } from "../api";
  import {
    sandboxStore,
    loadSandbox,
    refreshSandboxDiagnostics,
    resetSandboxEditor,
    saveSandboxPolicy,
    updateSandboxEdit,
    type SandboxEditor
  } from "../stores/sandbox.svelte";

  type Mode = "plan" | "manual" | "accept_edits" | "auto";

  let defaultMode: Mode = $state("accept_edits");
  let savedMode: Mode = $state("accept_edits");
  let loading = $state(false);
  let saving = $state(false);
  let actionMessage = $state("");

  const MODE_ICONS: Record<Mode, ReiconComponent> = {
    plan: ListCheck,
    manual: Hand,
    accept_edits: PenLine,
    auto: Lightning
  };

  const modes: readonly Mode[] = ["plan", "manual", "accept_edits", "auto"];

  function modeLabel(mode: Mode): string {
    return {
      plan: session.text.permissionModePlan,
      manual: session.text.permissionModeManual,
      accept_edits: session.text.permissionModeAcceptEdits,
      auto: session.text.permissionModeAuto
    }[mode];
  }

  function modeHint(mode: Mode): string {
    return {
      plan: session.text.permissionModePlanHint,
      manual: session.text.permissionModeManualHint,
      accept_edits: session.text.permissionModeAcceptEditsHint,
      auto: session.text.permissionModeAutoHint
    }[mode];
  }

  function selectMode(mode: Mode): void {
    defaultMode = mode;
    actionMessage = "";
  }

  const sandboxDirty = $derived(sandboxStore.sandboxEdit !== null && JSON.stringify(sandboxStore.sandboxEdit) !== sandboxStore.pristine);
  const dirty = $derived(defaultMode !== savedMode || sandboxDirty);
  const sandboxSaveBlocked = $derived(!sandboxStore.sandboxEdit?.preserveExternalEnvFilePath && !sandboxStore.sandboxEdit?.envFilePath.trim());

  // Declared backend capabilities decide which advanced settings exist; with
  // one backend there is no selector of unimplemented choices to show.
  const backend = $derived(sandboxStore.sandbox?.backend ?? null);
  const backendReady = $derived(backend !== null && backend.supportedPlatform && backend.dependenciesAvailable);

  // Load the saved default mode and the sandbox policy for this endpoint.
  $effect(() => {
    if (!session.serviceReady || !session.endpoint) return;
    loading = true;
    // Must go through the shared api transport: raw fetch is cross-origin from
    // the Tauri webview and the sidecar sends no CORS headers, so preflighted
    // requests fail (and even GET responses are unreadable) inside the app.
    loadDesktopExecutionDefault(session.endpoint)
      .then((mode) => {
        defaultMode = mode;
        savedMode = mode;
      })
      .catch((cause) => setError(cause))
      .finally(() => (loading = false));
    if (session.endpoint !== sandboxStore.endpoint) void loadSandbox(session.endpoint);
  });

  function discard(): void {
    defaultMode = savedMode;
    resetSandboxEditor();
    actionMessage = "";
  }

  async function save(): Promise<void> {
    if (saving || !session.endpoint) return;
    const endpoint = session.endpoint;
    saving = true;
    actionMessage = "";
    try {
      if (defaultMode !== savedMode) {
        savedMode = await saveDesktopExecutionDefault(endpoint, defaultMode);
        actionMessage = session.text.executionDefaultSaved;
      }
      if (sandboxDirty) {
        await saveSandboxPolicy();
        if (!session.error) actionMessage = session.text.sandboxSaved;
      }
    } catch {
      actionMessage = session.text.executionDefaultSaveFailed;
    } finally {
      saving = false;
    }
  }

  onDestroy(trackUnsaved(() => dirty));
</script>

{#if !session.serviceReady}
  <SettingGroup><EmptyState title={session.text.sandboxUnavailable} icon="shield-slash" /></SettingGroup>
{:else}
  <SettingGroup title={session.text.executionDefaultTitle} description={session.text.executionDefaultHint}>
    <div class="execution-mode-grid" role="radiogroup" aria-label={session.text.executionDefaultTitle} use:tablist={'[role="radio"]'}>
      {#each modes as mode (mode)}
        {@const ModeIcon = MODE_ICONS[mode]}
        <button
          type="button"
          role="radio"
          aria-checked={defaultMode === mode}
          tabindex={defaultMode === mode ? 0 : -1}
          class="execution-mode-card"
          class:active={defaultMode === mode}
          data-mode={mode}
          onclick={() => selectMode(mode)}
        >
          <div class="execution-mode-card-header">
            <ModeIcon size={15} aria-hidden="true" />
            <span class="execution-mode-title">{modeLabel(mode)}</span>
            {#if defaultMode === mode}<Check size={12} aria-hidden="true" />{/if}
          </div>
          <p class="execution-mode-desc">{modeHint(mode)}</p>
        </button>
      {/each}
    </div>
    <p class="execution-mode-footnote"><strong>{session.text.executionAutoScope}</strong>{session.text.executionAutoScopeValue}</p>
  </SettingGroup>

  {#if sandboxStore.loading || !sandboxStore.sandbox || !sandboxStore.sandboxEdit || !backend}
    <SettingGroup title={session.text.executionEnvBackend}>
      <div class="settings-row"><p>{session.text.loading}</p></div>
    </SettingGroup>
  {:else}
    <SettingGroup title={session.text.executionEnvBackend} description={session.text.executionEnvModeNoteValue}>
      <svelte:fragment slot="action">
        <button class="secondary-button" type="button" disabled={sandboxStore.diagnosing} onclick={() => void refreshSandboxDiagnostics()}>{sandboxStore.diagnosing ? session.text.loading : session.text.sandboxRunDiagnostics}</button>
      </svelte:fragment>
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
        <SettingRow title={session.text.executionEnvBackendUnavailable} description={session.text.executionEnvBackendUnavailableHint} stacked />
      {/if}
      <SettingRow title={session.text.sandboxInitialized}>
        <StatusBadge label={sandboxStore.sandbox.diagnostics.sandboxInitialized ? session.text.yes : session.text.no} state={sandboxStore.sandbox.diagnostics.sandboxInitialized ? "ready" : "error"} />
      </SettingRow>
      {#if sandboxStore.sandbox.diagnostics.sandboxError}
        <SettingRow title={session.text.sandboxError} description={sandboxStore.sandbox.diagnostics.sandboxError} stacked />
      {/if}
      <SettingRow title={session.text.sandboxEnvFile}>
        <span class="diag-value">{sandboxStore.sandbox.diagnostics.envFileExists ? session.text.sandboxEnvFileExists : session.text.sandboxEnvFileMissing} · {sandboxStore.sandbox.diagnostics.envKeysInjected}/{sandboxStore.sandbox.diagnostics.envKeysAvailable} {session.text.sandboxEnvKeysInjected} · {sandboxStore.sandbox.diagnostics.envKeysDenied} {session.text.sandboxDenied}</span>
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
  {/if}
  {#if actionMessage}<p class="settings-action-message" aria-live="polite">{actionMessage}</p>{/if}
{/if}

{#if dirty}
  <footer class="settings-footbar">
    <span class="settings-footbar-label">{session.text.settingsUnsaved}</span>
    <div class="settings-footbar-actions">
      <button class="secondary-button" type="button" disabled={saving} onclick={discard}>{session.text.discardChanges}</button>
      <button class="primary-button" type="button" disabled={saving || loading || (sandboxDirty && sandboxSaveBlocked)} onclick={() => void save()}>{saving ? session.text.onboardingProviderSaving : session.text.settingsSave}</button>
    </div>
  </footer>
{/if}
