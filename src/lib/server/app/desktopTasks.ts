import type {
  DesktopTaskExecution,
  DesktopTaskItem,
  DesktopTaskSessionMessage,
  DesktopTaskState,
  DesktopTaskSummary,
  DesktopTaskTarget,
  DesktopTaskType
} from "$lib/shared/desktop";
import { createHash } from "node:crypto";
import type { RuntimeSettings } from "$lib/server/settings/schema";

const KNOWN_TYPES: readonly DesktopTaskType[] = ["one-shot", "periodic", "immediate"];
const KNOWN_STATES: readonly DesktopTaskState[] = ["pending", "running", "completed", "skipped", "error"];

function taskSessionText(content: unknown): string {
  if (typeof content === "string") {
    const value = content.trim();
    if (!value || (value[0] !== "[" && value[0] !== "{")) return value;
    try {
      const parsed = JSON.parse(value) as unknown;
      if (isAgentContentBlocks(parsed)) return taskSessionText(parsed);
    } catch {
      // Ordinary text that happens to start with JSON punctuation stays intact.
    }
    return value;
  }
  const blocks = Array.isArray(content) ? content : [content];
  return blocks
    .map((block) => {
      if (!block || typeof block !== "object") return "";
      const item = block as { type?: unknown; text?: unknown };
      return item.type === "text" && typeof item.text === "string" ? item.text.trim() : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function isAgentContentBlocks(value: unknown): boolean {
  const blocks = Array.isArray(value) ? value : [value];
  const knownTypes = new Set(["text", "thinking", "toolCall", "toolResult", "image"]);
  return blocks.length > 0 && blocks.every((block) => {
    if (!block || typeof block !== "object") return false;
    return knownTypes.has(String((block as { type?: unknown }).type ?? ""));
  });
}

function taskSessionCreatedAt(value: unknown): string {
  const date = typeof value === "number" || typeof value === "string" ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : "";
}

export function buildDesktopTaskSessionMessages(messages: unknown[]): DesktopTaskSessionMessage[] {
  return messages.flatMap((message) => {
    if (!message || typeof message !== "object") return [];
    const source = message as { role?: unknown; content?: unknown; timestamp?: unknown; createdAt?: unknown };
    const role = String(source.role ?? "");
    if (role !== "user" && role !== "assistant") return [];
    const content = taskSessionText(source.content);
    return content ? [{ role, content, createdAt: taskSessionCreatedAt(source.timestamp ?? source.createdAt) }] : [];
  });
}

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
export type DesktopTaskExecutionLoader = (taskId: string) => { items: DesktopTaskExecution[]; total: number };

/**
 * Projects enabled channel instances' explicit allow-lists into task targets.
 * Runtime settings are the source of truth: filesystem directories and
 * partially populated session metadata never participate in target discovery.
 */
export function buildDesktopTaskTargets(settings: RuntimeSettings): DesktopTaskTarget[] {
  const targets: DesktopTaskTarget[] = [];
  for (const [channel, group] of Object.entries(settings.channels ?? {})) {
    if (channel === "web") continue;
    for (const instance of group?.instances ?? []) {
      if (instance.enabled === false) continue;
      const chatIds = Array.from(new Set((instance.allowedChatIds ?? []).map(String).map((value) => value.trim()).filter(Boolean)));
      for (const chatId of chatIds) {
        targets.push({
          channel,
          botId: instance.id,
          botDisplayName: String(instance.name ?? "").trim() || instance.id,
          chatId,
          scope: "chat-scratch"
        });
      }
    }
  }
  return targets.sort((a, b) => a.channel.localeCompare(b.channel)
    || (a.botDisplayName || a.botId).localeCompare(b.botDisplayName || b.botId)
    || a.chatId.localeCompare(b.chatId));
}

export function buildDesktopTaskItem(item: SharedTaskItem, loadExecutions: DesktopTaskExecutionLoader = () => ({ items: [], total: 0 })): DesktopTaskItem {
  const taskId = String(item.taskId ?? "").trim() || desktopTaskId(item.filePath);
  const executions = loadExecutions(taskId);
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
    executions: executions.items,
    executionCount: executions.total
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
  loadExecutions: DesktopTaskExecutionLoader = () => ({ items: [], total: 0 }),
  targets: DesktopTaskTarget[] = []
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
    targets,
    counts: { total: desktopItems.length, byType, byStatus, byScope, byChannel }
  };
}
