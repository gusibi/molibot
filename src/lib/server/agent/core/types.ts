import type { AssistantMessageEvent, ImageContent } from "@earendil-works/pi-ai";
import type { RuntimeThinkingLevel } from "$lib/server/settings/index.js";
import type { HostBashApprovalPrompt } from "$lib/server/hostBash/index.js";
import type { RunBudgetSnapshot } from "$lib/server/agent/core/runtimeBudget.js";
import type { ToolApprovalRequest, ToolExecutionContext, ToolResult, ToolSideEffect } from "$lib/server/agent/tools/toolTypes.js";
import type { DurablePrefixEntry } from "$lib/server/agent/durable/types.js";
import type { DurablePreflightDecision } from "$lib/server/agent/durable/preflight.js";
import type { ConversationPlan } from "$lib/shared/types/message.js";

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
  /** Explicit Project owner for a shared automation attempt. */
  projectId?: string;
  // fresh: scheduled-event run should start a new task session instead of the chat's active session.
  sessionMode?: "fresh" | "chat";
  sessionId?: string;
  initialStatusText?: string;
  initialStatusMessageId?: number;
  runId?: string;
  /** Internal: resume only this execution from a shared automation archive. */
  contextRunId?: string;
  /** Internal: active chat Session to restore after a suspended run finishes. */
  restoreSessionId?: string;
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
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    totalTokens: number;
  };
}

export interface DurableAttemptResult {
  result: RunResult;
  contextSessionId: string;
  approval?: ToolApprovalRequest;
}

export interface DurablePromotionRequest {
  message: string;
  runId: string;
  effect: ToolSideEffect;
  decision: DurablePreflightDecision;
  prefix: DurablePrefixEntry[];
}

export interface DurablePromotionResult {
  notice: string;
  executionId?: string;
}

export interface DurableAttemptHooks {
  onRunnerEvent?: (event: RunnerUiEvent) => Promise<void>;
  onToolSideEffectPreflight?: ToolExecutionContext["onSideEffectPreflight"];
  onToolSideEffectReceipt?: (effect: ToolSideEffect, result: ToolResult) => Promise<void>;
  onApprovalRequest?: ToolExecutionContext["onApprovalRequest"];
  consumeDurableApproval?: ToolExecutionContext["consumeDurableApproval"];
  readDurableEvidence?: ToolExecutionContext["readDurableEvidence"];
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
      toolCallId: string;
      toolName: string;
      displayName?: string;
      label: string;
      /** Project-relative paths the call touches, when the tool takes a file path. */
      paths?: string[];
      /** True when those paths are written rather than read. */
      mutates?: boolean;
      startedAt?: string;
    }
  | {
      type: "tool_execution_end";
      toolCallId: string;
      toolName: string;
      displayName?: string;
      isError: boolean;
      summary: string;
      /**
       * Unified patch for a call that changed a file, when the tool produced
       * one. Carried separately from `summary` because the summary is the text
       * the *model* reads ("Updated src/x.ts") while this is what a person needs
       * to see; collapsing them would make one of the two readers worse.
       */
      diff?: string;
      /** Successful Project file result, normalized from the tool receipt. */
      fileOutput?: {
        path: string;
        action: "created" | "modified";
      };
      finishedAt?: string;
      exitCode?: number;
      lineCount?: number;
      tokenUsage?: number;
      hostBashApproval?: HostBashApprovalPrompt;
    }
  | {
      type: "durable_preflight";
      sideEffectClass: "idempotent" | "queryable" | "non_idempotent";
      mode: "ordinary" | "promote";
      reason: string;
      preflightIndex: number;
    }
  | {
      type: "plan_proposal";
      plan: ConversationPlan;
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
      sessionId?: string;
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
  onToolSideEffectPreflight?: ToolExecutionContext["onSideEffectPreflight"];
  onToolSideEffectReceipt?: (effect: ToolSideEffect, result: ToolResult) => Promise<void>;
  onApprovalRequest?: ToolExecutionContext["onApprovalRequest"];
  consumeDurableApproval?: ToolExecutionContext["consumeDurableApproval"];
  readDurableEvidence?: ToolExecutionContext["readDurableEvidence"];
  onDurablePromotion?: (input: DurablePromotionRequest) => Promise<DurablePromotionResult>;
}

export interface RunnerLike {
  isRunning(): boolean;
  run(ctx: MomContext): Promise<RunResult>;
  abort(): void;
  steer(text: string): boolean;
  followUp(text: string): boolean;
}
