<script lang="ts">
  import { onDestroy } from "svelte";
  import Dialog from "../components/ui/Dialog.svelte";
  import AlertDialog from "../components/ui/AlertDialog.svelte";
  import IosSwitch from "../components/ui/IosSwitch.svelte";
  import SelectControl from "../components/ui/SelectControl.svelte";
  import { session } from "../stores/session.svelte";
  import {
    toolsStore,
    closeMediaTaskDetail,
    ensureMediaPolling,
    stopMediaPolling,
    loadImageGenerate,
    markToolSettingsDirty,
    mediaEngineLabel,
    openMediaTaskDetail,
    removeMediaTask,
    saveToolSettings,
    secretRevealed,
    testToolSettings,
    toggleRevealSecret,
    isCustomImageEngine,
    addImageCustomEngine,
    removeImageCustomEngine,
    BUILTIN_IMAGE_ENGINE_IDS
  } from "../stores/tools.svelte";

  let addEngineOpen = $state(false);
  let newEngineId = $state("");
  let newEngineName = $state("");
  let newEngineProtocol = $state<"images-generations" | "chat-completions">("images-generations");
  let newEngineError = $state("");
  let removeEngineId = $state<string | null>(null);

  $effect(() => {
    if (session.serviceReady && session.endpoint && session.endpoint !== toolsStore.imageGenerateEndpoint) {
      void loadImageGenerate(session.endpoint);
    }
  });
  $effect(() => {
    void toolsStore.imageTasks;
    ensureMediaPolling("image");
  });

  onDestroy(() => stopMediaPolling("image"));

  function engineLabel(engine: { id: string; name?: string }): string {
    return engine.name || mediaEngineLabel("image", engine.id);
  }

  function taskEngineLabel(id: string): string {
    return toolsStore.imageGenerate?.engines.find((engine) => engine.id === id)?.name || mediaEngineLabel("image", id);
  }

  function validateAndAddEngine(): void {
    newEngineError = "";
    const id = newEngineId.trim().toLowerCase();
    const name = newEngineName.trim();
    if (!id) {
      newEngineError = session.text.engineId;
      return;
    }
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(id)) {
      newEngineError = session.text.engineIdHint;
      return;
    }
    if (id === "auto") {
      newEngineError = session.text.engineIdHint;
      return;
    }
    if (BUILTIN_IMAGE_ENGINE_IDS.has(id) || toolsStore.imageGenerateEdit?.engines.some((e) => e.id === id)) {
      newEngineError = session.text.engineIdHint;
      return;
    }
    addImageCustomEngine(id, name || id, newEngineProtocol);
    addEngineOpen = false;
    newEngineId = "";
    newEngineName = "";
    newEngineProtocol = "images-generations";
  }

  function closeAddEngine(): void {
    addEngineOpen = false;
    newEngineId = "";
    newEngineName = "";
    newEngineProtocol = "images-generations";
    newEngineError = "";
  }

  function confirmRemoveEngine(): void {
    if (!removeEngineId) return;
    removeImageCustomEngine(removeEngineId);
    removeEngineId = null;
  }
</script>

{#if !session.serviceReady}
  <div class="settings-card"><div class="settings-row"><p>{session.text.imageGenerateUnavailable}</p></div></div>
{:else if toolsStore.imageGenerateLoading || !toolsStore.imageGenerateEdit}
  <div class="settings-card"><div class="settings-row"><p>{session.text.loading}</p></div></div>
{:else}
  <div class="settings-card">
    <div class="settings-row">
      <strong>{session.text.webSearchEnabled}</strong>
      <IosSwitch checked={toolsStore.imageGenerateEdit.enabled} ariaLabel={session.text.imageGenerate} onCheckedChange={(checked) => { if (toolsStore.imageGenerateEdit) toolsStore.imageGenerateEdit = { ...toolsStore.imageGenerateEdit, enabled: checked }; markToolSettingsDirty("imageGenerate"); }} />
    </div>
    <div class="settings-row">
      <strong>{session.text.webSearchDefaultEngine}</strong>
      <SelectControl
        value={toolsStore.imageGenerateEdit.defaultEngine}
        ariaLabel={session.text.webSearchDefaultEngine}
        options={[{ value: "auto", label: session.text.mediaEngineAuto }, ...toolsStore.imageGenerateEdit.engines.map((engine) => ({ value: engine.id, label: engineLabel(engine) }))]}
        onChange={(value) => { toolsStore.imageGenerateEdit!.defaultEngine = value; markToolSettingsDirty("imageGenerate"); }}
      />
    </div>
  </div>

  <p class="settings-group-title">{session.text.mediaEngines}</p>
  <div class="settings-card tool-engine-list">
    {#each toolsStore.imageGenerateEdit.engines as engine (engine.id)}
      <details class="tool-engine-card">
        <summary>
          <span>{engineLabel(engine)}</span>
          <span class="status-badge" data-state={engine.enabled ? "ready" : "disconnected"}>{engine.enabled ? session.text.providerEnabled : session.text.providerDisabled}</span>
        </summary>
        <div class="tool-engine-body">
          <div class="settings-row">
            <strong>{session.text.providerEnabledLabel}</strong>
            <IosSwitch checked={engine.enabled} ariaLabel={engineLabel(engine)} onCheckedChange={(checked) => { if (toolsStore.imageGenerateEdit) toolsStore.imageGenerateEdit = { ...toolsStore.imageGenerateEdit, engines: toolsStore.imageGenerateEdit.engines.map((item) => item.id === engine.id ? { ...item, enabled: checked } : item) }; markToolSettingsDirty("imageGenerate"); }} />
          </div>
          {#if isCustomImageEngine(engine.id)}
            <div class="settings-row">
              <strong>{session.text.engineProtocolLabel}</strong>
              <span>{engine.protocol === "chat-completions" ? session.text.protocolChat : session.text.protocolImages}</span>
            </div>
          {/if}
          <div class="settings-form">
            <label class="settings-field">
              <span>{session.text.toolBaseUrl}</span>
              <input bind:value={engine.baseUrl} oninput={() => markToolSettingsDirty("imageGenerate")} />
            </label>
            <label class="settings-field">
              <span>{session.text.toolModel}</span>
              <input bind:value={engine.model} oninput={() => markToolSettingsDirty("imageGenerate")} />
            </label>
            <label class="settings-field settings-field-wide">
              <span>{session.text.webSearchApiKey}</span>
              <div class="secret-input">
                <input type={secretRevealed(`image:${engine.id}`) ? "text" : "password"} bind:value={engine.apiKey} placeholder={engine.hasApiKey ? session.text.channelSecretConfigured : ""} autocomplete="new-password" oninput={() => markToolSettingsDirty("imageGenerate")} />
                <button class="secret-reveal" type="button" aria-label={session.text.toggleReveal} onclick={(event) => { event.preventDefault(); toggleRevealSecret(`image:${engine.id}`); }}>
                  <i class={`ph ${secretRevealed(`image:${engine.id}`) ? "ph-eye-slash" : "ph-eye"}`}></i>
                </button>
              </div>
              {#if engine.hasApiKey && !engine.apiKey}
                <label class="settings-inline-check">
                  <input type="checkbox" bind:checked={engine.clearApiKey} onchange={() => markToolSettingsDirty("imageGenerate")} />
                  <span>{session.text.channelClearSecret}</span>
                </label>
              {/if}
            </label>
          </div>
          {#if isCustomImageEngine(engine.id)}
            <div class="settings-row-actions">
              <button class="secondary-button danger-action" type="button" onclick={() => removeEngineId = engine.id}>{session.text.removeEngine}</button>
            </div>
          {/if}
        </div>
      </details>
    {/each}
  </div>

  <div class="settings-card">
    <div class="settings-row">
      <div>
        <strong>{session.text.customEnginesTitle}</strong>
        <p class="settings-hint">{session.text.customEnginesDesc}</p>
      </div>
      <button class="secondary-button" type="button" onclick={() => addEngineOpen = true}>{session.text.addEngine}</button>
    </div>
  </div>

  <Dialog open={addEngineOpen} contentClass="modal-card" labelledBy="image-add-engine-title" onOpenChange={(next) => { if (!next) closeAddEngine(); }}>
    <header class="modal-head">
      <strong id="image-add-engine-title">{session.text.addEngineTitle}</strong>
      <button class="modal-close" type="button" aria-label={session.text.cancel} onclick={closeAddEngine}><i class="ph ph-x"></i></button>
    </header>
    <div class="modal-body">
      <div class="settings-form">
        <label class="settings-field">
          <span>{session.text.engineId}</span>
          <input bind:value={newEngineId} placeholder={session.text.engineIdHint} />
        </label>
        <label class="settings-field">
          <span>{session.text.engineName}</span>
          <input bind:value={newEngineName} placeholder={session.text.engineName} />
        </label>
        <label class="settings-field">
          <span>{session.text.engineProtocol}</span>
          <SelectControl
            value={newEngineProtocol}
            ariaLabel={session.text.engineProtocol}
            options={[{ value: "images-generations", label: session.text.protocolImages }, { value: "chat-completions", label: session.text.protocolChat }]}
            onChange={(value) => newEngineProtocol = value as "images-generations" | "chat-completions"}
          />
          <span class="settings-hint">{session.text.protocolHint}</span>
        </label>
      </div>
      {#if newEngineError}
        <p class="settings-action-message run-history-failed">{newEngineError}</p>
      {/if}
    </div>
    <footer class="provider-modal-foot">
      <button class="secondary-button" type="button" onclick={closeAddEngine}>{session.text.cancel}</button>
      <button class="primary-button" type="button" onclick={validateAndAddEngine}>{session.text.addEngine}</button>
    </footer>
  </Dialog>

  {#if removeEngineId}
    <AlertDialog
      open={true}
      contentClass="modal-card"
      labelledBy="image-remove-engine-title"
      describedBy="image-remove-engine-description"
      onOpenChange={(next) => { if (!next) removeEngineId = null; }}
    >
      <header class="modal-head">
        <strong id="image-remove-engine-title">{session.text.removeEngine}</strong>
      </header>
      <div class="modal-body">
        <p id="image-remove-engine-description">{session.text.removeEngineConfirm}</p>
      </div>
      <footer class="provider-modal-foot">
        <button class="secondary-button" type="button" onclick={() => removeEngineId = null}>{session.text.cancel}</button>
        <button class="primary-button danger-action" type="button" onclick={confirmRemoveEngine}>{session.text.removeEngine}</button>
      </footer>
    </AlertDialog>
  {/if}

  <p class="settings-group-title">{session.text.toolTest}</p>
  <div class="settings-card tool-test-card">
    <div class="settings-form tool-test-form">
      <label class="settings-field">
        <span>{session.text.webSearchDefaultEngine}</span>
        <SelectControl value={toolsStore.imageTestEngine} ariaLabel={session.text.webSearchDefaultEngine} options={[{ value: "auto", label: session.text.mediaEngineAuto }, ...toolsStore.imageGenerateEdit.engines.map((engine) => ({ value: engine.id, label: engineLabel(engine) }))]} onChange={(value) => toolsStore.imageTestEngine = value} />
      </label>
      <label class="settings-field">
        <span>{session.text.toolImageSize}</span>
        <SelectControl value={toolsStore.imageTestSize} ariaLabel={session.text.toolImageSize} options={[{ value: "1024x1024", label: "1024 × 1024" }, { value: "1536x1024", label: "1536 × 1024" }, { value: "1024x1536", label: "1024 × 1536" }]} onChange={(value) => toolsStore.imageTestSize = value} />
      </label>
      <label class="settings-field settings-field-wide">
        <span>{session.text.toolPrompt}</span>
        <input bind:value={toolsStore.imageTestPrompt} />
      </label>
    </div>
    <div class="settings-row-actions tool-test-actions">
      <button class="secondary-button" type="button" disabled={toolsStore.testBusy} onclick={() => void testToolSettings("imageGenerate")}>{toolsStore.testBusy ? session.text.loading : session.text.toolTest}</button>
    </div>
    {#if toolsStore.testResult}
      <pre class:run-history-failed={!toolsStore.testResult.ok} class="tool-test-result">{JSON.stringify(toolsStore.testResult.result ?? toolsStore.testResult.error, null, 2)}</pre>
    {/if}
  </div>

  <p class="settings-group-title">{session.text.mediaTasks}</p>
  {#if toolsStore.imageTasks.length === 0}
    <div class="settings-card"><div class="settings-row"><p>{session.text.mediaTasksEmpty}</p></div></div>
  {:else}
    <div class="settings-card">
      {#each toolsStore.imageTasks as task (task.id)}
        <div class="settings-row media-task-row">
          <div class="media-task-summary">
            <span class="status-badge" data-state={task.status === "completed" ? "ready" : task.status === "failed" ? "error" : "pending"}>{task.status === "completed" ? session.text.mediaTaskCompleted : task.status === "failed" ? session.text.mediaTaskFailed : session.text.mediaTaskProcessing}</span>
            <span class="media-task-prompt" title={task.prompt}>{task.prompt}</span>
            <span class="media-task-meta">{taskEngineLabel(task.engine)} · {task.createdAt.slice(0, 19).replace("T", " ")}</span>
          </div>
          <div class="settings-row-actions">
            <button class="secondary-button" type="button" onclick={() => openMediaTaskDetail(task)}>{session.text.mediaTaskView}</button>
            <button class="row-icon-btn danger-action" type="button" title={session.text.mediaTaskDelete} aria-label={session.text.mediaTaskDelete} disabled={toolsStore.mediaTaskBusy === task.id} onclick={() => void removeMediaTask("image", task.id)}><i class="ph ph-trash" aria-hidden="true"></i></button>
          </div>
        </div>
      {/each}
    </div>
  {/if}

  {#if toolsStore.mediaTaskDetail && toolsStore.mediaTaskDetail.kind === "image"}
    <Dialog
      open={true}
      contentClass="modal-card"
      labelledBy="image-media-task-detail-title"
      onOpenChange={(next) => { if (!next) closeMediaTaskDetail(); }}
    >
      <header class="modal-head">
        <strong id="image-media-task-detail-title">{session.text.mediaTaskDetail}</strong>
        <button class="modal-close" type="button" aria-label={session.text.cancel} onclick={() => closeMediaTaskDetail()}><i class="ph ph-x"></i></button>
      </header>
      <div class="modal-body media-task-detail">
        {#if toolsStore.mediaTaskDetail.status === "completed"}
          <div class="media-task-preview-frame">
            {#if toolsStore.mediaTaskDetailUrl}
              <img class="media-task-preview" src={toolsStore.mediaTaskDetailUrl} alt={toolsStore.mediaTaskDetail.prompt} />
            {:else if toolsStore.mediaTaskDetailFailed}
              <button class="media-task-preview-state" type="button" onclick={() => toolsStore.mediaTaskDetail && openMediaTaskDetail(toolsStore.mediaTaskDetail)}>{session.text.mediaLoadFailed}</button>
            {:else}
              <div class="media-task-preview-state"><i class="ph ph-circle-notch" aria-hidden="true"></i><span>{session.text.mediaLoading}</span></div>
            {/if}
          </div>
        {/if}
        <div class="settings-row"><strong>{session.text.mediaTaskEngine}</strong><span>{taskEngineLabel(toolsStore.mediaTaskDetail.engine)}</span></div>
        <div class="settings-row"><strong>{session.text.mediaTaskStatus}</strong><span>{toolsStore.mediaTaskDetail.status === "completed" ? session.text.mediaTaskCompleted : toolsStore.mediaTaskDetail.status === "failed" ? session.text.mediaTaskFailed : session.text.mediaTaskProcessing}</span></div>
        <div class="settings-row media-task-detail-block"><strong>{session.text.mediaTaskPrompt}</strong><span>{toolsStore.mediaTaskDetail.prompt}</span></div>
        {#if toolsStore.mediaTaskDetail.requestParams}
          <div class="settings-row media-task-detail-block"><strong>{session.text.mediaTaskParams}</strong><pre class="media-task-params">{JSON.stringify(toolsStore.mediaTaskDetail.requestParams, null, 2)}</pre></div>
        {/if}
        {#if toolsStore.mediaTaskDetail.errorMessage}
          <div class="settings-row media-task-detail-block"><strong>{session.text.mediaTaskError}</strong><span class="run-history-failed">{toolsStore.mediaTaskDetail.errorMessage}</span></div>
        {/if}
        <div class="settings-row"><strong>{session.text.mediaTaskCreatedAt}</strong><span>{toolsStore.mediaTaskDetail.createdAt.slice(0, 19).replace("T", " ")}</span></div>
        <div class="settings-row"><strong>{session.text.mediaTaskUpdatedAt}</strong><span>{toolsStore.mediaTaskDetail.updatedAt.slice(0, 19).replace("T", " ")}</span></div>
        {#if toolsStore.mediaTaskDetailUrl}
          <div class="settings-row-actions media-task-detail-actions"><a class="secondary-button" href={toolsStore.mediaTaskDetailUrl} download={`image-${toolsStore.mediaTaskDetail.id}`}>{session.text.mediaTaskDownload}</a></div>
        {/if}
      </div>
    </Dialog>
  {/if}
{/if}

{#if toolsStore.message}<p class="settings-action-message">{toolsStore.message}</p>{/if}
{#if toolsStore.dirty.has("imageGenerate")}
  <footer class="settings-footbar">
    <span class="settings-footbar-label">{session.text.settingsUnsaved}</span>
    <div class="settings-footbar-actions">
      <button class="primary-button" type="button" disabled={toolsStore.saving} onclick={() => void saveToolSettings("imageGenerate")}>{toolsStore.saving ? session.text.onboardingProviderSaving : session.text.save}</button>
    </div>
  </footer>
{/if}
