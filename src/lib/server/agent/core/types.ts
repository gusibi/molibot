import type { AssistantMessageEvent, ImageContent } from "@mariozechner/pi-ai";
import type { RuntimeThinkingLevel } from "$lib/server/settings/index.js";
import type { HostBashApprovalPrompt } from "$lib/server/hostBash/index.js";
import type { RunBudgetSnapshot } from "$lib/server/agent/core/runtimeBudget.js";

export type AttachmentMediaType = "image" | "audio" | "video" | "file";

export interface FileAttachment {
  original: string;
  local: string;
  mediaType: AttachmentMediaType;
  mimeType?: string;
  size?: number;
  isImage: boolean;
  isAudio: boolean;
  isVideo?: boolean;
}

export type ChannelChatType = "private" | "group" | "supergroup" | "channel";

export interface ChannelInboundMessage {
  chatId: string;
  scopeId?: string;
  workspaceId?: string;
  chatType: ChannelChatType;
  messageId: number;
  messageThreadId?: number;
  platformMessageId?: string;
  platformThreadId?: string;
  platformParentMessageId?: string;
  platformRootMessageId?: string;
  userId: string;
  userName?: string;
  text: string;
  ts: string;
  attachments: FileAttachment[];
  imageContents: ImageContent[];
  hasInlineAudioTranscript?: boolean;
  isEvent?: boolean;
  taskId?: string;
  // fresh: scheduled-event run should start a new task session instead of the chat's active session.
  sessionMode?: "fresh" | "chat";
  sessionId?: string;
  initialStatusText?: string;
  initialStatusMessageId?: number;
  runId?: string;
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
  runId?: string;
  workspaceId?: string;
  assistantSourceEntryId?: string;
  stopReason: "stop" | "aborted" | "error" | "waiting_for_approval";
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
      displayName?: string;
      label: string;
    }
  | {
      type: "tool_execution_end";
      toolName: string;
      displayName?: string;
      isError: boolean;
      summary: string;
      hostBashApproval?: HostBashApprovalPrompt;
    }
  | {
      type: "subagent_execution";
      phase: "start" | "task_start" | "task_end" | "end";
      mode: "single" | "parallel" | "chain";
      agent?: string;
      task?: string;
      taskIndex?: number;
      taskCount: number;
      stopReason?: "stop" | "aborted" | "error" | "waiting_for_approval";
      errorMessage?: string;
      budget?: RunBudgetSnapshot;
      model?: string;
    };

export interface MomContext {
  channel: string;
  message: ChannelInboundMessage;
  workspaceDir: string;
  chatDir: string;
  project?: {
    id: string;
    name: string;
    rootPath: string;
    instructions?: string;
    scratchDir: string;
    sandboxEnabled?: boolean;
    toolProgress?: "off" | "new" | "all" | "verbose";
    showReasoning?: "off" | "on" | "stream" | "new";
    runLogNotice?: boolean;
  };
  thinkingLevelOverride?: RuntimeThinkingLevel;
  modelKeyOverride?: string;
  respond: (text: string, shouldLog?: boolean) => Promise<void>;
  replaceMessage: (text: string) => Promise<void>;
  commitMainAnswer?: (text: string) => Promise<void>;
  sendSupplement?: (text: string) => Promise<void>;
  beginContinuationResponse?: (partialText: string, notice: string) => Promise<void>;
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
  steer(text: string): boolean;
  followUp(text: string): boolean;
}
