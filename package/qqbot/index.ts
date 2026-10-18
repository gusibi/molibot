/**
 * @molipibot/qqbot — QQ Bot 渠道适配层
 *
 * 基于 @tencent-connect/qqbot-nodejs（腾讯官方协议层 SDK）封装，
 * 为 molipibot 提供网关事件流（onEvent 模式）与出站发送能力。
 */
export { ADAPTER_VERSION } from "./src/types.js";
export type { QQBotAccountConfig, ResolvedQQBotAccount } from "./src/types.js";
export { startGateway } from "./src/gateway.js";
export type { GatewayContext, GatewayEvent } from "./src/gateway.js";
export {
  sendText,
  sendMedia,
  sendProactiveMessage,
  parseTarget,
  inferMediaFileType,
  resolveUserFacingMediaError,
  OUTBOUND_ERROR_CODES,
  DEFAULT_MEDIA_SEND_ERROR,
} from "./src/outbound.js";
export type { OutboundContext, MediaOutboundContext, OutboundResult, OutboundErrorCode } from "./src/outbound.js";
export { initApiConfig, clearTokenCache, getAccessToken, MediaFileType } from "./src/api.js";
export type { UploadMediaResponse } from "./src/api.js";
