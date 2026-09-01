<script lang="ts">
  import Eye from "reicon-svelte/icons/Eye";
  import EyeSlash from "reicon-svelte/icons/EyeSlash";
  import Refresh from "reicon-svelte/icons/Refresh";
  import Trash from "reicon-svelte/icons/Trash";
  import X from "reicon-svelte/icons/X";
  import { onDestroy } from "svelte";
  import AlertDialog from "../components/ui/AlertDialog.svelte";
  import Dialog from "../components/ui/Dialog.svelte";
  import EmptyState from "../components/ui/EmptyState.svelte";
  import IosSwitch from "../components/ui/IosSwitch.svelte";
  import SelectControl from "../components/ui/SelectControl.svelte";
  import SettingGroup from "../components/ui/SettingGroup.svelte";
  import SettingRow from "../components/ui/SettingRow.svelte";
  import { formatTimestamp } from "../presentation";
  import { session } from "../stores/session.svelte";
  import { trackUnsaved } from "../unsavedGuard";
  import {
    toolsStore,
    BUILTIN_IMAGE_ENGINE_IDS,
    addImageCustomEngine,
    closeMediaTaskDetail,
    ensureMediaPolling,
    stopMediaPolling,
    isCustomImageEngine,
    loadImageGenerate,
    markToolSettingsDirty,
    mediaEngineLabel,
    openMediaTaskDetail,
    removeImageCustomEngine,
    removeMediaTask,
    saveToolSettings,
    secretRevealed,
    testToolSettings,
    toggleRevealSecret
  } from "../stores/tools.svelte";

  let addEngineOpen = $state(false);
  let newEngineId = $state("");
  let newEngineName = $state("");
  let newEngineProtocol = $state<"images-generations" | "chat-completions">("images-generations");
  let newEngineError = $state("");
  let removeEngineId = $state<string | null>(null);
  let confirmingDelete = $state("");

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
  onDestroy(trackUnsaved(() => toolsStore.dirty.has("imageGenerate")));

  // Two-step destructive delete: disarm when focus leaves the armed pair.
  function disarmDeleteOnBlur(event: FocusEvent): void {
    const next = event.relatedTarget;
    const container = event.currentTarget instanceof HTMLElement ? event.currentTarget.parentElement : null;
    if (!(next instanceof Node) || !container?.contains(next)) confirmingDelete = "";
  }

  function engineLabel(engine: { id: string; name?: string }): string {
    return engine.name || mediaEngineLabel("image", engine.id);
  }

  function taskEngineLabel(engineId: string): string {
    const found = toolsStore.imageGenerateEdit?.engines.find((e) => e.id === engineId);
    if (found?.name) return found.name;
    return mediaEngineLabel("image", engineId);
  }

  function validateAndAddEngine(): void {
    newEngineError = "";
    const id = newEngineId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (!id || !/^[a-z][a-z0-9_-]{0,63}$/.test(id) || id === "auto") {
      newEngineError = session.text.engineIdHint;
      return;
    }
    if (BUILTIN_IMAGE_ENGINE_IDS.has(id) || toolsStore.imageGenerateEdit?.engines.some((e) => e.id === id)) {
      newEngineError = session.text.engineIdHint;
      return;
    }
    const name = newEngineName.trim();
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
  <SettingGroup><EmptyState title={session.text.imageGenerateUnavailable} icon="image" /></SettingGroup>
{:else if toolsStore.imageGenerateLoading || !toolsStore.imageGenerateEdit}
  <SettingGroup><div class="settings-row"><p>{session.text.loading}</p></div></SettingGroup>
{:else}
  <SettingGroup ariaLabel={session.text.imageGenerate}>
    <SettingRow title={session.text.imageGenerateEnabled}>
      <IosSwitch checked={toolsStore.imageGenerateEdit.enabled} ariaLabel={session.text.imageGenerateEnabled} onCheckedChange={(checked) => { if (toolsStore.imageGenerateEdit) toolsStore.imageGenerateEdit = { ...toolsStore.imageGenerateEdit, enabled: checked }; markToolSettingsDirty("imageGenerate"); }} />
    </SettingRow>
    <SettingRow title={session.text.imageDefaultEngine}>
      <SelectControl
        value={toolsStore.imageGenerateEdit.defaultEngine}
        ariaLabel={session.text.imageDefaultEngine}
        options={[{ value: "auto", label: session.text.mediaEngineAuto }, ...toolsStore.imageGenerateEdit.engines.map((engine) => ({ value: engine.id, label: engineLabel(engine) }))]}
        onChange={(value) => { toolsStore.imageGenerateEdit!.defaultEngine = value; markToolSettingsDirty("imageGenerate"); }}
      />
    </SettingRow>
  </SettingGroup>

  <SettingGroup title={session.text.mediaEngines} contentClass="tool-engine-list">
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
              <input bind:value={engine.baseUrl} autocomplete="off" spellcheck="false" oninput={() => markToolSettingsDirty("imageGenerate")} />
            </label>
            <label class="settings-field">
              <span>{session.text.toolModel}</span>
              <input bind:value={engine.model} autocomplete="off" spellcheck="false" oninput={() => markToolSettingsDirty("imageGenerate")} />
            </label>
            <label class="settings-field settings-field-wide">
              <span>{session.text.toolApiKey}</span>
              <div class="secret-input">
                <input type={secretRevealed(`image:${engine.id}`) ? "text" : "password"} aria-label={session.text.toolApiKey} bind:value={engine.apiKey} placeholder={engine.hasApiKey ? session.text.channelSecretConfigured : ""} autocomplete="new-password" spellcheck="false" oninput={() => markToolSettingsDirty("imageGenerate")} />
                <button class="secret-reveal" type="button" aria-label={session.text.toggleReveal} onclick={(event) => { event.preventDefault(); toggleRevealSecret(`image:${engine.id}`); }}>
                  {#if secretRevealed(`image:${engine.id}`)}<EyeSlash size={16} aria-hidden="true" />{:else}<Eye size={16} aria-hidden="true" />{/if}
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
  </SettingGroup>

  <SettingGroup title={session.text.customEnginesTitle} description={session.text.customEnginesDesc}>
    <svelte:fragment slot="action">
      <button class="secondary-button" type="button" onclick={() => addEngineOpen = true}>{session.text.addEngine}</button>
    </svelte:fragment>
  </SettingGroup>

  <Dialog open={addEngineOpen} contentClass="modal-card" labelledBy="image-add-engine-title" onOpenChange={(next) => { if (!next) closeAddEngine(); }}>
    <header class="modal-head">
      <strong id="image-add-engine-title">{session.text.addEngineTitle}</strong>
      <button class="modal-close" type="button" aria-label={session.text.dialogClose} onclick={closeAddEngine}><X size={16} aria-hidden="true" /></button>
    </header>
    <div class="modal-body">
      <div class="settings-form">
        <label class="settings-field">
          <span>{session.text.engineId}</span>
          <input bind:value={newEngineId} placeholder={session.text.engineIdHint} autocomplete="off" spellcheck="false" />
        </label>
        <label class="settings-field">
          <span>{session.text.engineName}</span>
          <input bind:value={newEngineName} placeholder={session.text.engineName} autocomplete="off" />
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

  <SettingGroup title={session.text.toolTest} contentClass="tool-test-card">
    <div class="settings-form tool-test-form">
      <label class="settings-field">
        <span>{session.text.imageDefaultEngine}</span>
        <SelectControl value={toolsStore.imageTestEngine} ariaLabel={session.text.imageDefaultEngine} options={[{ value: "auto", label: session.text.mediaEngineAuto }, ...toolsStore.imageGenerateEdit.engines.map((engine) => ({ value: engine.id, label: engineLabel(engine) }))]} onChange={(value) => toolsStore.imageTestEngine = value} />
      </label>
      <label class="settings-field">
        <span>{session.text.toolImageSize}</span>
        <SelectControl value={toolsStore.imageTestSize} ariaLabel={session.text.toolImageSize} options={[{ value: "1024x1024", label: "1024 × 1024" }, { value: "1536x1024", label: "1536 × 1024" }, { value: "1024x1536", label: "1024 × 1536" }]} onChange={(value) => toolsStore.imageTestSize = value} />
      </label>
      <label class="settings-field settings-field-wide">
        <span>{session.text.toolPrompt}</span>
        <input bind:value={toolsStore.imageTestPrompt} autocomplete="off" />
      </label>
    </div>
    <div class="settings-row-actions tool-test-actions">
      <button class="secondary-button" type="button" disabled={toolsStore.testBusy} onclick={() => void testToolSettings("imageGenerate")}>{toolsStore.testBusy ? session.text.loading : session.text.toolTest}</button>
    </div>
    {#if toolsStore.testResult}
      <pre class:run-history-failed={!toolsStore.testResult.ok} class="tool-test-result">{JSON.stringify(toolsStore.testResult.result ?? toolsStore.testResult.error, null, 2)}</pre>
    {/if}
  </SettingGroup>

  <SettingGroup title={session.text.mediaTasks}>
    {#if toolsStore.imageTasks.length === 0}
      <EmptyState title={session.text.mediaTasksEmpty} icon="image" />
    {:else}
      {#each toolsStore.imageTasks as task (task.id)}
        <div class="settings-row media-task-row">
          <div class="media-task-summary">
            <span class="status-badge" data-state={task.status === "completed" ? "ready" : task.status === "failed" ? "error" : "pending"}>{task.status === "completed" ? session.text.mediaTaskCompleted : task.status === "failed" ? session.text.mediaTaskFailed : session.text.mediaTaskProcessing}</span>
            <span class="media-task-prompt" title={task.prompt}>{task.prompt}</span>
            <span class="media-task-meta">{taskEngineLabel(task.engine)} · {formatTimestamp(task.createdAt, session.locale)}</span>
          </div>
          <div class="settings-row-actions">
            <button class="secondary-button" type="button" onclick={() => openMediaTaskDetail(task)}>{session.text.mediaTaskView}</button>
            {#if confirmingDelete === task.id}
              <button class="secondary-button danger-action" type="button" disabled={toolsStore.mediaTaskBusy === task.id} onblur={disarmDeleteOnBlur} onclick={() => void removeMediaTask("image", task.id)}>{session.text.confirmDelete}</button>
              <button class="secondary-button" type="button" onblur={disarmDeleteOnBlur} onclick={() => (confirmingDelete = "")}>{session.text.cancel}</button>
            {:else}
              <button class="row-icon-btn danger-action" type="button" title={session.text.mediaTaskDelete} aria-label={session.text.mediaTaskDelete} disabled={toolsStore.mediaTaskBusy === task.id} onclick={() => (confirmingDelete = task.id)}><Trash size={16} aria-hidden="true" /></button>
            {/if}
          </div>
        </div>
      {/each}
    {/if}
  </SettingGroup>

  {#if toolsStore.mediaTaskDetail && toolsStore.mediaTaskDetail.kind === "image"}
    <Dialog
      open={true}
      contentClass="modal-card"
      labelledBy="image-media-task-detail-title"
      onOpenChange={(next) => { if (!next) closeMediaTaskDetail(); }}
    >
      <header class="modal-head">
        <strong id="image-media-task-detail-title">{session.text.mediaTaskDetail}</strong>
        <button class="modal-close" type="button" aria-label={session.text.dialogClose} onclick={() => closeMediaTaskDetail()}><X size={16} aria-hidden="true" /></button>
      </header>
      <div class="modal-body media-task-detail">
        {#if toolsStore.mediaTaskDetail.status === "completed"}
          <div class="media-task-preview-frame">
            {#if toolsStore.mediaTaskDetailUrl}
              <img class="media-task-preview" src={toolsStore.mediaTaskDetailUrl} alt={toolsStore.mediaTaskDetail.prompt} />
            {:else if toolsStore.mediaTaskDetailFailed}
              <button class="media-task-preview-state" type="button" onclick={() => toolsStore.mediaTaskDetail && openMediaTaskDetail(toolsStore.mediaTaskDetail)}>{session.text.mediaLoadFailed}</button>
            {:else}
              <div class="media-task-preview-state"><Refresh class="media-task-spinner" size={16} aria-hidden="true" /><span>{session.text.mediaLoading}</span></div>
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
        <div class="settings-row"><strong>{session.text.mediaTaskCreatedAt}</strong><span>{formatTimestamp(toolsStore.mediaTaskDetail.createdAt, session.locale)}</span></div>
        <div class="settings-row"><strong>{session.text.mediaTaskUpdatedAt}</strong><span>{formatTimestamp(toolsStore.mediaTaskDetail.updatedAt, session.locale)}</span></div>
        {#if toolsStore.mediaTaskDetailUrl}
          <div class="settings-row-actions media-task-detail-actions"><a class="secondary-button" href={toolsStore.mediaTaskDetailUrl} download={`image-${toolsStore.mediaTaskDetail.id}`}>{session.text.mediaTaskDownload}</a></div>
        {/if}
      </div>
    </Dialog>
  {/if}
{/if}

{#if toolsStore.message}<p class="settings-action-message" aria-live="polite">{toolsStore.message}</p>{/if}
{#if toolsStore.dirty.has("imageGenerate")}
  <footer class="settings-footbar">
    <span class="settings-footbar-label">{session.text.settingsUnsaved}</span>
    <div class="settings-footbar-actions">
      <button class="primary-button" type="button" disabled={toolsStore.saving} onclick={() => void saveToolSettings("imageGenerate")}>{toolsStore.saving ? session.text.onboardingProviderSaving : session.text.save}</button>
    </div>
  </footer>
{/if}
