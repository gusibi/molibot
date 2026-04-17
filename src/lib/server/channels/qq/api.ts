/**
 * QQ Bot API - 向后兼容层
 * 所有功能已迁移到 SDK (package/qqbot)
 * 此文件保留以兼容旧代码，实际调用转发到 SDK
 */

// ===== SDK 适配器重新导出 =====
export {
  // 核心类型
  type ResolvedQQBotAccount,
  type SDKQQBotAccountConfig,

  // SDK 管理函数
  sdkSendText,
  sdkSendMedia,
  sdkSendProactiveMessage,
  sdkGetAccessToken,
  sdkInitApiConfig,

  // 配置管理
  applyQQBotAccountConfig,
  resolveQQBotAccount,
  listQQBotAccountIds,
  resolveDefaultQQBotAccountId,
  DEFAULT_ACCOUNT_ID,

  // SDK 导出
  initApiConfig,
  clearTokenCache,
  MediaFileType,
  type OutboundResult,
  type OutboundContext,
  type MediaOutboundContext,
  type UploadMediaResponse,
} from "./sdk-adapter.js";

// ===== 向后兼容的 API 函数 =====

import {
  sdkSendText,
  sdkSendMedia,
  sdkGetAccessToken,
  type ResolvedQQBotAccount
} from "./sdk-adapter.js";

/**
 * 发送 C2C 消息（向后兼容）
 * @deprecated 使用 sdkSendText 或 QQManager.sendText
 */
export async function sendC2CMessage(
  accessToken: string,
  openid: string,
  content: string,
  replyToId?: string
): Promise<{ id?: string; timestamp?: string | number }> {
  // 创建临时账户配置
  const account: ResolvedQQBotAccount = {
    accountId: "legacy",
    enabled: true,
    appId: "",
    clientSecret: "",
    secretSource: "none",
    markdownSupport: false,
    config: {}
  };

  const result = await sdkSendText(account, openid, content, replyToId);

  if (result.error) {
    throw new Error(result.error);
  }

  return {
    id: result.messageId,
    timestamp: result.timestamp
  };
}

/**
 * 发送群聊消息（向后兼容）
 * @deprecated 使用 sdkSendText 或 QQManager.sendText
 */
export async function sendGroupMessage(
  accessToken: string,
  groupOpenid: string,
  content: string,
  replyToId?: string
): Promise<{ id?: string; timestamp?: string | number }> {
  const account: ResolvedQQBotAccount = {
    accountId: "legacy",
    enabled: true,
    appId: "",
    clientSecret: "",
    secretSource: "none",
    markdownSupport: false,
    config: {}
  };

  const result = await sdkSendText(account, `group:${groupOpenid}`, content, replyToId);

  if (result.error) {
    throw new Error(result.error);
  }

  return {
    id: result.messageId,
    timestamp: result.timestamp
  };
}

/**
 * 发送频道消息（向后兼容）
 * @deprecated 使用 sdkSendText 或 QQManager.sendText
 */
export async function sendChannelMessage(
  accessToken: string,
  channelId: string,
  content: string,
  replyToId?: string
): Promise<{ id?: string; timestamp?: string | number }> {
  const account: ResolvedQQBotAccount = {
    accountId: "legacy",
    enabled: true,
    appId: "",
    clientSecret: "",
    secretSource: "none",
    markdownSupport: false,
    config: {}
  };

  const result = await sdkSendText(account, `channel:${channelId}`, content, replyToId);

  if (result.error) {
    throw new Error(result.error);
  }

  return {
    id: result.messageId,
    timestamp: result.timestamp
  };
}

/**
 * 安全发送（带降级）（向后兼容）
 * @deprecated 使用 sdkSendText 或直接处理错误
 */
export async function safeSend(
  sender: () => Promise<{ id?: string; timestamp?: string | number }>,
  fallback: () => Promise<{ id?: string; timestamp?: string | number }>
): Promise<{ id?: string; timestamp?: string | number } | null> {
  try {
    return await sender();
  } catch (error) {
    console.warn("Primary send failed, trying fallback:", error);
    try {
      return await fallback();
    } catch (fallbackError) {
      console.error("Fallback also failed:", fallbackError);
      return null;
    }
  }
}

/**
 * 获取网关 URL（向后兼容）
 * @deprecated SDK 自动处理网关连接
 */
export async function getGatewayUrl(_accessToken: string): Promise<string> {
  // SDK 内部处理网关，这里返回空字符串
  console.warn("getGatewayUrl is deprecated, SDK handles gateway internally");
  return "";
}

/**
 * 获取访问令牌（向后兼容）
 * @deprecated 使用 sdkGetAccessToken
 */
export async function getAccessTokenLegacy(appId: string, clientSecret: string): Promise<string> {
  return sdkGetAccessToken(appId, clientSecret);
}
