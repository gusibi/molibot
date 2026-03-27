import type {
  CDNMedia as VendorCDNMedia,
  FileItem as VendorFileItem,
  GetConfigResp as VendorGetConfigResp,
  GetUpdatesReq as VendorGetUpdatesReq,
  GetUpdatesResp as VendorGetUpdatesResp,
  ImageItem as VendorImageItem,
  MessageItem as VendorMessageItem,
  RefMessage as VendorRefMessage,
  SendMessageReq as VendorSendMessageReq,
  SendTypingReq as VendorSendTypingReq,
  TextItem as VendorTextItem,
  VideoItem as VendorVideoItem,
  VoiceItem as VendorVoiceItem,
  WeixinMessage as VendorWeixinMessage
} from "#weixin-agent-sdk/src/api/types.js";

export {
  MessageType,
  MessageState,
  MessageItemType,
  TypingStatus,
  UploadMediaType,
  type BaseInfo
} from "#weixin-agent-sdk/src/api/types.js";

export type CDNMedia = VendorCDNMedia;
export type TextItem = VendorTextItem;
export type ImageItem = VendorImageItem;
export type RefMessage = VendorRefMessage;

export interface VoiceItem extends VendorVoiceItem {
  aeskey?: string;
}

export interface FileItem extends VendorFileItem {
  aeskey?: string;
}

export interface VideoItem extends VendorVideoItem {
  aeskey?: string;
}

export interface MessageItem extends Omit<VendorMessageItem, "voice_item" | "file_item" | "video_item"> {
  voice_item?: VoiceItem;
  file_item?: FileItem;
  video_item?: VideoItem;
}

export interface WeixinMessage extends Omit<VendorWeixinMessage, "item_list"> {
  item_list?: MessageItem[];
}

export interface GetUpdatesReq extends VendorGetUpdatesReq {}
export interface GetUpdatesResp extends Omit<VendorGetUpdatesResp, "msgs"> {
  msgs?: WeixinMessage[];
}
export interface SendMessageReq extends Omit<VendorSendMessageReq, "msg"> {
  msg?: WeixinMessage;
}
export interface SendTypingReq extends VendorSendTypingReq {}
export interface GetConfigResp extends VendorGetConfigResp {}

export interface IncomingMessage {
  userId: string;
  text: string;
  type: "text" | "image" | "voice" | "file" | "video";
  raw: WeixinMessage;
  _contextToken: string;
  timestamp: Date;
}
