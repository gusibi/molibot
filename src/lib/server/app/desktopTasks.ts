import type {
  DesktopTaskExecution,
  DesktopTaskItem,
  DesktopTaskSessionMessage,
  DesktopSystemTaskExecution,
  DesktopSystemTaskExecutionResult,
  DesktopTaskState,
  DesktopTaskSummary,
  DesktopTaskTarget,
  DesktopTaskType
} from "$lib/shared/desktop";
import type { EventExecutionLease } from "$lib/server/agent/eventsLeaseStore";
import { createHash } from "node:crypto";
import type { RuntimeSettings } from "$lib/server/settings/schema";
import { toWebExternalUserId } from "$lib/server/web/identity";

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

function executionCount(value: unknown): number {
  const count = Number(value);
  return Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0;
}

function projectSystemTaskResult(value: unknown): DesktopSystemTaskExecutionResult | undefined {
  if (!value || typeof value !== "object") return undefined;
  const result = value as Record<string, unknown>;
  if (result.kind === "memory-reflection") {
    return {
      kind: "memory-reflection",
      completedTargets: executionCount(result.completedTargets),
      scannedConversations: executionCount(result.scannedConversations),
      scannedMessages: executionCount(result.scannedMessages),
      createdCandidates: executionCount(result.createdCandidates)
    };
  }
  if (result.kind === "daily-materials") {
    return {
      kind: "daily-materials",
      completedTargets: executionCount(result.completedTargets),
      scannedConversations: executionCount(result.scannedConversations),
      scannedMessages: executionCount(result.scannedMessages),
      createdFiles: Array.isArray(result.createdFiles)
        ? result.createdFiles.map(String).map((item) => item.trim()).filter(Boolean)
        : []
    };
  }
  return undefined;
}

export function buildDesktopSystemTaskExecution(
  execution: Pick<EventExecutionLease, "status" | "startedAt" | "finishedAt" | "attempt" | "maxAttempts" | "lastError" | "result">
): DesktopSystemTaskExecution {
  const result = projectSystemTaskResult(execution.result);
  return {
    status: execution.status,
    startedAt: execution.startedAt,
    finishedAt: execution.finishedAt,
    attempt: execution.attempt,
    maxAttempts: execution.maxAttempts,
    ...(execution.lastError ? { lastError: execution.lastError } : {}),
    result,
    detailAvailable: Boolean(result)
  };
}

/**
 * The shape of a task item produced by the shared tasks route. Task text is
 * intentionally editable in Desktop, while the absolute file path is reduced
 * to an opaque id and never returned.
 */
interface SharedTaskItem {
  taskId?: string;
  managed?: { by?: string; scope?: string; kind?: string; ownerId?: string };
  channel: string;
  botId: string;
  projectId?: string;
  projectName?: string;
  chatId: string;
  scope: string;
  type: string;
  enabled?: boolean;
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
  reminderUnread?: boolean;
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
 * Desktop automations are bot-scoped watched events; chatId remains the
 * delivery target, but event files always belong in the bot's events folder.
 * Runtime settings are the source of truth: filesystem directories and
 * partially populated session metadata never participate in target discovery.
 */
export function buildDesktopTaskTargets(
  settings: RuntimeSettings,
  projects: Array<{ id: string; name: string }> = []
): DesktopTaskTarget[] {
  const targets: DesktopTaskTarget[] = [];
  for (const project of projects) {
    targets.push({
      kind: "project",
      channel: "project",
      botId: "",
      chatId: `project:${project.id}`,
      scope: "workspace",
      projectId: project.id,
      projectName: project.name
    });
  }
  for (const [channel, group] of Object.entries(settings.channels ?? {})) {
    for (const instance of group?.instances ?? []) {
      if (instance.enabled === false) continue;
      if (channel === "web") {
        targets.push({
          kind: "channel",
          channel,
          botId: instance.id,
          botDisplayName: String(instance.name ?? "").trim() || instance.id,
          chatId: toWebExternalUserId("web-anonymous", instance.id),
          scope: "workspace"
        });
        continue;
      }
      const chatIds = Array.from(new Set((instance.allowedChatIds ?? []).map(String).map((value) => value.trim()).filter(Boolean)));
      for (const chatId of chatIds) {
        targets.push({
          kind: "channel",
          channel,
          botId: instance.id,
          botDisplayName: String(instance.name ?? "").trim() || instance.id,
          chatId,
          scope: "workspace"
        });
      }
    }
  }
  return targets.sort((a, b) => a.channel.localeCompare(b.channel)
    || (("botDisplayName" in a ? a.botDisplayName : a.projectName) || a.botId).localeCompare(("botDisplayName" in b ? b.botDisplayName : b.projectName) || b.botId)
    || a.chatId.localeCompare(b.chatId));
}

const ACTIVE_EXECUTION_STATUSES: readonly string[] = ["running", "retry_wait"];

/**
 * The status a user should see for a task.
 *
 * The event file's own `status.state` is a scheduling lock, not a report: a
 * successful periodic run writes `pending` back, and a run whose process died
 * leaves `running` behind with nobody to clear it. Reading it directly is what
 * made finished and crashed tasks both render as a spinner forever. The lease
 * store is the record of what actually happened, so it wins whenever it has an
 * opinion; the file only supplies the answer for a task that has never run.
 */
export function resolveDesktopTaskStatus(
  fileStatus: DesktopTaskState,
  type: DesktopTaskType,
  latest: DesktopTaskExecution | undefined
): DesktopTaskState {
  if (!latest) return fileStatus === "running" ? "pending" : fileStatus;
  if (ACTIVE_EXECUTION_STATUSES.includes(latest.status)) return "running";
  if (latest.status === "completed") {
    // A periodic task that succeeded is idle until its next slot; a one-shot
    // task that succeeded is done.
    return type === "periodic" ? "completed" : fileStatus === "pending" ? "completed" : fileStatus;
  }
  if (latest.status === "failed" || latest.status === "aborted" || latest.status === "interrupted") return "error";
  if (latest.status === "skipped") return fileStatus === "running" ? "pending" : fileStatus;
  return fileStatus;
}

export function buildDesktopTaskItem(item: SharedTaskItem, loadExecutions: DesktopTaskExecutionLoader = () => ({ items: [], total: 0 })): DesktopTaskItem {
  const taskId = String(item.taskId ?? "").trim() || desktopTaskId(item.filePath);
  const executions = loadExecutions(taskId);
  // A `skipped` row records that a *dispatch* was declined, not the fate of an
  // attempt, so it must not stand in as "what happened last".
  const latest = executions.items.find((execution) => execution.status !== "skipped") ?? executions.items[0];
  const type = coerceType(item.type);
  const status = resolveDesktopTaskStatus(coerceState(item.status), type, latest);
  const systemKind = item.managed?.by === "molibot" && item.managed.scope === "owner"
    && (item.managed.kind === "memory-reflection" || item.managed.kind === "daily-materials")
    ? item.managed.kind
    : "";
  return {
    id: desktopTaskId(item.filePath),
    taskId,
    category: systemKind ? "system" : item.projectId ? "project" : "user",
    systemKind,
    channel: item.channel,
    botId: item.botId,
    projectId: item.projectId ?? "",
    projectName: item.projectName ?? "",
    chatId: item.chatId,
    scope: item.scope === "chat-scratch" ? "chat-scratch" : "workspace",
    type,
    enabled: item.enabled !== false,
    text: item.text,
    delivery: item.delivery,
    scheduleText: item.scheduleText,
    timezone: item.timezone,
    status,
    statusReason: item.statusReason,
    lastError: item.lastError,
    runCount: item.runCount,
    completedAt: item.completedAt,
    lastTriggeredAt: item.lastTriggeredAt,
    reminderUnread: item.type === "one-shot" && item.reminderUnread === true,
    sessionMode: item.sessionMode,
    updatedAt: item.updatedAt,
    createdAt: item.createdAt,
    executions: executions.items,
    executionCount: executions.total,
    lastRun: latest
      ? { status: latest.status, startedAt: latest.startedAt, finishedAt: latest.finishedAt, lastError: latest.lastError }
      : undefined,
    active: executions.items.some((execution) => ACTIVE_EXECUTION_STATUSES.includes(execution.status))
  };
}

export function resolveDesktopTaskPaths(items: SharedTaskItem[], ids: string[]): Map<string, string> {
  const requested = new Set(ids);
  const result = new Map<string, string>();
  for (const item of items.filter((entry) => entry.type === "periodic" || entry.type === "one-shot")) {
    const id = desktopTaskId(item.filePath);
    if (requested.has(id)) result.set(id, item.filePath);
  }
  if (result.size !== requested.size) throw new Error("Unknown task");
  return result;
}

export function resolveDesktopOneShotTaskPaths(items: SharedTaskItem[], ids: string[]): Map<string, string> {
  const requested = new Set(ids);
  const result = new Map<string, string>();
  for (const item of items.filter((entry) => entry.type === "one-shot")) {
    const id = desktopTaskId(item.filePath);
    if (requested.has(id)) result.set(id, item.filePath);
  }
  if (result.size !== requested.size) throw new Error("Unknown one-shot task");
  return result;
}

export function buildDesktopTaskSummary(
  items: SharedTaskItem[],
  loadExecutions: DesktopTaskExecutionLoader = () => ({ items: [], total: 0 }),
  targets: DesktopTaskTarget[] = [],
  executionTotals: { total: number; completed: number; failed: number } = { total: 0, completed: 0, failed: 0 }
): DesktopTaskSummary {
  const desktopItems = items.filter((item) => item.type === "periodic" || item.type === "one-shot").map((item) => buildDesktopTaskItem(item, loadExecutions));
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
    counts: {
      total: desktopItems.length,
      byType,
      byStatus,
      byScope,
      byChannel,
      unreadOneShot: desktopItems.filter((item) => item.type === "one-shot" && item.category === "user" && item.reminderUnread).length,
      executions: executionTotals
    }
  };
}
