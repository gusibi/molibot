import { resolve } from "node:path";
import { config } from "../../app/env.js";
import type { RuntimeSettings } from "../../settings/index.js";
import type { ChannelPlugin, ChannelPluginInstance } from "../registry.js";
import { WeixinManager, type WeixinConfig } from "./runtime.js";

function listInstances(settings: RuntimeSettings): ChannelPluginInstance<WeixinConfig>[] {
  return (settings.channels.weixin?.instances ?? [])
    .filter((instance) => instance.enabled)
    .map((instance) => ({
      id: instance.id,
      workspaceDir: resolve(config.dataDir, "moli-wx", "bots", instance.id),
      config: {
        baseUrl: instance.credentials.baseUrl,
        allowedChatIds: instance.allowedChatIds
      }
    }));
}

export const weixinChannelPlugin: ChannelPlugin<WeixinConfig> = {
  key: "weixin",
  name: "WeChat Bot",
  version: "built-in",
  description: "Built-in WeChat channel plugin powered by the local Weixin agent SDK bridge.",
  listInstances,
  createManager: (instance, deps) =>
    new WeixinManager(deps.getSettings, deps.updateSettings, deps.sessions, {
      instanceId: instance.id,
      workspaceDir: instance.workspaceDir,
      memory: deps.memory,
      usageTracker: deps.usageTracker,
      modelErrorTracker: deps.modelErrorTracker
    })
};
