import type * as lark from "@larksuiteoapi/node-sdk";
import type { AssistantMessageEvent } from "@mariozechner/pi-ai";
import type { RunnerUiEvent, RunResult } from "$lib/server/agent/core/types.js";
import { momWarn } from "$lib/server/agent/common/log.js";
import { formatSubagentProgressLabel, formatSubagentProgressSummary } from "$lib/server/agent/subagentProgress.js";
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
}

export class FeishuStreamingSession {
  private readonly startedAt = Date.now();
  private readonly client: lark.Client;
  private readonly chatId: string;
  private readonly runId: string;
  private readonly title: string;
  private answerText = "";
  private detailsText = "";
  private tools: FeishuToolProgressEntry[] = [];
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

  constructor(options: FeishuStreamingSessionOptions) {
    this.client = options.client;
    this.chatId = options.chatId;
    this.runId = options.runId;
    this.title = options.title ?? "Molibot";
  }

  get finalText(): string {
    return this.answerText.trim();
  }

  get sentMessageId(): string | null {
    return this.messageId ?? this.fallbackMessageId;
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
    this.answerText = this.answerText ? `${this.answerText}\n${normalized}` : normalized;
    this.scheduleFlush(true);
  }

  async replaceAnswer(text: string): Promise<void> {
    this.answerText = String(text ?? "").trim();
    this.lastStreamedAnswer = "";
    this.scheduleFlush(true);
    await this.flushNow();
  }

  async beginContinuationResponse(partialText: string, notice: string): Promise<void> {
    const finalized = [partialText.trim() || this.answerText.trim(), notice.trim()].filter(Boolean).join("\n\n");
    this.answerText = finalized;
    this.lastStreamedAnswer = "";
    await this.flushNow();
  }

  async respondInThread(text: string): Promise<void> {
    const normalized = String(text ?? "").trim();
    if (!normalized) return;
    this.detailsText = this.detailsText ? `${this.detailsText}\n\n${normalized}` : normalized;
    this.scheduleFlush(true);
  }

  async handleRunnerEvent(event: RunnerUiEvent): Promise<void> {
    if (event.type === "assistant_message_event") {
      await this.handleAssistantEvent(event.event);
      return;
    }
    if (event.type === "tool_execution_start") {
      this.addToolStart(event.toolName, event.label, event.displayName);
      this.scheduleFlush();
      return;
    }
    if (event.type === "tool_execution_end") {
      this.finishTool(event.toolName, event.summary, event.isError, event.displayName);
      this.scheduleFlush();
      return;
    }
    if (event.type === "subagent_execution") {
      const toolName = event.phase === "task_start" || event.phase === "task_end"
        ? `subagent:${event.agent ?? "subagent"}:${event.taskIndex ?? 0}`
        : `subagent:${event.phase}`;
      const label = formatSubagentProgressLabel(event);
      const summary = event.phase === "task_end" || event.phase === "end" ? formatSubagentProgressSummary(event) : undefined;
      if (summary || event.stopReason) {
        this.finishTool(toolName, summary ?? label, event.stopReason === "error", "Subagent");
      } else {
        this.addToolStart(toolName, label, "Subagent");
      }
      this.scheduleFlush();
    }
  }

  async finalize(result: RunResult): Promise<void> {
    this.closed = true;
    this.clearTimer();
    await this.flushNow();
    if (!this.messageId && !this.fallbackMessageId && !this.answerText.trim() && this.tools.length === 0 && !this.detailsText.trim()) return;
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
          answerText: this.answerText,
          tools: this.tools,
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

  private async handleAssistantEvent(event: AssistantMessageEvent): Promise<void> {
    const candidate = event as { type?: string; delta?: string };
    if (candidate.type !== "text_delta") return;
    this.answerText += candidate.delta ?? "";
    this.scheduleFlush();
  }

  private addToolStart(toolName: string, label: string, displayName?: string): void {
    this.tools.push({ toolName, displayName, label, status: "running" });
  }

  private finishTool(toolName: string, summary: string | undefined, isError: boolean, displayName?: string): void {
    const existing = [...this.tools].reverse().find((tool) => tool.toolName === toolName && tool.status === "running");
    if (existing) {
      existing.status = isError ? "error" : "success";
      existing.summary = summary;
      existing.displayName = displayName ?? existing.displayName;
      return;
    }
    this.tools.push({ toolName, displayName, label: toolName, status: isError ? "error" : "success", summary });
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
        const initialCard = buildFeishuStreamingCard({
          title: this.title,
          answerText: this.answerText,
          tools: this.tools,
          detailsText: this.detailsText,
          isWorking: true
        });
        this.cardId = await createFeishuCardEntity(this.client, initialCard);
        this.sequence = 1;
        const sent = await sendFeishuCardById(this.client, this.chatId, this.cardId);
        this.messageId = sent.message_id;
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
      this.sequence += 1;
      await updateFeishuCardEntity(
        this.client,
        this.cardId,
        buildFeishuStreamingCard({
          title: this.title,
          answerText: this.answerText,
          tools: this.tools,
          detailsText: this.detailsText,
          isWorking: !this.closed
        }),
        this.sequence
      );
      if (this.answerText !== this.lastStreamedAnswer) {
        this.sequence += 1;
        await streamFeishuCardContent(this.client, this.cardId, FEISHU_STREAMING_ELEMENT_ID, this.answerText, this.sequence);
        this.lastStreamedAnswer = this.answerText;
      }
    } catch (error) {
      momWarn("feishu", "streaming_cardkit_update_failed_fallback_post", { runId: this.runId, error: String(error) });
      this.usePostFallback = true;
      await this.flushPostFallback(false);
    }
  }

  private renderPostFallbackText(isFinal: boolean): string {
    const toolLines = this.tools.map((tool) => {
      const status = tool.status === "running" ? "running" : tool.status === "error" ? "failed" : "done";
      const name = tool.displayName || tool.toolName;
      return tool.summary ? `[${status}] ${name}: ${tool.summary}` : `[${status}] ${name}`;
    });
    return [
      toolLines.length > 0 ? `工具调用\n${toolLines.join("\n")}` : "",
      this.answerText.trim() ? `回答\n${this.answerText.trim()}${isFinal ? "" : " ..."}` : "",
      this.detailsText.trim() ? `运行详情\n${this.detailsText.trim()}` : ""
    ].filter(Boolean).join("\n\n") || (isFinal ? "_No response._" : "处理中...");
  }

  private async flushPostFallback(isFinal: boolean): Promise<void> {
    const text = this.renderPostFallbackText(isFinal);
    if (this.fallbackMessageId) {
      await editFeishuText(this.client, this.fallbackMessageId, text);
      return;
    }
    const sent = await sendFeishuText(this.client, this.chatId, text);
    this.fallbackMessageId = sent?.message_id ?? null;
  }
}
