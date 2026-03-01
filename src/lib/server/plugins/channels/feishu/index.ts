import { resolve } from "node:path";
import type { RuntimeSettings } from "../../../config.js";
import { config } from "../../../config.js";
import type { ChannelPlugin, ChannelPluginInstance } from "../../../channels/registry.js";
import { FeishuManager, type FeishuConfig } from "./runtime.js";

function listInstances(settings: RuntimeSettings): ChannelPluginInstance<FeishuConfig>[] {
  return (settings.channels.feishu?.instances ?? [])
    .filter((instance) => instance.enabled && instance.credentials.appId?.trim() && instance.credentials.appSecret?.trim())
    .map((instance) => ({
      id: instance.id,
      workspaceDir: resolve(config.dataDir, "moli-f", "bots", instance.id),
      config: {
        appId: instance.credentials.appId,
        appSecret: instance.credentials.appSecret,
        allowedChatIds: instance.allowedChatIds
      }
    }));
}

export const feishuChannelPlugin: ChannelPlugin<FeishuConfig> = {
  key: "feishu",
  name: "Feishu",
  version: "built-in",
  description: "Built-in Feishu channel plugin.",
  listInstances,
  createManager: (instance, deps) =>
    new FeishuManager(deps.getSettings, deps.updateSettings, deps.sessions, {
      instanceId: instance.id,
      workspaceDir: instance.workspaceDir,
      memory: deps.memory
    })
};
