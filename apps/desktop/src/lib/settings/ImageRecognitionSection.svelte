<script lang="ts">
  import AlertDialog from "../components/ui/AlertDialog.svelte";
  import IosSwitch from "../components/ui/IosSwitch.svelte";
  import SelectControl from "../components/ui/SelectControl.svelte";
  import { session } from "../stores/session.svelte";
  import {
    addImageRecognitionEngine,
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
  <div class="settings-card"><div class="settings-row"><p>{session.text.imageRecognitionUnavailable}</p></div></div>
{:else if imageRecognitionStore.loading}
  <div class="settings-card"><div class="settings-row"><p>{session.text.loading}</p></div></div>
{:else if !imageRecognitionStore.draft || !imageRecognitionStore.summary}
  <div class="settings-card">
    <div class="settings-row">
      <p>{session.text.imageRecognitionUnavailable}</p>
      <button class="secondary-button" type="button" onclick={() => session.endpoint && loadImageRecognition(session.endpoint)}>{session.text.retryLoading}</button>
    </div>
  </div>
{:else}
  <div class="settings-card">
    <div class="settings-row">
      <strong>{session.text.imageRecognitionEnabled}</strong>
      <IosSwitch
        checked={imageRecognitionStore.draft.enabled}
        ariaLabel={session.text.imageRecognitionEnabled}
        onCheckedChange={(checked) => {
          if (imageRecognitionStore.draft) imageRecognitionStore.draft.enabled = checked;
          markImageRecognitionDirty();
        }}
      />
    </div>
    <div class="settings-row">
      <div>
        <strong>{session.text.imageRecognitionDefaultEngine}</strong>
        <p class="settings-hint">{session.text.imageRecognitionOrderHint}</p>
      </div>
      <SelectControl
        value={imageRecognitionStore.draft.defaultEngine}
        ariaLabel={session.text.imageRecognitionDefaultEngine}
        options={[{ value: "auto", label: session.text.mediaEngineAuto }, ...imageRecognitionStore.draft.engines.map((engine) => ({ value: engine.id, label: engine.name || engine.id }))]}
        onChange={(value) => {
          if (imageRecognitionStore.draft) imageRecognitionStore.draft.defaultEngine = value;
          markImageRecognitionDirty();
        }}
      />
    </div>
  </div>

  <p class="settings-group-title">{session.text.imageRecognitionEngines}</p>
  {#if modelOptions.length === 0}
    <div class="settings-card"><div class="settings-row"><p>{session.text.imageRecognitionNoModels}</p></div></div>
  {:else}
    <div class="settings-card tool-engine-list">
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
                <input value={engine.name} oninput={(event) => updateImageRecognitionEngine(engine.id, { name: event.currentTarget.value })} />
              </label>
              <label class="settings-field settings-field-wide">
                <span>{session.text.imageRecognitionModel}</span>
                <SelectControl
                  value={engine.modelKey}
                  ariaLabel={session.text.imageRecognitionModel}
                  options={modelOptions}
                  technicalId={engine.modelKey}
                  technicalLabel={session.text.imageRecognitionModel}
                  onChange={(modelKey) => updateImageRecognitionEngine(engine.id, { modelKey })}
                />
              </label>
            </div>
            <div class="settings-row-actions tool-test-actions">
              <button class="secondary-button danger-action" type="button" onclick={() => removeEngineId = engine.id}>{session.text.imageRecognitionRemove}</button>
            </div>
          </div>
        </details>
      {/each}
    </div>

    <div class="settings-card">
      <div class="settings-row">
        <div>
          <strong>{session.text.imageRecognitionAddEngine}</strong>
          <p class="settings-hint">{session.text.imageRecognitionOrderHint}</p>
        </div>
        <button class="secondary-button" type="button" onclick={addEngine}>{session.text.imageRecognitionAddEngine}</button>
      </div>
    </div>
  {/if}

  <div class="settings-card">
    <div class="settings-row">
      <div>
        <strong>{session.text.imageRecognitionCliTitle}</strong>
        <p class="settings-hint">{session.text.imageRecognitionCliPlanned}</p>
      </div>
      <span class="status-badge" data-state="pending">Phase 2</span>
    </div>
  </div>

  <p class="settings-group-title">{session.text.toolTest}</p>
  <div class="settings-card tool-test-card">
    <div class="settings-form tool-test-form">
      <label class="settings-field">
        <span>{session.text.webSearchDefaultEngine}</span>
        <SelectControl
          value={imageRecognitionStore.testEngine}
          ariaLabel={session.text.webSearchDefaultEngine}
          options={[{ value: "auto", label: session.text.mediaEngineAuto }, ...imageRecognitionStore.draft.engines.map((engine) => ({ value: engine.id, label: engine.name || engine.id }))]}
          onChange={(value) => imageRecognitionStore.testEngine = value}
        />
      </label>
      <label class="settings-field settings-field-wide">
        <span>{session.text.imageRecognitionTestPrompt}</span>
        <input bind:value={imageRecognitionStore.testPrompt} />
      </label>
    </div>
    <div class="settings-row image-recognition-upload-row">
      <div>
        <strong>{session.text.imageRecognitionTestImage}</strong>
        <p class="settings-hint">{testFile?.name || session.text.imageRecognitionNoImage}</p>
      </div>
      <div class="settings-row-actions">
        <input bind:this={testFileInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onchange={onTestFilePicked} />
        <button class="secondary-button" type="button" onclick={() => testFileInput?.click()}>{session.text.imageRecognitionChooseImage}</button>
        <button class="secondary-button" type="button" disabled={!testFile || imageRecognitionStore.testBusy} onclick={() => void testImageRecognition(testFile)}>{imageRecognitionStore.testBusy ? session.text.loading : session.text.toolTest}</button>
      </div>
    </div>
    {#if imageRecognitionStore.testResult}
      <pre class:run-history-failed={!imageRecognitionStore.testResult.ok} class="tool-test-result">{JSON.stringify(imageRecognitionStore.testResult.result ?? imageRecognitionStore.testResult.error, null, 2)}</pre>
    {/if}
  </div>
{/if}

{#if imageRecognitionStore.message}<p class="settings-action-message">{imageRecognitionStore.message}</p>{/if}
{#if imageRecognitionStore.dirty}
  <footer class="settings-footbar">
    <span class="settings-footbar-label">{session.text.settingsUnsaved}</span>
    <div class="settings-footbar-actions">
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
