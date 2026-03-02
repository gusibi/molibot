import type { ImageContent } from "@mariozechner/pi-ai";

export interface FileAttachment {
  original: string;
  local: string;
  isImage: boolean;
}

export type ChannelChatType = "private" | "group" | "supergroup" | "channel";

export interface ChannelInboundMessage {
  chatId: string;
  chatType: ChannelChatType;
  messageId: number;
  userId: string;
  userName?: string;
  text: string;
  ts: string;
  attachments: FileAttachment[];
  imageContents: ImageContent[];
  isEvent?: boolean;
  sessionId?: string;
}

export interface LoggedMessage {
  date: string;
  ts: string;
  messageId: number;
  user: string;
  userName?: string;
  text: string;
  attachments: FileAttachment[];
  isBot: boolean;
}

export interface RunResult {
  stopReason: "stop" | "aborted" | "error";
  errorMessage?: string;
}

export interface MomContext {
  channel: string;
  message: ChannelInboundMessage;
  workspaceDir: string;
  chatDir: string;
  respond: (text: string, shouldLog?: boolean) => Promise<void>;
  replaceMessage: (text: string) => Promise<void>;
  respondInThread: (text: string) => Promise<void>;
  setTyping: (isTyping: boolean) => Promise<void>;
  setWorking: (isWorking: boolean) => Promise<void>;
  deleteMessage: () => Promise<void>;
  uploadFile: (filePath: string, title?: string) => Promise<void>;
}

export interface RunnerLike {
  isRunning(): boolean;
  run(ctx: MomContext): Promise<RunResult>;
  abort(): void;
}
