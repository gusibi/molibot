<script lang="ts">
  import { onDestroy } from "svelte";
  import AlertDialog from "../components/ui/AlertDialog.svelte";
  import EmptyState from "../components/ui/EmptyState.svelte";
  import IosSwitch from "../components/ui/IosSwitch.svelte";
  import SelectControl from "../components/ui/SelectControl.svelte";
  import SettingGroup from "../components/ui/SettingGroup.svelte";
  import SettingRow from "../components/ui/SettingRow.svelte";
  import { session } from "../stores/session.svelte";
  import { trackUnsaved } from "../unsavedGuard";
  import {
    addImageRecognitionEngine,
    discardImageRecognition,
    imageRecognitionStore,
    loadImageRecognition,
    markImageRecognitionDirty,
    moveImageRecognitionEngine,
    removeImageRecognitionEngine,
    saveImageRecognition,
    testImageRecognition,
    updateImageRecognitionEngine
  } from "../stores/imageRecognition.svelte";

  let testFileInput = $state<HTMLInputElement>();
  let testFile = $state<File | null>(null);
  let removeEngineId = $state<string | null>(null);
  let expandedEngines = $state<Record<string, boolean>>({});
  let modelOptions = $derived((imageRecognitionStore.summary?.models ?? []).map((model) => ({
    value: model.key,
    label: model.verification === "failed"
      ? `${model.label} · ${session.text.imageRecognitionVerificationFailed}`
      : model.verification === "untested"
        ? `${model.label} · ${session.text.imageRecognitionVerificationUntested}`
        : model.label,
    disabled: model.verification === "failed",
    group: model.providerId
  })));

  $effect(() => {
    if (session.serviceReady && session.endpoint && session.endpoint !== imageRecognitionStore.endpoint) {
      void loadImageRecognition(session.endpoint);
    }
  });

  onDestroy(trackUnsaved(() => imageRecognitionStore.dirty));

  function onTestFilePicked(event: Event): void {
    testFile = (event.currentTarget as HTMLInputElement).files?.[0] ?? null;
    imageRecognitionStore.testResult = null;
  }

  function confirmRemove(): void {
    if (!removeEngineId) return;
    removeImageRecognitionEngine(removeEngineId);
    removeEngineId = null;
  }

  function addEngine(): void {
    const existingIds = new Set(imageRecognitionStore.draft?.engines.map((engine) => engine.id) ?? []);
    addImageRecognitionEngine();
    const addedEngine = imageRecognitionStore.draft?.engines.find((engine) => !existingIds.has(engine.id));
    if (addedEngine) expandedEngines = { ...expandedEngines, [addedEngine.id]: true };
  }

  function setEngineExpanded(id: string, open: boolean): void {
    expandedEngines = { ...expandedEngines, [id]: open };
  }
</script>

{#if !session.serviceReady}
  <SettingGroup><EmptyState title={session.text.imageRecognitionUnavailable} icon="eye" /></SettingGroup>
{:else if imageRecognitionStore.loading}
  <SettingGroup><div class="settings-row"><p>{session.text.loading}</p></div></SettingGroup>
{:else if !imageRecognitionStore.draft || !imageRecognitionStore.summary}
  <SettingGroup>
    <div class="settings-row">
      <p>{session.text.imageRecognitionUnavailable}</p>
      <button class="secondary-button" type="button" onclick={() => session.endpoint && loadImageRecognition(session.endpoint)}>{session.text.retryLoading}</button>
    </div>
  </SettingGroup>
{:else}
  <SettingGroup ariaLabel={session.text.imageRecognitionTab}>
    <SettingRow title={session.text.imageRecognitionEnabled}>
      <IosSwitch
        checked={imageRecognitionStore.draft.enabled}
        ariaLabel={session.text.imageRecognitionEnabled}
        onCheckedChange={(checked) => {
          if (imageRecognitionStore.draft) imageRecognitionStore.draft.enabled = checked;
          markImageRecognitionDirty();
        }}
      />
    </SettingRow>
    <SettingRow title={session.text.imageRecognitionDefaultEngine} description={session.text.imageRecognitionOrderHint}>
      <SelectControl
        value={imageRecognitionStore.draft.defaultEngine}
        ariaLabel={session.text.imageRecognitionDefaultEngine}
        options={[{ value: "auto", label: session.text.mediaEngineAuto }, ...imageRecognitionStore.draft.engines.map((engine) => ({ value: engine.id, label: engine.name || engine.id }))]}
        onChange={(value) => {
          if (imageRecognitionStore.draft) imageRecognitionStore.draft.defaultEngine = value;
          markImageRecognitionDirty();
        }}
      />
    </SettingRow>
  </SettingGroup>

  <SettingGroup title={session.text.imageRecognitionEngines} contentClass="tool-engine-list">
    <svelte:fragment slot="action">
      <button class="secondary-button" type="button" onclick={addEngine}>{session.text.imageRecognitionAddEngine}</button>
    </svelte:fragment>
    {#if modelOptions.length === 0}
      <EmptyState title={session.text.imageRecognitionNoModels} icon="eye-slash" />
    {:else}
      {#each imageRecognitionStore.draft.engines as engine, index (engine.id)}
        <details
          class="tool-engine-card"
          open={expandedEngines[engine.id] ?? index === 0}
          ontoggle={(event) => setEngineExpanded(engine.id, event.currentTarget.open)}
        >
          <summary>
            <span>{engine.name || engine.id}</span>
            <span class="status-badge" data-state={engine.enabled ? "ready" : "disconnected"}>{engine.enabled ? session.text.providerEnabled : session.text.providerDisabled}</span>
          </summary>
          <div class="tool-engine-body">
            <div class="settings-row">
              <div>
                <strong>{engine.id}</strong>
                <p class="settings-hint">API · {index + 1}</p>
              </div>
              <div class="settings-row-actions">
                <button class="row-icon-btn" type="button" title={session.text.imageRecognitionMoveUp} aria-label={session.text.imageRecognitionMoveUp} disabled={index === 0} onclick={() => moveImageRecognitionEngine(engine.id, -1)}><i class="ph ph-arrow-up" aria-hidden="true"></i></button>
                <button class="row-icon-btn" type="button" title={session.text.imageRecognitionMoveDown} aria-label={session.text.imageRecognitionMoveDown} disabled={index === imageRecognitionStore.draft!.engines.length - 1} onclick={() => moveImageRecognitionEngine(engine.id, 1)}><i class="ph ph-arrow-down" aria-hidden="true"></i></button>
                <IosSwitch checked={engine.enabled} ariaLabel={engine.name || engine.id} onCheckedChange={(checked) => updateImageRecognitionEngine(engine.id, { enabled: checked })} />
              </div>
            </div>
            <div class="settings-form">
              <label class="settings-field">
                <span>{session.text.imageRecognitionEngineName}</span>
                <input value={engine.name} autocomplete="off" oninput={(event) => updateImageRecognitionEngine(engine.id, { name: event.currentTarget.value })} />
              </label>
              <label class="settings-field settings-field-wide">
                <span>{session.text.imageRecognitionModel}</span>
                <SelectControl
                  value={engine.modelKey}
                  ariaLabel={session.text.imageRecognitionModel}
                  options={modelOptions}
                  technicalId={engine.modelKey}
                  onChange={(value) => updateImageRecognitionEngine(engine.id, { modelKey: value })}
                />
              </label>
            </div>
            <div class="tool-engine-card-actions">
              <button class="secondary-button danger-action" type="button" disabled={imageRecognitionStore.draft.engines.length <= 1} onclick={() => (removeEngineId = engine.id)}>{session.text.imageRecognitionRemove}</button>
            </div>
          </div>
        </details>
      {/each}
    {/if}
  </SettingGroup>

  <SettingGroup title={session.text.toolTest} contentClass="tool-test-card">
    <div class="settings-form">
      <label class="settings-field">
        <span>{session.text.imageRecognitionDefaultEngine}</span>
        <SelectControl
          value={imageRecognitionStore.testEngine}
          ariaLabel={session.text.imageRecognitionDefaultEngine}
          options={[{ value: "auto", label: session.text.mediaEngineAuto }, ...imageRecognitionStore.draft.engines.map((engine) => ({ value: engine.id, label: engine.name || engine.id }))]}
          onChange={(value) => (imageRecognitionStore.testEngine = value)}
        />
      </label>
      <label class="settings-field settings-field-wide">
        <span>{session.text.toolPrompt}</span>
        <input bind:value={imageRecognitionStore.testPrompt} autocomplete="off" />
      </label>
      <label class="settings-field settings-field-wide">
        <span>{session.text.imageRecognitionTestImage}</span>
        <input type="file" accept="image/*" bind:this={testFileInput} onchange={onTestFilePicked} />
      </label>
    </div>
    <div class="settings-row-actions tool-test-actions">
      <div class="tool-test-actions-right">
        {#if testFile}
          <span class="tool-test-file-info">{testFile.name} ({(testFile.size / 1024).toFixed(1)} KB)</span>
        {/if}
        <button class="secondary-button" type="button" disabled={!testFile || imageRecognitionStore.testBusy} onclick={() => void testImageRecognition(testFile)}>{imageRecognitionStore.testBusy ? session.text.loading : session.text.toolTest}</button>
      </div>
    </div>
    {#if imageRecognitionStore.testResult}
      <pre class:run-history-failed={!imageRecognitionStore.testResult.ok} class="tool-test-result">{JSON.stringify(imageRecognitionStore.testResult.result ?? imageRecognitionStore.testResult.error, null, 2)}</pre>
    {/if}
  </SettingGroup>
{/if}

{#if imageRecognitionStore.message}<p class="settings-action-message" aria-live="polite">{imageRecognitionStore.message}</p>{/if}
{#if imageRecognitionStore.dirty}
  <footer class="settings-footbar">
    <span class="settings-footbar-label">{session.text.settingsUnsaved}</span>
    <div class="settings-footbar-actions">
      <button class="secondary-button" type="button" disabled={imageRecognitionStore.saving} onclick={discardImageRecognition}>{session.text.discardChanges}</button>
      <button class="primary-button" type="button" disabled={imageRecognitionStore.saving} onclick={() => void saveImageRecognition()}>{imageRecognitionStore.saving ? session.text.onboardingProviderSaving : session.text.save}</button>
    </div>
  </footer>
{/if}

{#if removeEngineId}
  <AlertDialog
    open={true}
    contentClass="modal-card"
    labelledBy="recognition-remove-title"
    describedBy="recognition-remove-description"
    onOpenChange={(next) => { if (!next) removeEngineId = null; }}
  >
    <header class="modal-head"><strong id="recognition-remove-title">{session.text.imageRecognitionRemove}</strong></header>
    <div class="modal-body"><p id="recognition-remove-description">{session.text.removeEngineConfirm}</p></div>
    <footer class="provider-modal-foot">
      <button class="secondary-button" type="button" onclick={() => removeEngineId = null}>{session.text.cancel}</button>
      <button class="primary-button danger-action" type="button" onclick={confirmRemove}>{session.text.imageRecognitionRemove}</button>
    </footer>
  </AlertDialog>
{/if}
