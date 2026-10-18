/**
 * QQ Bot 出站发送适配层。
 *
 * 所有发送走 @tencent-connect/qqbot-nodejs 的 bot.send* 接口
 * （token 注入、被动/主动消息分路、富媒体上传由 SDK 处理）。
 * 本模块保留旧 1.x 的对外签名与行为要点：
 *   - 目标地址解析：`qqbot:c2c:xxx` / `c2c:xxx` / `group:xxx` / `channel:xxx` / 裸 openid
 *   - 被动回复限流：同一消息最多回复 4 次（1 小时窗口），超限自动降级为主动消息
 *   - OutboundResult 错误形状（error / errorCode / qqBizCode）
 */
import path from "node:path";
import {
  ApiError,
  UploadDailyLimitExceededError,
  MediaFileType,
  type QQBot,
  type ReplyTarget,
  type MessageResponse,
  type InlineKeyboard,
  type StreamSession,
} from "@tencent-connect/qqbot-nodejs";
import type { ResolvedQQBotAccount } from "./types.js";
import { getOrCreateBot } from "./api.js";

export type { InlineKeyboard, StreamSession };

export interface OutboundContext {
  to: string;
  text: string;
  accountId?: string | null;
  replyToId?: string | null;
  account: ResolvedQQBotAccount;
}

export interface MediaOutboundContext extends OutboundContext {
  mediaUrl: string;
  /** 可选的 MIME 类型，优先于扩展名判断媒体类型 */
  mimeType?: string;
  /** 显式指定媒体类型，优先于 MIME 与扩展名推断 */
  fileType?: MediaFileType;
}

export const OUTBOUND_ERROR_CODES = {
  FILE_TOO_LARGE: "file_too_large",
  UPLOAD_DAILY_LIMIT_EXCEEDED: "upload_daily_limit_exceeded",
} as const;

export const DEFAULT_MEDIA_SEND_ERROR = "发送失败，请稍后重试。";

export type OutboundErrorCode = (typeof OUTBOUND_ERROR_CODES)[keyof typeof OUTBOUND_ERROR_CODES];

export interface OutboundResult {
  channel: string;
  messageId?: string;
  timestamp?: string | number;
  error?: string;
  /** 稳定错误码，供上层按类型处理，避免依赖 error 文案 */
  errorCode?: OutboundErrorCode;
  /** QQ 开放平台业务错误码 */
  qqBizCode?: number;
  /** 出站消息的引用索引（ext_info.ref_idx） */
  refIdx?: string;
}

/** 媒体错误只暴露稳定的用户可读文案（对齐旧版行为） */
export function resolveUserFacingMediaError(result: Pick<OutboundResult, "error" | "errorCode">): string {
  if (result.errorCode) {
    if (result.errorCode === OUTBOUND_ERROR_CODES.FILE_TOO_LARGE) return "文件超过 QQ Bot 限制";
    if (result.errorCode === OUTBOUND_ERROR_CODES.UPLOAD_DAILY_LIMIT_EXCEEDED) {
      return "上传额度已用完（每日上限），请明天再试";
    }
  }
  return DEFAULT_MEDIA_SEND_ERROR;
}

// ============ 目标地址解析 ============

export interface ParsedTarget {
  type: "c2c" | "group" | "channel";
  id: string;
}

export function parseTarget(to: string): ParsedTarget {
  const id = to.replace(/^qqbot:/i, "");
  if (id.startsWith("c2c:")) {
    const userId = id.slice(4);
    if (!userId) throw new Error(`Invalid c2c target format: ${to} - missing user ID`);
    return { type: "c2c", id: userId };
  }
  if (id.startsWith("group:")) {
    const groupId = id.slice(6);
    if (!groupId) throw new Error(`Invalid group target format: ${to} - missing group ID`);
    return { type: "group", id: groupId };
  }
  if (id.startsWith("channel:")) {
    const channelId = id.slice(8);
    if (!channelId) throw new Error(`Invalid channel target format: ${to} - missing channel ID`);
    return { type: "channel", id: channelId };
  }
  if (!id) throw new Error(`Invalid target format: ${to}`);
  return { type: "c2c", id };
}

function toReplyTarget(target: ParsedTarget, msgId?: string): ReplyTarget {
  return {
    scope: target.type === "group" ? "group" : "c2c",
    targetId: target.id,
    msgId,
  };
}

// ============ 被动回复限流 ============

const MESSAGE_REPLY_LIMIT = 4;
const MESSAGE_REPLY_TTL_MS = 60 * 60 * 1000;
const MAX_TRACKED_MESSAGES = 10_000;

interface TrackedMessage {
  count: number;
  firstSeenAt: number;
}

const messageReplyTracker = new Map<string, TrackedMessage>();

function checkMessageReplyLimit(messageId: string): { allowed: boolean; shouldFallbackToProactive: boolean } {
  const tracked = messageReplyTracker.get(messageId);
  if (!tracked) return { allowed: true, shouldFallbackToProactive: false };
  if (Date.now() - tracked.firstSeenAt > MESSAGE_REPLY_TTL_MS) {
    messageReplyTracker.delete(messageId);
    return { allowed: false, shouldFallbackToProactive: true };
  }
  if (tracked.count >= MESSAGE_REPLY_LIMIT) {
    return { allowed: false, shouldFallbackToProactive: true };
  }
  return { allowed: true, shouldFallbackToProactive: false };
}

function recordMessageReply(messageId: string): void {
  const tracked = messageReplyTracker.get(messageId);
  if (tracked) {
    tracked.count += 1;
    return;
  }
  if (messageReplyTracker.size >= MAX_TRACKED_MESSAGES) {
    const firstKey = messageReplyTracker.keys().next().value;
    if (firstKey) messageReplyTracker.delete(firstKey);
  }
  messageReplyTracker.set(messageId, { count: 1, firstSeenAt: Date.now() });
}

// ============ 发送 ============

function requireBot(account: ResolvedQQBotAccount): QQBot {
  if (!account.appId || !account.clientSecret) {
    throw new Error("QQBot not configured (missing appId or clientSecret)");
  }
  return getOrCreateBot(account);
}

function toOutboundResult(response: MessageResponse): OutboundResult {
  return {
    channel: "qqbot",
    messageId: response.id,
    timestamp: response.timestamp,
    refIdx: response.ext_info?.ref_idx,
  };
}

function toErrorResult(err: unknown): OutboundResult {
  if (err instanceof UploadDailyLimitExceededError) {
    return { channel: "qqbot", error: err.message, errorCode: OUTBOUND_ERROR_CODES.UPLOAD_DAILY_LIMIT_EXCEEDED };
  }
  if (err instanceof ApiError) {
    const result: OutboundResult = { channel: "qqbot", error: err.message, qqBizCode: err.bizCode };
    if (typeof err.bizCode === "number" && err.bizCode === 40093002) {
      result.errorCode = OUTBOUND_ERROR_CODES.FILE_TOO_LARGE;
    }
    return result;
  }
  return { channel: "qqbot", error: err instanceof Error ? err.message : String(err) };
}

/**
 * 主动/被动发送决策：
 * - 有 replyToId → 被动回复（被动窗口内不限量级）
 * - 无 replyToId 且 C2C → 唤醒消息（is_wakeup，用户最近互动后 30 天窗口内额度远高于普通主动消息）
 * - 无 replyToId 且群/频道 → 普通主动消息（受平台每月配额限制）
 */
export function resolveProactiveMode(
  target: ParsedTarget,
  replyToId?: string | null
): "passive" | "wakeup" | "proactive" {
  if (replyToId) return "passive";
  return target.type === "c2c" ? "wakeup" : "proactive";
}

async function sendTextViaBot(
  bot: QQBot,
  target: ParsedTarget,
  text: string,
  replyToId: string | null | undefined
): Promise<OutboundResult> {
  if (target.type === "channel") {
    // 频道消息走独立接口，ReplyTarget 不覆盖频道 scope
    const response = await bot.sendChannelMessage(target.id, text, { msgId: replyToId ?? undefined });
    return toOutboundResult(response);
  }
  const replyTarget = toReplyTarget(target, replyToId ?? undefined);
  const mode = resolveProactiveMode(target, replyToId);
  const response =
    mode === "wakeup" ? await bot.sendWakeup(replyTarget, text) : await bot.sendText(replyTarget, text);
  return toOutboundResult(response);
}

/** 发送带内联按钮键盘的文本（C2C/群；按钮点击以 interaction 事件回调） */
export async function sendTextWithKeyboard(
  ctx: OutboundContext & { keyboard: InlineKeyboard }
): Promise<OutboundResult> {
  const { to, text, account, replyToId } = ctx;
  if (!account.appId || !account.clientSecret) {
    return { channel: "qqbot", error: "QQBot not configured (missing appId or clientSecret)" };
  }
  try {
    const bot = requireBot(account);
    const target = parseTarget(to);
    if (target.type === "channel") {
      return { channel: "qqbot", error: "频道消息暂不支持按钮键盘" };
    }
    const response = await bot.sendTextWithKeyboard(toReplyTarget(target, replyToId ?? undefined), text, ctx.keyboard);
    if (replyToId) recordMessageReply(replyToId);
    return toOutboundResult(response);
  } catch (err) {
    return toErrorResult(err);
  }
}

/** 显示"输入中"状态（仅 C2C；durationSec 秒后自动消失，需周期续期） */
export async function sendTyping(
  account: ResolvedQQBotAccount,
  to: string,
  durationSec = 30
): Promise<void> {
  const target = parseTarget(to);
  if (target.type !== "c2c") return;
  const bot = getOrCreateBot(account);
  await bot.sendTyping(toReplyTarget(target), durationSec);
}

/**
 * 打开 C2C 流式消息会话（打字机效果）。
 * 要求 msgId 是 5 分钟内的入站消息；update 传"截至目前的全文"（replace 语义），
 * 结束时必须调 complete()。
 */
export function openC2cStream(
  account: ResolvedQQBotAccount,
  to: string,
  msgId: string,
  throttleMs?: number
): StreamSession {
  const target = parseTarget(to);
  if (target.type !== "c2c") {
    throw new Error("Streaming is only supported for C2C targets");
  }
  const bot = getOrCreateBot(account);
  return bot.openStream({ target: toReplyTarget(target, msgId), throttleMs });
}

/** 回执交互事件（QQ 要求点击后 5 秒内 ACK） */
export async function acknowledgeInteraction(
  account: ResolvedQQBotAccount,
  interactionId: string,
  code: 0 | 1 | 2 | 3 | 4 | 5 = 0
): Promise<void> {
  const bot = getOrCreateBot(account);
  await bot.acknowledgeInteraction(interactionId, code);
}

export async function sendText(ctx: OutboundContext): Promise<OutboundResult> {
  const { to, text, account } = ctx;
  let { replyToId } = ctx;

  if (!account.appId || !account.clientSecret) {
    return { channel: "qqbot", error: "QQBot not configured (missing appId or clientSecret)" };
  }

  // 被动回复限流：超限/过期时降级为主动消息
  if (replyToId) {
    const limitCheck = checkMessageReplyLimit(replyToId);
    if (!limitCheck.allowed) {
      replyToId = null;
    }
  }

  // 主动消息必须有内容
  if (!replyToId && !text.trim()) {
    return { channel: "qqbot", error: "主动消息必须有内容 (text is empty)" };
  }

  try {
    const bot = requireBot(account);
    const target = parseTarget(to);
    const result = await sendTextViaBot(bot, target, text, replyToId);
    if (replyToId) recordMessageReply(replyToId);
    return result;
  } catch (err) {
    return toErrorResult(err);
  }
}

/**
 * 主动发送消息（无 replyToId，受平台每月 4 条/用户/群的配额限制）
 */
export async function sendProactiveMessage(
  account: ResolvedQQBotAccount,
  to: string,
  text: string
): Promise<OutboundResult> {
  return sendText({ to, text, accountId: account.accountId, replyToId: null, account });
}

// ============ 媒体类型推断 ============

function getCleanExt(filePath: string): string {
  const cleanPath = filePath.split("?")[0]!.split("#")[0]!;
  return path.extname(cleanPath).toLowerCase();
}

export function inferMediaFileType(source: string, mimeType?: string): MediaFileType {
  if (mimeType?.startsWith("image/")) return MediaFileType.IMAGE;
  if (mimeType?.startsWith("video/")) return MediaFileType.VIDEO;
  if (mimeType?.startsWith("audio/")) return MediaFileType.VOICE;

  const ext = getCleanExt(source);
  if ([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"].includes(ext)) return MediaFileType.IMAGE;
  if ([".mp4", ".mov", ".avi", ".mkv", ".webm", ".flv", ".wmv", ".m4v", ".3gp"].includes(ext)) {
    return MediaFileType.VIDEO;
  }
  if ([".mp3", ".wav", ".silk", ".slk", ".amr", ".opus", ".ogg", ".m4a", ".aac"].includes(ext)) {
    return MediaFileType.VOICE;
  }
  return MediaFileType.FILE;
}

interface MediaSource {
  url?: string;
  localPath?: string;
  buffer?: Buffer;
  fileName?: string;
}

function isHttpUrl(source: string): boolean {
  return /^https?:\/\//i.test(source);
}

/** 媒体源解析：http(s) URL 直传，data URL 转 buffer，其余按本地路径处理 */
function resolveMediaSource(mediaUrl: string): MediaSource {
  if (isHttpUrl(mediaUrl)) {
    return { url: mediaUrl };
  }
  if (mediaUrl.startsWith("data:")) {
    const base64 = mediaUrl.slice(mediaUrl.indexOf(",") + 1);
    return { buffer: Buffer.from(base64, "base64") };
  }
  return { localPath: mediaUrl, fileName: path.basename(mediaUrl) };
}

export async function sendMedia(ctx: MediaOutboundContext): Promise<OutboundResult> {
  const { to, text, replyToId, account, mimeType } = ctx;

  if (!account.appId || !account.clientSecret) {
    return { channel: "qqbot", error: "QQBot not configured (missing appId or clientSecret)" };
  }
  if (!ctx.mediaUrl) {
    return { channel: "qqbot", error: "mediaUrl is required for sendMedia" };
  }

  try {
    const bot = requireBot(account);
    const target = parseTarget(to);
    const fileType = ctx.fileType ?? inferMediaFileType(ctx.mediaUrl, mimeType);

    // 频道：仅支持公网 URL 图片（Markdown 内嵌），与 1.x 行为一致
    if (target.type === "channel") {
      if (fileType !== MediaFileType.IMAGE || !isHttpUrl(ctx.mediaUrl)) {
        return { channel: "qqbot", error: "频道消息仅支持公网 URL 图片" };
      }
      const response = await bot.sendChannelMessage(target.id, `![](${ctx.mediaUrl})`, {
        msgId: replyToId ?? undefined,
      });
      const result = toOutboundResult(response);
      if (!result.error && replyToId) recordMessageReply(replyToId);
      return result;
    }
    const source = resolveMediaSource(ctx.mediaUrl);
    const content = text?.trim() ? text : undefined;

    let result = await sendMediaWithFallback(bot, target, fileType, source, content, replyToId);
    if (!result.error && replyToId) recordMessageReply(replyToId);
    return result;
  } catch (err) {
    return toErrorResult(err);
  }
}

/** 语音发送失败时降级为文件发送（保留错误链，对齐旧版行为） */
async function sendMediaWithFallback(
  bot: QQBot,
  target: ParsedTarget,
  fileType: MediaFileType,
  source: MediaSource,
  content: string | undefined,
  replyToId: string | null | undefined
): Promise<OutboundResult> {
  const replyTarget = toReplyTarget(target, replyToId ?? undefined);
  try {
    const { message } = await bot.sendMedia({
      target: replyTarget,
      fileType,
      url: source.url,
      buffer: source.buffer,
      localPath: source.localPath,
      fileName: source.fileName,
      content,
    });
    return message ? toOutboundResult(message) : { channel: "qqbot" };
  } catch (err) {
    if (fileType !== MediaFileType.VOICE) {
      throw err;
    }
    const voiceError = err instanceof Error ? err.message : String(err);
    try {
      const { message } = await bot.sendMedia({
        target: replyTarget,
        fileType: MediaFileType.FILE,
        url: source.url,
        buffer: source.buffer,
        localPath: source.localPath,
        fileName: source.fileName,
        content,
      });
      const fallback = message ? toOutboundResult(message) : { channel: "qqbot" };
      return fallback;
    } catch (fileErr) {
      const fileError = fileErr instanceof Error ? fileErr.message : String(fileErr);
      throw new Error(`voice: ${voiceError} | fallback file: ${fileError}`);
    }
  }
}
