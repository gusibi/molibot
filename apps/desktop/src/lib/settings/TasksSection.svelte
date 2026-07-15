<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { session } from "../stores/session.svelte";
  import type { DesktopTaskSummary } from "@molibot/desktop-contract";
  import { timezoneOptions } from "./timezones";
  import TaskScheduleBuilder from "./TaskScheduleBuilder.svelte";
  import { externalChannelLabel } from "../stores/channels.svelte";
  import ConversationTranscript from "../chat/ConversationTranscript.svelte";
  import EmptyState from "../components/ui/EmptyState.svelte";
  import OverflowMenu from "../components/ui/OverflowMenu.svelte";
  import SearchField from "../components/ui/SearchField.svelte";
  import SkeletonRows from "../components/ui/SkeletonRows.svelte";
  import { formatNaturalDateTime, formatNaturalSchedule } from "../presentation";
  import {
    tasksStore,
    beginTaskCreate,
    beginTaskEdit,
    executeTaskAction,
    isTaskRunning,
    isTaskStarting,
    isTaskUpdating,
    loadTaskHistoryPage,
    loadTasks,
    markOneShotTasksRead,
    refreshTasks,
    openTaskSession,
    saveTaskCreate,
    saveTaskEditor,
    setTaskEnabled,
    stopTaskRun,
    undoTaskEnabledChange,
    selectTaskCreateTarget,
    taskStatusLabel,
    openTaskHistory,
    toggleTaskSelection,
    requestDeleteTask,
    confirmDeleteTask,
    cancelDeleteTask
  } from "../stores/tasks.svelte";

  let { presentation = "settings", onUnreadChange = () => {} }: { presentation?: "settings" | "workspace"; onUnreadChange?: (count: number) => void } = $props();

  let selectedTaskId = $state("");
  let activeTaskView = $state<"user" | "one-shot" | "system">("user");
  let detailDragStartX = $state(0);
  let detailDragOffset = $state(0);
  let detailDragging = $state(false);
  let taskDialogElement = $state<HTMLElement | null>(null);
  let oneShotReadAttemptKey = $state("");

  $effect(() => {
    const dialogOpen = Boolean(tasksStore.taskCreate || tasksStore.historyTaskId || tasksStore.taskEdit || tasksStore.taskSession || tasksStore.pendingDeleteIds);
    if (dialogOpen) queueMicrotask(() => taskDialogElement?.focus());
  });

  function beginDetailDrag(event: PointerEvent): void {
    detailDragging = true;
    detailDragStartX = event.clientX;
    detailDragOffset = 0;
    event.currentTarget instanceof HTMLElement && event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDetailDrag(event: PointerEvent): void {
    if (detailDragging) detailDragOffset = Math.max(0, event.clientX - detailDragStartX);
  }

  function endDetailDrag(): void {
    if (!detailDragging) return;
    detailDragging = false;
    if (detailDragOffset > 96) selectedTaskId = "";
    detailDragOffset = 0;
  }

  function isSystemTask(id: string): boolean {
    return tasksStore.tasks?.items.some((task) => task.id === id && task.category === "system") === true;
  }

  $effect(() => {
    if (session.serviceReady && session.endpoint && session.endpoint !== tasksStore.endpoint) {
      void loadTasks(session.endpoint);
    }
  });

  let pollTimer: ReturnType<typeof setInterval> | null = null;

  function onVisibilityChange(): void {
    if (!document.hidden && session.serviceReady && session.endpoint) {
      void refreshTasks();
    }
  }

  function startTaskPolling(): void {
    stopTaskPolling();
    pollTimer = setInterval(() => {
      if (!document.hidden && session.serviceReady && session.endpoint) {
        void refreshTasks();
      }
    }, 3_000);
    document.addEventListener("visibilitychange", onVisibilityChange);
  }

  function stopTaskPolling(): void {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    document.removeEventListener("visibilitychange", onVisibilityChange);
  }

  onMount(() => {
    if (session.serviceReady && session.endpoint && tasksStore.endpoint) {
      void refreshTasks();
    }
    startTaskPolling();
  });

  onDestroy(() => {
    stopTaskPolling();
  });


  function matchesTaskView(item: DesktopTaskSummary["items"][number]): boolean {
    if (activeTaskView === "one-shot") return item.category === "user" && item.type === "one-shot";
    return item.category === activeTaskView && item.type === "periodic";
  }

  const filteredTaskItems = $derived(
    tasksStore.tasks?.items.filter((item) => matchesTaskView(item) && (!tasksStore.query.trim() || [taskTitle(item), item.text, item.channel, item.botId, item.chatId, item.status, item.type].join("\n").toLowerCase().includes(tasksStore.query.trim().toLowerCase()))) ?? []
  );

  const oneShotTaskItems = $derived([...filteredTaskItems].sort((a, b) => {
    if (a.reminderUnread !== b.reminderUnread) return a.reminderUnread ? -1 : 1;
    if (a.status === "completed" && b.status !== "completed") return 1;
    if (a.status !== "completed" && b.status === "completed") return -1;
    return (a.status === "completed" ? b.completedAt.localeCompare(a.completedAt) : a.scheduleText.localeCompare(b.scheduleText));
  }));

  const taskCategoryCounts = $derived({
    user: tasksStore.tasks?.items.filter((item) => item.category === "user" && item.type === "periodic").length ?? 0,
    "one-shot": tasksStore.tasks?.items.filter((item) => item.category === "user" && item.type === "one-shot").length ?? 0,
    system: tasksStore.tasks?.items.filter((item) => item.category === "system" && item.type === "periodic").length ?? 0
  });

  const oneShotCounts = $derived({
    pending: oneShotTaskItems.filter((task) => task.status !== "completed" && task.status !== "error" && task.status !== "skipped").length,
    reminded: oneShotTaskItems.filter((task) => task.status === "completed").length,
    unread: oneShotTaskItems.filter((task) => task.reminderUnread).length
  });

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
    if (isTaskStarting(task.id)) return session.text.tasksStarting;
    return task.enabled ? taskStatusLabel(task.status, session.text) : session.text.tasksPaused;
  }

  function taskScheduleStatusText(task: DesktopTaskSummary["items"][number]): string {
    return task.enabled ? session.text.tasksSchedulePending : session.text.tasksPaused;
  }

  function taskExecutionStatusText(task: DesktopTaskSummary["items"][number]): string {
    if (isTaskStarting(task.id)) return session.text.tasksStarting;
    return isTaskRunning(task.id) ? session.text.taskStatusRunning : session.text.tasksIdle;
  }

  function taskLatestResultText(task: DesktopTaskSummary["items"][number]): string {
    const latest = task.executions[0]?.status;
    if (!latest) return session.text.tasksNoRecord;
    return executionStatusLabel(latest);
  }

  function taskTitle(task: DesktopTaskSummary["items"][number]): string {
    if (task.systemKind === "memory-reflection") return session.text.tasksSystemMemoryReflection;
    if (task.systemKind === "daily-materials") return session.text.tasksSystemDailyMaterials;
    return task.text.split(/\r?\n/)[0] || task.text;
  }

  function selectTaskCategory(category: "user" | "one-shot" | "system"): void {
    activeTaskView = category;
    selectedTaskId = "";
    tasksStore.selected = new Set();
  }

  function oneShotStatusText(task: DesktopTaskSummary["items"][number]): string {
    if (task.status === "completed") return session.text.tasksReminderReminded;
    if (task.status === "error" || task.status === "skipped") return taskStatusLabel(task.status, session.text);
    return session.text.tasksReminderPending;
  }

  $effect(() => {
    onUnreadChange(tasksStore.tasks?.counts.unreadOneShot ?? 0);
  });

  $effect(() => {
    if (activeTaskView !== "one-shot") {
      oneShotReadAttemptKey = "";
      return;
    }
    const unreadIds = tasksStore.tasks?.items.filter((item) => item.type === "one-shot" && item.category === "user" && item.reminderUnread).map((item) => item.id) ?? [];
    const attemptKey = [...unreadIds].sort().join("\n");
    if (!attemptKey || attemptKey === oneShotReadAttemptKey) return;
    oneShotReadAttemptKey = attemptKey;
    void markOneShotTasksRead(unreadIds);
  });

  function pageSummary(page: number, pageSize: number, total: number): string {
    return session.text.tasksPageSummary.replace("{page}", String(page)).replace("{pages}", String(Math.max(1, Math.ceil(total / pageSize)))).replace("{total}", String(total));
  }

  function executionStatusLabel(status: "running" | "retry_wait" | "completed" | "failed" | "aborted" | "skipped"): string {
    return session.text[`taskExecution_${status}`];
  }

  function taskBody(text: string): string {
    return text.split(/\r?\n/).slice(1).join("\n").trim();
  }

  function taskScheduleText(task: DesktopTaskSummary["items"][number]): string {
    if (task.type === "periodic") return formatNaturalSchedule(task.scheduleText, session.locale);
    if (task.type === "one-shot") return formatNaturalDateTime(task.scheduleText, session.locale);
    return session.text.taskTypeImmediate;
  }

  function runningExecution(task: DesktopTaskSummary["items"][number]) {
    return task.executions.find((execution) => execution.status === "running" || execution.status === "retry_wait");
  }
</script>

<svelte:window onkeydown={(event) => { if (event.key === "Escape" && selectedTask && innerWidth < 1100) selectedTaskId = ""; }} />

{#if !session.serviceReady}
  <div class="settings-card"><EmptyState title={session.text.tasksUnavailable} icon="clock-countdown" /></div>
{:else if tasksStore.loading}
  <div class="settings-card"><SkeletonRows count={5} label={session.text.loading} /></div>
{:else if tasksStore.error && !tasksStore.tasks}
  <div class="settings-card" role="alert"><div class="settings-row"><div><p>{session.text.workspaceLoadFailed}</p><small>{tasksStore.error}</small></div><button class="secondary-button" type="button" onclick={() => session.endpoint && void loadTasks(session.endpoint)}>{session.text.retryLoading}</button></div></div>
{:else if !tasksStore.tasks}
  <div class="settings-card"><div class="settings-row"><p>{session.text.loading}</p></div></div>
{:else}
  <div class:workspace={presentation === "workspace"} class="automation-category-tabs" role="tablist" aria-label={session.text.tasksCategories}>
    <button class:active={activeTaskView === "user"} class="automation-category-tab" type="button" role="tab" aria-selected={activeTaskView === "user"} onclick={() => selectTaskCategory("user")}><i class="ph ph-arrows-clockwise" aria-hidden="true"></i><span>{session.text.tasksUserTab}</span><small>{taskCategoryCounts.user}</small></button>
    <button class:active={activeTaskView === "one-shot"} class="automation-category-tab" type="button" role="tab" aria-selected={activeTaskView === "one-shot"} onclick={() => selectTaskCategory("one-shot")}><i class="ph ph-bell" aria-hidden="true"></i><span>{session.text.tasksOneShotTab}</span><small>{taskCategoryCounts["one-shot"]}</small></button>
    <button class:active={activeTaskView === "system"} class="automation-category-tab" type="button" role="tab" aria-selected={activeTaskView === "system"} onclick={() => selectTaskCategory("system")}><i class="ph ph-cpu" aria-hidden="true"></i><span>{session.text.tasksSystemTab}</span><small>{taskCategoryCounts.system}</small></button>
  </div>
  {#if activeTaskView === "one-shot"}
    <section class="automation-workspace one-shot-workspace" aria-label={session.text.tasksOneShotTab}>
      <div class="automation-workspace-toolbar">
        <SearchField value={tasksStore.query} label={session.text.tasksFilter} placeholder={session.text.tasksReminderFilterHint} onInput={(value) => (tasksStore.query = value)} />
      </div>
      <div class="automation-workspace-summary" aria-label={session.text.tasksReminderSummary}>
        <span><strong>{taskCategoryCounts["one-shot"]}</strong>{session.text.tasksTotal}</span>
        <span><strong>{oneShotCounts.pending}</strong>{session.text.tasksReminderPending}</span>
        <span><strong>{oneShotCounts.reminded}</strong>{session.text.tasksReminderReminded}</span>
        <span><strong>{oneShotCounts.unread}</strong>{session.text.tasksReminderUnread}</span>
      </div>
      {#if oneShotTaskItems.length === 0}
        <div class="workspace-empty compact"><EmptyState title={session.text.tasksReminderEmpty} icon="bell" /></div>
      {:else}
        <ul class="one-shot-list" aria-label={session.text.tasksOneShotTab}>
          {#each oneShotTaskItems as task (task.id)}
            <li class:unread={task.reminderUnread} class:reminded={task.status === "completed"} class:error={task.status === "error" || task.status === "skipped"} class="one-shot-row">
              <span class="one-shot-check" aria-hidden="true"><i class={`ph ${task.status === "completed" ? "ph-check" : task.status === "error" || task.status === "skipped" ? "ph-warning" : "ph-bell"}`}></i></span>
              <span class="one-shot-copy"><strong>{taskTitle(task)}</strong>{#if taskBody(task.text)}<span>{taskBody(task.text)}</span>{/if}<small><i class="ph ph-clock" aria-hidden="true"></i>{taskScheduleText(task)}</small></span>
              <span class="one-shot-state" data-status={task.status}>{#if task.reminderUnread}<i aria-hidden="true"></i>{/if}{oneShotStatusText(task)}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {:else if presentation === "workspace"}
    <section class="automation-workspace" aria-label={session.text.tasks}>
      <div class="automation-workspace-toolbar">
        <SearchField value={tasksStore.query} label={session.text.tasksFilter} placeholder={session.text.tasksFilterHint} onInput={(value) => (tasksStore.query = value)} />
        {#if activeTaskView === "user"}<button class="primary-button automation-workspace-create" type="button" disabled={Boolean(tasksStore.busy) || tasksStore.tasks.targets.length === 0} onclick={beginTaskCreate}><i class="ph ph-plus" aria-hidden="true"></i>{session.text.tasksCreate}</button>{/if}
      </div>
      <div class="automation-workspace-summary" aria-label={session.text.tasksTotal}>
        <span><strong>{taskCategoryCounts[activeTaskView]}</strong>{session.text.tasksTotal}</span>
        <span><strong>{executionTotals.total}</strong>{session.text.tasksRunCount}</span>
        <span><strong>{executionTotals.completed}</strong>{session.text.tasksSuccessful}</span>
        <span><strong>{executionTotals.failed}</strong>{session.text.tasksFailed}</span>
      </div>
      {#if filteredTaskItems.length === 0}
        <div class="workspace-empty compact"><EmptyState title={session.text.tasksEmpty} icon="clock-countdown" /></div>
      {:else}
        <div class:detail-open={Boolean(selectedTask)} class="automation-workspace-layout">
          <div class="automation-workspace-list" role="listbox" aria-label={session.text.tasks}>
            {#each filteredTaskItems as task (task.id)}
              <button class:active={selectedTask?.id === task.id} class:running={isTaskRunning(task.id)} class:paused={!task.enabled} class="automation-task-row" data-status={task.status} type="button" role="option" aria-selected={selectedTask?.id === task.id} onclick={() => (selectedTaskId = task.id)}>
                <span class="automation-task-row-mark" aria-hidden="true">{#if isTaskRunning(task.id)}<i class="ph ph-spinner-gap automation-spinner"></i>{:else}<i></i>{/if}</span>
                <span class="automation-task-row-copy"><strong>{taskTitle(task)}</strong><span>{taskScheduleText(task)}</span><small><span>{taskScheduleStatusText(task)}</span><span>{session.text.tasksLastTriggered} {formatTaskTime(task.lastTriggeredAt || task.executions[0]?.startedAt || "")}</span></small></span>
                <i class="ph ph-caret-right" aria-hidden="true"></i>
              </button>
            {/each}
          </div>
          {#if selectedTask}
            <article class:dragging={detailDragging} class="automation-task-detail" style={`--detail-drag:${detailDragOffset}px`} aria-labelledby={`automation-task-${selectedTask.id}`}>
              <button class="automation-detail-drag-handle" type="button" aria-label={session.text.tasksSwipeClose} onpointerdown={beginDetailDrag} onpointermove={moveDetailDrag} onpointerup={endDetailDrag} onpointercancel={endDetailDrag}><span aria-hidden="true"></span></button>
              <button class="automation-detail-close" type="button" title={session.text.tasksCloseDetails} aria-label={session.text.tasksCloseDetails} onclick={() => (selectedTaskId = "")}><i class="ph ph-x" aria-hidden="true"></i></button>
              <header class="automation-task-detail-head">
                <div class="automation-task-detail-topbar">
                  <span class:active={isTaskRunning(selectedTask.id)} class:error={selectedTask.status === "error"} class:paused={!selectedTask.enabled} class="automation-status"><i></i>{taskStatusText(selectedTask)}</span>
                  <div class="automation-task-detail-actions">
                    {#if isTaskRunning(selectedTask.id) && runningExecution(selectedTask)?.runId}
                      <button class="automation-run-button danger-action" type="button" disabled={isTaskUpdating(selectedTask.id)} onclick={() => void stopTaskRun(selectedTask.id, runningExecution(selectedTask)?.runId ?? "")}><i class="ph ph-stop-circle" aria-hidden="true"></i>{session.text.tasksStop}</button>
                    {:else}
                      <button class="automation-run-button" type="button" disabled={!selectedTask.enabled || isTaskStarting(selectedTask.id) || isTaskUpdating(selectedTask.id)} onclick={() => void executeTaskAction("trigger", [selectedTask.id])}>{#if isTaskStarting(selectedTask.id)}<i class="ph ph-spinner-gap automation-spinner" aria-hidden="true"></i>{:else}<i class="ph-fill ph-play" aria-hidden="true"></i>{/if}{isTaskStarting(selectedTask.id) ? session.text.tasksStarting : session.text.tasksTrigger}</button>
                    {/if}
                    {#if selectedTask.category === "user"}<OverflowMenu label={session.text.more}><button role="menuitem" type="button" disabled={isTaskRunning(selectedTask.id) || isTaskUpdating(selectedTask.id)} onclick={() => void setTaskEnabled(selectedTask.id, !selectedTask.enabled)}><i class={`ph ${selectedTask.enabled ? "ph-pause" : "ph-play"}`} aria-hidden="true"></i>{selectedTask.enabled ? session.text.tasksPause : session.text.tasksResume}</button><button role="menuitem" type="button" disabled={Boolean(tasksStore.busy) || tasksStore.taskEdit !== null} onclick={() => beginTaskEdit(selectedTask)}><i class="ph ph-pencil-simple" aria-hidden="true"></i>{session.text.channelEdit}</button><button role="menuitem" class="danger-action" type="button" disabled={Boolean(tasksStore.busy)} onclick={() => requestDeleteTask([selectedTask.id])}><i class="ph ph-trash" aria-hidden="true"></i>{session.text.channelDelete}</button></OverflowMenu>{/if}
                  </div>
                </div>
                <div>
                  <h2 id={`automation-task-${selectedTask.id}`}>{taskTitle(selectedTask)}</h2>
                  <p>{selectedTask.category === "system" ? session.text.tasksSystemOwner : session.text.tasksUserOwner}</p>
                </div>
              </header>
              <section class="automation-task-detail-copy" aria-label={session.text.tasksText}><span>{session.text.tasksText}</span><p>{selectedTask.text}</p></section>
              <dl class="automation-task-facts">
                <div><dt>{session.text.tasksEnabledState}</dt><dd>{selectedTask.enabled ? session.text.tasksEnabled : session.text.tasksDisabled}</dd></div>
                <div><dt>{session.text.tasksCurrentRun}</dt><dd>{taskExecutionStatusText(selectedTask)}</dd></div>
                <div><dt>{session.text.tasksScheduleState}</dt><dd>{taskScheduleStatusText(selectedTask)}</dd></div>
                <div><dt>{session.text.tasksLatestResult}</dt><dd>{taskLatestResultText(selectedTask)}</dd></div>
                <div><dt>{session.text.tasksSchedule}</dt><dd><i class="ph ph-calendar-dots" aria-hidden="true"></i>{taskScheduleText(selectedTask)}</dd></div>
                <div><dt>{session.text.tasksLastTriggered}</dt><dd>{formatTaskTime(selectedTask.lastTriggeredAt || selectedTask.executions[0]?.startedAt || "")}</dd></div>
              </dl>
              <details class="automation-task-technical technical-detail">
                <summary>{session.text.technicalDetails}</summary>
                <dl>
                  <div><dt>{session.text.tasksTaskId}</dt><dd><code>{selectedTask.id}</code></dd></div>
                  <div><dt>{session.text.tasksTarget}</dt><dd>{selectedTask.channel} / {selectedTask.botId} / {selectedTask.chatId}</dd></div>
                  <div><dt>{session.text.tasksCustomCron}</dt><dd><code>{selectedTask.scheduleText}</code></dd></div>
                  <div><dt>{session.text.tasksTimezone}</dt><dd>{selectedTask.timezone}</dd></div>
                  <div><dt>{session.text.tasksDelivery}</dt><dd>{selectedTask.delivery}</dd></div>
                </dl>
              </details>
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
                      <button class="task-session-link" type="button" title={execution.sessionId} disabled={Boolean(tasksStore.busy) || !execution.sessionId} onclick={() => void openTaskSession(selectedTask.id, execution.id)}>{execution.sessionId ? (selectedTask.category === "system" ? session.text.tasksOpenExecution : session.text.tasksOpenSession) : session.text.tasksSessionCleaned}</button>
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
      <div><span class="automation-eyebrow">{session.text.tasksTotal}</span><strong>{taskCategoryCounts[activeTaskView]}</strong><small>{session.text.tasksHint}</small></div>
    </div>
    <div class="automation-command-stats">
      <div><span class="stat-signal running"></span><small>{session.text.taskStatusRunning}</small><strong>{tasksStore.tasks.counts.byStatus.running}</strong></div>
      <div><span class="stat-signal error"></span><small>{session.text.taskStatusError}</small><strong>{tasksStore.tasks.counts.byStatus.error}</strong></div>
      <div><span class="stat-signal completed"></span><small>{session.text.tasksRunCount}</small><strong>{tasksStore.tasks.items.reduce((total, item) => total + item.runCount, 0)}</strong></div>
    </div>
    <div class="automation-toolbar">
      <label class="automation-search"><i class="ph ph-magnifying-glass" aria-hidden="true"></i><input bind:value={tasksStore.query} aria-label={session.text.tasksFilter} placeholder={session.text.tasksFilterHint} /></label>
      {#if activeTaskView === "user"}<button class="primary-button automation-create-button" type="button" disabled={Boolean(tasksStore.busy) || tasksStore.tasks.targets.length === 0} onclick={beginTaskCreate}><i class="ph ph-plus" aria-hidden="true"></i>{session.text.tasksCreate}</button>{/if}
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
          {#if task.category === "user"}<label class="inline-check task-select"><input type="checkbox" checked={tasksStore.selected.has(task.id)} onchange={() => toggleTaskSelection(task.id)} /><span class="sr-only">{session.text.tasksSelect}</span></label>{:else}<span class="task-select system-task-mark" aria-hidden="true"><i class="ph ph-cpu"></i></span>{/if}
          <div class="automation-card-main">
            <div class="automation-card-head">
              <div class="automation-title-block"><div><span class:active={task.status === "running"} class:error={task.status === "error"} class="automation-status"><i></i>{taskStatusLabel(task.status, session.text)}</span><span class="automation-target"><i class="ph ph-robot"></i>{task.category === "system" ? session.text.tasksSystemOwner : `${task.channel} / ${task.botId}${task.chatId ? ` / ${task.chatId}` : ""}`}</span></div><strong>{taskTitle(task)}</strong></div>
              <div class="automation-card-actions">
                <button class="automation-run-button" type="button" disabled={Boolean(tasksStore.busy)} onclick={() => void executeTaskAction("trigger", [task.id])}><i class="ph-fill ph-play" aria-hidden="true"></i>{session.text.tasksTrigger}</button>
                {#if task.category === "user"}<button class="row-icon-btn" type="button" title={session.text.channelEdit} aria-label={session.text.channelEdit} disabled={Boolean(tasksStore.busy) || tasksStore.taskEdit !== null} onclick={() => beginTaskEdit(task)}><i class="ph ph-pencil-simple" aria-hidden="true"></i></button>
                <button class="row-icon-btn danger-action" type="button" title={session.text.channelDelete} aria-label={session.text.channelDelete} disabled={Boolean(tasksStore.busy)} onclick={() => requestDeleteTask([task.id])}><i class="ph ph-trash" aria-hidden="true"></i></button>{/if}
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
    <div class="modal-overlay" role="dialog" aria-modal="true" tabindex="-1" bind:this={taskDialogElement} aria-label={session.text.tasksCreate} onclick={() => (tasksStore.taskCreate = null)} onkeydown={(event) => { if (event.key === "Escape") tasksStore.taskCreate = null; }}>
      <div class="modal-card task-editor-modal" role="presentation" onclick={(event) => event.stopPropagation()}>
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
    <div class="modal-overlay" role="dialog" aria-modal="true" tabindex="-1" bind:this={taskDialogElement} aria-label={session.text.tasksExecutions} onclick={() => (tasksStore.historyTaskId = "")} onkeydown={(event) => { if (event.key === "Escape") tasksStore.historyTaskId = ""; }}>
      <div class="modal-card task-history-modal" role="presentation" onclick={(event) => event.stopPropagation()}>
        <header class="modal-head task-history-modal-head"><div><span>{session.text.tasksExecutions}</span><strong>{historyTask?.text.split(/\r?\n/)[0] || session.text.tasks}</strong></div><button class="modal-close" type="button" aria-label={session.text.cancel} onclick={() => (tasksStore.historyTaskId = "")}><i class="ph ph-x"></i></button></header>
        <div class="modal-body task-history-modal-body">
          {#if !history}<p class="task-history-loading">{session.text.loading}</p>{:else if history.items.length === 0}<p class="task-history-loading">{session.text.tasksNoExecutions}</p>{:else}
            <div class="task-history-table-head"><span>{session.text.tasksByStatus}</span><span>{session.text.tasksLastTriggered}</span><span>{session.text.tasksSession}</span></div>
            {#each history.items as execution (execution.id)}
              <div class="task-execution-row history-row"><span class={`execution-state state-${execution.status}`}><i></i>{executionStatusLabel(execution.status)}</span><span>{formatTaskTime(execution.startedAt)}</span><button class="task-session-link" type="button" title={execution.sessionId} disabled={!execution.sessionId || Boolean(tasksStore.busy)} onclick={() => void openTaskSession(tasksStore.historyTaskId, execution.id)}>{execution.sessionId ? (isSystemTask(tasksStore.historyTaskId) ? session.text.tasksOpenExecution : session.text.tasksOpenSession) : session.text.tasksSessionCleaned}</button></div>
            {/each}
          {/if}
        </div>
        {#if history}<footer class="task-history-modal-foot"><span>{pageSummary(history.page, history.pageSize, history.total)}</span><div><button class="secondary-button" type="button" disabled={history.page <= 1 || Boolean(tasksStore.busy)} onclick={() => void loadTaskHistoryPage(tasksStore.historyTaskId, history.page - 1)}><i class="ph ph-arrow-left"></i>{session.text.tasksPreviousPage}</button><button class="secondary-button" type="button" disabled={history.page * history.pageSize >= history.total || Boolean(tasksStore.busy)} onclick={() => void loadTaskHistoryPage(tasksStore.historyTaskId, history.page + 1)}>{session.text.tasksNextPage}<i class="ph ph-arrow-right"></i></button></div></footer>{/if}
      </div>
    </div>
  {/if}
  {#if tasksStore.taskEdit}
    <div class="modal-overlay" role="dialog" aria-modal="true" tabindex="-1" bind:this={taskDialogElement} aria-label={session.text.channelEdit} onclick={() => (tasksStore.taskEdit = null)} onkeydown={(event) => { if (event.key === "Escape") tasksStore.taskEdit = null; }}>
      <div class="modal-card task-editor-modal" role="presentation" onclick={(event) => event.stopPropagation()}>
        <form id="desktop-task-form" aria-label={session.text.channelEdit} onsubmit={(event) => { event.preventDefault(); void saveTaskEditor(); }}>
          <header class="modal-head"><div><strong>{session.text.channelEdit}</strong><p>{tasksStore.taskEdit.channel} / {tasksStore.taskEdit.botId}{tasksStore.taskEdit.chatId ? ` / ${tasksStore.taskEdit.chatId}` : ""}</p></div><button class="modal-close" type="button" aria-label={session.text.cancel} disabled={Boolean(tasksStore.busy)} onclick={() => (tasksStore.taskEdit = null)}><i class="ph ph-x"></i></button></header>
          <div class="modal-body task-editor-body"><label class="settings-field settings-field-wide"><span>{session.text.tasksText}</span><textarea rows="7" bind:value={tasksStore.taskEdit.draftText}></textarea></label><TaskScheduleBuilder bind:schedule={tasksStore.taskEdit.draftSchedule} /><div class="settings-form task-advanced-settings"><label class="settings-field"><span>{session.text.tasksTimezone}</span><select bind:value={tasksStore.taskEdit.draftTimezone}>{#if tasksStore.taskEdit.draftTimezone && !timezoneOptions().includes(tasksStore.taskEdit.draftTimezone)}<option value={tasksStore.taskEdit.draftTimezone}>{tasksStore.taskEdit.draftTimezone}</option>{/if}{#each timezoneOptions() as tz (tz)}<option value={tz}>{tz}</option>{/each}</select></label><label class="settings-field"><span>{session.text.tasksDelivery}</span><select bind:value={tasksStore.taskEdit.draftDelivery}><option value="agent">{session.text.tasksDeliveryAgent}</option><option value="text">{session.text.tasksDeliveryText}</option></select></label><label class="settings-field"><span>{session.text.tasksSessionMode}</span><select bind:value={tasksStore.taskEdit.draftSessionMode}><option value="fresh">{session.text.tasksSessionFresh}</option><option value="chat">{session.text.tasksSessionChat}</option></select></label></div></div>
          <footer class="entity-editor-foot"><button class="secondary-button" type="button" disabled={Boolean(tasksStore.busy)} onclick={() => (tasksStore.taskEdit = null)}>{session.text.cancel}</button><button class="primary-button" type="submit" disabled={Boolean(tasksStore.busy) || !tasksStore.taskEdit.draftText.trim() || tasksStore.taskEdit.draftSchedule.trim().split(/\s+/).length !== 5}>{tasksStore.busy ? session.text.onboardingProviderSaving : session.text.save}</button></footer>
        </form>
      </div>
    </div>
  {/if}
  {#if tasksStore.actionMessage}
    <div class="settings-action-toast" role="status"><span>{tasksStore.actionMessage}</span>{#if tasksStore.undoEnabledChange}<button type="button" onclick={() => void undoTaskEnabledChange()}>{session.text.undo}</button>{/if}</div>
  {/if}
  {#if tasksStore.taskSession}
    <div class="modal-overlay" role="dialog" aria-modal="true" tabindex="-1" bind:this={taskDialogElement} aria-label={tasksStore.taskSession.execution ? session.text.tasksExecutionDetail : session.text.tasksSession} onclick={() => (tasksStore.taskSession = null)} onkeydown={(event) => { if (event.key === "Escape") tasksStore.taskSession = null; }}>
      <div class="modal-card task-session-modal" tabindex="-1" role="presentation" onclick={(event) => event.stopPropagation()}>
        <header class="modal-head">
          <strong>{tasksStore.taskSession.execution ? session.text.tasksExecutionDetail : session.text.tasksSession}</strong>
          <button class="modal-close" type="button" aria-label={session.text.cancel} onclick={() => (tasksStore.taskSession = null)}><i class="ph ph-x"></i></button>
        </header>
        <div class="modal-body messages task-session-detail" aria-live="polite">
          <details class="technical-detail task-session-technical"><summary>{session.text.technicalDetails}</summary><code>{tasksStore.taskSession.sessionId}</code></details>
          {#if tasksStore.taskSession.execution}
            {@const execution = tasksStore.taskSession.execution}
            <dl class="automation-task-facts">
              <div><dt>{session.text.tasksByStatus}</dt><dd><span class={`execution-state state-${execution.status}`}><i></i>{executionStatusLabel(execution.status)}</span></dd></div>
              <div><dt>{session.text.tasksExecutionStarted}</dt><dd>{formatTaskTime(execution.startedAt)}</dd></div>
              <div><dt>{session.text.tasksExecutionFinished}</dt><dd>{formatTaskTime(execution.finishedAt ?? "")}</dd></div>
              <div><dt>{session.text.tasksExecutionAttempt}</dt><dd>{execution.attempt} / {execution.maxAttempts}</dd></div>
              {#if execution.lastError}<div><dt>{session.text.tasksFailed}</dt><dd>{execution.lastError}</dd></div>{/if}
              {#if execution.result}
                <div><dt>{session.text.tasksExecutionTargets}</dt><dd>{execution.result.completedTargets}</dd></div>
                <div><dt>{session.text.tasksExecutionScannedConversations}</dt><dd>{execution.result.scannedConversations}</dd></div>
                <div><dt>{session.text.tasksExecutionScannedMessages}</dt><dd>{execution.result.scannedMessages}</dd></div>
                {#if execution.result.kind === "memory-reflection"}
                  <div><dt>{session.text.tasksExecutionCreatedCandidates}</dt><dd>{execution.result.createdCandidates}</dd></div>
                {:else}
                  <div><dt>{session.text.tasksExecutionCreatedFiles}</dt><dd>{execution.result.createdFiles.length > 0 ? execution.result.createdFiles.join("、") : session.text.tasksExecutionNoFiles}</dd></div>
                {/if}
              {/if}
            </dl>
            {#if !execution.detailAvailable}<p>{session.text.tasksExecutionLegacy}</p>{/if}
          {:else if tasksStore.taskSession.messages.length === 0}
            <p>{session.text.tasksSessionCleaned}</p>
          {:else}
            <ConversationTranscript messages={tasksStore.taskSession.messages} copy={session.text} formatTime={formatSessionTime} />
          {/if}
        </div>
      </div>
    </div>
  {/if}
  {#if tasksStore.pendingDeleteIds}
    <div class="modal-overlay" role="dialog" aria-modal="true" tabindex="-1" bind:this={taskDialogElement} aria-label={session.text.confirmDelete} onclick={cancelDeleteTask} onkeydown={(event) => { if (event.key === "Escape") cancelDeleteTask(); }}>
      <div class="modal-card task-delete-confirm-modal" role="presentation" onclick={(event) => event.stopPropagation()}>
        <header class="modal-head"><div><strong>{session.text.confirmDelete}</strong><p>{session.text.tasksDeleteConfirm.replace("{count}", String(tasksStore.pendingDeleteIds.length))}</p></div></header>
        <footer class="entity-editor-foot"><button class="secondary-button" type="button" onclick={cancelDeleteTask}>{session.text.cancel}</button><button class="primary-button danger-action" type="button" onclick={() => void confirmDeleteTask()}>{session.text.confirmDelete}</button></footer>
      </div>
    </div>
  {/if}
{/if}
