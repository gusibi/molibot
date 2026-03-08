import { resolve } from "node:path";
import { config } from "../../app/env.js";
import type { RuntimeSettings } from "../../settings/index.js";
import type { ChannelPlugin, ChannelPluginInstance } from "../registry.js";
import { QQManager, type QQConfig } from "./runtime.js";

function listInstances(settings: RuntimeSettings): ChannelPluginInstance<QQConfig>[] {
  return (settings.channels.qq?.instances ?? [])
    .filter((instance) => instance.enabled && instance.credentials.appId?.trim() && instance.credentials.clientSecret?.trim())
    .map((instance) => ({
      id: instance.id,
      workspaceDir: resolve(config.dataDir, "moli-q", "bots", instance.id),
      config: {
        appId: instance.credentials.appId,
        clientSecret: instance.credentials.clientSecret,
        allowedChatIds: instance.allowedChatIds
      }
    }));
}

export const qqChannelPlugin: ChannelPlugin<QQConfig> = {
  key: "qq",
  name: "QQ Bot",
  version: "built-in",
  description: "Built-in QQ channel plugin.",
  listInstances,
  createManager: (instance, deps) =>
    new QQManager(deps.getSettings, deps.updateSettings, deps.sessions, {
      instanceId: instance.id,
      workspaceDir: instance.workspaceDir,
      memory: deps.memory,
      usageTracker: deps.usageTracker
    })
};
