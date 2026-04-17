/**
 * QQ Bot SDK helper exports for the Molibot adapter layer.
 */

import {
  applyQQBotAccountConfig,
  resolveQQBotAccount,
  listQQBotAccountIds,
  resolveDefaultQQBotAccountId,
  DEFAULT_ACCOUNT_ID
} from "#qqbot/src/config.js";
import type { ResolvedQQBotAccount, QQBotAccountConfig } from "#qqbot/src/types.js";
import {
  sendText,
  sendMedia,
  sendProactiveMessage,
  type OutboundResult
} from "#qqbot/src/outbound.js";
import { getAccessToken, initApiConfig, clearTokenCache } from "#qqbot/src/api.js";

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

export async function sdkSendProactiveMessage(
  account: ResolvedQQBotAccount,
  to: string,
  text: string
): Promise<OutboundResult> {
  return sendProactiveMessage(account, to, text);
}

export async function sdkGetAccessToken(appId: string, clientSecret: string): Promise<string> {
  return getAccessToken(appId, clientSecret);
}

export function sdkInitApiConfig(options: { markdownSupport?: boolean; appId?: string }): void {
  initApiConfig(options);
}

export type { ResolvedQQBotAccount, QQBotAccountConfig as SDKQQBotAccountConfig };
export type { OutboundResult, OutboundContext, MediaOutboundContext } from "#qqbot/src/outbound.js";
export { MediaFileType, initApiConfig, clearTokenCache } from "#qqbot/src/api.js";
export type { UploadMediaResponse } from "#qqbot/src/api.js";
export {
  applyQQBotAccountConfig,
  resolveQQBotAccount,
  listQQBotAccountIds,
  resolveDefaultQQBotAccountId,
  DEFAULT_ACCOUNT_ID
};
