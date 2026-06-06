import { resolve } from "node:path";
import { config } from "$lib/server/app/env.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";
import type { ChannelPlugin, ChannelPluginInstance } from "$lib/server/channels/registry.js";
import { TelegramManager, type TelegramConfig } from "$lib/server/channels/telegram/runtime.js";

function listInstances(settings: RuntimeSettings): ChannelPluginInstance<TelegramConfig>[] {
  return (settings.channels.telegram?.instances ?? [])
    .filter((instance) => instance.enabled && instance.credentials.token?.trim())
    .map((instance) => ({
      id: instance.id,
      workspaceDir: resolve(config.dataDir, "moli-t", "bots", instance.id),
      config: {
        token: instance.credentials.token,
        allowedChatIds: instance.allowedChatIds
      }
    }));
}

export const telegramChannelPlugin: ChannelPlugin<TelegramConfig> = {
  key: "telegram",
  name: "Telegram",
  version: "built-in",
  description: "Built-in Telegram channel plugin.",
  listInstances,
  createManager: (instance, deps) =>
    new TelegramManager(deps.getSettings, deps.updateSettings, deps.sessions, {
      instanceId: instance.id,
      workspaceDir: instance.workspaceDir,
      memory: deps.memory,
      usageTracker: deps.usageTracker,
      modelErrorTracker: deps.modelErrorTracker,
      hookManager: deps.hookManager
    })
};
