<script lang="ts">
  import Eye from "reicon-svelte/icons/Eye";
  import EyeSlash from "reicon-svelte/icons/EyeSlash";
  import Refresh from "reicon-svelte/icons/Refresh";
  import Trash from "reicon-svelte/icons/Trash";
  import X from "reicon-svelte/icons/X";
  import { onDestroy } from "svelte";
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
    closeMediaTaskDetail,
    ensureMediaPolling,
    stopMediaPolling,
    loadVideoGenerate,
    markToolSettingsDirty,
    mediaEngineLabel,
    openMediaTaskDetail,
    removeMediaTask,
    saveToolSettings,
    secretRevealed,
    testToolSettings,
    toggleRevealSecret
  } from "../stores/tools.svelte";

  let confirmingDelete = $state("");

  $effect(() => {
    if (session.serviceReady && session.endpoint && session.endpoint !== toolsStore.videoGenerateEndpoint) {
      void loadVideoGenerate(session.endpoint);
    }
  });
  $effect(() => {
    void toolsStore.videoTasks;
    ensureMediaPolling("video");
  });

  onDestroy(() => stopMediaPolling("video"));
  onDestroy(trackUnsaved(() => toolsStore.dirty.has("videoGenerate")));

  // Two-step destructive delete: disarm when focus leaves the armed pair.
  function disarmDeleteOnBlur(event: FocusEvent): void {
    const next = event.relatedTarget;
    const container = event.currentTarget instanceof HTMLElement ? event.currentTarget.parentElement : null;
    if (!(next instanceof Node) || !container?.contains(next)) confirmingDelete = "";
  }
</script>

{#if !session.serviceReady}
  <SettingGroup><EmptyState title={session.text.videoGenerateUnavailable} icon="film-strip" /></SettingGroup>
{:else if toolsStore.videoGenerateLoading || !toolsStore.videoGenerateEdit}
  <SettingGroup><div class="settings-row"><p>{session.text.loading}</p></div></SettingGroup>
{:else}
  <SettingGroup ariaLabel={session.text.videoGenerateEnabled}>
    <SettingRow title={session.text.videoGenerateEnabled}>
      <IosSwitch checked={toolsStore.videoGenerateEdit.enabled} ariaLabel={session.text.videoGenerateEnabled} onCheckedChange={(checked) => { if (toolsStore.videoGenerateEdit) toolsStore.videoGenerateEdit = { ...toolsStore.videoGenerateEdit, enabled: checked }; markToolSettingsDirty("videoGenerate"); }} />
    </SettingRow>
    <SettingRow title={session.text.videoDefaultEngine}>
      <SelectControl value={toolsStore.videoGenerateEdit.defaultEngine} ariaLabel={session.text.videoDefaultEngine} options={[{ value: "auto", label: session.text.mediaEngineAuto }, ...toolsStore.videoGenerateEdit.engines.map((engine) => ({ value: engine.id, label: mediaEngineLabel("video", engine.id) }))]} onChange={(value) => { toolsStore.videoGenerateEdit!.defaultEngine = value; markToolSettingsDirty("videoGenerate"); }} />
    </SettingRow>
  </SettingGroup>

  <SettingGroup title={session.text.mediaEngines} contentClass="tool-engine-list">
    {#each toolsStore.videoGenerateEdit.engines as engine (engine.id)}
      <details class="tool-engine-card">
        <summary>
          <span>{mediaEngineLabel("video", engine.id)}</span>
          <span class="status-badge" data-state={engine.enabled ? "ready" : "disconnected"}>{engine.enabled ? session.text.providerEnabled : session.text.providerDisabled}</span>
        </summary>
        <div class="tool-engine-body">
          <div class="settings-row">
            <strong>{session.text.providerEnabledLabel}</strong>
            <IosSwitch checked={engine.enabled} ariaLabel={mediaEngineLabel("video", engine.id)} onCheckedChange={(checked) => { if (toolsStore.videoGenerateEdit) toolsStore.videoGenerateEdit = { ...toolsStore.videoGenerateEdit, engines: toolsStore.videoGenerateEdit.engines.map((item) => item.id === engine.id ? { ...item, enabled: checked } : item) }; markToolSettingsDirty("videoGenerate"); }} />
          </div>
          <div class="settings-form">
            <label class="settings-field">
              <span>{session.text.toolBaseUrl}</span>
              <input bind:value={engine.baseUrl} autocomplete="off" spellcheck="false" oninput={() => markToolSettingsDirty("videoGenerate")} />
            </label>
            <label class="settings-field">
              <span>{session.text.toolModel}</span>
              <input bind:value={engine.model} autocomplete="off" spellcheck="false" oninput={() => markToolSettingsDirty("videoGenerate")} />
            </label>
            <label class="settings-field settings-field-wide">
              <span>{session.text.toolApiKey}</span>
              <div class="secret-input">
                <input type={secretRevealed(`video:${engine.id}`) ? "text" : "password"} aria-label={session.text.toolApiKey} bind:value={engine.apiKey} placeholder={engine.hasApiKey ? session.text.channelSecretConfigured : ""} autocomplete="new-password" spellcheck="false" oninput={() => markToolSettingsDirty("videoGenerate")} />
                <button class="secret-reveal" type="button" aria-label={session.text.toggleReveal} onclick={(event) => { event.preventDefault(); toggleRevealSecret(`video:${engine.id}`); }}>
                  {#if secretRevealed(`video:${engine.id}`)}<EyeSlash size={16} aria-hidden="true" />{:else}<Eye size={16} aria-hidden="true" />{/if}
                </button>
              </div>
              {#if engine.hasApiKey}
                <label class="inline-check">
                  <input type="checkbox" bind:checked={engine.clearApiKey} onchange={() => markToolSettingsDirty("videoGenerate")} />
                  {session.text.channelClearSecret}
                </label>
              {/if}
            </label>
          </div>
        </div>
      </details>
    {/each}
  </SettingGroup>

  <SettingGroup title={session.text.toolTest} contentClass="tool-test-card">
    <div class="settings-form">
      <label class="settings-field">
        <span>{session.text.videoTestEngine}</span>
        <SelectControl value={toolsStore.videoTestEngine} ariaLabel={session.text.videoTestEngine} options={[{ value: "auto", label: session.text.mediaEngineAuto }, ...toolsStore.videoGenerateEdit.engines.map((engine) => ({ value: engine.id, label: mediaEngineLabel("video", engine.id) }))]} onChange={(value) => toolsStore.videoTestEngine = value} />
      </label>
      <label class="settings-field settings-field-wide">
        <span>{session.text.toolPrompt}</span>
        <input bind:value={toolsStore.videoTestPrompt} autocomplete="off" />
      </label>
    </div>
    <div class="settings-row-actions tool-test-actions">
      <button class="secondary-button" type="button" disabled={toolsStore.testBusy} onclick={() => void testToolSettings("videoGenerate")}>{toolsStore.testBusy ? session.text.loading : session.text.toolTest}</button>
    </div>
    {#if toolsStore.testResult}
      <pre class:run-history-failed={!toolsStore.testResult.ok} class="tool-test-result">{JSON.stringify(toolsStore.testResult.result ?? toolsStore.testResult.error, null, 2)}</pre>
    {/if}
  </SettingGroup>

  <SettingGroup title={session.text.mediaTasks}>
    {#if toolsStore.videoTasks.length === 0}
      <EmptyState title={session.text.mediaTasksEmpty} icon="film-strip" />
    {:else}
      {#each toolsStore.videoTasks as task (task.id)}
        <div class="settings-row media-task-row">
          <div class="media-task-summary">
            <span class="status-badge" data-state={task.status === "completed" ? "ready" : task.status === "failed" ? "error" : "pending"}>{task.status === "completed" ? session.text.mediaTaskCompleted : task.status === "failed" ? session.text.mediaTaskFailed : session.text.mediaTaskProcessing}</span>
            <span class="media-task-prompt" title={task.prompt}>{task.prompt}</span>
            <span class="media-task-meta">{mediaEngineLabel("video", task.engine)}{#if task.status === "processing"} · {task.progress ?? 0}%{/if} · {formatTimestamp(task.createdAt, session.locale)}</span>
          </div>
          <div class="settings-row-actions">
            <button class="secondary-button" type="button" onclick={() => openMediaTaskDetail(task)}>{session.text.mediaTaskView}</button>
            {#if confirmingDelete === task.id}
              <button class="secondary-button danger-action" type="button" disabled={toolsStore.mediaTaskBusy === task.id} onblur={disarmDeleteOnBlur} onclick={() => void removeMediaTask("video", task.id)}>{session.text.confirmDelete}</button>
              <button class="secondary-button" type="button" onblur={disarmDeleteOnBlur} onclick={() => (confirmingDelete = "")}>{session.text.cancel}</button>
            {:else}
              <button class="row-icon-btn danger-action" type="button" title={session.text.mediaTaskDelete} aria-label={session.text.mediaTaskDelete} disabled={toolsStore.mediaTaskBusy === task.id} onclick={() => (confirmingDelete = task.id)}><Trash size={16} aria-hidden="true" /></button>
            {/if}
          </div>
        </div>
      {/each}
    {/if}
  </SettingGroup>
  {#if toolsStore.mediaTaskDetail && toolsStore.mediaTaskDetail.kind === "video"}
    <Dialog
      open={true}
      contentClass="modal-card"
      labelledBy="video-media-task-detail-title"
      onOpenChange={(next) => { if (!next) closeMediaTaskDetail(); }}
    >
      <header class="modal-head">
        <strong id="video-media-task-detail-title">{session.text.mediaTaskDetail}</strong>
        <button class="modal-close" type="button" aria-label={session.text.dialogClose} onclick={() => closeMediaTaskDetail()}><X size={16} aria-hidden="true" /></button>
      </header>
      <div class="modal-body media-task-detail">
        {#if toolsStore.mediaTaskDetail.status === "completed"}
          <div class="media-task-preview-frame">
            {#if toolsStore.mediaTaskDetailUrl}
              <video class="media-task-preview" controls src={toolsStore.mediaTaskDetailUrl}><track kind="captions" /></video>
            {:else if toolsStore.mediaTaskDetailFailed}
              <button class="media-task-preview-state" type="button" onclick={() => toolsStore.mediaTaskDetail && openMediaTaskDetail(toolsStore.mediaTaskDetail)}>{session.text.mediaLoadFailed}</button>
            {:else}
              <div class="media-task-preview-state" aria-live="polite"><Refresh class="media-task-spinner" size={16} aria-hidden="true" /><span>{session.text.mediaLoading}</span></div>
            {/if}
          </div>
        {/if}
        <div class="settings-row"><strong>{session.text.mediaTaskEngine}</strong><span>{mediaEngineLabel("video", toolsStore.mediaTaskDetail.engine)}</span></div>
        <div class="settings-row"><strong>{session.text.mediaTaskStatus}</strong><span>{toolsStore.mediaTaskDetail.status === "completed" ? session.text.mediaTaskCompleted : toolsStore.mediaTaskDetail.status === "failed" ? session.text.mediaTaskFailed : session.text.mediaTaskProcessing}</span></div>
        <div class="settings-row"><strong>{session.text.mediaTaskProgress}</strong><span>{toolsStore.mediaTaskDetail.progress ?? 0}%</span></div>
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
          <div class="settings-row-actions media-task-detail-actions"><a class="secondary-button" href={toolsStore.mediaTaskDetailUrl} download={`video-${toolsStore.mediaTaskDetail.id}`}>{session.text.mediaTaskDownload}</a></div>
        {/if}
      </div>
    </Dialog>
  {/if}
{/if}

{#if toolsStore.message}<p class="settings-action-message" aria-live="polite">{toolsStore.message}</p>{/if}
{#if toolsStore.dirty.has("videoGenerate")}
  <footer class="settings-footbar">
    <span class="settings-footbar-label">{session.text.settingsUnsaved}</span>
    <div class="settings-footbar-actions">
      <button class="primary-button" type="button" disabled={toolsStore.saving} onclick={() => void saveToolSettings("videoGenerate")}>{toolsStore.saving ? session.text.onboardingProviderSaving : session.text.save}</button>
    </div>
  </footer>
{/if}
