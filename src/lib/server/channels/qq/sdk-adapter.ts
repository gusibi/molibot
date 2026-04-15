/**
 * QQ Bot Runtime - 使用 SDK 的增强版
 * 基于 package/qqbot SDK 实现
 */

import type { RuntimeSettings } from "../../settings/index.js";
import type { SessionStore } from "../../sessions/store.js";
import type { MemoryGateway } from "../../memory/gateway.js";
import type { AiUsageTracker } from "../../usage/tracker.js";
import { BaseChannelRuntime } from "../shared/baseRuntime.js";
import type { QQConfig } from "./index.js";

// SDK 导入
import {
  type ResolvedQQBotAccount,
  applyQQBotAccountConfig,
  resolveQQBotAccount,
  resolveDefaultQQBotAccountId
} from "#qqbot/src/config.js";
import {
  sendText,
  sendMedia,
  sendProactiveMessage,
  type OutboundResult
} from "#qqbot/src/outbound.js";
import { getAccessToken, initApiConfig, clearTokenCache } from "#qqbot/src/api.js";
import { startGateway } from "#qqbot/src/gateway.js";

// 类型定义
interface QQManagerOptions {
  instanceId: string;
  workspaceDir: string;
  memory: MemoryGateway;
  usageTracker: AiUsageTracker;
  sdkAccount: ResolvedQQBotAccount;
}

interface SendTarget {
  mode: "c2c" | "group" | "channel";
  id: string;
  replyToId?: string;
}

/**
 * QQ Manager - 集成 SDK 的运行时管理器
 */
export class QQManager extends BaseChannelRuntime {
  private readonly sdkAccount: ResolvedQQBotAccount;
  private gatewayRunning = false;

  constructor(
    getSettings: () => RuntimeSettings,
    updateSettings: (patch: Partial<RuntimeSettings>) => RuntimeSettings,
    sessionStore: SessionStore,
    options: QQManagerOptions
  ) {
    super({
      channel: "qq",
      defaultWorkspaceName: "moli-q",
      getSettings,
      updateSettings,
      sessionStore,
      options
    });

    this.sdkAccount = options.sdkAccount;

    // 初始化 SDK API 配置
    initApiConfig({
      markdownSupport: this.sdkAccount.markdownSupport ?? true
    });
  }

  /**
   * 应用配置 - 由 molipibot 框架调用
   */
  apply(cfg: QQConfig): void {
    const appId = cfg.appId.trim();
    const clientSecret = cfg.clientSecret.trim();

    if (!appId || !clientSecret) {
      this.stop();
      return;
    }

    // 更新 SDK 账户配置
    this.sdkAccount.appId = appId;
    this.sdkAccount.clientSecret = clientSecret;

    // 启动网关
    void this.startGateway();
  }

  /**
   * 停止运行时
   */
  stop(): void {
    if (this.gatewayRunning) {
      // SDK gateway 没有显式 stop 函数，连接会在对象销毁时自动关闭
      this.gatewayRunning = false;
    }
    clearTokenCache();
  }

  /**
   * 发送文本消息 - 供外部调用
   */
  async sendText(target: SendTarget, text: string, replyToId?: string): Promise<OutboundResult> {
    const to = this.buildTargetAddress(target);

    return sendText({
      to,
      text,
      accountId: this.sdkAccount.accountId,
      replyToId: replyToId ?? null,
      account: this.sdkAccount
    });
  }

  /**
   * 发送媒体消息
   */
  async sendMedia(target: SendTarget, mediaUrl: string, text?: string, replyToId?: string): Promise<OutboundResult> {
    const to = this.buildTargetAddress(target);

    return sendMedia({
      to,
      mediaUrl,
      text: text ?? "",
      accountId: this.sdkAccount.accountId,
      replyToId: replyToId ?? null,
      account: this.sdkAccount
    });
  }

  /**
   * 发送主动消息
   */
  async sendProactiveMessage(to: string, text: string): Promise<OutboundResult> {
    return sendProactiveMessage(this.sdkAccount, to, text);
  }

  /**
   * 获取访问令牌
   */
  async getAccessToken(): Promise<string> {
    return getAccessToken(this.sdkAccount.appId, this.sdkAccount.clientSecret);
  }

  /**
   * 启动网关连接
   */
  private async startGateway(): Promise<void> {
    if (this.gatewayRunning) {
      return;
    }

    try {
      const accessToken = await this.getAccessToken();

      startGateway({
        account: this.sdkAccount,
        accessToken,
        onMessage: (message) => {
          // 处理入站消息
          void this.handleIncomingMessage(message);
        },
        onError: (error) => {
          console.error(`[qqbot] Gateway error:`, error);
        },
        onClose: () => {
          this.gatewayRunning = false;
        }
      });

      this.gatewayRunning = true;
    } catch (error) {
      console.error(`[qqbot] Failed to start gateway:`, error);
      this.gatewayRunning = false;
    }
  }

  /**
   * 处理入站消息
   */
  private async handleIncomingMessage(message: unknown): Promise<void> {
    // 这里需要将 SDK 的消息格式转换为 molipibot 的格式
    // 并调用父类的方法处理
    console.log(`[qqbot] Received message:`, message);
  }

  /**
   * 构建目标地址
   */
  private buildTargetAddress(target: SendTarget): string {
    if (target.mode === "c2c") {
      return target.id;
    }
    return `${target.mode}:${target.id}`;
  }
}

// ============ 便捷导出 ============

export type { ResolvedQQBotAccount, QQConfig as SDKQQBotAccountConfig };
export type { OutboundResult, OutboundContext, MediaOutboundContext } from "#qqbot/src/outbound.js";
export { MediaFileType, initApiConfig, clearTokenCache } from "#qqbot/src/api.js";
export type { UploadMediaResponse } from "#qqbot/src/api.js";
export {
  sendText as sdkSendText,
  sendMedia as sdkSendMedia,
  sendProactiveMessage as sdkSendProactiveMessage
} from "#qqbot/src/outbound.js";

// 配置管理导出
export {
  applyQQBotAccountConfig,
  resolveQQBotAccount,
  listQQBotAccountIds,
  resolveDefaultQQBotAccountId,
  DEFAULT_ACCOUNT_ID
} from "#qqbot/src/config.js";
