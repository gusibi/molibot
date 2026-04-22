/**
 * QQ Bot SDK 适配器 - 为 molipibot 提供兼容层
 * 使用 package/qqbot 中的 SDK 实现
 */

import type { RuntimeSettings } from "../../settings/index.js";
import type { ChannelPlugin, ChannelPluginInstance } from "../registry.js";
import { config } from "../../app/env.js";
import { resolve } from "node:path";
import type { ResolvedQQBotAccount, QQBotAccountConfig } from "#qqbot/src/types.js";
import { sendText, sendMedia, sendProactiveMessage, type OutboundResult } from "#qqbot/src/outbound.js";
import { getAccessToken, initApiConfig } from "#qqbot/src/api.js";
import { QQManager } from "./runtime.js";

export interface QQConfig {
  appId: string;
  clientSecret: string;
  allowedChatIds: string[];
  /** @deprecated 使用多账户配置 */
  accountId?: string;
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

/**
 * 使用 SDK 发送消息
 */
export async function sdkSendText(
  account: ResolvedQQBotAccount,
  to: string,
  text: string,
  replyToId?: string
): Promise<OutboundResult> {
  return sendText({
    to,
    text,
    accountId: account.accountId,
    replyToId: replyToId ?? null,
    account
  });
}

/**
 * 使用 SDK 发送主动消息
 */
export async function sdkSendProactiveMessage(
  account: ResolvedQQBotAccount,
  to: string,
  text: string
): Promise<OutboundResult> {
  return sendProactiveMessage(account, to, text);
}

/**
 * 使用 SDK 发送媒体
 */
export async function sdkSendMedia(
  account: ResolvedQQBotAccount,
  to: string,
  mediaUrl: string,
  text?: string,
  replyToId?: string
): Promise<OutboundResult> {
  return sendMedia({
    to,
    mediaUrl,
    text: text ?? "",
    accountId: account.accountId,
    replyToId: replyToId ?? null,
    account
  });
}

/**
 * 使用 SDK 获取访问令牌
 */
export async function sdkGetAccessToken(appId: string, clientSecret: string): Promise<string> {
  return getAccessToken(appId, clientSecret);
}

/**
 * 初始化 API 配置（markdown 支持等）
 */
export function sdkInitApiConfig(options: { markdownSupport?: boolean; appId?: string }): void {
  initApiConfig(options);
}

// ============ Channel Plugin 导出 ============

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
        workspaceDir: resolve(config.dataDir, "moli-q", "bots", instance.id),
        config: {
          appId: instance.credentials.appId,
          clientSecret: instance.credentials.clientSecret,
          allowedChatIds: instance.allowedChatIds
        }
      }));
  },

  createManager(instance, deps) {
    // 转换为 SDK 账户格式
    const sdkAccount = toSDKAccount(instance as ChannelPluginInstance<QQConfig>);

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
        // 使用 SDK 账户配置
        sdkAccount
      }
    );
  }
};

// ============ 类型重新导出 ============
export type { ResolvedQQBotAccount, QQBotAccountConfig } from "#qqbot/src/types.js";
export type { OutboundResult, OutboundContext, MediaOutboundContext } from "#qqbot/src/outbound.js";
export { MediaFileType } from "#qqbot/src/api.js";
export type { UploadMediaResponse } from "#qqbot/src/api.js";

// ============ 向后兼容导出 ============
export { clearTokenCache } from "#qqbot/src/api.js";
export { checkMessageReplyLimit, recordMessageReply, getMessageReplyConfig } from "#qqbot/src/outbound.js";
