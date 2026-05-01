import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { config } from "../app/env.js";
import { EventsWatcher } from "./events.js";
import { momLog, momWarn } from "./log.js";
import { TASK_CHANNEL_ROOTS } from "./taskChannels.js";
import type { ChannelManager } from "../channels/registry.js";

export class TaskScheduler {
  private watchers: EventsWatcher[] = [];

  start(channelManagers: Map<string, Map<string, ChannelManager>>): void {
    this.stop();

    const dataRoot = resolve(config.dataDir);
    const started: string[] = [];

    for (const { channel, dir } of TASK_CHANNEL_ROOTS) {
      const managers = channelManagers.get(channel);
      if (!managers) {
        momLog("taskScheduler", "channel_skipped_no_managers", { channel });
        continue;
      }

      const botsRoot = join(dataRoot, dir, "bots");
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
          momLog("taskScheduler", "events_dir_missing", { channel, botId, eventsDir });
          continue;
        }

        const watcher = new EventsWatcher(eventsDir, (event, filename) => {
          momLog("taskScheduler", "event_dispatched", {
            channel,
            botId,
            filename,
            eventType: event.type,
            chatId: event.chatId,
            delivery: event.delivery
          });
          return manager.triggerTask!(event, filename);
        });
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

  restart(channelManagers: Map<string, Map<string, ChannelManager>>): void {
    momLog("taskScheduler", "restart", {});
    this.stop();
    this.start(channelManagers);
  }
}
