/**
 * QQ Bot 实例注册表与 API 兼容入口。
 *
 * 协议层（token 管理、REST 调用、WS 网关）全部由
 * @tencent-connect/qqbot-nodejs 提供；本模块维护 appId → QQBot 实例的映射，
 * 让出站调用（sendText / sendMedia）可以复用网关已建立的连接与 token 缓存，
 * 也允许在网关未启动时按需创建仅发送用的实例。
 */
import {
  QQBot,
  MediaFileType,
  type UploadMediaResponse,
  type QQBotOptions,
} from "@tencent-connect/qqbot-nodejs";
import type { ResolvedQQBotAccount } from "./types.js";
import { ADAPTER_VERSION } from "./types.js";

export { MediaFileType };
export type { UploadMediaResponse };

/** initApiConfig 记录的全局默认配置（账户字段优先） */
let apiConfig: { markdownSupport?: boolean } = {};

/** appId → QQBot 实例 */
const bots = new Map<string, QQBot>();

export function initApiConfig(options: { markdownSupport?: boolean; appId?: string }): void {
  apiConfig = options;
}

/** 已注册的 bot 实例（网关启动后注册，发送侧复用其 token 管理） */
export function getRegisteredBot(appId: string): QQBot | undefined {
  return bots.get(appId);
}

export function registerBot(appId: string, bot: QQBot): void {
  bots.set(appId, bot);
}

export function unregisterBot(appId: string): void {
  const bot = bots.get(appId);
  bots.delete(appId);
  if (bot) {
    try {
      bot.stop();
    } catch {
      // stop 只做资源释放，失败可忽略
    }
  }
}

/**
 * 获取或创建指定账户的 bot 实例。
 * 网关未启动时也会创建仅发送用的实例（等价旧版无状态 REST 发送）。
 */
export function getOrCreateBot(account: ResolvedQQBotAccount): QQBot {
  const existing = bots.get(account.appId);
  if (existing) return existing;

  const options: QQBotOptions = {
    appId: account.appId,
    appSecret: account.clientSecret,
    accountId: account.accountId,
    markdownSupport: account.markdownSupport ?? apiConfig.markdownSupport ?? false,
    userAgent: `MolibotQQBot/${ADAPTER_VERSION}`,
  };
  const bot = new QQBot(options);
  bots.set(account.appId, bot);
  return bot;
}

/**
 * 清除 token 缓存：丢弃已注册实例，下次调用会重建并重新取 token。
 * 网关持有的实例由 gateway 的 abort 流程负责停止，这里只兜底清理发送用实例。
 */
export function clearTokenCache(appId?: string): void {
  if (appId) {
    unregisterBot(appId);
    return;
  }
  for (const key of [...bots.keys()]) {
    unregisterBot(key);
  }
}

/** 获取访问令牌（兼容旧入口；token 生命周期由 SDK 管理） */
export async function getAccessToken(appId: string, clientSecret: string): Promise<string> {
  const existing = bots.get(appId);
  const bot =
    existing ??
    new QQBot({
      appId,
      appSecret: clientSecret,
      userAgent: `MolibotQQBot/${ADAPTER_VERSION}`,
    });
  return bot.api.getToken();
}
