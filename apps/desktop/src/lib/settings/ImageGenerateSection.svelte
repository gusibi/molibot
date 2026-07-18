<script lang="ts">
  import { onDestroy } from "svelte";
  import Dialog from "../components/ui/Dialog.svelte";
  import IosSwitch from "../components/ui/IosSwitch.svelte";
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
    toggleRevealSecret
  } from "../stores/tools.svelte";

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
</script>

{#if !session.serviceReady}
  <div class="settings-card"><div class="settings-row"><p>{session.text.imageGenerateUnavailable}</p></div></div>
{:else if toolsStore.imageGenerateLoading || !toolsStore.imageGenerateEdit}
  <div class="settings-card"><div class="settings-row"><p>{session.text.loading}</p></div></div>
{:else}
  <div class="settings-card"><div class="settings-row"><strong>{session.text.webSearchEnabled}</strong><IosSwitch checked={toolsStore.imageGenerateEdit.enabled} ariaLabel={session.text.imageGenerate} onCheckedChange={(checked) => { if (toolsStore.imageGenerateEdit) toolsStore.imageGenerateEdit = { ...toolsStore.imageGenerateEdit, enabled: checked }; markToolSettingsDirty("imageGenerate"); }} /></div><div class="settings-row"><strong>{session.text.webSearchDefaultEngine}</strong><select bind:value={toolsStore.imageGenerateEdit.defaultEngine} onchange={() => markToolSettingsDirty("imageGenerate")}><option value="auto">{session.text.mediaEngineAuto}</option>{#each toolsStore.imageGenerateEdit.engines as engine (engine.id)}<option value={engine.id}>{mediaEngineLabel("image", engine.id)}</option>{/each}</select></div></div>
  <p class="settings-group-title">{session.text.mediaEngines}</p><div class="settings-card tool-engine-list">{#each toolsStore.imageGenerateEdit.engines as engine (engine.id)}<details class="tool-engine-card"><summary><span>{mediaEngineLabel("image", engine.id)}</span><span class="status-badge" data-state={engine.enabled ? "ready" : "disconnected"}>{engine.enabled ? session.text.providerEnabled : session.text.providerDisabled}</span></summary><div class="tool-engine-body"><div class="settings-row"><strong>{session.text.providerEnabledLabel}</strong><IosSwitch checked={engine.enabled} ariaLabel={mediaEngineLabel("image", engine.id)} onCheckedChange={(checked) => { if (toolsStore.imageGenerateEdit) toolsStore.imageGenerateEdit = { ...toolsStore.imageGenerateEdit, engines: toolsStore.imageGenerateEdit.engines.map((item) => item.id === engine.id ? { ...item, enabled: checked } : item) }; markToolSettingsDirty("imageGenerate"); }} /></div><div class="settings-form"><label class="settings-field"><span>{session.text.toolBaseUrl}</span><input bind:value={engine.baseUrl} oninput={() => markToolSettingsDirty("imageGenerate")} /></label><label class="settings-field"><span>{session.text.toolModel}</span><input bind:value={engine.model} oninput={() => markToolSettingsDirty("imageGenerate")} /></label><label class="settings-field settings-field-wide"><span>{session.text.webSearchApiKey}</span><div class="secret-input"><input type={secretRevealed(`image:${engine.id}`) ? "text" : "password"} bind:value={engine.apiKey} placeholder={engine.hasApiKey ? session.text.channelSecretConfigured : ""} autocomplete="new-password" oninput={() => markToolSettingsDirty("imageGenerate")} /><button class="secret-reveal" type="button" aria-label={session.text.toggleReveal} onclick={(event) => { event.preventDefault(); toggleRevealSecret(`image:${engine.id}`); }}><i class={`ph ${secretRevealed(`image:${engine.id}`) ? "ph-eye-slash" : "ph-eye"}`}></i></button></div>{#if engine.hasApiKey}<label class="inline-check"><input type="checkbox" bind:checked={engine.clearApiKey} onchange={() => markToolSettingsDirty("imageGenerate")} /> {session.text.channelClearSecret}</label>{/if}</label></div></div></details>{/each}</div>
  <p class="settings-group-title">{session.text.toolTest}</p><div class="settings-card tool-test-card"><div class="settings-form"><label class="settings-field"><span>{session.text.webSearchDefaultEngine}</span><select bind:value={toolsStore.imageTestEngine}><option value="auto">{session.text.mediaEngineAuto}</option>{#each toolsStore.imageGenerateEdit.engines as engine (engine.id)}<option value={engine.id}>{mediaEngineLabel("image", engine.id)}</option>{/each}</select></label><label class="settings-field settings-field-wide"><span>{session.text.toolPrompt}</span><input bind:value={toolsStore.imageTestPrompt} /></label><label class="settings-field"><span>{session.text.toolImageSize}</span><select bind:value={toolsStore.imageTestSize}><option value="1024x1024">1024 × 1024</option><option value="1536x1024">1536 × 1024</option><option value="1024x1536">1024 × 1536</option></select></label></div><div class="settings-row-actions tool-test-actions"><button class="secondary-button" type="button" disabled={toolsStore.testBusy} onclick={() => void testToolSettings("imageGenerate")}>{toolsStore.testBusy ? session.text.loading : session.text.toolTest}</button></div>{#if toolsStore.testResult}<pre class:run-history-failed={!toolsStore.testResult.ok} class="tool-test-result">{JSON.stringify(toolsStore.testResult.result ?? toolsStore.testResult.error, null, 2)}</pre>{/if}</div>
  <p class="settings-group-title">{session.text.mediaTasks}</p>{#if toolsStore.imageTasks.length === 0}<div class="settings-card"><div class="settings-row"><p>{session.text.mediaTasksEmpty}</p></div></div>{:else}<div class="settings-card">{#each toolsStore.imageTasks as task (task.id)}<div class="settings-row media-task-row"><div class="media-task-summary"><span class="status-badge" data-state={task.status === "completed" ? "ready" : task.status === "failed" ? "error" : "pending"}>{task.status === "completed" ? session.text.mediaTaskCompleted : task.status === "failed" ? session.text.mediaTaskFailed : session.text.mediaTaskProcessing}</span><span class="media-task-prompt" title={task.prompt}>{task.prompt}</span><span class="media-task-meta">{mediaEngineLabel("image", task.engine)} · {task.createdAt.slice(0, 19).replace("T", " ")}</span></div><div class="settings-row-actions"><button class="secondary-button" type="button" onclick={() => openMediaTaskDetail(task)}>{session.text.mediaTaskView}</button><button class="row-icon-btn danger-action" type="button" title={session.text.mediaTaskDelete} aria-label={session.text.mediaTaskDelete} disabled={toolsStore.mediaTaskBusy === task.id} onclick={() => void removeMediaTask("image", task.id)}><i class="ph ph-trash" aria-hidden="true"></i></button></div></div>{/each}</div>{/if}
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
        <div class="settings-row"><strong>{session.text.mediaTaskEngine}</strong><span>{mediaEngineLabel("image", toolsStore.mediaTaskDetail.engine)}</span></div>
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
