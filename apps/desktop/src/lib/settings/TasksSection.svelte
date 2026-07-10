<script lang="ts">
  import { session } from "../stores/session.svelte";
  import type { DesktopTaskSummary } from "@molibot/desktop-contract";
  import { timezoneOptions } from "./timezones";
  import TaskScheduleBuilder from "./TaskScheduleBuilder.svelte";
  import { externalChannelLabel } from "../stores/channels.svelte";
  import ConversationTranscript from "../chat/ConversationTranscript.svelte";
  import {
    tasksStore,
    beginTaskCreate,
    beginTaskEdit,
    executeTaskAction,
    isTaskRunning,
    isTaskUpdating,
    loadTaskHistoryPage,
    loadTasks,
    openTaskSession,
    saveTaskCreate,
    saveTaskEditor,
    setTaskEnabled,
    selectTaskCreateTarget,
    taskStatusLabel,
    openTaskHistory,
    toggleTaskSelection,
    requestDeleteTask,
    confirmDeleteTask,
    cancelDeleteTask
  } from "../stores/tasks.svelte";

  let { presentation = "settings" }: { presentation?: "settings" | "workspace" } = $props();

  let selectedTaskId = $state("");

  $effect(() => {
    if (session.serviceReady && session.endpoint && session.endpoint !== tasksStore.endpoint) {
      void loadTasks(session.endpoint);
    }
  });

  const filteredTaskItems = $derived(
    tasksStore.tasks?.items.filter((item) => !tasksStore.query.trim() || [item.text, item.channel, item.botId, item.chatId, item.status, item.type].join("\n").toLowerCase().includes(tasksStore.query.trim().toLowerCase())) ?? []
  );

  const selectedTask = $derived(selectedTaskId ? filteredTaskItems.find((task) => task.id === selectedTaskId) ?? null : null);
  const executionTotals = $derived(tasksStore.tasks?.counts.executions ?? { total: 0, completed: 0, failed: 0 });

  const taskTargetGroups = $derived.by(() => {
    const groups = new Map<string, { key: string; label: string; options: Array<{ index: number; label: string }> }>();
    for (const [index, target] of (tasksStore.tasks?.targets ?? []).entries()) {
      const key = `${target.channel}\n${target.botId}`;
      const channel = target.channel === "web"
        ? "Web"
        : externalChannelLabel(target.channel as "telegram" | "feishu" | "qq" | "weixin", session.locale);
      const group = groups.get(key) ?? { key, label: `${channel} · ${target.botDisplayName || target.botId}`, options: [] };
      group.options.push({ index, label: target.chatId });
      groups.set(key, group);
    }
    return [...groups.values()];
  });

  const selectedTaskTargetGroup = $derived(tasksStore.taskCreate ? `${tasksStore.taskCreate.channel}\n${tasksStore.taskCreate.botId}` : "");

  function selectTaskTargetGroup(key: string): void {
    const first = taskTargetGroups.find((group) => group.key === key)?.options[0];
    if (first) selectTaskCreateTarget(first.index);
  }

  function formatSessionTime(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(session.locale, { hour: "2-digit", minute: "2-digit" }).format(date);
  }

  function formatTaskTime(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? session.text.tasksNeverRun : new Intl.DateTimeFormat(session.locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
  }

  function taskStatusText(task: DesktopTaskSummary["items"][number]): string {
    return task.enabled ? taskStatusLabel(task.status, session.text) : session.text.tasksPaused;
  }

  function pageSummary(page: number, pageSize: number, total: number): string {
    return session.text.tasksPageSummary.replace("{page}", String(page)).replace("{pages}", String(Math.max(1, Math.ceil(total / pageSize)))).replace("{total}", String(total));
  }

  function executionStatusLabel(status: "running" | "retry_wait" | "completed" | "failed" | "aborted" | "skipped"): string {
    return session.text[`taskExecution_${status}`];
  }

  function taskBody(text: string): string {
    return text.split(/\r?\n/).slice(1).join("\n").trim();
  }
</script>

{#if !session.serviceReady}
  <div class="settings-card"><div class="settings-row"><p>{session.text.tasksUnavailable}</p></div></div>
{:else if tasksStore.loading || !tasksStore.tasks}
  <div class="settings-card"><div class="settings-row"><p>{session.text.loading}</p></div></div>
{:else}
  {#if presentation === "workspace"}
    <section class="automation-workspace" aria-label={session.text.tasks}>
      <div class="automation-workspace-toolbar">
        <label class="automation-workspace-search"><i class="ph ph-magnifying-glass" aria-hidden="true"></i><input bind:value={tasksStore.query} aria-label={session.text.tasksFilter} placeholder={session.text.tasksFilterHint} /></label>
        <button class="primary-button automation-workspace-create" type="button" disabled={Boolean(tasksStore.busy) || tasksStore.tasks.targets.length === 0} onclick={beginTaskCreate}><i class="ph ph-plus" aria-hidden="true"></i>{session.text.tasksCreate}</button>
      </div>
      <div class="automation-workspace-summary" aria-label={session.text.tasksTotal}>
        <span><strong>{tasksStore.tasks.counts.total}</strong>{session.text.tasksTotal}</span>
        <span><strong>{executionTotals.total}</strong>{session.text.tasksRunCount}</span>
        <span><strong>{executionTotals.completed}</strong>{session.text.tasksSuccessful}</span>
        <span><strong>{executionTotals.failed}</strong>{session.text.tasksFailed}</span>
      </div>
      {#if filteredTaskItems.length === 0}
        <div class="workspace-empty compact"><p>{session.text.tasksEmpty}</p></div>
      {:else}
        <div class:detail-open={Boolean(selectedTask)} class="automation-workspace-layout">
          <div class="automation-workspace-list" role="listbox" aria-label={session.text.tasks}>
            {#each filteredTaskItems as task (task.id)}
              <button class:active={selectedTask?.id === task.id} class:running={isTaskRunning(task.id)} class:paused={!task.enabled} class="automation-task-row" data-status={task.status} type="button" role="option" aria-selected={selectedTask?.id === task.id} onclick={() => (selectedTaskId = task.id)}>
                <span class="automation-task-row-mark" aria-hidden="true">{#if isTaskRunning(task.id)}<i class="ph ph-spinner-gap automation-spinner"></i>{:else}<i></i>{/if}</span>
                <span class="automation-task-row-copy"><strong>{task.text.split(/\r?\n/)[0] || task.text}</strong><span>{task.scheduleText} · {taskStatusText(task)}</span><small><span>{session.text.tasksRunCount} {task.runCount}</span><span>{session.text.tasksLastTriggered} {formatTaskTime(task.lastTriggeredAt || task.executions[0]?.startedAt || "")}</span></small></span>
                <i class="ph ph-caret-right" aria-hidden="true"></i>
              </button>
            {/each}
          </div>
          {#if selectedTask}
            <article class="automation-task-detail" aria-labelledby={`automation-task-${selectedTask.id}`}>
              <button class="automation-detail-close" type="button" title={session.text.tasksCloseDetails} aria-label={session.text.tasksCloseDetails} onclick={() => (selectedTaskId = "")}><i class="ph ph-x" aria-hidden="true"></i></button>
              <header class="automation-task-detail-head">
                <div class="automation-task-detail-topbar">
                  <span class:active={isTaskRunning(selectedTask.id)} class:error={selectedTask.status === "error"} class:paused={!selectedTask.enabled} class="automation-status"><i></i>{taskStatusText(selectedTask)}</span>
                  <div class="automation-task-detail-actions">
                    <button class="automation-run-button" type="button" disabled={!selectedTask.enabled || isTaskRunning(selectedTask.id) || isTaskUpdating(selectedTask.id)} onclick={() => void executeTaskAction("trigger", [selectedTask.id])}>{#if isTaskRunning(selectedTask.id)}<i class="ph ph-spinner-gap automation-spinner" aria-hidden="true"></i>{:else}<i class="ph-fill ph-play" aria-hidden="true"></i>{/if}{isTaskRunning(selectedTask.id) ? session.text.taskStatus_running : session.text.tasksTrigger}</button>
                    <button class="row-icon-btn" type="button" title={selectedTask.enabled ? session.text.tasksPause : session.text.tasksResume} aria-label={selectedTask.enabled ? session.text.tasksPause : session.text.tasksResume} disabled={isTaskRunning(selectedTask.id) || isTaskUpdating(selectedTask.id)} onclick={() => void setTaskEnabled(selectedTask.id, !selectedTask.enabled)}><i class={`ph ${selectedTask.enabled ? "ph-pause" : "ph-play"}`} aria-hidden="true"></i></button>
                    <button class="row-icon-btn" type="button" title={session.text.channelEdit} aria-label={session.text.channelEdit} disabled={Boolean(tasksStore.busy) || tasksStore.taskEdit !== null} onclick={() => beginTaskEdit(selectedTask)}><i class="ph ph-pencil-simple" aria-hidden="true"></i></button>
                    <button class="row-icon-btn danger-action" type="button" title={session.text.channelDelete} aria-label={session.text.channelDelete} disabled={Boolean(tasksStore.busy)} onclick={() => requestDeleteTask([selectedTask.id])}><i class="ph ph-trash" aria-hidden="true"></i></button>
                  </div>
                </div>
                <div>
                  <h2 id={`automation-task-${selectedTask.id}`}>{selectedTask.text.split(/\r?\n/)[0] || selectedTask.text}</h2>
                  <p>{selectedTask.channel} / {selectedTask.botId}{selectedTask.chatId ? ` / ${selectedTask.chatId}` : ""}</p>
                </div>
              </header>
              <section class="automation-task-detail-copy" aria-label={session.text.tasksText}><span>{session.text.tasksText}</span><p>{selectedTask.text}</p></section>
              <dl class="automation-task-facts">
                <div><dt>{session.text.tasksSchedule}</dt><dd><i class="ph ph-calendar-dots" aria-hidden="true"></i>{selectedTask.scheduleText}</dd></div>
                <div><dt>{session.text.tasksTimezone}</dt><dd>{selectedTask.timezone}</dd></div>
                <div><dt>{session.text.tasksDelivery}</dt><dd>{selectedTask.delivery}</dd></div>
                <div><dt>{session.text.tasksLastTriggered}</dt><dd>{formatTaskTime(selectedTask.lastTriggeredAt || selectedTask.executions[0]?.startedAt || "")}</dd></div>
              </dl>
              {#if selectedTask.lastError}<p class="run-history-failed">{selectedTask.lastError}</p>{/if}
              <section class="automation-task-runs" aria-labelledby={`automation-task-runs-${selectedTask.id}`}>
                <header><h3 id={`automation-task-runs-${selectedTask.id}`}>{session.text.tasksRecentRuns}</h3><span>{selectedTask.executionCount}</span></header>
                {#if selectedTask.executions.length === 0}
                  <p>{session.text.tasksNoExecutions}</p>
                {:else}
                  {#each selectedTask.executions as execution (execution.id)}
                    <div class="automation-task-run-row">
                      <span class={`execution-state state-${execution.status}`}><i></i>{executionStatusLabel(execution.status)}</span>
                      <span>{formatTaskTime(execution.startedAt)}</span>
                      <button class="task-session-link" type="button" title={execution.sessionId} disabled={Boolean(tasksStore.busy) || !execution.sessionId} onclick={() => void openTaskSession(selectedTask.id, execution.id)}>{execution.sessionId || session.text.tasksSessionCleaned}</button>
                    </div>
                  {/each}
                {/if}
                <button class="task-history-toggle" type="button" disabled={Boolean(tasksStore.busy) && tasksStore.busy !== `history:${selectedTask.id}`} onclick={() => void openTaskHistory(selectedTask.id)}>{session.text.tasksViewAllRuns}<i class="ph ph-arrow-square-out"></i></button>
              </section>
            </article>
          {/if}
        </div>
      {/if}
    </section>
  {:else}
  <section class="automation-command-deck" aria-label={session.text.tasksByStatus}>
    <div class="automation-command-summary">
      <div class="automation-command-mark" aria-hidden="true"><i class="ph-fill ph-clock-countdown"></i><span></span></div>
      <div><span class="automation-eyebrow">{session.text.tasksTotal}</span><strong>{tasksStore.tasks.counts.total}</strong><small>{session.text.tasksHint}</small></div>
    </div>
    <div class="automation-command-stats">
      <div><span class="stat-signal running"></span><small>{session.text.taskStatusRunning}</small><strong>{tasksStore.tasks.counts.byStatus.running}</strong></div>
      <div><span class="stat-signal error"></span><small>{session.text.taskStatusError}</small><strong>{tasksStore.tasks.counts.byStatus.error}</strong></div>
      <div><span class="stat-signal completed"></span><small>{session.text.tasksRunCount}</small><strong>{tasksStore.tasks.items.reduce((total, item) => total + item.runCount, 0)}</strong></div>
    </div>
    <div class="automation-toolbar">
      <label class="automation-search"><i class="ph ph-magnifying-glass" aria-hidden="true"></i><input bind:value={tasksStore.query} aria-label={session.text.tasksFilter} placeholder={session.text.tasksFilterHint} /></label>
      <button class="primary-button automation-create-button" type="button" disabled={Boolean(tasksStore.busy) || tasksStore.tasks.targets.length === 0} onclick={beginTaskCreate}><i class="ph ph-plus" aria-hidden="true"></i>{session.text.tasksCreate}</button>
    </div>
  </section>
  {#if tasksStore.selected.size > 0}
    <div class="task-bulk-bar">
      <span class="task-bulk-count"><i class="ph ph-check-square" aria-hidden="true"></i>{tasksStore.selected.size}</span>
      <button class="tertiary-button" type="button" disabled={filteredTaskItems.length === 0} onclick={() => (tasksStore.selected = new Set(filteredTaskItems.map((item) => item.id)))}>{session.text.tasksSelectAll}</button>
      <button class="tertiary-button" type="button" disabled={tasksStore.selected.size === 0} onclick={() => (tasksStore.selected = new Set())}>{session.text.tasksClearSelection}</button>
      <span class="task-bulk-spacer"></span>
      <button class="secondary-button" type="button" disabled={tasksStore.selected.size === 0 || Boolean(tasksStore.busy)} onclick={() => void executeTaskAction("trigger", [...tasksStore.selected])}>{session.text.tasksTriggerSelected}</button>
      <button class="secondary-button danger-action" type="button" disabled={tasksStore.selected.size === 0 || Boolean(tasksStore.busy)} onclick={() => requestDeleteTask([...tasksStore.selected])}>{session.text.tasksDeleteSelected}</button>
    </div>
  {/if}
  {#if filteredTaskItems.length === 0}
    <div class="settings-card"><div class="settings-row"><p>{session.text.tasksEmpty}</p></div></div>
  {:else}
    <div class="automation-list">
      {#each filteredTaskItems as task (task.id)}
        <article class="automation-card" data-status={task.status}>
          <label class="inline-check task-select"><input type="checkbox" checked={tasksStore.selected.has(task.id)} onchange={() => toggleTaskSelection(task.id)} /><span class="sr-only">{session.text.tasksSelect}</span></label>
          <div class="automation-card-main">
            <div class="automation-card-head">
              <div class="automation-title-block"><div><span class:active={task.status === "running"} class:error={task.status === "error"} class="automation-status"><i></i>{taskStatusLabel(task.status, session.text)}</span><span class="automation-target"><i class="ph ph-robot"></i>{task.channel} / {task.botId}{task.chatId ? ` / ${task.chatId}` : ""}</span></div><strong>{task.text.split(/\r?\n/)[0] || task.text}</strong></div>
              <div class="automation-card-actions">
                <button class="automation-run-button" type="button" disabled={Boolean(tasksStore.busy)} onclick={() => void executeTaskAction("trigger", [task.id])}><i class="ph-fill ph-play" aria-hidden="true"></i>{session.text.tasksTrigger}</button>
                <button class="row-icon-btn" type="button" title={session.text.channelEdit} aria-label={session.text.channelEdit} disabled={Boolean(tasksStore.busy) || tasksStore.taskEdit !== null} onclick={() => beginTaskEdit(task)}><i class="ph ph-pencil-simple" aria-hidden="true"></i></button>
                <button class="row-icon-btn danger-action" type="button" title={session.text.channelDelete} aria-label={session.text.channelDelete} disabled={Boolean(tasksStore.busy)} onclick={() => requestDeleteTask([task.id])}><i class="ph ph-trash" aria-hidden="true"></i></button>
              </div>
            </div>
            <div class:single={!taskBody(task.text)} class="automation-card-body">
              {#if taskBody(task.text)}<div class="automation-task-copy"><span>{session.text.tasksText}</span><p class="task-text-preview" title={task.text}>{taskBody(task.text)}</p></div>{/if}
              <div class="automation-schedule-panel">
                <span>{session.text.tasksSchedule}</span>
                <strong><i class="ph ph-calendar-dots"></i>{task.scheduleText}</strong>
                <small><i class="ph ph-globe"></i>{task.timezone}</small>
                <small><i class="ph ph-clock-counter-clockwise"></i>{formatTaskTime(task.lastTriggeredAt || task.executions[0]?.startedAt || "")}</small>
              </div>
            </div>
            {#if task.lastError}<p class="run-history-failed">{task.lastError}</p>{/if}
            <div class="task-execution-list">
              <div class="task-execution-head"><strong>{session.text.tasksRecentRuns}</strong><span>{task.executionCount}</span></div>
              {#if task.executions.length === 0}
                <p>{session.text.tasksNoExecutions}</p>
              {:else}
                {#each task.executions as execution (execution.id)}
                  <div class="task-execution-row">
                    <span class={`execution-state state-${execution.status}`}><i></i>{executionStatusLabel(execution.status)}</span>
                    <span>{formatTaskTime(execution.startedAt)}</span>
                    <button class="task-session-link" type="button" title={execution.sessionId} disabled={Boolean(tasksStore.busy) || !execution.sessionId} onclick={() => void openTaskSession(task.id, execution.id)}>
                      {session.text.tasksSession}: {execution.sessionId || session.text.tasksSessionCleaned}
                    </button>
                    {#if execution.lastError}<span class="run-history-failed">{execution.lastError}</span>{/if}
                  </div>
                {/each}
              {/if}
              <button class="task-history-toggle" type="button" disabled={Boolean(tasksStore.busy) && tasksStore.busy !== `history:${task.id}`} onclick={() => void openTaskHistory(task.id)}>{session.text.tasksViewAllRuns}<i class="ph ph-arrow-square-out"></i></button>
            </div>
          </div>
        </article>
      {/each}
    </div>
  {/if}
  {/if}
  {#if tasksStore.taskCreate}
    <div class="modal-overlay" role="dialog" aria-modal="true" tabindex="-1" aria-label={session.text.tasksCreate} onclick={() => (tasksStore.taskCreate = null)} onkeydown={(event) => { if (event.key === "Escape") tasksStore.taskCreate = null; }}>
      <div class="modal-card task-editor-modal" role="presentation" onclick={(event) => event.stopPropagation()} onkeydown={(event) => event.stopPropagation()}>
      <form id="desktop-task-create-form" onsubmit={(event) => { event.preventDefault(); void saveTaskCreate(); }}>
        <header class="modal-head"><div><strong>{session.text.tasksCreate}</strong><p>{session.text.tasksCreateHint}</p></div><button class="modal-close" type="button" aria-label={session.text.cancel} onclick={() => (tasksStore.taskCreate = null)}><i class="ph ph-x"></i></button></header>
        <div class="modal-body task-editor-body">
          <div class="task-target-picker">
            <label class="settings-field"><span>{session.text.tasksTargetBot}</span><select value={selectedTaskTargetGroup} onchange={(event) => selectTaskTargetGroup(event.currentTarget.value)}>{#each taskTargetGroups as group (group.key)}<option value={group.key}>{group.label}</option>{/each}</select></label>
            <label class="settings-field"><span>{session.text.tasksTargetConversation}</span><select value={Math.max(0, tasksStore.tasks.targets.findIndex((target) => target.channel === tasksStore.taskCreate?.channel && target.botId === tasksStore.taskCreate?.botId && target.chatId === tasksStore.taskCreate?.chatId && target.scope === tasksStore.taskCreate?.scope))} onchange={(event) => selectTaskCreateTarget(Number(event.currentTarget.value))}>{#each taskTargetGroups.find((group) => group.key === selectedTaskTargetGroup)?.options ?? [] as option (option.index)}<option value={option.index}>{option.label}</option>{/each}</select></label>
            <small>{session.text.tasksTargetHint}</small>
          </div>
          <label class="settings-field settings-field-wide"><span>{session.text.tasksText}</span><textarea rows="7" bind:value={tasksStore.taskCreate.text}></textarea></label>
          <TaskScheduleBuilder bind:schedule={tasksStore.taskCreate.schedule} />
          <div class="settings-form task-advanced-settings"><label class="settings-field"><span>{session.text.tasksTimezone}</span><select bind:value={tasksStore.taskCreate.timezone}>{#if tasksStore.taskCreate.timezone && !timezoneOptions().includes(tasksStore.taskCreate.timezone)}<option value={tasksStore.taskCreate.timezone}>{tasksStore.taskCreate.timezone}</option>{/if}{#each timezoneOptions() as tz (tz)}<option value={tz}>{tz}</option>{/each}</select></label><label class="settings-field"><span>{session.text.tasksDelivery}</span><select bind:value={tasksStore.taskCreate.delivery}><option value="agent">{session.text.tasksDeliveryAgent}</option><option value="text">{session.text.tasksDeliveryText}</option></select></label><label class="settings-field"><span>{session.text.tasksSessionMode}</span><select bind:value={tasksStore.taskCreate.sessionMode}><option value="fresh">{session.text.tasksSessionFresh}</option><option value="chat">{session.text.tasksSessionChat}</option></select></label></div>
        </div>
        <footer class="entity-editor-foot"><button class="secondary-button" type="button" onclick={() => (tasksStore.taskCreate = null)}>{session.text.cancel}</button><button class="primary-button" type="submit" disabled={Boolean(tasksStore.busy) || !tasksStore.taskCreate.text.trim() || tasksStore.taskCreate.schedule.trim().split(/\s+/).length !== 5}>{tasksStore.busy === "create" ? session.text.onboardingProviderSaving : session.text.tasksCreate}</button></footer>
      </form>
      </div>
    </div>
  {/if}
  {#if tasksStore.historyTaskId}
    {@const historyTask = tasksStore.tasks.items.find((item) => item.id === tasksStore.historyTaskId)}
    {@const history = tasksStore.histories[tasksStore.historyTaskId]}
    <div class="modal-overlay" role="dialog" aria-modal="true" tabindex="-1" aria-label={session.text.tasksExecutions} onclick={() => (tasksStore.historyTaskId = "")} onkeydown={(event) => { if (event.key === "Escape") tasksStore.historyTaskId = ""; }}>
      <div class="modal-card task-history-modal" role="presentation" onclick={(event) => event.stopPropagation()} onkeydown={(event) => event.stopPropagation()}>
        <header class="modal-head task-history-modal-head"><div><span>{session.text.tasksExecutions}</span><strong>{historyTask?.text.split(/\r?\n/)[0] || session.text.tasks}</strong></div><button class="modal-close" type="button" aria-label={session.text.cancel} onclick={() => (tasksStore.historyTaskId = "")}><i class="ph ph-x"></i></button></header>
        <div class="modal-body task-history-modal-body">
          {#if !history}<p class="task-history-loading">{session.text.loading}</p>{:else if history.items.length === 0}<p class="task-history-loading">{session.text.tasksNoExecutions}</p>{:else}
            <div class="task-history-table-head"><span>{session.text.tasksByStatus}</span><span>{session.text.tasksLastTriggered}</span><span>{session.text.tasksSession}</span></div>
            {#each history.items as execution (execution.id)}
              <div class="task-execution-row history-row"><span class={`execution-state state-${execution.status}`}><i></i>{executionStatusLabel(execution.status)}</span><span>{formatTaskTime(execution.startedAt)}</span><button class="task-session-link" type="button" disabled={!execution.sessionId || Boolean(tasksStore.busy)} onclick={() => void openTaskSession(tasksStore.historyTaskId, execution.id)}>{execution.sessionId || session.text.tasksSessionCleaned}</button></div>
            {/each}
          {/if}
        </div>
        {#if history}<footer class="task-history-modal-foot"><span>{pageSummary(history.page, history.pageSize, history.total)}</span><div><button class="secondary-button" type="button" disabled={history.page <= 1 || Boolean(tasksStore.busy)} onclick={() => void loadTaskHistoryPage(tasksStore.historyTaskId, history.page - 1)}><i class="ph ph-arrow-left"></i>{session.text.tasksPreviousPage}</button><button class="secondary-button" type="button" disabled={history.page * history.pageSize >= history.total || Boolean(tasksStore.busy)} onclick={() => void loadTaskHistoryPage(tasksStore.historyTaskId, history.page + 1)}>{session.text.tasksNextPage}<i class="ph ph-arrow-right"></i></button></div></footer>{/if}
      </div>
    </div>
  {/if}
  {#if tasksStore.taskEdit}
    <div class="modal-overlay" role="dialog" aria-modal="true" tabindex="-1" aria-label={session.text.channelEdit} onclick={() => (tasksStore.taskEdit = null)} onkeydown={(event) => { if (event.key === "Escape") tasksStore.taskEdit = null; }}>
      <div class="modal-card task-editor-modal" role="presentation" onclick={(event) => event.stopPropagation()} onkeydown={(event) => event.stopPropagation()}>
        <form id="desktop-task-form" aria-label={session.text.channelEdit} onsubmit={(event) => { event.preventDefault(); void saveTaskEditor(); }}>
          <header class="modal-head"><div><strong>{session.text.channelEdit}</strong><p>{tasksStore.taskEdit.channel} / {tasksStore.taskEdit.botId}{tasksStore.taskEdit.chatId ? ` / ${tasksStore.taskEdit.chatId}` : ""}</p></div><button class="modal-close" type="button" aria-label={session.text.cancel} disabled={Boolean(tasksStore.busy)} onclick={() => (tasksStore.taskEdit = null)}><i class="ph ph-x"></i></button></header>
          <div class="modal-body task-editor-body"><label class="settings-field settings-field-wide"><span>{session.text.tasksText}</span><textarea rows="7" bind:value={tasksStore.taskEdit.draftText}></textarea></label><TaskScheduleBuilder bind:schedule={tasksStore.taskEdit.draftSchedule} /><div class="settings-form task-advanced-settings"><label class="settings-field"><span>{session.text.tasksTimezone}</span><select bind:value={tasksStore.taskEdit.draftTimezone}>{#if tasksStore.taskEdit.draftTimezone && !timezoneOptions().includes(tasksStore.taskEdit.draftTimezone)}<option value={tasksStore.taskEdit.draftTimezone}>{tasksStore.taskEdit.draftTimezone}</option>{/if}{#each timezoneOptions() as tz (tz)}<option value={tz}>{tz}</option>{/each}</select></label><label class="settings-field"><span>{session.text.tasksDelivery}</span><select bind:value={tasksStore.taskEdit.draftDelivery}><option value="agent">{session.text.tasksDeliveryAgent}</option><option value="text">{session.text.tasksDeliveryText}</option></select></label><label class="settings-field"><span>{session.text.tasksSessionMode}</span><select bind:value={tasksStore.taskEdit.draftSessionMode}><option value="fresh">{session.text.tasksSessionFresh}</option><option value="chat">{session.text.tasksSessionChat}</option></select></label></div></div>
          <footer class="entity-editor-foot"><button class="secondary-button" type="button" disabled={Boolean(tasksStore.busy)} onclick={() => (tasksStore.taskEdit = null)}>{session.text.cancel}</button><button class="primary-button" type="submit" disabled={Boolean(tasksStore.busy) || !tasksStore.taskEdit.draftText.trim() || tasksStore.taskEdit.draftSchedule.trim().split(/\s+/).length !== 5}>{tasksStore.busy ? session.text.onboardingProviderSaving : session.text.save}</button></footer>
        </form>
      </div>
    </div>
  {/if}
  {#if tasksStore.actionMessage}<p class="settings-action-message">{tasksStore.actionMessage}</p>{/if}
  {#if tasksStore.taskSession}
    <div class="modal-overlay" role="dialog" aria-modal="true" tabindex="-1" aria-label={session.text.tasksSession} onclick={() => (tasksStore.taskSession = null)} onkeydown={(event) => { if (event.key === "Escape") tasksStore.taskSession = null; }}>
      <div class="modal-card task-session-modal" tabindex="-1" role="presentation" onclick={(event) => event.stopPropagation()} onkeydown={(event) => event.stopPropagation()}>
        <header class="modal-head">
          <strong>{session.text.tasksSession} · {tasksStore.taskSession.sessionId}</strong>
          <button class="modal-close" type="button" aria-label={session.text.cancel} onclick={() => (tasksStore.taskSession = null)}><i class="ph ph-x"></i></button>
        </header>
        <div class="modal-body messages task-session-detail" aria-live="polite">
          {#if tasksStore.taskSession.messages.length === 0}
            <p>{session.text.tasksSessionCleaned}</p>
          {:else}
            <ConversationTranscript messages={tasksStore.taskSession.messages} copy={session.text} formatTime={formatSessionTime} />
          {/if}
        </div>
      </div>
    </div>
  {/if}
  {#if tasksStore.pendingDeleteIds}
    <div class="modal-overlay" role="dialog" aria-modal="true" tabindex="-1" aria-label={session.text.confirmDelete} onclick={cancelDeleteTask} onkeydown={(event) => { if (event.key === "Escape") cancelDeleteTask(); }}>
      <div class="modal-card task-delete-confirm-modal" role="presentation" onclick={(event) => event.stopPropagation()} onkeydown={(event) => event.stopPropagation()}>
        <header class="modal-head"><div><strong>{session.text.confirmDelete}</strong><p>{session.text.tasksDeleteConfirm.replace("{count}", String(tasksStore.pendingDeleteIds.length))}</p></div></header>
        <footer class="entity-editor-foot"><button class="secondary-button" type="button" onclick={cancelDeleteTask}>{session.text.cancel}</button><button class="primary-button danger-action" type="button" onclick={() => void confirmDeleteTask()}>{session.text.confirmDelete}</button></footer>
      </div>
    </div>
  {/if}
{/if}
