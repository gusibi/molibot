<script lang="ts">
  import { session } from "../stores/session.svelte";
  import { timezoneOptions } from "./timezones";
  import {
    tasksStore,
    beginTaskEdit,
    executeTaskAction,
    loadTasks,
    openTaskSession,
    saveTaskEditor,
    taskStatusLabel,
    taskTypeLabel,
    toggleTaskSelection
  } from "../stores/tasks.svelte";

  $effect(() => {
    if (session.serviceReady && session.endpoint && session.endpoint !== tasksStore.endpoint) {
      void loadTasks(session.endpoint);
    }
  });

  const filteredTaskItems = $derived(
    tasksStore.tasks?.items.filter((item) => !tasksStore.query.trim() || [item.text, item.channel, item.botId, item.chatId, item.status, item.type].join("\n").toLowerCase().includes(tasksStore.query.trim().toLowerCase())) ?? []
  );
</script>

<p class="settings-section-hint">{session.text.tasksHint}</p>
{#if !session.serviceReady}
  <div class="settings-card"><div class="settings-row"><p>{session.text.tasksUnavailable}</p></div></div>
{:else if tasksStore.loading || !tasksStore.tasks}
  <div class="settings-card"><div class="settings-row"><p>{session.text.loading}</p></div></div>
{:else}
  <div class="settings-card">
    <div class="settings-row"><strong>{session.text.tasksTotal}</strong><span class="diag-value">{tasksStore.tasks.counts.total}</span></div>
    <div class="settings-row"><strong>{session.text.tasksByStatus}</strong><span class="diag-value">{session.text.taskStatusPending}: {tasksStore.tasks.counts.byStatus.pending} · {session.text.taskStatusRunning}: {tasksStore.tasks.counts.byStatus.running} · {session.text.taskStatusCompleted}: {tasksStore.tasks.counts.byStatus.completed} · {session.text.taskStatusError}: {tasksStore.tasks.counts.byStatus.error}</span></div>
    <div class="settings-row"><strong>{session.text.tasksByScope}</strong><span class="diag-value">{session.text.taskScopeWorkspace}: {tasksStore.tasks.counts.byScope.workspace} · {session.text.taskScopeChat}: {tasksStore.tasks.counts.byScope.chatScratch}</span></div>
  </div>
  <div class="settings-card provider-editor">
    <div class="settings-form"><label class="settings-field settings-field-wide"><span>{session.text.tasksFilter}</span><input bind:value={tasksStore.query} placeholder={session.text.tasksFilterHint} /></label></div>
    <div class="task-bulk-bar">
      <span class="task-bulk-count"><i class="ph ph-check-square" aria-hidden="true"></i>{tasksStore.selected.size}</span>
      <button class="tertiary-button" type="button" disabled={filteredTaskItems.length === 0} onclick={() => (tasksStore.selected = new Set(filteredTaskItems.map((item) => item.id)))}>{session.text.tasksSelectAll}</button>
      <button class="tertiary-button" type="button" disabled={tasksStore.selected.size === 0} onclick={() => (tasksStore.selected = new Set())}>{session.text.tasksClearSelection}</button>
      <span class="task-bulk-spacer"></span>
      <button class="secondary-button" type="button" disabled={tasksStore.selected.size === 0 || Boolean(tasksStore.busy)} onclick={() => void executeTaskAction("trigger", [...tasksStore.selected])}>{session.text.tasksTriggerSelected}</button>
      <button class="secondary-button danger-action" type="button" disabled={tasksStore.selected.size === 0 || Boolean(tasksStore.busy)} onclick={() => void executeTaskAction("delete", [...tasksStore.selected])}>{session.text.tasksDeleteSelected}</button>
    </div>
  </div>
  {#if filteredTaskItems.length === 0}
    <div class="settings-card"><div class="settings-row"><p>{session.text.tasksEmpty}</p></div></div>
  {:else}
    <div class="settings-card">
      {#each filteredTaskItems as task (task.id)}
        <div class="settings-row">
          <label class="inline-check task-select"><input type="checkbox" checked={tasksStore.selected.has(task.id)} onchange={() => toggleTaskSelection(task.id)} /><span class="sr-only">{session.text.tasksSelect}</span></label>
          <div class="profile-info">
            <strong>{task.channel} / {task.botId}{task.chatId ? ` / ${task.chatId}` : ""}</strong>
            <p>{taskTypeLabel(task.type, session.text)} · {task.scheduleText || task.delivery} · {task.timezone}</p>
            <p>{taskStatusLabel(task.status, session.text)}{task.runCount > 0 ? ` · ${session.text.tasksRunCount}: ${task.runCount}` : ""}{task.lastTriggeredAt ? ` · ${session.text.tasksLastTriggered}: ${task.lastTriggeredAt.slice(0, 19).replace("T", " ")}` : ""}</p>
            <p class="task-text-preview" title={task.text}>{task.text.split(/\r?\n/)[0] || task.text}</p>
            {#if task.lastError}<p class="run-history-failed">{task.lastError}</p>{/if}
            <div class="task-execution-list">
              <strong>{session.text.tasksExecutions}</strong>
              {#if task.executions.length === 0}
                <p>{session.text.tasksNoExecutions}</p>
              {:else}
                {#each task.executions.slice(0, 5) as execution (execution.id)}
                  <div class="task-execution-row">
                    <span>{execution.status} · {execution.startedAt.slice(0, 19).replace("T", " ")}</span>
                    <span>{session.text.tasksRunCount}: {execution.attempt}/{execution.maxAttempts}</span>
                    <button class="task-session-link" type="button" title={execution.sessionId} disabled={Boolean(tasksStore.busy) || !execution.sessionId} onclick={() => void openTaskSession(task.id, execution.id)}>
                      {session.text.tasksSession}: {execution.sessionId || session.text.tasksSessionCleaned}
                    </button>
                    {#if execution.lastError}<span class="run-history-failed">{execution.lastError}</span>{/if}
                  </div>
                {/each}
              {/if}
            </div>
          </div>
          <div class="row-icon-actions">
            <button class="row-icon-btn" type="button" title={session.text.tasksTrigger} aria-label={session.text.tasksTrigger} disabled={Boolean(tasksStore.busy)} onclick={() => void executeTaskAction("trigger", [task.id])}><i class="ph ph-play" aria-hidden="true"></i></button>
            <button class="row-icon-btn" type="button" title={session.text.channelEdit} aria-label={session.text.channelEdit} disabled={Boolean(tasksStore.busy) || tasksStore.taskEdit !== null} onclick={() => beginTaskEdit(task)}><i class="ph ph-pencil-simple" aria-hidden="true"></i></button>
            <button class="row-icon-btn danger-action" type="button" title={session.text.channelDelete} aria-label={session.text.channelDelete} disabled={Boolean(tasksStore.busy)} onclick={() => void executeTaskAction("delete", [task.id])}><i class="ph ph-trash" aria-hidden="true"></i></button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
  {#if tasksStore.taskEdit}
    <form id="desktop-task-form" class="settings-card provider-editor" aria-label={session.text.tasks} onsubmit={(event) => { event.preventDefault(); void saveTaskEditor(); }}>
      <header class="entity-editor-head"><strong>{session.text.tasks} · {tasksStore.taskEdit.channel} / {tasksStore.taskEdit.botId}</strong><button class="modal-close" type="button" aria-label={session.text.cancel} disabled={Boolean(tasksStore.busy)} onclick={() => (tasksStore.taskEdit = null)}><i class="ph ph-x"></i></button></header>
      <label class="settings-field settings-field-wide"><span>{session.text.tasksText}</span><textarea rows="6" bind:value={tasksStore.taskEdit.draftText}></textarea></label>
      <div class="settings-form"><label class="settings-field"><span>{session.text.tasksDelivery}</span><select bind:value={tasksStore.taskEdit.draftDelivery}><option value="agent">agent</option><option value="text">text</option></select></label><label class="settings-field"><span>{session.text.tasksSessionMode}</span><select bind:value={tasksStore.taskEdit.draftSessionMode}><option value="chat">chat</option><option value="fresh">fresh</option></select></label>{#if tasksStore.taskEdit.type !== "immediate"}<label class="settings-field"><span>{session.text.tasksSchedule}</span><input bind:value={tasksStore.taskEdit.draftSchedule} /></label>{/if}{#if tasksStore.taskEdit.type === "periodic"}<label class="settings-field"><span>{session.text.tasksTimezone}</span><select bind:value={tasksStore.taskEdit.draftTimezone}>{#if tasksStore.taskEdit.draftTimezone && !timezoneOptions().includes(tasksStore.taskEdit.draftTimezone)}<option value={tasksStore.taskEdit.draftTimezone}>{tasksStore.taskEdit.draftTimezone}</option>{/if}{#each timezoneOptions() as tz (tz)}<option value={tz}>{tz}</option>{/each}</select></label>{/if}</div>
      <footer class="entity-editor-foot"><button class="secondary-button" type="button" disabled={Boolean(tasksStore.busy)} onclick={() => (tasksStore.taskEdit = null)}>{session.text.cancel}</button><button class="primary-button" type="submit" disabled={Boolean(tasksStore.busy) || !tasksStore.taskEdit.draftText.trim()}>{tasksStore.busy ? session.text.onboardingProviderSaving : session.text.save}</button></footer>
    </form>
  {/if}
  {#if tasksStore.actionMessage}<p class="settings-action-message">{tasksStore.actionMessage}</p>{/if}
  {#if tasksStore.taskSession}
    <div class="modal-overlay" role="dialog" aria-modal="true" tabindex="-1" aria-label={session.text.tasksSession} onclick={() => (tasksStore.taskSession = null)} onkeydown={(event) => { if (event.key === "Escape") tasksStore.taskSession = null; }}>
      <div class="modal-card" tabindex="-1" role="presentation" onclick={(event) => event.stopPropagation()} onkeydown={(event) => event.stopPropagation()}>
        <header class="modal-head">
          <strong>{session.text.tasksSession} · {tasksStore.taskSession.sessionId}</strong>
          <button class="modal-close" type="button" aria-label={session.text.cancel} onclick={() => (tasksStore.taskSession = null)}><i class="ph ph-x"></i></button>
        </header>
        <div class="modal-body task-session-detail">
          {#if tasksStore.taskSession.messages.length === 0}
            <p>{session.text.tasksSessionCleaned}</p>
          {:else}
            {#each tasksStore.taskSession.messages as message, index (`${index}-${message.role}`)}
              <div class="task-session-message">
                <strong>{message.role || "message"}</strong>
                <p>{message.content}</p>
              </div>
            {/each}
          {/if}
        </div>
      </div>
    </div>
  {/if}
{/if}
