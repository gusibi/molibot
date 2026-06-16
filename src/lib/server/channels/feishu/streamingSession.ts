import type * as lark from "@larksuiteoapi/node-sdk";
import type { RunnerUiEvent, RunResult } from "$lib/server/agent/core/types.js";
import { DisplayFormatter, type DisplayConfig } from "$lib/server/agent/core/displayFormatter.js";
import { momWarn } from "$lib/server/agent/common/log.js";
import { editFeishuText, sendFeishuText } from "$lib/server/channels/feishu/messaging.js";
import {
  FEISHU_STREAMING_ELEMENT_ID,
  buildFeishuFinalCard,
  buildFeishuStreamingCard,
  createFeishuCardEntity,
  sendFeishuCardById,
  setFeishuCardStreamingMode,
  streamFeishuCardContent,
  type FeishuToolProgressEntry,
  updateFeishuCardEntity
} from "$lib/server/channels/feishu/cardkit.js";

const CARDKIT_FLUSH_INTERVAL_MS = 700;
const POST_FALLBACK_FLUSH_INTERVAL_MS = 1000;

export interface FeishuStreamingSessionOptions {
  client: lark.Client;
  chatId: string;
  runId: string;
  title?: string;
  displayConfig?: DisplayConfig;
  replyToMessageId?: string | null;
  replyInThread?: boolean;
  onMessageSent?: (messageId: string) => void;
}

export class FeishuStreamingSession {
  private readonly startedAt = Date.now();
  private readonly client: lark.Client;
  private readonly chatId: string;
  private readonly runId: string;
  private readonly title: string;
  private readonly displayConfig: DisplayConfig;
  private readonly replyToMessageId: string | null;
  private readonly replyInThread: boolean;
  private readonly onMessageSent?: (messageId: string) => void;
  private readonly formatter = new DisplayFormatter();
  private detailsText = "";
  private cardId: string | null = null;
  private messageId: string | null = null;
  private fallbackMessageId: string | null = null;
  private sequence = 0;
  private cardCreation: Promise<void> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushInFlight: Promise<void> | null = null;
  private pendingFlush = false;
  private closed = false;
  private usePostFallback = false;
  private lastStreamedAnswer = "";
  private reasoningMessageId: string | null = null;
  private lastReasoningText = "";
  private reasoningFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private reasoningFlushInFlight: Promise<void> | null = null;
  private reasoningPendingFlush = false;
  private mainAnswerCommitted = false;
  private committedMainAnswerText = "";
  private workingPhase: "thinking" | "processing" = "processing";

  constructor(options: FeishuStreamingSessionOptions) {
    this.client = options.client;
    this.chatId = options.chatId;
    this.runId = options.runId;
    this.title = options.title ?? "Processing";
    this.replyToMessageId = options.replyToMessageId ?? null;
    this.replyInThread = options.replyInThread === true;
    this.onMessageSent = options.onMessageSent;
    this.displayConfig = options.displayConfig ?? {
      toolProgress: "all",
      showReasoning: "off",
      gatewayNotifyInterval: 0
    };
  }

  get finalText(): string {
    return this.formatter.answerText.trim();
  }

  get sentMessageId(): string | null {
    return this.messageId ?? this.fallbackMessageId;
  }

  private markMessageSent(messageId: string | null | undefined): void {
    const normalized = String(messageId ?? "").trim();
    if (!normalized) return;
    this.onMessageSent?.(normalized);
  }

  async respond(text: string, shouldLog = true): Promise<void> {
    const normalized = String(text ?? "").trim();
    if (!normalized) return;
    if (!shouldLog) {
      if (/^_?→\s+/.test(normalized) || /^_?Error:/.test(normalized)) return;
      this.detailsText = this.detailsText ? `${this.detailsText}\n${normalized}` : normalized;
      this.scheduleFlush();
      return;
    }
    if (this.mainAnswerCommitted) return;
    this.formatter.feedTextDelta(text);
    this.scheduleFlush(true);
  }

  async replaceAnswer(text: string): Promise<void> {
    if (this.mainAnswerCommitted) {
      await this.respondInThread(text);
      return;
    }
    this.formatter.answerText = String(text ?? "").trim();
    this.lastStreamedAnswer = "";
    this.scheduleFlush(true);
    await this.flushNow();
  }

  async commitMainAnswer(text: string): Promise<void> {
    const normalized = String(text ?? "").trim();
    if (!normalized) return;
    if (this.mainAnswerCommitted) {
      await this.respondInThread(normalized);
      return;
    }
    await this.replaceAnswer(normalized);
    this.mainAnswerCommitted = true;
    this.committedMainAnswerText = normalized;
  }

  async sendSupplement(text: string): Promise<void> {
    const normalized = String(text ?? "").trim();
    if (!normalized) return;
    if (normalized === this.committedMainAnswerText.trim()) return;
    await this.respondInThread(normalized);
  }

  async beginContinuationResponse(partialText: string, notice: string): Promise<void> {
    const finalized = [partialText.trim() || this.formatter.answerText.trim(), notice.trim()].filter(Boolean).join("\n\n");
    await this.commitMainAnswer(finalized);
  }

  async respondInThread(text: string): Promise<void> {
    const normalized = String(text ?? "").trim();
    if (!normalized) return;
    this.detailsText = this.detailsText ? `${this.detailsText}\n\n${normalized}` : normalized;
    this.scheduleFlush(true);
  }

  async handleRunnerEvent(event: RunnerUiEvent): Promise<void> {
    if (this.mainAnswerCommitted && event.type === "assistant_message_event") return;
    this.formatter.feedEvent(event);
    if (event.type === "assistant_message_event") {
      const candidate = event.event as { type?: string };
      // "thinking_start"/"thinking_delta" mean the model is actively reasoning;
      // any other event (text output, thinking_end, tool activity) is processing.
      this.workingPhase = candidate.type === "thinking_start" || candidate.type === "thinking_delta"
        ? "thinking"
        : "processing";
      if (candidate.type === "thinking_start" || candidate.type === "thinking_delta" || candidate.type === "thinking_end") {
        this.scheduleReasoningFlush();
        return;
      }
      if (candidate.type !== "text_delta") return;
    } else {
      this.workingPhase = "processing";
    }
    this.scheduleFlush();
  }

  // Header label shown while the card is still streaming. Reflects the model's
  // current phase so the user sees clear semantics (Thinking vs Processing)
  // instead of a static product name.
  private resolveStreamingTitle(): string {
    return this.workingPhase === "thinking" ? "Thinking" : this.title;
  }

  private getCardTools(): FeishuToolProgressEntry[] {
    if (this.displayConfig.toolProgress === "off") return [];
    if (this.displayConfig.toolProgress === "new") {
      return this.formatter.tools
        .filter((t) => t.status === "running")
        .map((t) => ({
          toolName: t.toolName,
          displayName: t.displayName,
          label: t.label,
          status: t.status as any,
          summary: t.summary
        }));
    }
    return this.formatter.tools.map((t) => ({
      toolName: t.toolName,
      displayName: t.displayName,
      label: t.label,
      status: t.status as any,
      summary: t.status === "running" && this.displayConfig.toolProgress !== "verbose" ? undefined : t.summary
    }));
  }

  async finalize(result: RunResult): Promise<void> {
    this.closed = true;
    this.clearTimer();
    this.clearReasoningTimer();
    if (this.displayConfig.showReasoning === "new") {
      await this.completeLatestReasoningNotice();
    } else {
      await this.flushReasoningNow();
    }

    const finalAnswer = this.formatter.renderAnswerMarkdown();
    const cardTools = this.getCardTools();

    if (!this.messageId && !this.fallbackMessageId && !finalAnswer.trim() && cardTools.length === 0 && !this.detailsText.trim()) return;
    await this.flushNow();
    const elapsedMs = Date.now() - this.startedAt;
    if (this.usePostFallback || !this.cardId) {
      await this.flushPostFallback(true);
      return;
    }
    try {
      this.sequence += 1;
      await setFeishuCardStreamingMode(this.client, this.cardId, false, this.sequence);
      this.sequence += 1;
      await updateFeishuCardEntity(
        this.client,
        this.cardId,
        buildFeishuFinalCard({
          title: result.stopReason === "error" ? "Error" : result.stopReason === "aborted" ? "Stopped" : "Completed",
          answerText: finalAnswer,
          tools: cardTools,
          detailsText: this.detailsText,
          stopReason: result.stopReason,
          elapsedMs
        }),
        this.sequence
      );
    } catch (error) {
      momWarn("feishu", "streaming_finalize_failed_fallback_post", { runId: this.runId, error: String(error) });
      this.usePostFallback = true;
      await this.flushPostFallback(true);
    }
  }

  private scheduleReasoningFlush(force = false): void {
    this.reasoningPendingFlush = true;
    if (force) this.clearReasoningTimer();
    if (this.reasoningFlushTimer || this.reasoningFlushInFlight) return;
    this.reasoningFlushTimer = setTimeout(() => {
      this.reasoningFlushTimer = null;
      void this.flushReasoningNow();
    }, force ? 0 : CARDKIT_FLUSH_INTERVAL_MS);
  }

  private clearReasoningTimer(): void {
    if (!this.reasoningFlushTimer) return;
    clearTimeout(this.reasoningFlushTimer);
    this.reasoningFlushTimer = null;
  }

  private async flushReasoningNow(): Promise<void> {
    this.clearReasoningTimer();
    if (this.reasoningFlushInFlight) await this.reasoningFlushInFlight;
    if (!this.reasoningPendingFlush && !this.closed) return;
    this.reasoningPendingFlush = false;
    const reasoningText = this.formatter.renderReasoningMarkdown(this.displayConfig).trim();
    if (!reasoningText || reasoningText === this.lastReasoningText) return;
    this.reasoningFlushInFlight = (async () => {
      if (this.reasoningMessageId) {
        await editFeishuText(this.client, this.reasoningMessageId, reasoningText);
      } else {
        const sent = await sendFeishuText(this.client, this.chatId, reasoningText, {
          replyToMessageId: this.replyToMessageId,
          replyInThread: this.replyInThread
        });
        this.reasoningMessageId = sent?.message_id ?? null;
        this.markMessageSent(this.reasoningMessageId);
      }
      this.lastReasoningText = reasoningText;
    })().finally(() => {
      this.reasoningFlushInFlight = null;
      if (this.reasoningPendingFlush && !this.closed) this.scheduleReasoningFlush();
    });
    await this.reasoningFlushInFlight;
  }

  private async completeLatestReasoningNotice(): Promise<void> {
    this.clearReasoningTimer();
    this.reasoningPendingFlush = false;
    if (this.reasoningFlushInFlight) await this.reasoningFlushInFlight;
    if (!this.reasoningMessageId) return;
    const text = "思考完成";
    if (text === this.lastReasoningText) return;
    await editFeishuText(this.client, this.reasoningMessageId, text);
    this.lastReasoningText = text;
  }

  private scheduleFlush(force = false): void {
    this.pendingFlush = true;
    if (force) this.clearTimer();
    if (this.flushTimer || this.flushInFlight) return;
    const interval = this.usePostFallback ? POST_FALLBACK_FLUSH_INTERVAL_MS : CARDKIT_FLUSH_INTERVAL_MS;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushNow();
    }, force ? 0 : interval);
  }

  private clearTimer(): void {
    if (!this.flushTimer) return;
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
  }

  async flushNow(): Promise<void> {
    this.clearTimer();
    if (this.flushInFlight) await this.flushInFlight;
    if (!this.pendingFlush && !this.closed) return;
    this.pendingFlush = false;
    this.flushInFlight = (this.usePostFallback ? this.flushPostFallback(this.closed) : this.flushCardKit()).finally(() => {
      this.flushInFlight = null;
      if (this.pendingFlush && !this.closed) this.scheduleFlush();
    });
    await this.flushInFlight;
  }

  private async ensureCard(): Promise<void> {
    if (this.cardId || this.messageId || this.usePostFallback) return;
    if (this.cardCreation) return this.cardCreation;
    this.cardCreation = (async () => {
      try {
        const finalAnswer = this.formatter.renderAnswerMarkdown();
        const cardTools = this.getCardTools();
        const initialCard = buildFeishuStreamingCard({
          title: this.resolveStreamingTitle(),
          answerText: finalAnswer,
          tools: cardTools,
          detailsText: this.detailsText,
          isWorking: true
        });
        this.cardId = await createFeishuCardEntity(this.client, initialCard);
        this.sequence = 1;
        const sent = await sendFeishuCardById(this.client, this.chatId, this.cardId, {
          replyToMessageId: this.replyToMessageId,
          replyInThread: this.replyInThread
        });
        this.messageId = sent.message_id;
        this.markMessageSent(this.messageId);
      } catch (error) {
        momWarn("feishu", "streaming_cardkit_create_failed_fallback_post", { runId: this.runId, error: String(error) });
        this.usePostFallback = true;
      }
    })();
    await this.cardCreation;
  }

  private async flushCardKit(): Promise<void> {
    await this.ensureCard();
    if (this.usePostFallback || !this.cardId) {
      await this.flushPostFallback(false);
      return;
    }
    try {
      const finalAnswer = this.formatter.renderAnswerMarkdown();
      const cardTools = this.getCardTools();
      this.sequence += 1;
      await updateFeishuCardEntity(
        this.client,
        this.cardId,
        buildFeishuStreamingCard({
          title: this.resolveStreamingTitle(),
          answerText: finalAnswer,
          tools: cardTools,
          detailsText: this.detailsText,
          isWorking: !this.closed
        }),
        this.sequence
      );
      if (finalAnswer !== this.lastStreamedAnswer) {
        this.sequence += 1;
        await streamFeishuCardContent(this.client, this.cardId, FEISHU_STREAMING_ELEMENT_ID, finalAnswer, this.sequence);
        this.lastStreamedAnswer = finalAnswer;
      }
    } catch (error) {
      momWarn("feishu", "streaming_cardkit_update_failed_fallback_post", { runId: this.runId, error: String(error) });
      this.usePostFallback = true;
      await this.flushPostFallback(false);
    }
  }

  private renderPostFallbackText(isFinal: boolean): string {
    const cardTools = this.getCardTools();
    const toolLines = cardTools.map((tool) => {
      const status = tool.status === "running" ? "running" : tool.status === "error" ? "failed" : "done";
      const name = tool.displayName || tool.toolName;
      return tool.summary ? `[${status}] ${name}: ${tool.summary}` : `[${status}] ${name}`;
    });
    const finalAnswer = this.formatter.renderAnswerMarkdown();
    return [
      toolLines.length > 0 ? `工具调用\n${toolLines.join("\n")}` : "",
      finalAnswer.trim() ? `回答\n${finalAnswer.trim()}${isFinal ? "" : " ..."}` : "",
      this.detailsText.trim() ? `运行详情\n${this.detailsText.trim()}` : ""
    ].filter(Boolean).join("\n\n") || (isFinal ? "_No response._" : "处理中...");
  }

  private async flushPostFallback(isFinal: boolean): Promise<void> {
    const text = this.renderPostFallbackText(isFinal);
    if (this.fallbackMessageId) {
      await editFeishuText(this.client, this.fallbackMessageId, text);
      return;
    }
    const sent = await sendFeishuText(this.client, this.chatId, text, {
      replyToMessageId: this.replyToMessageId,
      replyInThread: this.replyInThread
    });
    this.fallbackMessageId = sent?.message_id ?? null;
    this.markMessageSent(this.fallbackMessageId);
  }
}
