/**
 * QQ Bot 网关适配层。
 *
 * 基于 @tencent-connect/qqbot-nodejs 的 QQBot 实例：
 * WS 连接、心跳、RESUME、token 刷新、重连退避全部由 SDK 负责。
 * 本模块只做两件事：
 *   1. 把 SDK 的 InboundMessage 映射为 molipibot 约定的 GatewayEvent 并回调 onEvent
 *   2. 把 abortSignal / onReady / onError / log 接到 SDK 生命周期上
 */
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import {
  QQBot,
  FileKVStore,
  kvSessionPersistence,
  type QQBotInboundMessage,
  type GatewayDisconnect,
} from "@tencent-connect/qqbot-nodejs";
import type { ResolvedQQBotAccount } from "./types.js";
import { ADAPTER_VERSION } from "./types.js";
import { registerBot, unregisterBot } from "./api.js";

/** molipibot 消费的事件形状（与旧 1.x onEvent 事件保持一致） */
export interface GatewayEvent {
  type: "c2c" | "guild" | "dm" | "group";
  senderId: string;
  senderName?: string;
  senderIsBot?: boolean;
  content: string;
  messageId: string;
  timestamp: string;
  channelId?: string;
  guildId?: string;
  groupOpenid?: string;
  attachments?: Array<{
    content_type: string;
    url: string;
    filename?: string;
    voice_wav_url?: string;
    asr_refer_text?: string;
  }>;
  /** 原始网关事件类型，如 GROUP_AT_MESSAGE_CREATE */
  eventType?: string;
  mentions?: unknown[];
  messageScene?: { source?: string; ext?: string[] };
  msgElements?: unknown[];
  msgType?: number;
}

export interface GatewayContext {
  account: ResolvedQQBotAccount;
  abortSignal?: AbortSignal;
  cfg?: unknown;
  /** 每条入站消息回调一次（含群非 @ 消息；@/白名单过滤由上层负责） */
  onEvent?: (event: GatewayEvent) => Promise<void>;
  /** 按钮点击等交互事件回调（QQ 要求 5 秒内 ACK，由上层决定回执码） */
  onInteraction?: (event: GatewayInteractionEvent) => Promise<void>;
  onReady?: (data: unknown) => void;
  onError?: (error: Error) => void;
  log?: {
    info: (msg: string) => void;
    error: (msg: string) => void;
    debug?: (msg: string) => void;
  };
}

/** 按钮点击等交互事件（INTERACTION_CREATE 的适配层形状） */
export interface GatewayInteractionEvent {
  /** 交互 ID，用于 acknowledgeInteraction 回执 */
  id: string;
  /** 被点击按钮的 button_data */
  buttonData?: string;
  buttonId?: string;
  /** 群聊场景的 group_openid */
  groupOpenid?: string;
  /** C2C 场景的用户 openid */
  userOpenid?: string;
  /** 群成员 openid（群场景） */
  groupMemberOpenid?: string;
  chatType?: number;
  scene?: string;
}

/** 会话持久化目录（跨重启 RESUME 用）：~/.molibot/qqbot/<accountId>/ */
function sessionDataDir(accountId: string): string {
  const dir = path.join(os.homedir(), ".molibot", "qqbot", accountId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function toGatewayEvent(msg: QQBotInboundMessage): GatewayEvent {
  return {
    type: msg.kind,
    senderId: msg.senderId,
    senderName: msg.senderName,
    senderIsBot: msg.senderIsBot,
    content: msg.content,
    messageId: msg.messageId,
    timestamp: msg.timestamp,
    channelId: msg.channelId,
    guildId: msg.guildId,
    groupOpenid: msg.groupOpenid,
    attachments: msg.attachments,
    eventType: msg.rawEventType,
    mentions: msg.mentions,
    messageScene: msg.messageScene,
    msgElements: msg.msgElements,
    msgType: msg.msgType,
  };
}

/**
 * 启动网关并阻塞到连接结束（abort / 致命错误）。
 * 启动失败（凭证错误、重试耗尽）会 reject，由上层捕获。
 */
export async function startGateway(ctx: GatewayContext): Promise<void> {
  const { account, onEvent, onReady, onError, log } = ctx;
  const abortSignal = ctx.abortSignal ?? new AbortController().signal;
  const prefix = `[qqbot:${account.accountId}]`;

  if (!account.appId || !account.clientSecret) {
    throw new Error("QQBot not configured (missing appId or clientSecret)");
  }

  const bot = new QQBot({
    appId: account.appId,
    appSecret: account.clientSecret,
    accountId: account.accountId,
    markdownSupport: account.markdownSupport ?? false,
    userAgent: `MolibotQQBot/${ADAPTER_VERSION}`,
    logger: {
      debug: (msg: string) => log?.debug?.(`${prefix} ${msg}`),
      info: (msg: string) => log?.info(`${prefix} ${msg}`),
      warn: (msg: string) => log?.info(`${prefix} ${msg}`),
      error: (msg: string) => log?.error(`${prefix} ${msg}`),
    },
    sessionPersistence: kvSessionPersistence({
      store: new FileKVStore({ dir: sessionDataDir(account.accountId), fileName: "session.json" }),
      accountId: account.accountId,
    }),
  });
  registerBot(account.appId, bot);

  bot.on("ready", (data) => {
    log?.info(`${prefix} Gateway ready`);
    onReady?.(data);
  });
  bot.on("resumed", (data) => {
    log?.info(`${prefix} Session resumed`);
    onReady?.(data);
  });
  bot.on("disconnected", (event: GatewayDisconnect) => {
    log?.info(`${prefix} Disconnected: ${JSON.stringify(event)}`);
  });
  bot.on("error", (err) => {
    onError?.(err);
  });
  if (onEvent) {
    bot.on("message", async (_middlewareCtx, msg) => {
      try {
        await onEvent(toGatewayEvent(msg));
      } catch (err) {
        log?.error(`${prefix} onEvent handler failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
  }
  if (ctx.onInteraction) {
    bot.on("interaction", async (_interactionCtx, event) => {
      try {
        await ctx.onInteraction!({
          id: event.id,
          buttonData: event.data?.resolved?.button_data,
          buttonId: event.data?.resolved?.button_id,
          groupOpenid: event.group_openid,
          userOpenid: event.user_openid,
          groupMemberOpenid: event.group_member_openid,
          chatType: event.chat_type,
          scene: event.scene,
        });
      } catch (err) {
        log?.error(`${prefix} onInteraction handler failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
  }

  try {
    // start(signal) 在 stop/abort 时 resolve，在启动失败或重试耗尽时 reject
    await bot.start(abortSignal);
  } finally {
    unregisterBot(account.appId);
  }
}
