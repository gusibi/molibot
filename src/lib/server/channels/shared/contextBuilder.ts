import type { MomContext, ChannelInboundMessage } from "$lib/server/agent/core/types.js";
import type { RunnerUiEvent } from "$lib/server/agent/core/types.js";
import type { SessionStore } from "$lib/server/sessions/store.js";
import type { MomRuntimeStore } from "$lib/server/agent/session/store.js";
import type { Channel } from "$lib/shared/types/message.js";
import { momLog } from "$lib/server/agent/common/log.js";

export interface ContextSentMessageRef {
  messageId: string | number;
}

export interface ChannelResponseHandle<TSent extends ContextSentMessageRef> {
  sendText(text: string): Promise<TSent | null>;
  editText?(message: TSent, text: string): Promise<boolean>;
  deleteMessage?(message: TSent): Promise<boolean>;
  uploadFile?(filePath: string, title?: string, text?: string): Promise<void>;
  setTyping?(isTyping: boolean): Promise<void>;
  respondInThread?(text: string): Promise<void>;
}

interface ContextBuilderState<TSent extends ContextSentMessageRef> {
  accumulatedText: string;
  hasResponded: boolean;
  lastSentMessage: TSent | null;
  mainAnswerPhase: "draft" | "committed";
}

interface BuildTextChannelContextOptions<TSent extends ContextSentMessageRef> {
  channel: Channel;
  event: ChannelInboundMessage;
  workspaceDir: string;
  chatDir: string;
  store: MomRuntimeStore;
  sessions: SessionStore;
  instanceId: string;
  activeSessionId: string;
  project?: MomContext["project"];
  modelKeyOverride?: string;
  thinkingLevelOverride?: MomContext["thinkingLevelOverride"];
  /** Present when the scope is in Project mode: session messages must land in the project session store. */
  projectConversation?: { projectId: string; conversationId: string };
  conversationKey: string;
  response: ChannelResponseHandle<TSent>;
  createBotMessageId: () => number;
  normalizeText?: (text: string) => string;
  onSessionAppendWarning?: (error: unknown) => void;
  replaceWithoutEdit?: (text: string, state: ContextBuilderState<TSent>, ctx: MomContext) => Promise<void>;
  deleteWithoutHandle?: (state: ContextBuilderState<TSent>) => Promise<void>;
  uploadWithoutHandle?: (filePath: string, title: string | undefined, text: string | undefined, ctx: MomContext) => Promise<void>;
  onRunnerEvent?: (event: RunnerUiEvent) => Promise<void>;
}

export function buildTextChannelContext<TSent extends ContextSentMessageRef>(
  options: BuildTextChannelContextOptions<TSent>
): MomContext {
  const normalize = options.normalizeText ?? defaultNormalizeText;
  const state: ContextBuilderState<TSent> = {
    accumulatedText: "",
    hasResponded: false,
    lastSentMessage: null,
    mainAnswerPhase: "draft"
  };

  const appendAssistantMessage = (text: string) => {
    options.store.logMessage(options.event.chatId, {
      date: new Date().toISOString(),
      ts: `${Math.floor(Date.now() / 1000)}.000`,
      messageId: options.createBotMessageId(),
      user: options.instanceId,
      userName: options.instanceId,
      text,
      attachments: [],
      isBot: true
    });
    try {
      const conv = options.sessions.getOrCreateConversation(
        options.channel,
        options.conversationKey,
        options.projectConversation?.conversationId,
        options.projectConversation ? { projectId: options.projectConversation.projectId } : undefined
      );
      options.sessions.appendMessage(conv.id, "assistant", text);
    } catch (error) {
      options.onSessionAppendWarning?.(error);
    }
  };

  const sendSupplement = async (text: string) => {
    const normalized = normalize(text);
    if (!normalized) return;
    if (normalized === state.accumulatedText.trim()) return;
    if (options.response.respondInThread) {
      await options.response.respondInThread(normalized);
      return;
    }
    await ctx.respond(normalized);
  };

  const replaceDraftMessage = async (text: string) => {
    const normalized = normalize(text);
    if (!normalized) return;
    if (state.lastSentMessage && options.response.editText) {
      const runId = (options.event as { runId?: string }).runId;
      momLog(options.channel, "channel_sending_start", {
        runId,
        chatId: options.event.chatId,
        textLength: normalized.length,
        isEdit: true
      });
      const edited = await options.response.editText(state.lastSentMessage, normalized);
      if (edited) {
        state.accumulatedText = normalized;
        return;
      }
    }
    if (options.replaceWithoutEdit) {
      await options.replaceWithoutEdit(normalized, state, ctx);
    } else {
      await ctx.respond(normalized);
    }
  };

  const ctx: MomContext = {
    channel: options.channel,
    message: options.event,
    workspaceDir: options.workspaceDir,
    chatDir: options.chatDir,
    project: options.project,
    modelKeyOverride: options.modelKeyOverride,
    thinkingLevelOverride: options.thinkingLevelOverride,
    respond: async (text: string, shouldLog = true) => {
      const normalized = normalize(text);
      if (!normalized) return;
      const runId = (options.event as { runId?: string }).runId;
      momLog(options.channel, "channel_sending_start", {
        runId,
        chatId: options.event.chatId,
        textLength: normalized.length
      });
      state.lastSentMessage = await options.response.sendText(normalized);
      state.hasResponded = true;
      state.accumulatedText += state.accumulatedText ? `\n${normalized}` : normalized;
      if (shouldLog) {
        appendAssistantMessage(normalized);
      }
    },
    replaceMessage: async (text: string) => {
      const normalized = normalize(text);
      if (!normalized) return;
      if (state.mainAnswerPhase === "committed") {
        await sendSupplement(normalized);
        return;
      }
      await replaceDraftMessage(normalized);
    },
    commitMainAnswer: async (text: string) => {
      const normalized = normalize(text);
      if (!normalized) return;
      if (state.mainAnswerPhase === "committed") {
        await sendSupplement(normalized);
        return;
      }
      await replaceDraftMessage(normalized);
      state.mainAnswerPhase = "committed";
    },
    sendSupplement,
    beginContinuationResponse: async (partialText: string, notice: string) => {
      const partial = normalize(partialText);
      const normalizedNotice = normalize(notice);
      const finalized = [partial || state.accumulatedText, normalizedNotice].filter(Boolean).join("\n\n");
      if (finalized) {
        await ctx.commitMainAnswer?.(finalized);
      } else if (normalizedNotice) {
        await ctx.respond(normalizedNotice);
      }
      state.lastSentMessage = null;
    },
    respondInThread: async (text: string) => {
      const normalized = normalize(text);
      if (!normalized) return;
      if (options.response.respondInThread) {
        await options.response.respondInThread(normalized);
        return;
      }
      await ctx.respond(normalized);
    },
    setTyping: async (isTyping: boolean) => {
      await options.response.setTyping?.(isTyping);
    },
    setWorking: async () => {},
    deleteMessage: async () => {
      if (state.lastSentMessage && options.response.deleteMessage) {
        await options.response.deleteMessage(state.lastSentMessage);
        state.lastSentMessage = null;
        state.accumulatedText = "";
        return;
      }
      if (options.deleteWithoutHandle) {
        await options.deleteWithoutHandle(state);
      } else {
        state.lastSentMessage = null;
        state.accumulatedText = "";
      }
    },
    uploadFile: async (filePath: string, title?: string, text?: string) => {
      if (options.response.uploadFile) {
        await options.response.uploadFile(filePath, title, text);
        return;
      }
      if (options.uploadWithoutHandle) {
        await options.uploadWithoutHandle(filePath, title, text, ctx);
      }
    },
    onRunnerEvent: options.onRunnerEvent
  };

  return ctx;
}

function defaultNormalizeText(text: string): string {
  return String(text ?? "").trim();
}
