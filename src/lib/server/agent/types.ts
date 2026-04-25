import type { AssistantMessageEvent, ImageContent } from "@mariozechner/pi-ai";
import type { RuntimeThinkingLevel } from "../settings/index.js";

export type AttachmentMediaType = "image" | "audio" | "file";

export interface FileAttachment {
  original: string;
  local: string;
  mediaType: AttachmentMediaType;
  mimeType?: string;
  isImage: boolean;
  isAudio: boolean;
}

export type ChannelChatType = "private" | "group" | "supergroup" | "channel";

export interface ChannelInboundMessage {
  chatId: string;
  scopeId?: string;
  chatType: ChannelChatType;
  messageId: number;
  messageThreadId?: number;
  userId: string;
  userName?: string;
  text: string;
  ts: string;
  attachments: FileAttachment[];
  imageContents: ImageContent[];
  hasInlineAudioTranscript?: boolean;
  isEvent?: boolean;
  sessionId?: string;
  initialStatusText?: string;
  initialStatusMessageId?: number;
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

export type RunnerUiEvent =
  | {
      type: "thinking_config";
      requestedThinkingLevel: RuntimeThinkingLevel;
      effectiveThinkingLevel: RuntimeThinkingLevel;
      provider: string;
      model: string;
      reasoningSupported: boolean;
    }
  | {
      type: "payload";
      provider: string;
      model: string;
      api: string;
      requestedThinkingLevel: RuntimeThinkingLevel;
      effectiveThinkingLevel: RuntimeThinkingLevel;
      summary: string;
    }
  | {
      type: "assistant_message_event";
      event: AssistantMessageEvent;
    }
  | {
      type: "tool_execution_start";
      toolName: string;
      label: string;
    }
  | {
      type: "tool_execution_end";
      toolName: string;
      isError: boolean;
      summary: string;
    };

export interface MomContext {
  channel: string;
  message: ChannelInboundMessage;
  workspaceDir: string;
  chatDir: string;
  thinkingLevelOverride?: RuntimeThinkingLevel;
  respond: (text: string, shouldLog?: boolean) => Promise<void>;
  replaceMessage: (text: string) => Promise<void>;
  respondInThread: (text: string) => Promise<void>;
  setTyping: (isTyping: boolean) => Promise<void>;
  setWorking: (isWorking: boolean) => Promise<void>;
  deleteMessage: () => Promise<void>;
  uploadFile: (filePath: string, title?: string, text?: string) => Promise<void>;
  onRunnerEvent?: (event: RunnerUiEvent) => Promise<void>;
}

export interface RunnerLike {
  isRunning(): boolean;
  run(ctx: MomContext): Promise<RunResult>;
  abort(): void;
}
