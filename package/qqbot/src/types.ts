/**
 * QQ Bot 账户配置类型。
 *
 * 2.0 起本包是基于 @tencent-connect/qqbot-nodejs 的薄适配层，
 * 协议层类型（ReplyTarget / InboundMessage 等）直接来自该 SDK。
 */

/** 适配层版本号，与 package.json / CHANGELOG.md 保持同步 */
export const ADAPTER_VERSION = "2.1.0";

export interface QQBotAccountConfig {
  enabled?: boolean;
  appId?: string;
  clientSecret?: string;
  /** 允许的用户/群 openid 白名单 */
  allowFrom?: string[];
}

export interface ResolvedQQBotAccount {
  accountId: string;
  name?: string;
  enabled: boolean;
  appId: string;
  clientSecret: string;
  secretSource: "config" | "file" | "env" | "none";
  /** 是否支持 markdown 消息（msg_type=2） */
  markdownSupport: boolean;
  config: QQBotAccountConfig;
}
