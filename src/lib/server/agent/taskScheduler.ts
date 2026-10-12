import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { config } from "$lib/server/app/env.js";
import { EventsWatcher } from "$lib/server/agent/events.js";
import { momLog, momWarn } from "$lib/server/agent/common/log.js";
import { SYSTEM_TASK_BOTS_DIR, SYSTEM_TASK_CHANNEL, SYSTEM_TASK_OWNER_ID, TASK_CHANNEL_ROOTS } from "$lib/server/agent/commands/taskChannels.js";
import type { ChannelManager } from "$lib/server/channels/registry.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";
import type { MemoryReflectionNotificationTarget } from "$lib/server/settings/schema.js";
import type { MomEvent } from "$lib/server/agent/events.js";
import type { MemoryCandidateReview, MemoryReviewBatch } from "$lib/server/memory/review.js";
import { getProjectStore } from "$lib/server/projects/store.js";
import { readSessionOriginMetadata } from "$lib/server/agent/session/metadata.js";
import { projectWorkspaceDir } from "$lib/server/projects/runtimeCache.js";

export interface InternalTaskExecutionResult {
  notificationText?: string;
  kind?: "memory-reflection" | "memory-maintenance" | "daily-materials" | "durable-execution" | "session-auto-archive" | "session-trash-expiry";
  completedTargets?: number;
  scannedConversations?: number;
  scannedMessages?: number;
  createdCandidates?: number;
  createdFiles?: string[];
  archivedCount?: number;
  dormantCount?: number;
  compactRemovedCount?: number;
  reviewDuplicateCount?: number;
}

export async function dispatchTaskEvent(
  event: MomEvent,
  filename: string,
  manager: ChannelManager,
  runInternalEvent?: (event: MomEvent, filename: string) => Promise<InternalTaskExecutionResult | void>
): Promise<InternalTaskExecutionResult | void> {
  if (event.execution === "internal") {
    if (!runInternalEvent) throw new Error("Internal event handler is not configured.");
    const result = await runInternalEvent(event, filename);
    if (result?.notificationText && event.internal?.notificationChatId) {
      if (!manager.sendInternalNotice) throw new Error("Channel manager does not support internal notices.");
      await manager.sendInternalNotice(event.internal.notificationChatId, result.notificationText, {
        kind: result.kind ?? event.internal.kind,
        filename
      });
    }
    return result;
  }
  if (typeof manager.triggerTask !== "function") throw new Error("Channel manager does not support scheduled tasks.");
  await manager.triggerTask(event, filename);
}

export async function dispatchProjectTaskEvent(
  event: MomEvent,
  filename: string,
  projectId: string,
  manager: ChannelManager
): Promise<unknown> {
  if (event.target?.kind !== "project" || event.target.projectId !== projectId) {
    throw new Error("Project task target does not match its watched Project.");
  }
  if (event.type !== "periodic" || event.delivery !== "agent" || event.sessionMode !== "fresh") {
    throw new Error("Project tasks must be periodic Agent runs with fresh Session mode.");
  }
  if (typeof manager.triggerProjectTask !== "function") {
    throw new Error("Project task runtime is not available.");
  }
  return manager.triggerProjectTask(event, filename);
}

function allowedChatIds(channel: string, botId: string, allowed: string[] = []): string[] {
  if (channel === "web") return [`web:${botId}:web-anonymous`];
  return Array.from(new Set(allowed.map(String).map((value) => value.trim()).filter(Boolean)));
}

export interface MemoryReflectionNotificationOption {
  value: string;
  label: string;
  target: MemoryReflectionNotificationTarget;
}

export function memoryReflectionNotificationTargetValue(target: MemoryReflectionNotificationTarget): string {
  return JSON.stringify(target);
}

export function listMemoryReflectionNotificationTargets(settings?: RuntimeSettings): MemoryReflectionNotificationOption[] {
  const options: MemoryReflectionNotificationOption[] = [];
  for (const channel of ["telegram", "feishu"] as const) {
    for (const instance of settings?.channels?.[channel]?.instances ?? []) {
      if (instance.enabled === false) continue;
      for (const chatId of allowedChatIds(channel, instance.id, instance.allowedChatIds)) {
        const target = { channel, botId: instance.id, chatId } satisfies MemoryReflectionNotificationTarget;
        options.push({
          value: memoryReflectionNotificationTargetValue(target),
          label: `${channel === "telegram" ? "Telegram" : "Feishu"} · ${instance.name || instance.id} · ${chatId}`,
          target
        });
      }
    }
  }
  return options;
}

export function resolveMemoryReflectionNotificationTarget(settings?: RuntimeSettings): MemoryReflectionNotificationTarget | null {
  const options = listMemoryReflectionNotificationTargets(settings);
  const saved = settings?.plugins.memory.reflectionNotificationTarget;
  if (saved) {
    const match = options.find((option) => option.value === memoryReflectionNotificationTargetValue(saved));
    if (match) return match.target;
  }
  return options[0]?.target ?? null;
}

export async function deliverMemoryTaskNotification(
  channelManagers: Map<string, Map<string, ChannelManager>>,
  settings: RuntimeSettings,
  text: string,
  metadata: { kind: "memory-reflection" | "daily-materials"; filename: string }
): Promise<boolean> {
  const target = resolveMemoryReflectionNotificationTarget(settings);
  if (!target) return false;
  const manager = channelManagers.get(target.channel)?.get(target.botId);
  if (!manager?.sendInternalNotice) {
    throw new Error(`Memory notification target is unavailable: ${target.channel}/${target.botId}`);
  }
  await manager.sendInternalNotice(target.chatId, text, metadata);
  return true;
}

export async function deliverMemoryReviewBatch(
  channelManagers: Map<string, Map<string, ChannelManager>>,
  review: MemoryCandidateReview,
  batch: MemoryReviewBatch
): Promise<{ delivered: number; alreadyDelivered: number; skipped: number }> {
  const manager = channelManagers.get(batch.target.channel)?.get(batch.target.botId);
  if (!manager?.sendMemoryReviewItem) {
    return { delivered: 0, alreadyDelivered: batch.items.filter((item) => item.messageId).length, skipped: batch.items.filter((item) => !item.messageId).length };
  }
  let delivered = 0;
  let alreadyDelivered = 0;
  let skipped = 0;
  const pending = batch.items.filter((item) => {
    if (!item.messageId) return true;
    alreadyDelivered += 1;
    return false;
  });
  for (const [index, item] of pending.entries()) {
    const sent = await manager.sendMemoryReviewItem(batch.target.chatId, item);
    if (!sent) {
      skipped += pending.length - index;
      break;
    }
    review.recordDelivery({ batchId: batch.id, candidateId: item.candidateId, messageId: sent.messageId });
    delivered += 1;
  }
  return { delivered, alreadyDelivered, skipped };
}

export function formatDailyMaterialsNotification(createdFiles: string[]): string | undefined {
  const uniqueFiles = Array.from(new Set(createdFiles.map((file) => String(file).trim()).filter(Boolean)));
  if (uniqueFiles.length === 0) return undefined;
  if (uniqueFiles.length === 1) return `今日素材已生成：${uniqueFiles[0]}`;
  return `今日素材已生成 ${uniqueFiles.length} 个文件：\n${uniqueFiles.map((file) => `- ${file}`).join("\n")}`;
}

export function collectMemoryReflectionInternals(settings?: RuntimeSettings): Array<NonNullable<MomEvent["internal"]>> {
  if (!settings?.plugins.memory.enabled || settings.plugins.memory.backend !== "mory") return [];
  const internals: Array<NonNullable<MomEvent["internal"]>> = [];
  for (const { channel } of TASK_CHANNEL_ROOTS) {
    if (channel === "web") continue;
    for (const instance of settings.channels?.[channel]?.instances ?? []) {
      if (instance.enabled === false) continue;
      const agent = settings.agents.find(agent => agent.id === instance.agentId);
      if (!agent?.enabled) continue;
      const chatIds = allowedChatIds(channel, instance.id, instance.allowedChatIds);
      if (chatIds.length === 0) continue;
      internals.push({
        kind: "memory-reflection",
        target: {
          ownerId: SYSTEM_TASK_OWNER_ID,
          botId: instance.id,
          agentId: instance.agentId,
          timezone: settings.timezone,
          sourceScopes: chatIds.map((externalUserId) => ({ channel, externalUserId }))
        }
      });
    }
  }
  for (const agent of settings.agents.filter(agent => agent.enabled)) {
    const profiles = [`agent-${agent.id}`, ...(settings.channels.web?.instances ?? []).filter(instance => instance.agentId === agent.id).map(instance => instance.id)];
    for (const profileId of new Set(profiles)) internals.push({ kind: "memory-reflection", target: {
      ownerId: SYSTEM_TASK_OWNER_ID, botId: profileId, agentId: agent.id, timezone: settings.timezone,
      sourceScopes: [{ channel: "web", externalUserId: `web:${profileId}:web-anonymous` }]
    } });
  }
  return internals;
}

function disableManagedEvent(filePath: string): null {
  if (!existsSync(filePath)) return null;
  try {
    const current = JSON.parse(readFileSync(filePath, "utf8")) as MomEvent;
    if (current.enabled !== false) writeFileSync(filePath, `${JSON.stringify({ ...current, enabled: false }, null, 2)}\n`, "utf8");
  } catch { /* leave malformed files for the watcher to report */ }
  return null;
}

function managedEventMatches(current: MomEvent, expected: MomEvent): boolean {
  const { status: _currentStatus, ...currentComparable } = current;
  const { status: _expectedStatus, ...expectedComparable } = expected;
  return isDeepStrictEqual(currentComparable, expectedComparable);
}

export function ensureOwnerMemoryReflectionEvent(eventsDir: string, settings?: RuntimeSettings): string | null {
  const filePath = join(eventsDir, "memory-reflection.json");
  if (!settings?.plugins.memory.enabled || settings.plugins.memory.backend !== "mory") return disableManagedEvent(filePath);
  const [hour, minute] = (settings.plugins.memory.reflectionTime || "03:00").split(":").map(Number);
  const event: MomEvent = {
    type: "periodic",
    enabled: true,
    taskId: "memory-reflection-owner",
    managed: { by: "molibot", scope: "owner", kind: "memory-reflection", ownerId: SYSTEM_TASK_OWNER_ID },
    chatId: "internal-memory-reflection",
    text: "Daily memory reflection",
    schedule: `${minute} ${hour} * * *`,
    timezone: settings.timezone,
    execution: "internal",
    internal: { kind: "memory-reflection" }
  };
  if (existsSync(filePath)) {
    try {
      const current = JSON.parse(readFileSync(filePath, "utf8")) as typeof event;
      if (managedEventMatches(current, event)) return filePath;
      event.status = current.status;
    } catch { /* replace malformed managed event */ }
  }
  writeFileSync(filePath, `${JSON.stringify(event, null, 2)}\n`, "utf8");
  return filePath;
}

export function ensureOwnerMemoryMaintenanceEvent(eventsDir: string, settings?: RuntimeSettings): string | null {
  const filePath = join(eventsDir, "memory-maintenance.json");
  if (!settings?.plugins.memory.enabled || settings.plugins.memory.backend !== "mory") return disableManagedEvent(filePath);
  const [reflectionHour] = (settings.plugins.memory.reflectionTime || "03:00").split(":").map(Number);
  const hour = (reflectionHour + 1) % 24;
  const event: MomEvent = {
    type: "periodic",
    enabled: true,
    taskId: "memory-maintenance-owner",
    managed: { by: "molibot", scope: "owner", kind: "memory-maintenance", ownerId: SYSTEM_TASK_OWNER_ID },
    chatId: "internal-memory-maintenance",
    text: "Daily memory maintenance",
    schedule: `0 ${hour} * * *`,
    timezone: settings.timezone,
    execution: "internal",
    internal: { kind: "memory-maintenance" }
  };
  if (existsSync(filePath)) {
    try {
      const current = JSON.parse(readFileSync(filePath, "utf8")) as MomEvent;
      if (managedEventMatches(current, event)) return filePath;
      event.status = current.status;
    } catch { /* replace malformed managed event */ }
  }
  writeFileSync(filePath, `${JSON.stringify(event, null, 2)}\n`, "utf8");
  return filePath;
}

// Build the `internal` payload for a daily-materials event for one channel/bot,
// or null when the feature is disabled/unconfigured or the bot has no chat ids.
// Shared by the periodic scheduler and the one-off history backfill so both scan
// exactly the same authorized scopes.
export function buildDailyMaterialsInternal(channel: string, botId: string, settings?: RuntimeSettings): NonNullable<MomEvent["internal"]> | null {
  const configured = settings?.plugins.memory.dailyMaterials;
  if (!configured?.enabled || !configured.projectId.trim()) return null;
  const instance = settings?.channels?.[channel]?.instances?.find((item) => item.id === botId);
  if (instance?.enabled === false) return null;
  const chatIds = allowedChatIds(channel, botId, instance?.allowedChatIds);
  if (chatIds.length === 0) return null;
  return {
    kind: "daily-materials",
    target: {
      ownerId: "owner",
      botId,
      timezone: settings!.timezone,
      sourceScopes: chatIds.map((externalUserId) => ({ channel, externalUserId }))
    },
    promptPath: configured.promptPath,
    output: { projectId: configured.projectId, dir: configured.dir },
    scanTokenBudget: configured.scanTokenBudget
  };
}

// Every daily-materials scope the scheduler would target, across all channels
// and bot instances. The history backfill runs each of these once.
export function collectDailyMaterialsBackfillInternals(settings?: RuntimeSettings): Array<NonNullable<MomEvent["internal"]>> {
  const internals: Array<NonNullable<MomEvent["internal"]>> = [];
  for (const { channel } of TASK_CHANNEL_ROOTS) {
    for (const instance of settings?.channels?.[channel]?.instances ?? []) {
      const internal = buildDailyMaterialsInternal(channel, instance.id, settings);
      if (internal) internals.push(internal);
    }
  }
  return internals;
}

export function ensureOwnerDailyMaterialsEvent(eventsDir: string, settings?: RuntimeSettings): string | null {
  const filePath = join(eventsDir, "daily-materials.json");
  const configured = settings?.plugins.memory.dailyMaterials;
  if (!configured?.enabled || !configured.projectId.trim()) return disableManagedEvent(filePath);
  const [hour, minute] = (configured.time || "23:30").split(":").map(Number);
  const event: MomEvent = {
    type: "periodic",
    enabled: true,
    taskId: "daily-materials-owner",
    managed: { by: "molibot", scope: "owner", kind: "daily-materials", ownerId: SYSTEM_TASK_OWNER_ID },
    chatId: "internal-daily-materials",
    text: "Daily materials",
    schedule: `${minute} ${hour} * * *`,
    timezone: settings!.timezone,
    execution: "internal",
    internal: { kind: "daily-materials" }
  };
  if (existsSync(filePath)) {
    try {
      const current = JSON.parse(readFileSync(filePath, "utf8")) as MomEvent;
      if (managedEventMatches(current, event)) return filePath;
      event.status = current.status;
    } catch { /* replace malformed managed event */ }
  }
  writeFileSync(filePath, `${JSON.stringify(event, null, 2)}\n`, "utf8");
  return filePath;
}

export function ensureOwnerSessionAutoArchiveEvent(eventsDir: string, settings?: RuntimeSettings): string | null {
  const filePath = join(eventsDir, "session-auto-archive.json");
  if (!settings?.sessionAutoArchive.enabled) return disableManagedEvent(filePath);
  const event: MomEvent = {
    type: "periodic",
    enabled: true,
    taskId: "session-auto-archive-owner",
    managed: { by: "molibot", scope: "owner", kind: "session-auto-archive", ownerId: SYSTEM_TASK_OWNER_ID },
    chatId: "internal-session-auto-archive",
    text: "Daily session auto-archive sweep",
    schedule: "30 4 * * *",
    timezone: settings.timezone,
    execution: "internal",
    internal: { kind: "session-auto-archive" }
  };
  if (existsSync(filePath)) {
    try {
      const current = JSON.parse(readFileSync(filePath, "utf8")) as MomEvent;
      if (managedEventMatches(current, event)) return filePath;
      event.status = current.status;
    } catch { /* replace malformed managed event */ }
  }
  writeFileSync(filePath, `${JSON.stringify(event, null, 2)}\n`, "utf8");
  return filePath;
}

/**
 * Daily expired-trash purge. Unlike auto-archive there is no opt-in switch:
 * the fixed 30-day recovery deadline shown at deletion time governs it, so
 * the watched event is always enabled. Scheduling rides the same
 * watched-event JSON + Runtime dispatcher mechanism as auto-archive; the
 * sweep itself only purges (never restores — restore always wins over a
 * stale intent) and partial failures stay as recoverable cleanup work.
 */
export function ensureOwnerSessionTrashExpiryEvent(eventsDir: string, settings?: RuntimeSettings): string | null {
  const filePath = join(eventsDir, "session-trash-expiry.json");
  const event: MomEvent = {
    type: "periodic",
    enabled: true,
    taskId: "session-trash-expiry-owner",
    managed: { by: "molibot", scope: "owner", kind: "session-trash-expiry", ownerId: SYSTEM_TASK_OWNER_ID },
    chatId: "internal-session-trash-expiry",
    text: "Daily expired-trash purge",
    schedule: "45 4 * * *",
    timezone: settings?.timezone ?? "UTC",
    execution: "internal",
    internal: { kind: "session-trash-expiry" }
  };
  if (existsSync(filePath)) {
    try {
      const current = JSON.parse(readFileSync(filePath, "utf8")) as MomEvent;
      if (managedEventMatches(current, event)) return filePath;
      event.status = current.status;
    } catch { /* replace malformed managed event */ }
  }
  writeFileSync(filePath, `${JSON.stringify(event, null, 2)}\n`, "utf8");
  return filePath;
}

export class TaskScheduler {
  private watchers: EventsWatcher[] = [];

  constructor(
    private readonly runInternalEvent?: (event: import("$lib/server/agent/events.js").MomEvent, filename: string) => Promise<InternalTaskExecutionResult | void>,
    private readonly onInternalEventSkipped?: (event: import("$lib/server/agent/events.js").MomEvent, filename: string, reason: string) => void,
    private readonly projectTasks: {
      list: () => Array<{ id: string; name: string }>;
      workspaceDir: (projectId: string) => string;
    } = { list: () => getProjectStore().list(), workspaceDir: projectWorkspaceDir }
  ) {}

  start(channelManagers: Map<string, Map<string, ChannelManager>>, settings?: RuntimeSettings): void {
    this.stop();

    const dataRoot = resolve(config.dataDir);
    const started: string[] = [];

    const ownerEventsDir = join(dataRoot, SYSTEM_TASK_BOTS_DIR, SYSTEM_TASK_OWNER_ID, "events");
    mkdirSync(ownerEventsDir, { recursive: true });
    ensureOwnerMemoryReflectionEvent(ownerEventsDir, settings);
    ensureOwnerMemoryMaintenanceEvent(ownerEventsDir, settings);
    ensureOwnerDailyMaterialsEvent(ownerEventsDir, settings);
    ensureOwnerSessionAutoArchiveEvent(ownerEventsDir, settings);
    ensureOwnerSessionTrashExpiryEvent(ownerEventsDir, settings);
    const ownerWatcher = new EventsWatcher(
      ownerEventsDir,
      async (event, filename) => {
        if (event.execution !== "internal" || !this.runInternalEvent) throw new Error("Owner task must use the internal runtime.");
        return this.runInternalEvent(event, filename);
      },
      {
        channel: SYSTEM_TASK_CHANNEL,
        leaseScope: `${SYSTEM_TASK_CHANNEL}:${SYSTEM_TASK_OWNER_ID}`,
        getExecutionSettings: () => settings?.events ?? { executionTimeoutMs: 600_000, maxAttempts: 3, retryDelayMs: 5000 },
        onSkip: ({ event, filename, reason }) => {
          if (event.execution === "internal") this.onInternalEventSkipped?.(event, filename, reason);
        }
      }
    );
    ownerWatcher.start();
    this.watchers.push(ownerWatcher);
    started.push(`${SYSTEM_TASK_CHANNEL}/${SYSTEM_TASK_OWNER_ID}`);

    const projectTaskManager = Array.from(channelManagers.get("web")?.values() ?? [])
      .find((manager) => typeof manager.triggerProjectTask === "function");
    if (projectTaskManager) {
      for (const project of this.projectTasks.list()) {
        const eventsDir = join(this.projectTasks.workspaceDir(project.id), "events");
        mkdirSync(eventsDir, { recursive: true });
        const watcher = new EventsWatcher(
          eventsDir,
          (event, filename) => dispatchProjectTaskEvent(event, filename, project.id, projectTaskManager),
          {
            channel: "project",
            leaseScope: `project:${project.id}`,
            getExecutionSettings: () => settings?.events ?? {
              executionTimeoutMs: 600_000,
              maxAttempts: 3,
              retryDelayMs: 5000
            },
            onTimeout: ({ event, runId }) => {
              momWarn("taskScheduler", "project_event_timeout_abort_requested", {
                projectId: project.id,
                taskId: event.taskId,
                runId
              });
              projectTaskManager.abortProjectTaskRun?.(runId, "Scheduled Project event attempt timed out.");
            }
          }
        );
        watcher.start();
        this.watchers.push(watcher);
        started.push(`project/${project.id}`);
      }
    } else {
      momWarn("taskScheduler", "project_task_manager_missing", {});
    }

    for (const agent of settings?.agents ?? []) {
      const eventsDir = join(dataRoot, "sessions", agent.id, "events");
      mkdirSync(eventsDir, { recursive: true });
      const managerFor = (event: MomEvent) => event.deliveryTarget
        ? channelManagers.get(event.deliveryTarget.channel)?.get(event.deliveryTarget.instanceId) : undefined;
      const watcher = new EventsWatcher(eventsDir, async (event, filename) => {
        const manager = managerFor(event);
        if (!manager) throw new Error("Event delivery target is unavailable");
        if (event.agentId !== agent.id || !event.deliveryTarget) throw new Error("Event Agent or delivery target is invalid");
        return dispatchTaskEvent({ ...event, chatId: event.deliveryTarget.chatId }, filename, manager, this.runInternalEvent);
      }, {
        channel: "agent",
        leaseScope: `agent:${agent.id}`,
        skipReason: event => {
          if (event.agentId !== agent.id) return "agent_mismatch";
          if (!agent.enabled) return "agent_disabled";
          return managerFor(event) ? undefined : "delivery_target_missing";
        },
        getExecutionSettings: () => settings?.events ?? { executionTimeoutMs: 600_000, maxAttempts: 3, retryDelayMs: 5000 },
        onTimeout: ({ event }) => { managerFor(event)?.abortTaskRun?.(event.deliveryTarget!.chatId, "Scheduled event attempt timed out."); }
      });
      watcher.start();
      this.watchers.push(watcher);
      started.push(`agent/${agent.id}`);
    }

    momLog("taskScheduler", "started", { count: this.watchers.length, watchers: started.join(",") });
  }

  stop(): void {
    momLog("taskScheduler", "stopping", { count: this.watchers.length });
    for (const watcher of this.watchers) {
      watcher.stop();
    }
    this.watchers = [];
  }

  restart(channelManagers: Map<string, Map<string, ChannelManager>>, settings?: RuntimeSettings): void {
    momLog("taskScheduler", "restart", {});
    this.stop();
    this.start(channelManagers, settings);
  }
}
