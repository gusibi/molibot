// Scheduled tasks settings — state + orchestration.
import { loadDesktopTaskHistory, loadDesktopTasks, loadDesktopTaskSession, runDesktopTaskAction } from "../api";
import type { DesktopTaskExecutionPage, DesktopTaskSession, DesktopTaskSummary, DesktopTaskTarget } from "@molibot/desktop-contract";
import { session, setError } from "./session.svelte";

export type TaskEditor = DesktopTaskSummary["items"][number] & {
  draftText: string;
  draftDelivery: string;
  draftSchedule: string;
  draftTimezone: string;
  draftSessionMode: string;
};

export type TaskCreateDraft = DesktopTaskTarget & {
  text: string;
  delivery: string;
  schedule: string;
  timezone: string;
  sessionMode: string;
};

export const tasksStore = $state({
  tasks: null as DesktopTaskSummary | null,
  loading: false,
  endpoint: "",
  selected: new Set<string>(),
  taskEdit: null as TaskEditor | null,
  taskCreate: null as TaskCreateDraft | null,
  taskSession: null as DesktopTaskSession | null,
  historyTaskId: "",
  histories: {} as Record<string, DesktopTaskExecutionPage>,
  busy: "",
  query: "",
  actionMessage: ""
});

export function beginTaskCreate(): void {
  const target = tasksStore.tasks?.targets[0] ?? { channel: "telegram", botId: "", chatId: "", scope: "chat-scratch" as const };
  tasksStore.taskCreate = { ...target, text: "", delivery: "agent", schedule: "0 9 * * *", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", sessionMode: "fresh" };
}

export function selectTaskCreateTarget(index: number): void {
  const target = tasksStore.tasks?.targets[index];
  if (!target || !tasksStore.taskCreate) return;
  tasksStore.taskCreate = { ...tasksStore.taskCreate, ...target };
}

export function taskTypeLabel(type: "one-shot" | "periodic" | "immediate", copy: typeof session.text): string {
  if (type === "one-shot") return copy.taskType_oneShot;
  if (type === "periodic") return copy.taskType_periodic;
  return copy.taskType_immediate;
}

export function taskStatusLabel(status: "pending" | "running" | "completed" | "skipped" | "error", copy: typeof session.text): string {
  if (status === "pending") return copy.taskStatus_pending;
  if (status === "running") return copy.taskStatus_running;
  if (status === "completed") return copy.taskStatus_completed;
  if (status === "skipped") return copy.taskStatus_skipped;
  return copy.taskStatus_error;
}

export async function loadTasks(endpoint: string): Promise<void> {
  tasksStore.endpoint = endpoint;
  tasksStore.loading = true;
  session.error = "";
  try {
    tasksStore.tasks = await loadDesktopTasks(endpoint);
  } catch (cause) {
    setError(cause);
  } finally {
    tasksStore.loading = false;
  }
}

export function toggleTaskSelection(id: string): void {
  const next = new Set(tasksStore.selected);
  next.has(id) ? next.delete(id) : next.add(id);
  tasksStore.selected = next;
}

export function beginTaskEdit(item: DesktopTaskSummary["items"][number]): void {
  tasksStore.taskEdit = { ...item, draftText: item.text, draftDelivery: item.delivery || "agent", draftSchedule: item.scheduleText, draftTimezone: item.timezone, draftSessionMode: item.sessionMode || (item.type === "periodic" ? "fresh" : "chat") };
}

export async function executeTaskAction(action: "trigger" | "delete", ids: string[]): Promise<void> {
  const endpoint = session.endpoint;
  if (!endpoint || tasksStore.busy || ids.length === 0) return;
  if (action === "delete" && !window.confirm(session.text.tasksDeleteConfirm.replace("{count}", String(ids.length)))) return;
  tasksStore.busy = action;
  session.error = "";
  try {
    const result = await runDesktopTaskAction(endpoint, { action, ids });
    tasksStore.tasks = result.summary;
    tasksStore.histories = {};
    tasksStore.historyTaskId = "";
    tasksStore.selected = new Set([...tasksStore.selected].filter((id) => !result.affected.includes(id)));
    tasksStore.actionMessage = `${action === "trigger" ? session.text.tasksTriggered : session.text.tasksDeleted}: ${result.affected.length}${result.failed.length ? ` · ${session.text.tasksFailed}: ${result.failed.length}` : ""}`;
  } catch (cause) {
    setError(cause);
  } finally {
    tasksStore.busy = "";
  }
}

export async function openTaskSession(taskId: string, executionId: string): Promise<void> {
  const endpoint = session.endpoint;
  if (!endpoint || tasksStore.busy) return;
  tasksStore.busy = "session";
  session.error = "";
  try {
    tasksStore.taskSession = await loadDesktopTaskSession(endpoint, taskId, executionId);
  } catch (cause) {
    setError(cause);
  } finally {
    tasksStore.busy = "";
  }
}

export async function openTaskHistory(id: string): Promise<void> {
  tasksStore.historyTaskId = id;
  if (!tasksStore.histories[id]) await loadTaskHistoryPage(id, 1);
}

export async function loadTaskHistoryPage(id: string, page: number): Promise<void> {
  const endpoint = session.endpoint;
  if (!endpoint || tasksStore.busy) return;
  tasksStore.busy = `history:${id}`;
  session.error = "";
  try {
    tasksStore.histories = { ...tasksStore.histories, [id]: await loadDesktopTaskHistory(endpoint, id, page, 10) };
  } catch (cause) {
    setError(cause);
  } finally {
    tasksStore.busy = "";
  }
}

export async function saveTaskCreate(): Promise<void> {
  const endpoint = session.endpoint;
  if (!endpoint || !tasksStore.taskCreate || tasksStore.busy) return;
  tasksStore.busy = "create";
  session.error = "";
  try {
    const result = await runDesktopTaskAction(endpoint, { action: "create", task: tasksStore.taskCreate });
    tasksStore.tasks = result.summary;
    tasksStore.histories = {};
    tasksStore.taskCreate = null;
    tasksStore.actionMessage = session.text.tasksCreated;
  } catch (cause) {
    setError(cause);
  } finally {
    tasksStore.busy = "";
  }
}

export async function saveTaskEditor(): Promise<void> {
  const endpoint = session.endpoint;
  if (!endpoint || !tasksStore.taskEdit || tasksStore.busy) return;
  tasksStore.busy = "update";
  session.error = "";
  try {
    const taskEdit = tasksStore.taskEdit;
    const patch: { text: string; delivery: string; sessionMode: string; at?: string; schedule?: string; timezone?: string } = { text: taskEdit.draftText, delivery: taskEdit.draftDelivery, sessionMode: taskEdit.draftSessionMode };
    if (taskEdit.type === "one-shot") patch.at = taskEdit.draftSchedule;
    if (taskEdit.type === "periodic") { patch.schedule = taskEdit.draftSchedule; patch.timezone = taskEdit.draftTimezone; }
    const result = await runDesktopTaskAction(endpoint, { action: "update", id: taskEdit.id, patch });
    tasksStore.tasks = result.summary;
    tasksStore.histories = {};
    tasksStore.taskEdit = null;
    tasksStore.actionMessage = session.text.tasksUpdated;
  } catch (cause) {
    setError(cause);
  } finally {
    tasksStore.busy = "";
  }
}
