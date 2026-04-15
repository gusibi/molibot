/**
 * QQ Bot Runtime - SDK 增强版
 * 使用 package/qqbot SDK 的实现
 */

import { readFileSync } from "node:fs";
import WebSocket from "ws";
import type { RuntimeSettings } from "../../settings/index.js";
import type { EventDeliveryMode, MomEvent } from "../../agent/events.js";
import { createRunId, momError, momLog, momWarn } from "../../agent/log.js";
import { buildAcpPermissionText } from "../../acp/prompt.js";
import { SharedRuntimeCommandService } from "../../agent/channelCommands.js";
import type { ChannelInboundMessage } from "../../agent/types.js";
import type { SessionStore } from "../../sessions/store.js";
import type { MemoryGateway } from "../../memory/gateway.js";
import type { AiUsageTracker } from "../../usage/tracker.js";
import type { AcpPendingPermissionView } from "../../acp/types.js";
import { BasicChannelAcpTemplate } from "../shared/acp.js";
import { BaseChannelRuntime } from "../shared/baseRuntime.js";
import { buildTextChannelContext } from "../shared/contextBuilder.js";
import {
  type ResolvedQQBotAccount,
  initApiConfig,
  clearTokenCache
} from "./sdk-adapter.js";

// SDK 直接导入
import { getAccessToken } from "#qqbot/src/api.js";
import { sendText, sendMedia, type OutboundResult } from "#qqbot/src/outbound.js";
import { startGateway } from "#qqbot/src/gateway.js";

export interface QQConfig {
  appId: string;
  clientSecret: string;
  allowedChatIds: string[];
}

interface SendTarget {
  mode: "c2c" | "group" | "channel";
  id: string;
  replyToId?: string;
}

/**
 * QQ Manager - 集成 SDK 的运行时
 */
export class QQManager extends BaseChannelRuntime {
  private readonly acpTemplate: BasicChannelAcpTemplate<SendTarget>;
  private readonly commandService: SharedRuntimeCommandService<SendTarget>;

  private currentAppId = "";
  private currentClientSecret = "";
  private currentAllowedChatIdsKey = "";

  private accessToken = "";
  private ws: WebSocket | undefined;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private lastSeq: number | null = null;
  private aborted = false;

  // SDK 账户配置
  private sdkAccount: ResolvedQQBotAccount | null = null;
  // Gateway 控制句柄
  private gatewayHandle: { stop: () => void; updateAccount: (account: ResolvedQQBotAccount) => void } | null = null;

  constructor(
    getSettings: () => RuntimeSettings,
    updateSettings: (patch: Partial<RuntimeSettings>) => RuntimeSettings,
    sessionStore: SessionStore,
    options: {
      instanceId: string;
      workspaceDir: string;
      memory: MemoryGateway;
      usageTracker: AiUsageTracker;
      sdkAccount?: ResolvedQQBotAccount;
    }
  ) {
    super({
      channel: "qq",
      defaultWorkspaceName: "moli-q",
      getSettings,
      updateSettings,
      sessionStore,
      options
    });

    this.sdkAccount = options.sdkAccount ?? null;

    // 初始化 SDK API 配置
    if (this.sdkAccount) {
      initApiConfig({
        markdownSupport: this.sdkAccount.markdownSupport ?? true
      });
    }

    // ACP 模板
    this.acpTemplate = new BasicChannelAcpTemplate<SendTarget>({
      acp: this.acp,
      sendText: async (_chatId, target, text) => {
        await this.replyCommand(target, text);
      },
      runPrompt: async (chatId, target, request) => {
        await this.runAcpPrompt(chatId, request.prompt, target, request.startText);
      }
    });

    // 命令服务
    this.commandService = new SharedRuntimeCommandService<SendTarget>({
      channel: "qq",
      instanceId: this.instanceId,
      workspaceDir: this.workspaceDir,
      authScopePrefix: "qq",
      store: this.store,
      runners: this.runners,
      getSettings,
      updateSettings,
      isRunning: (scopeId) => this.running.has(scopeId),
      stopRun: (scopeId) => this.stopChatWork(scopeId),
      cancelAcpRun: (scopeId) => this.acp.cancelRun(scopeId),
      maybeHandleAcpCommand: (scopeId, cmd, rawArg, target) =>
        this.acpTemplate.maybeHandleCommand(scopeId, cmd, rawArg, target),
      sendText: (target, text) => this.replyCommand(target, text),
      onSessionMutation: (scopeId) => {
        void this.writePromptPreview([scopeId]);
      },
      getQueueSize: (scopeId) => this.chatQueues.get(scopeId)?.size() ?? 0,
      helpLines: this.acpTemplate.helpLines()
    });
  }

  /**
   * 应用配置
   */
  apply(cfg: QQConfig): void {
    const appId = cfg.appId.trim();
    const clientSecret = cfg.clientSecret.trim();
    const allowedChatIds = cfg.allowedChatIds.map((v) => v.trim()).filter(Boolean);
    const allowedChatIdsKey = JSON.stringify([...allowedChatIds].sort());

    momLog("qq", "apply", {
      hasAppId: Boolean(appId),
      hasClientSecret: Boolean(clientSecret),
      allowedChatCount: allowedChatIds.length
    });

    if (!appId || !clientSecret) {
      this.stop();
      momWarn("qq", "disabled_no_credentials");
      return;
    }

    // 检查配置是否变化
    if (
      this.ws &&
      this.currentAppId === appId &&
      this.currentClientSecret === clientSecret &&
      this.currentAllowedChatIdsKey === allowedChatIdsKey
    ) {
      momLog("qq", "apply_noop_same_credentials");
      return;
    }

    // 停止现有连接
    this.stop();

    // 更新配置
    this.currentAppId = appId;
    this.currentClientSecret = clientSecret;
    this.currentAllowedChatIdsKey = allowedChatIdsKey;
    this.aborted = false;

    // 初始化 SDK
    if (this.sdkAccount) {
      this.sdkAccount.appId = appId;
      this.sdkAccount.clientSecret = clientSecret;
      initApiConfig({ markdownSupport: this.sdkAccount.markdownSupport ?? true });
    }

    // 连接网关
    void this.connect(new Set(allowedChatIds));
    void this.writePromptPreview(allowedChatIds);
  }

  /**
   * 停止运行时
   */
  stop(): void {
    this.aborted = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.close();
      } catch (error) {
        momWarn("qq", "adapter_stop_close_failed", {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    this.ws = undefined;
    this.lastSeq = null;
    this.accessToken = "";
    clearTokenCache();
    // 注：SDK 的 gateway 没有显式的 stop 函数，连接会在对象销毁时自动关闭
    void this.acp.dispose();
    momLog("qq", "adapter_stopped");
  }

  /**
   * 连接网关
   */
  private async connect(allowed: Set<string>): Promise<void> {
    if (!this.sdkAccount) {
      momError("qq", "connect_failed_no_account", { error: "SDK account not initialized" });
      return;
    }

    try {
      this.accessToken = await getAccessToken(this.currentAppId, this.currentClientSecret);

      // 使用 SDK 的网关
      startGateway({
        account: this.sdkAccount,
        accessToken: this.accessToken,
        onMessage: (message) => {
          void this.handleSDKMessage(message, allowed);
        },
        onError: (error) => {
          momError("qq", "gateway_error", { error: error.message });
        },
        onClose: () => {
          if (!this.aborted) {
            this.scheduleReconnect(5000, allowed);
          }
        }
      });

      momLog("qq", "gateway_started");
    } catch (error) {
      momError("qq", "connect_failed", {
        error: error instanceof Error ? error.message : String(error)
      });
      this.scheduleReconnect(5000, allowed);
    }
  }

  /**
   * 处理 SDK 消息
   */
  private async handleSDKMessage(message: unknown, allowed: Set<string>): Promise<void> {
    // TODO: 将 SDK 消息格式转换为 molipibot 的格式并处理
    console.log("[qqbot] SDK message received:", message);
  }

  /**
   * 发送文本消息
   */
  async sendText(target: SendTarget, text: string, replyToId?: string): Promise<OutboundResult> {
    if (!this.sdkAccount) {
      return { channel: "qqbot", error: "SDK account not initialized" };
    }

    // 确保有 access token
    if (!this.accessToken) {
      this.accessToken = await getAccessToken(this.currentAppId, this.currentClientSecret);
    }

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
   * 回复命令
   */
  private async replyCommand(target: SendTarget, text: string): Promise<void> {
    await this.sendText(target, text, target.replyToId);
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

  /**
   * 调度重连
   */
  private scheduleReconnect(delayMs: number, allowed: Set<string>): void {
    if (this.aborted) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect(allowed);
    }, delayMs);
  }

  /**
   * 运行 ACP Prompt
   */
  private async runAcpPrompt(
    chatId: string,
    prompt: string,
    target: SendTarget,
    startText: string
  ): Promise<void> {
    await this.replyCommand(target, startText);
    // TODO: 实现完整的 ACP 运行逻辑
  }
}

// 导出 SDK 相关类型和函数
export type { ResolvedQQBotAccount };
export { getAccessToken, initApiConfig, clearTokenCache };
