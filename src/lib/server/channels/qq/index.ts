/**
 * QQ 渠道插件 — 把 molipibot 的渠道配置转换为 package/qqbot 适配层的账户结构。
 */

import type { RuntimeSettings } from "$lib/server/settings/index.js";
import type { ChannelPlugin, ChannelPluginInstance } from "$lib/server/channels/registry.js";
import { config } from "$lib/server/app/env.js";
import { resolve } from "node:path";
import type { ResolvedQQBotAccount } from "#qqbot/src/types.js";
import { QQManager } from "$lib/server/channels/qq/runtime.js";

export interface QQConfig {
  appId: string;
  clientSecret: string;
  allowedChatIds: string[];
}

/**
 * 转换 molipibot 配置到 SDK 账户配置
 */
function toSDKAccount(instance: ChannelPluginInstance<QQConfig>): ResolvedQQBotAccount {
  const { id, config: cfg } = instance;
  return {
    accountId: id,
    name: id,
    enabled: true,
    appId: cfg.appId,
    clientSecret: cfg.clientSecret,
    secretSource: "config" as const,
    markdownSupport: true,
    config: {
      enabled: true,
      appId: cfg.appId,
      clientSecret: cfg.clientSecret,
      allowFrom: cfg.allowedChatIds
    }
  };
}

export const qqChannelPlugin: ChannelPlugin<QQConfig> = {
  key: "qq",
  name: "QQ Bot",
  version: "built-in",
  description: "QQ Bot channel using SDK",

  listInstances(settings: RuntimeSettings): ChannelPluginInstance<QQConfig>[] {
    return (settings.channels.qq?.instances ?? [])
      .filter((instance) =>
        instance.enabled &&
        instance.credentials.appId?.trim() &&
        instance.credentials.clientSecret?.trim()
      )
      .map((instance) => ({
        id: instance.id,
        workspaceDir: resolve(config.dataDir, "channels", "qq", "bots", instance.id),
        config: {
          appId: instance.credentials.appId,
          clientSecret: instance.credentials.clientSecret,
          allowedChatIds: instance.allowedChatIds
        }
      }));
  },

  createManager(instance, deps) {
    return new QQManager(
      deps.getSettings,
      deps.updateSettings,
      deps.sessions,
      {
        instanceId: instance.id,
        workspaceDir: instance.workspaceDir,
        memory: deps.memory,
        usageTracker: deps.usageTracker,
        modelErrorTracker: deps.modelErrorTracker,
        hookManager: deps.hookManager,
        sdkAccount: toSDKAccount(instance as ChannelPluginInstance<QQConfig>)
      }
    );
  }
};
