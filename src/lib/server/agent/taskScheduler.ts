import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { config } from "$lib/server/app/env.js";
import { EventsWatcher } from "$lib/server/agent/events.js";
import { momLog, momWarn } from "$lib/server/agent/common/log.js";
import { TASK_CHANNEL_ROOTS } from "$lib/server/agent/commands/taskChannels.js";
import type { ChannelManager } from "$lib/server/channels/registry.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";
import type { MomEvent } from "$lib/server/agent/events.js";

export async function dispatchTaskEvent(
  event: MomEvent,
  filename: string,
  manager: ChannelManager,
  runInternalEvent?: (event: MomEvent, filename: string) => Promise<{ notificationText?: string } | void>
): Promise<void> {
  if (event.execution === "internal") {
    if (!runInternalEvent) throw new Error("Internal event handler is not configured.");
    const result = await runInternalEvent(event, filename);
    if (result?.notificationText && event.internal?.notificationChatId && manager.triggerTask) {
      await manager.triggerTask({ type: "immediate", chatId: event.internal.notificationChatId, text: result.notificationText, delivery: "text" }, `${filename}:notification`);
    }
    return;
  }
  if (typeof manager.triggerTask !== "function") throw new Error("Channel manager does not support scheduled tasks.");
  await manager.triggerTask(event, filename);
}

export function ensureMemoryReflectionEvent(eventsDir: string, channel: string, botId: string, settings?: RuntimeSettings): string | null {
  if (!settings?.plugins.memory.enabled || settings.plugins.memory.backend !== "mory") return null;
  const instance = settings.channels?.[channel]?.instances?.find((item) => item.id === botId);
  const chatIds = channel === "web"
    ? [`web:${botId}:web-anonymous`]
    : (instance?.allowedChatIds ?? []);
  if (chatIds.length === 0) return null;
  const filePath = join(eventsDir, "memory-reflection.json");
  const [hour, minute] = (settings.plugins.memory.reflectionTime || "03:00").split(":").map(Number);
  const event: MomEvent = {
    type: "periodic",
    enabled: true,
    taskId: `memory-reflection-${botId}`,
    chatId: "internal-memory-reflection",
    text: "",
    schedule: `${minute} ${hour} * * *`,
    timezone: settings.timezone,
    execution: "internal",
    internal: {
      kind: "memory-reflection",
      notificationChatId: settings.plugins.memory.reflectionNotifications ? chatIds[0] : undefined,
      target: {
        ownerId: "owner",
        botId,
        timezone: settings.timezone,
        sourceScopes: chatIds.map((externalUserId) => ({ channel, externalUserId }))
      }
    }
  };
  if (existsSync(filePath)) {
    try {
      const current = JSON.parse(readFileSync(filePath, "utf8")) as typeof event;
      if (current.taskId === event.taskId && current.schedule === event.schedule && current.internal?.notificationChatId === event.internal.notificationChatId) return filePath;
      event.status = current.status;
    } catch { /* replace malformed managed event */ }
  }
  writeFileSync(filePath, `${JSON.stringify(event, null, 2)}\n`, "utf8");
  return filePath;
}

export function ensureDailyMaterialsEvent(eventsDir: string, channel: string, botId: string, settings?: RuntimeSettings): string | null {
  const filePath = join(eventsDir, "daily-materials.json");
  const configured = settings?.plugins.memory.dailyMaterials;
  if (!configured?.enabled || !configured.projectId.trim()) {
    if (!existsSync(filePath)) return null;
    try {
      const current = JSON.parse(readFileSync(filePath, "utf8")) as MomEvent;
      if (current.enabled !== false) writeFileSync(filePath, `${JSON.stringify({ ...current, enabled: false }, null, 2)}\n`, "utf8");
    } catch { /* leave malformed files for the watcher to report */ }
    return null;
  }
  const instance = settings?.channels?.[channel]?.instances?.find((item) => item.id === botId);
  const chatIds = channel === "web" ? [`web:${botId}:web-anonymous`] : (instance?.allowedChatIds ?? []);
  if (chatIds.length === 0) return null;
  const [hour, minute] = (configured.time || "23:30").split(":").map(Number);
  const event: MomEvent = {
    type: "periodic",
    enabled: true,
    taskId: `daily-materials-${botId}`,
    chatId: "internal-daily-materials",
    text: "",
    schedule: `${minute} ${hour} * * *`,
    timezone: settings.timezone,
    execution: "internal",
    internal: {
      kind: "daily-materials",
      notificationChatId: configured.notifications ? chatIds[0] : undefined,
      target: {
        ownerId: "owner",
        botId,
        timezone: settings.timezone,
        sourceScopes: chatIds.map((externalUserId) => ({ channel, externalUserId }))
      },
      promptPath: configured.promptPath,
      output: { projectId: configured.projectId, dir: configured.dir }
    }
  };
  if (existsSync(filePath)) {
    try {
      const current = JSON.parse(readFileSync(filePath, "utf8")) as MomEvent;
      const currentComparable = { ...current, status: undefined };
      const nextComparable = { ...event, status: undefined };
      if (JSON.stringify(currentComparable) === JSON.stringify(nextComparable)) return filePath;
      event.status = current.status;
    } catch { /* replace malformed managed event */ }
  }
  writeFileSync(filePath, `${JSON.stringify(event, null, 2)}\n`, "utf8");
  return filePath;
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

  constructor(private readonly runInternalEvent?: (event: import("$lib/server/agent/events.js").MomEvent, filename: string) => Promise<{ notificationText?: string } | void>) {}

  start(channelManagers: Map<string, Map<string, ChannelManager>>, settings?: RuntimeSettings): void {
    this.stop();

    const dataRoot = resolve(config.dataDir);
    const started: string[] = [];

    for (const { channel, dir } of TASK_CHANNEL_ROOTS) {
      const managers = channelManagers.get(channel);
      if (!managers) {
        momLog("taskScheduler", "channel_skipped_no_managers", { channel });
        continue;
      }

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
        ensureMemoryReflectionEvent(eventsDir, channel, botId, settings);
        ensureDailyMaterialsEvent(eventsDir, channel, botId, settings);

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
