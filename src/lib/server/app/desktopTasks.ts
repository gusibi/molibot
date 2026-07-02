import type {
  DesktopTaskExecution,
  DesktopTaskItem,
  DesktopTaskState,
  DesktopTaskSummary,
  DesktopTaskType
} from "$lib/shared/desktop";
import { createHash } from "node:crypto";

const KNOWN_TYPES: readonly DesktopTaskType[] = ["one-shot", "periodic", "immediate"];
const KNOWN_STATES: readonly DesktopTaskState[] = ["pending", "running", "completed", "skipped", "error"];

/**
 * The shape of a task item produced by the shared tasks route. Task text is
 * intentionally editable in Desktop, while the absolute file path is reduced
 * to an opaque id and never returned.
 */
interface SharedTaskItem {
  taskId?: string;
  channel: string;
  botId: string;
  chatId: string;
  scope: string;
  type: string;
  text: string;
  filePath: string;
  delivery: string;
  scheduleText: string;
  timezone: string;
  status: string;
  statusReason: string;
  lastError: string;
  runCount: number;
  completedAt: string;
  lastTriggeredAt: string;
  sessionMode: string;
  updatedAt: string;
  createdAt: string;
}

export function desktopTaskId(filePath: string): string {
  return createHash("sha256").update(filePath).digest("hex").slice(0, 16);
}

function coerceType(value: string): DesktopTaskType {
  return (KNOWN_TYPES as readonly string[]).includes(value) ? (value as DesktopTaskType) : "one-shot";
}

function coerceState(value: string): DesktopTaskState {
  return (KNOWN_STATES as readonly string[]).includes(value) ? (value as DesktopTaskState) : "pending";
}

/**
 * Maps a shared task item into a path-safe Desktop view. Task text is included
 * because the Web task page supports editing it; the absolute file path is
 * replaced with a stable opaque id.
 */
export type DesktopTaskExecutionLoader = (taskId: string) => DesktopTaskExecution[];

export function buildDesktopTaskItem(item: SharedTaskItem, loadExecutions: DesktopTaskExecutionLoader = () => []): DesktopTaskItem {
  const taskId = String(item.taskId ?? "").trim() || desktopTaskId(item.filePath);
  return {
    id: desktopTaskId(item.filePath),
    taskId,
    channel: item.channel,
    botId: item.botId,
    chatId: item.chatId,
    scope: item.scope === "chat-scratch" ? "chat-scratch" : "workspace",
    type: coerceType(item.type),
    text: item.text,
    delivery: item.delivery,
    scheduleText: item.scheduleText,
    timezone: item.timezone,
    status: coerceState(item.status),
    statusReason: item.statusReason,
    lastError: item.lastError,
    runCount: item.runCount,
    completedAt: item.completedAt,
    lastTriggeredAt: item.lastTriggeredAt,
    sessionMode: item.sessionMode,
    updatedAt: item.updatedAt,
    createdAt: item.createdAt,
    executions: loadExecutions(taskId)
  };
}

export function resolveDesktopTaskPaths(items: SharedTaskItem[], ids: string[]): Map<string, string> {
  const requested = new Set(ids);
  const result = new Map<string, string>();
  for (const item of items.filter((entry) => entry.type === "periodic")) {
    const id = desktopTaskId(item.filePath);
    if (requested.has(id)) result.set(id, item.filePath);
  }
  if (result.size !== requested.size) throw new Error("Unknown task");
  return result;
}

export function buildDesktopTaskSummary(
  items: SharedTaskItem[],
  loadExecutions: DesktopTaskExecutionLoader = () => []
): DesktopTaskSummary {
  const desktopItems = items.filter((item) => item.type === "periodic").map((item) => buildDesktopTaskItem(item, loadExecutions));
  const byType: Record<DesktopTaskType, number> = { "one-shot": 0, periodic: 0, immediate: 0 };
  const byStatus: Record<DesktopTaskState, number> = {
    pending: 0,
    running: 0,
    completed: 0,
    skipped: 0,
    error: 0
  };
  const byScope = { workspace: 0, chatScratch: 0 };
  const byChannel: Record<string, number> = {};

  for (const item of desktopItems) {
    byType[item.type] += 1;
    byStatus[item.status] += 1;
    if (item.scope === "workspace") byScope.workspace += 1;
    else byScope.chatScratch += 1;
    byChannel[item.channel] = (byChannel[item.channel] ?? 0) + 1;
  }

  return {
    items: desktopItems,
    counts: { total: desktopItems.length, byType, byStatus, byScope, byChannel }
  };
}
