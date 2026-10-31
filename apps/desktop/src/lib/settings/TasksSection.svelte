<script lang="ts">
  import ChatHeader from "../chat/ChatHeader.svelte";
  import Button from "../components/ui/Button.svelte";
  import ArrowLeft from "reicon-svelte/icons/ArrowLeft";
  import ArrowRight from "reicon-svelte/icons/ArrowRight";
  import Bell from "reicon-svelte/icons/Bell";
  import CalendarDays from "reicon-svelte/icons/CalendarDays";
  import ChatDots from "reicon-svelte/icons/ChatDots";
  import Check from "reicon-svelte/icons/Check";
  import Clock from "reicon-svelte/icons/Clock";
  import Folder from "reicon-svelte/icons/Folder";
  import Cpu from "reicon-svelte/icons/Cpu";
  import Loader from "reicon-svelte/icons/Loader";
  import Pause from "reicon-svelte/icons/Pause";
  import Pen from "reicon-svelte/icons/Pen";
  import Play from "reicon-svelte/icons/Play";
  import Plus from "reicon-svelte/icons/Plus";
  import Refresh from "reicon-svelte/icons/Refresh";
  import SquareArrowUp from "reicon-svelte/icons/SquareArrowUp";
  import StopCircle from "reicon-svelte/icons/StopCircle";
  import Trash from "reicon-svelte/icons/Trash";
  import TriangleWarning from "reicon-svelte/icons/TriangleWarning";
  import X from "reicon-svelte/icons/X";
  import { onMount, onDestroy } from "svelte";
  import { session } from "../stores/session.svelte";
  import type { DesktopTaskSummary } from "@molibot/desktop-contract";
  import { timezoneOptions } from "./timezones";
  import TaskScheduleBuilder from "./TaskScheduleBuilder.svelte";
  import { cronSortMinutes, listCronOccurrences, nextCronOccurrence } from "./taskSchedule";
  import { externalChannelLabel } from "../stores/channels.svelte";
  import ConversationTranscript from "../chat/ConversationTranscript.svelte";
  import EmptyState from "../components/ui/EmptyState.svelte";
  import OverflowMenu from "../components/ui/OverflowMenu.svelte";
  import WorkspaceSearch from "../components/ui/WorkspaceSearch.svelte";
  import WorkspaceEmpty from "../components/ui/WorkspaceEmpty.svelte";
  import SelectControl from "../components/ui/SelectControl.svelte";
  import SkeletonRows from "../components/ui/SkeletonRows.svelte";
  import Dialog from "../components/ui/Dialog.svelte";
  import AlertDialog from "../components/ui/AlertDialog.svelte";
  import { formatDuration, formatNaturalDateTime, formatNaturalSchedule } from "../presentation";
  import { listFlip, listIn, listOut } from "../motion/listMotion";
  import { DirectManipulation, type ManipulationSnapshot } from "../native/directManipulation";
  import { ActivityScheduler, documentActivityVisibility, interactiveActivityPolicy } from "../native/activityScheduler";
  import {
    tasksStore,
    beginTaskCreate,
    beginTaskEdit,
    executeTaskAction,
    isTaskRunning,
    isTaskStarting,
    isTaskUpdating,
    loadTaskHistoryPage,
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
    requestDeleteTask,
    confirmDeleteTask,
    cancelDeleteTask
  } from "../stores/tasks.svelte";

  let { presentation = "settings", projectId = "", onUnreadChange = () => {} }: { presentation?: "settings" | "workspace" | "project"; projectId?: string; onUnreadChange?: (count: number) => void } = $props();

  let selectedTaskId = $state("");
  let activeTaskView = $state<"user" | "project" | "one-shot" | "system">("user");
  let selectedAgendaDayKey = $state("all");
  let agendaIncludePaused = $state(false);
  let nowTick = $state(Date.now());
  let detailDragOffset = $state(0);
  let detailGesturePhase = $state<ManipulationSnapshot["phase"]>("idle");
  let detailGestureFrame = 0;
  let detailGestureFrameAt = 0;
  const detailManipulation = new DirectManipulation({
    min: 0,
    max: 640,
    reducedMotion: () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    onUpdate(snapshot) {
      detailDragOffset = snapshot.position;
      detailGesturePhase = snapshot.phase;
    },
    onSettled(target) {
      detailGesturePhase = "idle";
      detailDragOffset = 0;
      if (target > 0) selectedTaskId = "";
    }
  });
  let oneShotReadAttemptKey = $state("");

  $effect(() => {
    if (projectId) activeTaskView = "project";
  });

  function stepDetailGesture(timestamp: number): void {
    const elapsed = detailGestureFrameAt ? timestamp - detailGestureFrameAt : 16;
    detailGestureFrameAt = timestamp;
    if (detailManipulation.step(elapsed)) {
      detailGestureFrame = requestAnimationFrame(stepDetailGesture);
    } else {
      detailGestureFrame = 0;
      detailGestureFrameAt = 0;
    }
  }

  function settleDetailGesture(): void {
    if (detailGestureFrame) cancelAnimationFrame(detailGestureFrame);
    detailGestureFrame = requestAnimationFrame(stepDetailGesture);
  }

  function beginDetailDrag(event: PointerEvent): void {
    if (!(event.currentTarget instanceof HTMLElement)) return;
    if (detailGestureFrame) cancelAnimationFrame(detailGestureFrame);
    detailGestureFrame = 0;
    detailGestureFrameAt = 0;
    if (detailManipulation.current().phase === "settling") {
      detailManipulation.interrupt(event.pointerId, event.clientX, event.timeStamp);
    } else {
      detailManipulation.begin(event.pointerId, event.clientX, event.timeStamp);
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDetailDrag(event: PointerEvent): void {
    detailManipulation.move(event.pointerId, event.clientX, event.timeStamp);
  }

  function endDetailDrag(event: PointerEvent): void {
    if (event.currentTarget instanceof HTMLElement && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (detailManipulation.end(event.pointerId, event.timeStamp) !== null) settleDetailGesture();
  }

  function cancelDetailDrag(): void {
    if (detailGesturePhase === "idle") return;
    detailManipulation.cancel();
    settleDetailGesture();
  }

  function isSystemTask(id: string): boolean {
    return tasksStore.tasks?.items.some((task) => task.id === id && task.category === "system") === true;
  }

  let taskScheduler: ActivityScheduler | null = null;

  $effect(() => {
    if (session.serviceReady && session.endpoint && session.endpoint !== tasksStore.endpoint) {
      taskScheduler?.wake("manual");
    }
  });

  onMount(() => {
    nowTick = Date.now();
    taskScheduler = new ActivityScheduler(
      interactiveActivityPolicy,
      async () => {
        nowTick = Date.now();
        if (session.serviceReady && session.endpoint) await refreshTasks();
      },
      documentActivityVisibility
    );
    taskScheduler.start();
  });

  onDestroy(() => {
    taskScheduler?.dispose();
    taskScheduler = null;
    if (detailGestureFrame) cancelAnimationFrame(detailGestureFrame);
  });


  function matchesTaskView(item: DesktopTaskSummary["items"][number]): boolean {
    if (projectId) return item.category === "project" && item.projectId === projectId && item.type === "periodic";
    if (activeTaskView === "one-shot") return item.category === "user" && item.type === "one-shot";
    return item.category === activeTaskView && item.type === "periodic";
  }

  const filteredTaskItems = $derived(
    tasksStore.tasks?.items.filter((item) => matchesTaskView(item) && (!tasksStore.query.trim() || [taskTitle(item), item.text, item.channel, item.botId, item.chatId, item.projectName, item.status, item.type].join("\n").toLowerCase().includes(tasksStore.query.trim().toLowerCase()))) ?? []
  );

  const referenceNow = $derived(new Date(nowTick));

  const oneShotTaskItems = $derived([...filteredTaskItems].sort((a, b) => {
    if (a.reminderUnread !== b.reminderUnread) return a.reminderUnread ? -1 : 1;
    if (a.status === "completed" && b.status !== "completed") return 1;
    if (a.status !== "completed" && b.status === "completed") return -1;
    return (a.status === "completed" ? b.completedAt.localeCompare(a.completedAt) : a.scheduleText.localeCompare(b.scheduleText));
  }));

  const periodicTaskItems = $derived([...filteredTaskItems].sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    if (a.enabled) {
      const nextA = nextCronOccurrence(a.scheduleText, referenceNow, 366)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const nextB = nextCronOccurrence(b.scheduleText, referenceNow, 366)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      if (nextA !== nextB) return nextA - nextB;
    }
    const sortA = cronSortMinutes(a.scheduleText);
    const sortB = cronSortMinutes(b.scheduleText);
    if (sortA !== sortB) return sortA - sortB;
    return taskTitle(a).localeCompare(taskTitle(b), session.locale);
  }));

  const displayTaskItems = $derived(
    activeTaskView === "one-shot" ? oneShotTaskItems : periodicTaskItems
  );

  const taskCategoryCounts = $derived({
    user: tasksStore.tasks?.items.filter((item) => item.category === "user" && item.type === "periodic").length ?? 0,
    project: tasksStore.tasks?.items.filter((item) => item.category === "project" && item.type === "periodic" && (!projectId || item.projectId === projectId)).length ?? 0,
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
  // The global execution counters span every scope (system, all projects, all
  // channels), so in a single project's view they would pair "0 tasks" with
  // hundreds of unrelated runs. Scope the run total to this project's tasks.
  const projectRunTotal = $derived(
    tasksStore.tasks?.items
      .filter((item) => item.category === "project" && item.projectId === projectId && item.type === "periodic")
      .reduce((sum, item) => sum + (Number(item.executionCount) || 0), 0) ?? 0
  );

  const taskTargetGroups = $derived.by(() => {
    const groups = new Map<string, { key: string; label: string; options: Array<{ index: number; label: string }> }>();
    for (const [index, target] of (tasksStore.tasks?.targets ?? []).entries()) {
      if (projectId && (target.kind !== "project" || target.projectId !== projectId)) continue;
      if (!projectId && activeTaskView === "project" && target.kind !== "project") continue;
      if (!projectId && activeTaskView === "user" && target.kind !== "channel") continue;
      const key = target.kind === "project" ? `project\n${target.projectId}` : `${target.channel}\n${target.botId}`;
      if (target.kind === "project") {
        groups.set(key, { key, label: `${session.text.tasksProjectTab} · ${target.projectName}`, options: [{ index, label: target.projectName }] });
        continue;
      }
      const channel = target.channel === "web"
        ? "Web"
        : externalChannelLabel(target.channel as "telegram" | "feishu" | "qq" | "weixin", session.locale);
      const group = groups.get(key) ?? { key, label: `${channel} · ${target.botDisplayName || target.botId}`, options: [] };
      group.options.push({ index, label: target.chatId });
      groups.set(key, group);
    }
    return [...groups.values()];
  });

  const selectedTaskTargetGroup = $derived(tasksStore.taskCreate
    ? tasksStore.taskCreate.kind === "project"
      ? `project\n${tasksStore.taskCreate.projectId}`
      : `${tasksStore.taskCreate.channel}\n${tasksStore.taskCreate.botId}`
    : "");

  const projectTaskTargets = $derived((tasksStore.tasks?.targets ?? []).flatMap((target, index) =>
    target.kind === "project" ? [{ index, projectId: target.projectId, label: target.projectName }] : []
  ));

  const selectedProjectTargetIndex = $derived.by(() => {
    const draft = tasksStore.taskCreate;
    if (!draft || draft.kind !== "project") return 0;
    return Math.max(0, projectTaskTargets.findIndex((target) => target.projectId === draft.projectId));
  });

  function selectTaskTargetGroup(key: string): void {
    const first = taskTargetGroups.find((group) => group.key === key)?.options[0];
    if (first) selectTaskCreateTarget(first.index);
  }

  function formatSessionTime(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(session.locale, { hour: "2-digit", minute: "2-digit" }).format(date);
  }

  function formatTaskTime(value: string): string {
    if (!value) return session.text.tasksNeverRun;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(session.locale, {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  function taskStatusText(task: DesktopTaskSummary["items"][number]): string {
    if (task.type === "one-shot") return oneShotStatusText(task);
    if (isTaskStarting(task.id)) return session.text.tasksStarting;
    if (!task.enabled) return session.text.tasksPaused;
    if (task.active) return session.text.taskStatusRunning;
    // The headline is the outcome of the last run, so a task that finished or
    // died reads as finished or failed rather than as perpetually in progress.
    return task.lastRun ? executionStatusLabel(task.lastRun.status) : session.text.tasksNeverRunYet;
  }

  function taskScheduleStatusText(task: DesktopTaskSummary["items"][number]): string {
    return task.enabled ? session.text.tasksSchedulePending : session.text.tasksPaused;
  }

  function taskExecutionStatusText(task: DesktopTaskSummary["items"][number]): string {
    if (isTaskStarting(task.id)) return session.text.tasksStarting;
    return isTaskRunning(task.id) ? session.text.taskStatusRunning : session.text.tasksIdle;
  }

  function taskLatestResultText(task: DesktopTaskSummary["items"][number]): string {
    if (!task.lastRun) return session.text.tasksNoRecord;
    return executionStatusLabel(task.lastRun.status);
  }

  /** The failure line to show, preferring the last run's own message. */
  function taskErrorText(task: DesktopTaskSummary["items"][number]): string {
    if (task.lastRun?.status === "interrupted") return task.lastRun.lastError || session.text.tasksInterruptedHint;
    return task.lastRun?.lastError || task.lastError || "";
  }

  function taskTitle(task: DesktopTaskSummary["items"][number]): string {
    if (task.systemKind === "memory-reflection") return session.text.tasksSystemMemoryReflection;
    if (task.systemKind === "daily-materials") return session.text.tasksSystemDailyMaterials;
    return task.text.split(/\r?\n/)[0] || task.text;
  }

  function selectTaskCategory(category: "user" | "project" | "one-shot" | "system"): void {
    activeTaskView = category;
    selectedTaskId = "";
    selectedAgendaDayKey = "all";
    tasksStore.selected = new Set();
  }

  function beginCreateForView(): void {
    const targetProjectId = projectId || (activeTaskView === "project"
      ? tasksStore.tasks?.targets.find((target) => target.kind === "project")?.projectId ?? ""
      : "");
    beginTaskCreate(targetProjectId);
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

  function executionStatusLabel(status: DesktopTaskSummary["items"][number]["executions"][number]["status"]): string {
    return session.text[`taskExecution_${status}`];
  }

  function taskScheduleText(task: DesktopTaskSummary["items"][number]): string {
    if (task.type === "periodic") return formatNaturalSchedule(task.scheduleText, session.locale);
    if (task.type === "one-shot") return formatNaturalDateTime(task.scheduleText, session.locale);
    return session.text.taskTypeImmediate;
  }

  const taskCategoryOptions = $derived([
    { value: "user", label: `${session.text.tasksUserTab} · ${taskCategoryCounts.user}` },
    { value: "project", label: `${session.text.tasksProjectTab} · ${taskCategoryCounts.project}` },
    { value: "one-shot", label: `${session.text.tasksOneShotTab} · ${taskCategoryCounts["one-shot"]}` },
    { value: "system", label: `${session.text.tasksSystemTab} · ${taskCategoryCounts.system}` }
  ]);
  const taskGroups = $derived(activeTaskView === "one-shot"
    ? [{ label: "", items: displayTaskItems }]
    : [
      { label: session.text.tasksEnabled, items: displayTaskItems.filter((task) => task.enabled) },
      { label: session.text.tasksPaused, items: displayTaskItems.filter((task) => !task.enabled) }
    ]);

  function runningExecution(task: DesktopTaskSummary["items"][number]) {
    return task.executions.find((execution) => execution.status === "running" || execution.status === "retry_wait");
  }

  function taskTargetLabel(task: DesktopTaskSummary["items"][number]): string {
    if (task.category === "project" && task.projectName) return task.projectName;
    if (task.category === "system" || task.channel === "system") return session.text.tasksTargetSystem;
    if (task.channel === "web") return "Web";
    if (task.channel === "telegram" || task.channel === "feishu" || task.channel === "qq" || task.channel === "weixin") {
      return externalChannelLabel(task.channel, session.locale);
    }
    if (task.channel) return task.channel;
    if (task.type === "one-shot") return session.text.tasksOneShotTab;
    return "";
  }

  function dateDayKey(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function isSameLocalDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  function formatClockTime(date: Date): string {
    return new Intl.DateTimeFormat(session.locale, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(date);
  }

  function dayPeriodLabel(date: Date): string {
    const hour = date.getHours();
    if (hour < 6) return session.text.tasksPeriodEarly;
    if (hour < 12) return session.text.tasksPeriodMorning;
    if (hour < 18) return session.text.tasksPeriodAfternoon;
    return session.text.tasksPeriodEvening;
  }

  function formatRelativeUntil(target: Date, fromDate: Date = referenceNow): string {
    const diffMs = target.getTime() - fromDate.getTime();
    if (diffMs <= 60_000) return session.text.tasksRelativeSoon;
    const diffMinutes = Math.round(diffMs / 60_000);
    if (diffMinutes < 60) {
      return session.text.tasksRelativeInMinutes.replace("{count}", String(Math.max(1, diffMinutes)));
    }
    const diffHours = Math.round(diffMinutes / 60);
    if (diffHours < 36) {
      return session.text.tasksRelativeInHours.replace("{count}", String(diffHours));
    }
    const diffDays = Math.max(1, Math.round(diffHours / 24));
    return session.text.tasksRelativeInDays.replace("{count}", String(diffDays));
  }

  function formatNextOccurrenceStamp(target: Date, fromDate: Date = referenceNow): string {
    const timeText = formatClockTime(target);
    if (isSameLocalDay(target, fromDate)) {
      return `${session.text.tasksAgendaToday} ${timeText}`;
    }
    const tomorrow = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate() + 1);
    if (isSameLocalDay(target, tomorrow)) {
      return `${session.text.tasksAgendaTomorrow} ${timeText}`;
    }
    const monthDay = new Intl.DateTimeFormat(session.locale, { month: "numeric", day: "numeric" }).format(target);
    return `${monthDay} ${timeText}`;
  }

  function taskNextOccurrence(task: DesktopTaskSummary["items"][number], includePaused = false): Date | null {
    if (task.type === "periodic") {
      if (!task.enabled && !includePaused) return null;
      return nextCronOccurrence(task.scheduleText, referenceNow, 366);
    }
    if (task.type === "one-shot") {
      if (task.status === "completed" || task.status === "error" || task.status === "skipped") return null;
      const ms = Date.parse(task.scheduleText);
      if (!Number.isFinite(ms) || ms < referenceNow.getTime() - 60_000) return null;
      return new Date(ms);
    }
    return null;
  }

  function taskNextRunText(task: DesktopTaskSummary["items"][number]): string {
    if (task.type === "one-shot") {
      if (task.status === "completed") return session.text.tasksReminderReminded;
      const next = taskNextOccurrence(task);
      return next ? `${formatNextOccurrenceStamp(next)} · ${formatRelativeUntil(next)}` : taskScheduleText(task);
    }
    if (!task.enabled) return session.text.tasksPaused;
    const next = taskNextOccurrence(task);
    if (!next) return session.text.tasksSchedulePending;
    return `${formatNextOccurrenceStamp(next)} · ${formatRelativeUntil(next)}`;
  }

  function executionDurationText(execution: DesktopTaskSummary["items"][number]["executions"][number]): string {
    if (!execution.startedAt || !execution.finishedAt) return "";
    const startMs = Date.parse(execution.startedAt);
    const endMs = Date.parse(execution.finishedAt);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return "";
    return formatDuration(endMs - startMs);
  }

  const enabledTaskCount = $derived(
    displayTaskItems.filter((task) => task.type === "one-shot"
      ? task.status !== "completed" && task.status !== "error" && task.status !== "skipped"
      : task.enabled
    ).length
  );
  const pausedTaskCount = $derived(
    displayTaskItems.filter((task) => task.type === "periodic" && !task.enabled).length
  );
  const effectiveIncludePaused = $derived(
    agendaIncludePaused || (enabledTaskCount === 0 && pausedTaskCount > 0)
  );

  const nextUpcomingRun = $derived.by(() => {
    let best: { task: DesktopTaskSummary["items"][number]; at: Date } | null = null;
    for (const task of displayTaskItems) {
      const next = taskNextOccurrence(task, false);
      if (!next) continue;
      if (!best || next.getTime() < best.at.getTime()) {
        best = { task, at: next };
      }
    }
    return best;
  });

  interface AgendaSlotItem {
    key: string;
    task: DesktopTaskSummary["items"][number];
    at: Date;
    timeText: string;
    periodText: string;
    relativeText: string;
    isNextUp: boolean;
  }

  interface AgendaDayGroup {
    key: string;
    date: Date;
    isToday: boolean;
    isTomorrow: boolean;
    shortLabel: string;
    dayNumber: string;
    fullLabel: string;
    items: AgendaSlotItem[];
  }

  const agendaDays = $derived.by((): AgendaDayGroup[] => {
    const startOfToday = new Date(referenceNow.getFullYear(), referenceNow.getMonth(), referenceNow.getDate(), 0, 0, 0, 0);
    const endOfWindow = new Date(referenceNow.getFullYear(), referenceNow.getMonth(), referenceNow.getDate() + 6, 23, 59, 59, 999);
    const weekdayShortFmt = new Intl.DateTimeFormat(session.locale, { weekday: "short" });
    const monthDayFmt = new Intl.DateTimeFormat(session.locale, { month: "short", day: "numeric", weekday: "short" });

    const days: AgendaDayGroup[] = [];
    const dayMap = new Map<string, AgendaDayGroup>();

    for (let offset = 0; offset < 7; offset += 1) {
      const d = new Date(startOfToday.getFullYear(), startOfToday.getMonth(), startOfToday.getDate() + offset);
      const key = dateDayKey(d);
      const isToday = offset === 0;
      const isTomorrow = offset === 1;
      const shortLabel = isToday
        ? session.text.tasksAgendaToday
        : isTomorrow
          ? session.text.tasksAgendaTomorrow
          : weekdayShortFmt.format(d);
      const prefix = isToday
        ? `${session.text.tasksAgendaToday} · `
        : isTomorrow
          ? `${session.text.tasksAgendaTomorrow} · `
          : "";
      const group: AgendaDayGroup = {
        key,
        date: d,
        isToday,
        isTomorrow,
        shortLabel,
        dayNumber: String(d.getDate()).padStart(2, "0"),
        fullLabel: `${prefix}${monthDayFmt.format(d)}`,
        items: []
      };
      days.push(group);
      dayMap.set(key, group);
    }

    const nextUpKey = nextUpcomingRun ? `${nextUpcomingRun.task.id}@${nextUpcomingRun.at.getTime()}` : "";

    for (const task of displayTaskItems) {
      if (task.type === "periodic") {
        if (!task.enabled && !effectiveIncludePaused) continue;
        const occurrences = listCronOccurrences(task.scheduleText, referenceNow, endOfWindow, 28);
        for (const at of occurrences) {
          const group = dayMap.get(dateDayKey(at));
          if (!group) continue;
          const slotKey = `${task.id}@${at.getTime()}`;
          group.items.push({
            key: slotKey,
            task,
            at,
            timeText: formatClockTime(at),
            periodText: dayPeriodLabel(at),
            relativeText: formatRelativeUntil(at, referenceNow),
            isNextUp: slotKey === nextUpKey
          });
        }
      } else if (task.type === "one-shot") {
        const next = taskNextOccurrence(task, false);
        if (!next || next.getTime() > endOfWindow.getTime()) continue;
        const group = dayMap.get(dateDayKey(next));
        if (!group) continue;
        const slotKey = `${task.id}@${next.getTime()}`;
        group.items.push({
          key: slotKey,
          task,
          at: next,
          timeText: formatClockTime(next),
          periodText: dayPeriodLabel(next),
          relativeText: formatRelativeUntil(next, referenceNow),
          isNextUp: slotKey === nextUpKey
        });
      }
    }

    for (const day of days) {
      day.items.sort((a, b) => a.at.getTime() - b.at.getTime() || taskTitle(a.task).localeCompare(taskTitle(b.task), session.locale));
    }
    return days;
  });

  const totalAgendaSlots = $derived(agendaDays.reduce((sum, day) => sum + day.items.length, 0));
  const visibleAgendaDays = $derived(
    selectedAgendaDayKey === "all"
      ? agendaDays.filter((day) => day.items.length > 0)
      : agendaDays.filter((day) => day.key === selectedAgendaDayKey)
  );
</script>

{#snippet taskActions()}
  <div class="workspace-header-tools">
    <WorkspaceSearch value={tasksStore.query} label={session.text.tasksFilter} placeholder={session.text.tasksFilterHint} closeLabel={session.text.closeSearch} onInput={(value) => (tasksStore.query = value)} />
    {#if activeTaskView === "user" || activeTaskView === "project"}
      <Button variant="icon" title={session.text.tasksCreate} disabled={!session.serviceReady || Boolean(tasksStore.busy) || taskTargetGroups.length === 0} onclick={beginCreateForView}><Plus size={16} aria-hidden="true" /></Button>
    {/if}
    <Button variant="icon" title={session.text.workspaceRefresh} disabled={!session.serviceReady || tasksStore.loading} onclick={() => taskScheduler?.wake("manual")}><Refresh size={16} aria-hidden="true" /></Button>
  </div>
{/snippet}
{#if presentation === "workspace"}<ChatHeader title={session.text.autoTasks} actions={taskActions} />{/if}

<svelte:window onkeydown={(event) => { if (event.key === "Escape" && selectedTask) selectedTaskId = ""; }} onblur={cancelDetailDrag} />

{#if !session.serviceReady}
  <div class="settings-card"><EmptyState title={session.text.tasksUnavailable} icon="clock-countdown" /></div>
{:else if tasksStore.loading}
  <div class="settings-card"><SkeletonRows count={5} label={session.text.loading} /></div>
{:else if tasksStore.error && !tasksStore.tasks}
  <div class="settings-card" role="alert"><div class="settings-row"><div><p>{session.text.workspaceLoadFailed}</p><small>{tasksStore.error}</small></div><button class="secondary-button" type="button" onclick={() => taskScheduler?.wake("retry")}>{session.text.retryLoading}</button></div></div>
{:else if !tasksStore.tasks}
  <div class="settings-card"><div class="settings-row"><p>{session.text.loading}</p></div></div>
{:else}
  {#if presentation !== "workspace" && presentation !== "project"}<div class="automation-category-bar">{@render taskActions()}</div>{/if}
  <div class="automation-workspace" id="tasks-main-panel">
    {#if presentation === "workspace"}<p class="workspace-description" title={session.text.autoTasksHint}>{session.text.autoTasksHint}</p>{/if}
    <div class="workspace-filterbar">
      {#if !projectId}
        <div class="segmented workspace-task-filters" role="group" aria-label={session.text.tasksCategories}>
          {#each taskCategoryOptions as item}
            <Button class={`segmented-item${activeTaskView === item.value ? " active" : ""}`} aria-pressed={activeTaskView === item.value} onclick={() => selectTaskCategory(item.value as typeof activeTaskView)}>{item.label}</Button>
          {/each}
        </div>
      {/if}
      {#if projectId}<span class="workspace-filter-count">{session.text.tasksTotal} <strong>{displayTaskItems.length}</strong></span>{/if}
      <span class="workspace-filter-summary" title={activeTaskView === "one-shot"
        ? `${session.text.tasksReminderPending} ${oneShotCounts.pending} · ${session.text.tasksReminderReminded} ${oneShotCounts.reminded} · ${session.text.tasksReminderUnread} ${oneShotCounts.unread}`
        : projectId
          ? `${session.text.tasksRunCount} ${projectRunTotal}`
          : `${session.text.tasksRunCount} ${executionTotals.total} · ${session.text.tasksSuccessful} ${executionTotals.completed} · ${session.text.tasksFailed} ${executionTotals.failed}`}>
        {#if activeTaskView === "one-shot"}
          {session.text.tasksReminderPending} {oneShotCounts.pending} · {session.text.tasksReminderReminded} {oneShotCounts.reminded} · {session.text.tasksReminderUnread} {oneShotCounts.unread}
        {:else if projectId}
          {session.text.tasksRunCount} {projectRunTotal}
        {:else}
          {session.text.tasksRunCount} {executionTotals.total} · {session.text.tasksSuccessful} {executionTotals.completed} · {session.text.tasksFailed} {executionTotals.failed}
        {/if}
      </span>
      {#if presentation === "project"}{@render taskActions()}{/if}
    </div>
      <div class:detail-open={Boolean(selectedTask)} class="automation-workspace-layout">
        <div class="automation-workspace-list">
          {#if displayTaskItems.length === 0}
      <div class="workspace-empty compact">
        <EmptyState title={activeTaskView === "one-shot" ? session.text.tasksReminderEmpty : session.text.tasksEmpty} description={activeTaskView === "one-shot" ? "" : session.text.tasksEmptyHint} icon={activeTaskView === "one-shot" ? "bell" : "clock-countdown"}>
          {#if activeTaskView === "user" || activeTaskView === "project"}
            <button class="secondary-button" type="button" disabled={Boolean(tasksStore.busy) || (!projectId && taskTargetGroups.length === 0)} onclick={beginCreateForView}><Plus size={13} aria-hidden="true" />{session.text.tasksCreate}</button>
          {/if}
        </EmptyState>
      </div>
          {:else}
          {#each taskGroups as group (group.label)}
            {#if group.items.length > 0 && group.label}<h3 class="workspace-list-group">{group.label}<span>{group.items.length}</span></h3>{/if}
          {#each group.items as task (task.id)}
            <div role="button" tabindex="0" class:active={selectedTask?.id === task.id} class:running={isTaskRunning(task.id)} class:paused={!task.enabled} class:unread={task.reminderUnread} class="automation-task-row" aria-label={taskTitle(task)} aria-pressed={selectedTask?.id === task.id} data-status={task.status} in:listIn={{ disabled: Boolean(tasksStore.query.trim()) }} out:listOut={{ disabled: Boolean(tasksStore.query.trim()) }} animate:listFlip={{ disabled: Boolean(tasksStore.query.trim()) }} onclick={() => (selectedTaskId = task.id)} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectedTaskId = task.id; } }}>
              <div class="automation-task-card-top">
                  <span class="automation-task-row-mark" aria-hidden="true">
                    {#if isTaskRunning(task.id)}
                      <Loader class="automation-spinner" size={13} aria-hidden="true" />
                    {:else if task.type === "periodic"}
                      {#if task.category === "system"}<Cpu size={16} />{:else if task.category === "project"}<Folder size={16} />{:else}<Refresh size={16} />{/if}
                    {:else if task.status === "completed"}
                      <Check size={13} class="one-shot-mark-completed" />
                    {:else if task.status === "error" || task.status === "skipped"}
                      <TriangleWarning size={13} class="one-shot-mark-error" />
                    {:else}
                      <Bell size={13} class="one-shot-mark-pending" />
                    {/if}
                  </span>
                <strong class="automation-task-card-title">{taskTitle(task)}</strong>
                <span class={`row-outcome outcome-${task.lastRun?.status ?? "none"} state-${task.status}`}>
                  {#if task.reminderUnread}<i class="unread-dot" aria-hidden="true"></i>{/if}
                  {task.type === "one-shot" || isTaskRunning(task.id) ? taskStatusText(task) : task.enabled ? session.text.tasksEnabled : session.text.tasksPaused}
                </span>
              </div>


              <div class="automation-task-card-footer">
                {#if task.enabled && task.lastRun && ["failed", "aborted", "interrupted"].includes(task.lastRun.status)}<span class="workspace-row-error"><TriangleWarning size={12} aria-hidden="true" />{taskLatestResultText(task)}</span>{/if}
                {#if !projectId && taskTargetLabel(task)}
                  <span class="task-target-pill">{taskTargetLabel(task)}</span>
                {/if}
                <span class="task-schedule-line">
                  <Clock size={12} aria-hidden="true" />
                  <span>{taskScheduleText(task)}</span>
                </span>
                {#if task.type === "periodic" && task.enabled}
                  {@const nextRun = taskNextOccurrence(task)}
                  {#if nextRun}
                    <span class="task-next-run-hint" title={`${session.text.tasksNextRun}: ${formatNextOccurrenceStamp(nextRun)}`}>{formatRelativeUntil(nextRun)}</span>
                  {/if}
                {/if}
                {#if task.type === "one-shot" && task.executions[0]}
                  <button class="task-session-link" type="button" title={session.text.tasksOpenSession} aria-label={session.text.tasksOpenSession} disabled={!task.executions[0].sessionId || Boolean(tasksStore.busy)} onclick={(event) => { event.stopPropagation(); void openTaskSession(task.id, task.executions[0].id); }}><ChatDots size={13} aria-hidden="true" /></button>
                {/if}
              </div>
            </div>
          {/each}
          {/each}
          {/if}
        </div>
        {#if selectedTask}
          {#key selectedTask.id}
            <article class:dragging={detailGesturePhase === "dragging"} class:settling={detailGesturePhase === "settling"} class="automation-task-detail" style={`--detail-drag:${detailDragOffset}px`} aria-labelledby={`automation-task-${selectedTask.id}`}>
            <button class="automation-detail-drag-handle" type="button" aria-label={session.text.tasksSwipeClose} onpointerdown={beginDetailDrag} onpointermove={moveDetailDrag} onpointerup={endDetailDrag} onpointercancel={cancelDetailDrag}><span aria-hidden="true"></span></button>
            <button class="automation-detail-close" type="button" title={session.text.tasksCloseDetails} aria-label={session.text.tasksCloseDetails} onclick={() => (selectedTaskId = "")}><X size={14} aria-hidden="true" /></button>
            <header class="automation-task-detail-head">
              <div>
                <h2 id={`automation-task-${selectedTask.id}`}>{taskTitle(selectedTask)}</h2>
                <p>{selectedTask.type === "one-shot" ? session.text.tasksOneShotTab : selectedTask.category === "system" ? session.text.tasksSystemOwner : selectedTask.category === "project" ? selectedTask.projectName : session.text.tasksUserOwner}</p>
              </div>
              <div class="automation-task-detail-topbar">
                <span class:active={isTaskRunning(selectedTask.id)} class:error={selectedTask.status === "error"} class:paused={!selectedTask.enabled} class="automation-status"><i></i>{selectedTask.type === "one-shot" || isTaskRunning(selectedTask.id) ? taskStatusText(selectedTask) : selectedTask.enabled ? session.text.tasksEnabled : session.text.tasksPaused}</span>
                <div class="automation-task-detail-actions">
                  {#if selectedTask.type === "one-shot"}
                    {#if selectedTask.executions[0]}
                      <button class="task-session-link" type="button" title={selectedTask.executions[0].sessionId} disabled={Boolean(tasksStore.busy) || !selectedTask.executions[0].sessionId} onclick={() => void openTaskSession(selectedTask.id, selectedTask.executions[0].id)}><ChatDots size={13} aria-hidden="true" />{selectedTask.executions[0].sessionId ? session.text.tasksOpenSession : session.text.tasksSessionCleaned}</button>
                    {/if}
                    <button class="danger-action" type="button" disabled={Boolean(tasksStore.busy)} onclick={() => requestDeleteTask([selectedTask.id])}><Trash size={13} aria-hidden="true" />{session.text.channelDelete}</button>
                  {:else}
                    {#if isTaskRunning(selectedTask.id) && runningExecution(selectedTask)?.runId}
                      <button class="automation-run-button danger-action" type="button" disabled={isTaskUpdating(selectedTask.id)} onclick={() => void stopTaskRun(selectedTask.id, runningExecution(selectedTask)?.runId ?? "")}><StopCircle size={13} aria-hidden="true" />{session.text.tasksStop}</button>
                    {:else}
                      <Button variant="primary" disabled={!selectedTask.enabled || isTaskStarting(selectedTask.id) || isTaskUpdating(selectedTask.id)} onclick={() => void executeTaskAction("trigger", [selectedTask.id])}>{#if isTaskStarting(selectedTask.id)}<Loader class="automation-spinner" size={13} aria-hidden="true" />{:else}<Play weight="Filled" size={13} aria-hidden="true" />{/if}{isTaskStarting(selectedTask.id) ? session.text.tasksStarting : session.text.tasksTrigger}</Button>
                    {/if}
                    {#if selectedTask.executions[0]?.sessionId}<Button onclick={() => void openTaskSession(selectedTask.id, selectedTask.executions[0].id)}><ChatDots size={13} aria-hidden="true" />{selectedTask.category === "system" ? session.text.tasksOpenExecution : session.text.tasksOpenSession}</Button>{/if}
                    {#if selectedTask.category !== "system"}<OverflowMenu label={session.text.workspaceMore}><button role="menuitem" type="button" disabled={isTaskRunning(selectedTask.id) || isTaskUpdating(selectedTask.id)} onclick={() => void setTaskEnabled(selectedTask.id, !selectedTask.enabled)}>{#if selectedTask.enabled}<Pause size={14} aria-hidden="true" />{:else}<Play size={14} aria-hidden="true" />{/if}{selectedTask.enabled ? session.text.tasksPause : session.text.tasksResume}</button><button role="menuitem" type="button" disabled={Boolean(tasksStore.busy) || tasksStore.taskEdit !== null} onclick={() => beginTaskEdit(selectedTask)}><Pen size={14} aria-hidden="true" />{session.text.channelEdit}</button><button role="menuitem" class="danger-action" type="button" disabled={Boolean(tasksStore.busy)} onclick={() => requestDeleteTask([selectedTask.id])}><Trash size={14} aria-hidden="true" />{session.text.channelDelete}</button></OverflowMenu>{/if}
                  {/if}
                </div>
              </div>

            </header>
            <dl class="automation-task-facts">
              <div><dt>{session.text.tasksEnabledState}</dt><dd>{selectedTask.type === "one-shot" ? oneShotStatusText(selectedTask) : selectedTask.enabled ? session.text.tasksEnabled : session.text.tasksDisabled}</dd></div>
              <div><dt>{session.text.tasksCurrentRun}</dt><dd>{selectedTask.type === "one-shot" ? (selectedTask.status === "completed" ? session.text.tasksReminderReminded : session.text.tasksReminderPending) : taskExecutionStatusText(selectedTask)}</dd></div>
              <div><dt>{session.text.tasksScheduleState}</dt><dd>{selectedTask.type === "one-shot" ? oneShotStatusText(selectedTask) : taskScheduleStatusText(selectedTask)}</dd></div>
              <div><dt>{session.text.tasksLatestResult}</dt><dd><span class={`execution-state state-${selectedTask.lastRun?.status ?? "none"}`}><i></i>{selectedTask.type === "one-shot" ? oneShotStatusText(selectedTask) : taskLatestResultText(selectedTask)}</span></dd></div>
              <div><dt>{session.text.tasksSchedule}</dt><dd><CalendarDays size={13} aria-hidden="true" />{taskScheduleText(selectedTask)}</dd></div>
              <div><dt>{session.text.tasksNextRun}</dt><dd>{taskNextRunText(selectedTask)}</dd></div>
              <div><dt>{session.text.tasksLastRun}</dt><dd>{formatTaskTime(selectedTask.lastRun?.startedAt || selectedTask.lastTriggeredAt || selectedTask.completedAt || "")}</dd></div>
            </dl>
            <section class="automation-task-detail-copy" aria-label={session.text.tasksText}><span>{session.text.tasksText}</span><p>{selectedTask.text}</p></section>
            <details class="automation-task-technical technical-detail">
              <summary>{session.text.technicalDetails}</summary>
              <dl>
                <div><dt>{session.text.tasksTaskId}</dt><dd><code>{selectedTask.id}</code></dd></div>
                <div><dt>{session.text.tasksTarget}</dt><dd>{selectedTask.category === "project" ? selectedTask.projectName : `${selectedTask.channel} / ${selectedTask.botId} / ${selectedTask.chatId}`}</dd></div>
                <div><dt>{session.text.tasksCustomCron}</dt><dd><code>{selectedTask.scheduleText}</code></dd></div>
                <div><dt>{session.text.tasksTimezone}</dt><dd>{selectedTask.timezone}</dd></div>
                <div><dt>{session.text.tasksDelivery}</dt><dd>{selectedTask.delivery}</dd></div>
              </dl>
            </details>
            {#if taskErrorText(selectedTask)}<p class="run-history-failed">{taskErrorText(selectedTask)}</p>{/if}
            <section class="automation-task-runs" aria-labelledby={`automation-task-runs-${selectedTask.id}`}>
              <header><h3 id={`automation-task-runs-${selectedTask.id}`}>{session.text.tasksRecentRuns}</h3><span>{selectedTask.executionCount}</span></header>
              {#if selectedTask.executions.length === 0}
                <p>{session.text.tasksNoExecutions}</p>
              {:else}
                {#each selectedTask.executions as execution (execution.id)}
                  {@const durationLabel = executionDurationText(execution)}
                  <div class="automation-task-run-row">
                    <span class={`execution-state state-${execution.status}`}><i></i>{executionStatusLabel(execution.status)}</span>
                    <span>{formatTaskTime(execution.startedAt)}{#if durationLabel} · {durationLabel}{/if}</span>
                    <button class="task-session-link" type="button" title={execution.sessionId} disabled={Boolean(tasksStore.busy) || !execution.sessionId} onclick={() => void openTaskSession(selectedTask.id, execution.id)}>{execution.sessionId ? (selectedTask.category === "system" ? session.text.tasksOpenExecution : session.text.tasksOpenSession) : session.text.tasksSessionCleaned}</button>
                  </div>
                {/each}
              {/if}
              <button class="task-history-toggle" type="button" disabled={Boolean(tasksStore.busy) && tasksStore.busy !== `history:${selectedTask.id}`} onclick={() => void openTaskHistory(selectedTask.id)}>{session.text.tasksViewAllRuns}<SquareArrowUp size={13} aria-hidden="true" /></button>
            </section>
          </article>
        {/key}
      {:else}
        <div class="workspace-detail-placeholder" class:has-agenda={displayTaskItems.length > 0 && totalAgendaSlots > 0}>
          {#if displayTaskItems.length > 0 && totalAgendaSlots > 0}
            <section class="automation-agenda" aria-label={session.text.tasksAgendaTitle}>
              <header class="automation-agenda-head">
                <div class="automation-agenda-title">
                  <h3>{session.text.tasksAgendaTitle}</h3>
                  <p>{session.text.tasksAgendaSubtitle}</p>
                </div>
                {#if pausedTaskCount > 0 && enabledTaskCount > 0}
                  <button
                    type="button"
                    class:active={agendaIncludePaused}
                    class="agenda-filter-chip"
                    aria-pressed={agendaIncludePaused}
                    onclick={() => (agendaIncludePaused = !agendaIncludePaused)}
                  >
                    <span>{session.text.tasksAgendaIncludePaused}</span>
                    <strong>{pausedTaskCount}</strong>
                  </button>
                {/if}
              </header>

              {#if nextUpcomingRun}
                <button
                  type="button"
                  class="automation-next-up-card"
                  onclick={() => (selectedTaskId = nextUpcomingRun.task.id)}
                >
                  <span class="next-up-badge"><i class="next-up-dot" aria-hidden="true"></i>{session.text.tasksNextUp}</span>
                  <div class="next-up-main">
                    <strong>{taskTitle(nextUpcomingRun.task)}</strong>
                    {#if !projectId && taskTargetLabel(nextUpcomingRun.task)}
                      <span class="next-up-target">{taskTargetLabel(nextUpcomingRun.task)}</span>
                    {/if}
                  </div>
                  <div class="next-up-timing">
                    <span class="next-up-stamp">{formatNextOccurrenceStamp(nextUpcomingRun.at)}</span>
                    <span class="next-up-countdown">{formatRelativeUntil(nextUpcomingRun.at)}</span>
                  </div>
                </button>
              {:else if enabledTaskCount === 0 && pausedTaskCount > 0}
                <div class="automation-agenda-paused-banner" role="status">
                  <Pause size={13} aria-hidden="true" />
                  <span>{session.text.tasksAgendaAllPausedBanner}</span>
                </div>
              {/if}

              <div class="automation-week-strip" role="group" aria-label={session.text.tasksAgendaTitle}>
                <button
                  type="button"
                  class:active={selectedAgendaDayKey === "all"}
                  class="week-strip-all"
                  aria-pressed={selectedAgendaDayKey === "all"}
                  onclick={() => (selectedAgendaDayKey = "all")}
                >
                  <span>{session.text.tasksAgendaAllDays}</span>
                  <strong>{totalAgendaSlots}</strong>
                </button>
                {#each agendaDays as day (day.key)}
                  <button
                    type="button"
                    class:active={selectedAgendaDayKey === day.key}
                    class:today={day.isToday}
                    class:empty={day.items.length === 0}
                    class="week-strip-day"
                    aria-pressed={selectedAgendaDayKey === day.key}
                    onclick={() => (selectedAgendaDayKey = selectedAgendaDayKey === day.key ? "all" : day.key)}
                  >
                    <span class="week-day-name">{day.shortLabel}</span>
                    <strong class="week-day-num">{day.dayNumber}</strong>
                    <span class="week-day-dots" aria-hidden="true">
                      {#if day.items.length === 0}
                        <i class="empty-dot"></i>
                      {:else}
                        {#each day.items.slice(0, 4) as slot (slot.key)}
                          <i class:paused={!slot.task.enabled} class:next={slot.isNextUp}></i>
                        {/each}
                      {/if}
                    </span>
                  </button>
                {/each}
              </div>

              <div class="automation-agenda-timeline">
                {#each visibleAgendaDays as day (day.key)}
                  <div class="automation-agenda-day">
                    <header class="agenda-day-header">
                      <h4>{day.fullLabel}</h4>
                      <span>{day.items.length}</span>
                    </header>
                    {#if day.items.length === 0}
                      <p class="agenda-day-empty">{session.text.tasksAgendaNoRunsDay}</p>
                    {:else}
                      <div class="agenda-day-slots">
                        {#each day.items as slot (slot.key)}
                          <button
                            type="button"
                            class:is-next={slot.isNextUp}
                            class:is-paused={!slot.task.enabled}
                            class="agenda-slot-row"
                            onclick={() => (selectedTaskId = slot.task.id)}
                          >
                            <div class="agenda-slot-time">
                              <strong>{slot.timeText}</strong>
                              <span>{slot.periodText}</span>
                            </div>
                            <span class="agenda-slot-axis" aria-hidden="true"><i></i></span>
                            <div class="agenda-slot-body">
                              <strong class="agenda-slot-title">{taskTitle(slot.task)}</strong>
                              <span class="agenda-slot-sub">
                                {#if !projectId && taskTargetLabel(slot.task)}{taskTargetLabel(slot.task)} · {/if}{taskScheduleText(slot.task)}
                              </span>
                            </div>
                            <div class="agenda-slot-trailing">
                              {#if !slot.task.enabled}
                                <span class="agenda-slot-tag paused">{session.text.tasksPaused}</span>
                              {:else if slot.isNextUp}
                                <span class="agenda-slot-tag next">{slot.relativeText}</span>
                              {:else}
                                <span class="agenda-slot-tag">{slot.relativeText}</span>
                              {/if}
                            </div>
                          </button>
                        {/each}
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            </section>
          {:else}
            <WorkspaceEmpty title={session.text.tasksSelect} description={session.text.tasksDetailEmptyHint} />
          {/if}
        </div>
      {/if}
      </div>
  </div>
  {#if tasksStore.taskCreate}
    <Dialog open={Boolean(tasksStore.taskCreate)} busy={tasksStore.busy === "create"} contentClass="task-editor-modal" labelledBy="task-create-title" describedBy="task-create-hint" onOpenChange={(next) => { if (!next) tasksStore.taskCreate = null; }}>
      <form id="desktop-task-create-form" onsubmit={(event) => { event.preventDefault(); void saveTaskCreate(); }}>
        <header class="modal-head"><div><strong id="task-create-title">{session.text.tasksCreate}</strong><p id="task-create-hint">{session.text.tasksCreateHint}</p></div><button class="modal-close" type="button" aria-label={session.text.dialogClose} onclick={() => (tasksStore.taskCreate = null)}><X size={16} aria-hidden="true" /></button></header>
        <div class="modal-body task-editor-body">
          {#if tasksStore.taskCreate.kind === "project" && projectId}<div class="task-target-picker">
            <label class="settings-field"><span>{session.text.tasksProjectTarget}</span><input value={tasksStore.taskCreate.projectName} autocomplete="off" readonly /></label>
            <small>{session.text.tasksProjectTargetHint}</small>
          </div>{:else if tasksStore.taskCreate.kind === "project"}<div class="task-target-picker">
            <label class="settings-field"><span>{session.text.tasksProjectTarget}</span><SelectControl value={String(selectedProjectTargetIndex)} ariaLabel={session.text.tasksProjectTarget} options={projectTaskTargets.map((target, index) => ({ value: String(index), label: target.label }))} onChange={(value) => selectTaskCreateTarget(projectTaskTargets[Number(value)]?.index ?? -1)} /></label>
            <small>{session.text.tasksProjectTargetHint}</small>
          </div>{:else if !projectId}<div class="task-target-picker">
            <label class="settings-field"><span>{session.text.tasksTargetBot}</span><SelectControl value={selectedTaskTargetGroup} ariaLabel={session.text.tasksTargetBot} options={taskTargetGroups.map((group) => ({ value: group.key, label: group.label }))} onChange={selectTaskTargetGroup} /></label>
            <label class="settings-field"><span>{session.text.tasksTargetConversation}</span><SelectControl value={String(Math.max(0, tasksStore.tasks.targets.findIndex((target) => target.channel === tasksStore.taskCreate?.channel && target.botId === tasksStore.taskCreate?.botId && target.chatId === tasksStore.taskCreate?.chatId && target.scope === tasksStore.taskCreate?.scope)))} ariaLabel={session.text.tasksTargetConversation} options={(taskTargetGroups.find((group) => group.key === selectedTaskTargetGroup)?.options ?? []).map((option) => ({ value: String(option.index), label: option.label }))} onChange={(value) => selectTaskCreateTarget(Number(value))} /></label>
            <small>{session.text.tasksTargetHint}</small>
          </div>{/if}
          <label class="settings-field settings-field-wide"><span>{session.text.tasksText}</span><textarea rows="7" bind:value={tasksStore.taskCreate.text}></textarea></label>
          <TaskScheduleBuilder bind:schedule={tasksStore.taskCreate.schedule} />
          <div class="settings-form task-advanced-settings"><label class="settings-field"><span>{session.text.tasksTimezone}</span><SelectControl value={tasksStore.taskCreate.timezone} ariaLabel={session.text.tasksTimezone} options={[...(!timezoneOptions().includes(tasksStore.taskCreate.timezone) ? [{ value: tasksStore.taskCreate.timezone, label: tasksStore.taskCreate.timezone }] : []), ...timezoneOptions().map((tz) => ({ value: tz, label: tz }))]} onChange={(value) => tasksStore.taskCreate!.timezone = value} /></label>{#if tasksStore.taskCreate.kind !== "project"}<label class="settings-field"><span>{session.text.tasksDelivery}</span><SelectControl value={tasksStore.taskCreate.delivery} ariaLabel={session.text.tasksDelivery} options={[{ value: "agent", label: session.text.tasksDeliveryAgent }, { value: "text", label: session.text.tasksDeliveryText }]} onChange={(value) => tasksStore.taskCreate!.delivery = value as "agent" | "text"} /></label><label class="settings-field"><span>{session.text.tasksSessionMode}</span><SelectControl value={tasksStore.taskCreate.sessionMode} ariaLabel={session.text.tasksSessionMode} options={[{ value: "fresh", label: session.text.tasksSessionFresh }, { value: "chat", label: session.text.tasksSessionChat }]} onChange={(value) => tasksStore.taskCreate!.sessionMode = value as "fresh" | "chat"} /></label>{/if}</div>
        </div>
        <footer class="entity-editor-foot"><button class="secondary-button" type="button" onclick={() => (tasksStore.taskCreate = null)}>{session.text.cancel}</button><button class="primary-button" type="submit" disabled={Boolean(tasksStore.busy) || !tasksStore.taskCreate.text.trim() || tasksStore.taskCreate.schedule.trim().split(/\s+/).length !== 5}>{tasksStore.busy === "create" ? session.text.onboardingProviderSaving : session.text.tasksCreate}</button></footer>
      </form>
    </Dialog>
  {/if}
  {#if tasksStore.historyTaskId}
    {@const historyTask = tasksStore.tasks.items.find((item) => item.id === tasksStore.historyTaskId)}
    {@const history = tasksStore.histories[tasksStore.historyTaskId]}
    <Dialog open={Boolean(tasksStore.historyTaskId)} busy={Boolean(tasksStore.busy)} contentClass="task-history-modal" labelledBy="task-history-title" onOpenChange={(next) => { if (!next) tasksStore.historyTaskId = ""; }}>
      <header class="modal-head task-history-modal-head"><div><span id="task-history-title">{session.text.tasksExecutions}</span><strong>{historyTask?.text.split(/\r?\n/)[0] || session.text.tasks}</strong></div><button class="modal-close" type="button" aria-label={session.text.dialogClose} onclick={() => (tasksStore.historyTaskId = "")}><X size={16} aria-hidden="true" /></button></header>
      <div class="modal-body task-history-modal-body">
        {#if !history}<p class="task-history-loading">{session.text.loading}</p>{:else if history.items.length === 0}<p class="task-history-loading">{session.text.tasksNoExecutions}</p>{:else}
          <div class="task-history-table-head"><span>{session.text.tasksByStatus}</span><span>{session.text.tasksLastTriggered}</span><span>{session.text.tasksSession}</span></div>
          {#each history.items as execution (execution.id)}
            <div class="task-execution-row history-row"><span class={`execution-state state-${execution.status}`}><i></i>{executionStatusLabel(execution.status)}</span><span>{formatTaskTime(execution.startedAt)}</span><button class="task-session-link" type="button" title={execution.sessionId} disabled={!execution.sessionId || Boolean(tasksStore.busy)} onclick={() => void openTaskSession(tasksStore.historyTaskId, execution.id)}>{execution.sessionId ? (isSystemTask(tasksStore.historyTaskId) ? session.text.tasksOpenExecution : session.text.tasksOpenSession) : session.text.tasksSessionCleaned}</button></div>
          {/each}
        {/if}
      </div>
      {#if history}<footer class="task-history-modal-foot"><span>{pageSummary(history.page, history.pageSize, history.total)}</span><div><button class="secondary-button" type="button" disabled={history.page <= 1 || Boolean(tasksStore.busy)} onclick={() => void loadTaskHistoryPage(tasksStore.historyTaskId, history.page - 1)}><ArrowLeft size={13} aria-hidden="true" />{session.text.tasksPreviousPage}</button><button class="secondary-button" type="button" disabled={history.page * history.pageSize >= history.total || Boolean(tasksStore.busy)} onclick={() => void loadTaskHistoryPage(tasksStore.historyTaskId, history.page + 1)}>{session.text.tasksNextPage}<ArrowRight size={13} aria-hidden="true" /></button></div></footer>{/if}
    </Dialog>
  {/if}
  {#if tasksStore.taskEdit}
    <Dialog open={Boolean(tasksStore.taskEdit)} busy={Boolean(tasksStore.busy)} contentClass="task-editor-modal" labelledBy="task-edit-title" onOpenChange={(next) => { if (!next) tasksStore.taskEdit = null; }}>
      <form id="desktop-task-form" aria-label={session.text.channelEdit} onsubmit={(event) => { event.preventDefault(); void saveTaskEditor(); }}>
        <header class="modal-head"><div><strong id="task-edit-title">{session.text.channelEdit}</strong><p>{tasksStore.taskEdit.category === "project" ? tasksStore.taskEdit.projectName : `${tasksStore.taskEdit.channel} / ${tasksStore.taskEdit.botId}${tasksStore.taskEdit.chatId ? ` / ${tasksStore.taskEdit.chatId}` : ""}`}</p></div><button class="modal-close" type="button" aria-label={session.text.dialogClose} disabled={Boolean(tasksStore.busy)} onclick={() => (tasksStore.taskEdit = null)}><X size={16} aria-hidden="true" /></button></header>
        <div class="modal-body task-editor-body"><label class="settings-field settings-field-wide"><span>{session.text.tasksText}</span><textarea rows="7" bind:value={tasksStore.taskEdit.draftText}></textarea></label><TaskScheduleBuilder bind:schedule={tasksStore.taskEdit.draftSchedule} /><div class="settings-form task-advanced-settings"><label class="settings-field"><span>{session.text.tasksTimezone}</span><SelectControl value={tasksStore.taskEdit.draftTimezone} ariaLabel={session.text.tasksTimezone} options={[...(!timezoneOptions().includes(tasksStore.taskEdit.draftTimezone) ? [{ value: tasksStore.taskEdit.draftTimezone, label: tasksStore.taskEdit.draftTimezone }] : []), ...timezoneOptions().map((tz) => ({ value: tz, label: tz }))]} onChange={(value) => tasksStore.taskEdit!.draftTimezone = value} /></label>{#if tasksStore.taskEdit.category !== "project"}<label class="settings-field"><span>{session.text.tasksDelivery}</span><SelectControl value={tasksStore.taskEdit.draftDelivery} ariaLabel={session.text.tasksDelivery} options={[{ value: "agent", label: session.text.tasksDeliveryAgent }, { value: "text", label: session.text.tasksDeliveryText }]} onChange={(value) => tasksStore.taskEdit!.draftDelivery = value as "agent" | "text"} /></label><label class="settings-field"><span>{session.text.tasksSessionMode}</span><SelectControl value={tasksStore.taskEdit.draftSessionMode} ariaLabel={session.text.tasksSessionMode} options={[{ value: "fresh", label: session.text.tasksSessionFresh }, { value: "chat", label: session.text.tasksSessionChat }]} onChange={(value) => tasksStore.taskEdit!.draftSessionMode = value as "fresh" | "chat"} /></label>{/if}</div></div>
        <footer class="entity-editor-foot"><button class="secondary-button" type="button" disabled={Boolean(tasksStore.busy)} onclick={() => (tasksStore.taskEdit = null)}>{session.text.cancel}</button><button class="primary-button" type="submit" disabled={Boolean(tasksStore.busy) || !tasksStore.taskEdit.draftText.trim() || tasksStore.taskEdit.draftSchedule.trim().split(/\s+/).length !== 5}>{tasksStore.busy ? session.text.onboardingProviderSaving : session.text.save}</button></footer>
      </form>
    </Dialog>
  {/if}
  {#if tasksStore.actionMessage}
    <div class="settings-action-toast" role="status"><span>{tasksStore.actionMessage}</span>{#if tasksStore.undoEnabledChange}<button type="button" onclick={() => void undoTaskEnabledChange()}>{session.text.undo}</button>{/if}</div>
  {/if}
  {#if tasksStore.taskSession}
    <Dialog open={Boolean(tasksStore.taskSession)} contentClass="task-session-modal" labelledBy="task-session-title" onOpenChange={(next) => { if (!next) tasksStore.taskSession = null; }}>
      <header class="modal-head">
        <strong id="task-session-title">{tasksStore.taskSession.execution ? session.text.tasksExecutionDetail : session.text.tasksSession}</strong>
        <button class="modal-close" type="button" aria-label={session.text.dialogClose} onclick={() => (tasksStore.taskSession = null)}><X size={16} aria-hidden="true" /></button>
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
          <ConversationTranscript messages={tasksStore.taskSession.messages} copy={session.text} formatTime={formatSessionTime} endpoint={session.endpoint ?? ""} />
        {/if}
      </div>
    </Dialog>
  {/if}
  {#if tasksStore.pendingDeleteIds}
    <AlertDialog open={Boolean(tasksStore.pendingDeleteIds)} busy={Boolean(tasksStore.busy)} contentClass="task-delete-confirm-modal" labelledBy="task-delete-title" describedBy="task-delete-description" onOpenChange={(next) => { if (!next) cancelDeleteTask(); }}>
      <header class="modal-head"><div><strong id="task-delete-title">{session.text.confirmDelete}</strong><p id="task-delete-description">{session.text.tasksDeleteConfirm.replace("{count}", String(tasksStore.pendingDeleteIds.length))}</p></div></header>
      <footer class="entity-editor-foot"><button class="secondary-button" type="button" disabled={Boolean(tasksStore.busy)} onclick={cancelDeleteTask}>{session.text.cancel}</button><button class="primary-button danger-action" type="button" disabled={Boolean(tasksStore.busy)} onclick={() => void confirmDeleteTask()}>{session.text.confirmDelete}</button></footer>
    </AlertDialog>
  {/if}
{/if}
