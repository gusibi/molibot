import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
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

export interface InternalTaskExecutionResult {
  notificationText?: string;
  kind?: "memory-reflection" | "memory-maintenance" | "daily-materials";
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
    if (result?.notificationText && event.internal?.notificationChatId && manager.triggerTask) {
      await manager.triggerTask({ type: "immediate", chatId: event.internal.notificationChatId, text: result.notificationText, delivery: "text" }, `${filename}:notification`);
    }
    return result;
  }
  if (typeof manager.triggerTask !== "function") throw new Error("Channel manager does not support scheduled tasks.");
  await manager.triggerTask(event, filename);
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

export function collectMemoryReflectionInternals(settings?: RuntimeSettings): Array<NonNullable<MomEvent["internal"]>> {
  if (!settings?.plugins.memory.enabled || settings.plugins.memory.backend !== "mory") return [];
  const internals: Array<NonNullable<MomEvent["internal"]>> = [];
  for (const { channel } of TASK_CHANNEL_ROOTS) {
    for (const instance of settings.channels?.[channel]?.instances ?? []) {
      if (instance.enabled === false) continue;
      const chatIds = allowedChatIds(channel, instance.id, instance.allowedChatIds);
      if (chatIds.length === 0) continue;
      internals.push({
        kind: "memory-reflection",
        notificationChatId: settings.plugins.memory.reflectionNotifications ? chatIds[0] : undefined,
        target: {
          ownerId: SYSTEM_TASK_OWNER_ID,
          botId: instance.id,
          timezone: settings.timezone,
          sourceScopes: chatIds.map((externalUserId) => ({ channel, externalUserId }))
        }
      });
    }
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
    notificationChatId: configured.notifications ? chatIds[0] : undefined,
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

export function migrateLegacyManagedMemoryEvents(botsRoot: string): string[] {
  if (!existsSync(botsRoot)) return [];
  const removed: string[] = [];
  for (const botEntry of readdirSync(botsRoot, { withFileTypes: true })) {
    if (!botEntry.isDirectory()) continue;
    const eventsDir = join(botsRoot, botEntry.name, "events");
    for (const [filename, kind] of [["memory-reflection.json", "memory-reflection"], ["memory-maintenance.json", "memory-maintenance"], ["daily-materials.json", "daily-materials"]] as const) {
      const filePath = join(eventsDir, filename);
      if (!existsSync(filePath)) continue;
      try {
        const event = JSON.parse(readFileSync(filePath, "utf8")) as MomEvent;
        if (event.internal?.kind !== kind) continue;
        unlinkSync(filePath);
        removed.push(filePath);
      } catch { /* keep malformed or user-repurposed files */ }
    }
  }
  return removed;
}

/**
 * Desktop automations are watched by this shared scheduler at
 * `<bot>/events`. Early Desktop builds incorrectly stored Web automations in
 * a chat scratch directory, which the Web runtime never watches. Move those
 * files once at scheduler start while keeping their chatId payload intact.
 */
export function migrateLegacyWebTaskEvents(botsRoot: string): string[] {
  if (!existsSync(botsRoot)) return [];

  const migrated: string[] = [];
  for (const botEntry of readdirSync(botsRoot, { withFileTypes: true })) {
    if (!botEntry.isDirectory()) continue;
    const botDir = join(botsRoot, botEntry.name);
    const eventsDir = join(botDir, "events");

    for (const chatEntry of readdirSync(botDir, { withFileTypes: true })) {
      if (!chatEntry.isDirectory() || chatEntry.name === "events") continue;
      const legacyEventsDir = join(botDir, chatEntry.name, "scratch", "events");
      if (!existsSync(legacyEventsDir)) continue;

      for (const entry of readdirSync(legacyEventsDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        mkdirSync(eventsDir, { recursive: true });
        let destination = join(eventsDir, entry.name);
        if (existsSync(destination)) {
          const suffix = `-migrated-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          destination = join(eventsDir, `${entry.name.slice(0, -5)}${suffix}.json`);
        }
        renameSync(join(legacyEventsDir, entry.name), destination);
        migrated.push(destination);
      }
    }
  }
  return migrated;
}

export class TaskScheduler {
  private watchers: EventsWatcher[] = [];

  constructor(private readonly runInternalEvent?: (event: import("$lib/server/agent/events.js").MomEvent, filename: string) => Promise<InternalTaskExecutionResult | void>) {}

  start(channelManagers: Map<string, Map<string, ChannelManager>>, settings?: RuntimeSettings): void {
    this.stop();

    const dataRoot = resolve(config.dataDir);
    const started: string[] = [];

    const ownerEventsDir = join(dataRoot, SYSTEM_TASK_BOTS_DIR, SYSTEM_TASK_OWNER_ID, "events");
    mkdirSync(ownerEventsDir, { recursive: true });
    ensureOwnerMemoryReflectionEvent(ownerEventsDir, settings);
    ensureOwnerMemoryMaintenanceEvent(ownerEventsDir, settings);
    ensureOwnerDailyMaterialsEvent(ownerEventsDir, settings);
    const ownerWatcher = new EventsWatcher(
      ownerEventsDir,
      async (event, filename) => {
        if (event.execution !== "internal" || !this.runInternalEvent) throw new Error("Owner task must use the internal runtime.");
        return this.runInternalEvent(event, filename);
      },
      {
        channel: SYSTEM_TASK_CHANNEL,
        leaseScope: `${SYSTEM_TASK_CHANNEL}:${SYSTEM_TASK_OWNER_ID}`,
        getExecutionSettings: () => settings?.events ?? { executionTimeoutMs: 600_000, maxAttempts: 3, retryDelayMs: 5000 }
      }
    );
    ownerWatcher.start();
    this.watchers.push(ownerWatcher);
    started.push(`${SYSTEM_TASK_CHANNEL}/${SYSTEM_TASK_OWNER_ID}`);

    for (const { channel, dir } of TASK_CHANNEL_ROOTS) {
      const botsRoot = channel === "web"
        ? join(resolve(config.webWorkspaceDir), "bots")
        : join(dataRoot, dir, "bots");
      if (channel === "web") {
        const migrated = migrateLegacyWebTaskEvents(botsRoot);
        if (migrated.length > 0) {
          momLog("taskScheduler", "legacy_web_events_migrated", { count: migrated.length, botsRoot });
        }
      }
      if (!existsSync(botsRoot)) {
        momLog("taskScheduler", "bots_root_missing", { channel, botsRoot });
        continue;
      }
      const removedManaged = migrateLegacyManagedMemoryEvents(botsRoot);
      if (removedManaged.length > 0) momLog("taskScheduler", "legacy_managed_events_removed", { channel, count: removedManaged.length });
      const managers = channelManagers.get(channel);
      if (!managers) {
        momLog("taskScheduler", "channel_skipped_no_managers", { channel });
        continue;
      }

      const botEntries = readdirSync(botsRoot, { withFileTypes: true }).filter((e) => e.isDirectory());
      for (const botEntry of botEntries) {
        const botId = botEntry.name;
        const manager = managers.get(botId);
        if (!manager) {
          momLog("taskScheduler", "manager_not_found", { channel, botId });
          continue;
        }
        if (typeof manager.triggerTask !== "function") {
          momLog("taskScheduler", "trigger_task_not_supported", { channel, botId });
          continue;
        }

        const eventsDir = join(botsRoot, botId, "events");
        if (!existsSync(eventsDir)) {
          mkdirSync(eventsDir, { recursive: true });
          momLog("taskScheduler", "events_dir_created", { channel, botId, eventsDir });
        }
        const watcher = new EventsWatcher(
          eventsDir,
          (event, filename) => {
            momLog("taskScheduler", "event_dispatched", {
              channel,
              botId,
              filename,
              eventType: event.type,
              chatId: event.chatId,
              delivery: event.delivery
            });
            return dispatchTaskEvent(event, filename, manager, this.runInternalEvent);
          },
          {
            channel,
            leaseScope: `${channel}:${botId}`,
            getExecutionSettings: () => settings?.events ?? {
              executionTimeoutMs: 600_000,
              maxAttempts: 3,
              retryDelayMs: 5000
            },
            onTimeout: ({ event, runId }) => {
              momWarn("taskScheduler", "event_timeout_abort_requested", {
                channel,
                botId,
                runId,
                chatId: event.chatId
              });
              manager.abortTaskRun?.(event.chatId, "Scheduled event attempt timed out.");
            }
          }
        );
        watcher.start();
        this.watchers.push(watcher);
        started.push(`${channel}/${botId}`);
      }
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
