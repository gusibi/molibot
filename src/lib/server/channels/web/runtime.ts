import { resolveEventSessionMode, type EventDeliveryMode, type MomEvent } from "$lib/server/agent/events.js";
import type { ChannelInboundMessage } from "$lib/server/agent/core/types.js";
import { createRunId, momError, momLog, momWarn } from "$lib/server/agent/common/log.js";
import { BaseChannelRuntime } from "$lib/server/channels/shared/baseRuntime.js";
import type { ChannelRuntimeDeps } from "$lib/server/channels/registry.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";

export interface WebConfig {
  id: string;
}

interface WebSentMessageRef {
  messageId: number;
}

export class WebManager extends BaseChannelRuntime {
  constructor(
    getSettings: () => RuntimeSettings,
    updateSettings: (patch: Partial<RuntimeSettings>) => RuntimeSettings,
    deps: ChannelRuntimeDeps,
    options: { instanceId: string; workspaceDir: string }
  ) {
    super({
      channel: "web",
      defaultWorkspaceName: "moli-w",
      getSettings,
      updateSettings,
      sessionStore: deps.sessions,
      options: {
        instanceId: options.instanceId,
        workspaceDir: options.workspaceDir,
        memory: deps.memory,
        usageTracker: deps.usageTracker,
        modelErrorTracker: deps.modelErrorTracker,
        hookManager: deps.hookManager
      }
    });
  }

  apply(_config: WebConfig): void {
    // Web profiles are local runtime stores. There is no external socket/client
    // to start, but keeping this manager registered lets the shared scheduler
    // dispatch watched event JSON for Web reminders and automations.
    momLog("web", "manager_applied", { botId: this.instanceId, workspaceDir: this.workspaceDir });
  }

  stop(): void {
    momLog("web", "manager_stopped", { botId: this.instanceId });
  }

  private resolveEventDeliveryMode(event: MomEvent): EventDeliveryMode {
    if (event.delivery === "text") return "text";
    if (event.delivery === "agent") return "agent";
    return event.type === "periodic" ? "agent" : "text";
  }

  private buildEventSyntheticText(event: MomEvent, filename: string): string {
    const timePart = event.type === "one-shot"
      ? event.at
      : (event.type === "periodic" ? event.schedule : "immediate");
    return `[EVENT:${filename}:${event.type}:${timePart}] ${event.text}`;
  }

  private appendDirectEventMessage(event: MomEvent, runId: string, filename: string): void {
    const messageId = Date.now();
    const sessionId = this.resolveInboundSessionId(event.chatId, {
      chatId: event.chatId,
      chatType: "private",
      messageId,
      userId: "EVENT",
      userName: "EVENT",
      text: event.text,
      ts: (Date.now() / 1000).toFixed(6),
      attachments: [],
      imageContents: [],
      isEvent: true,
      taskId: event.taskId,
      sessionMode: resolveEventSessionMode(event),
      runId
    });
    this.store.logBotResponse(event.chatId, event.text, messageId);
    this.appendConversationMessage(
      "web",
      `bot:${this.instanceId}:chat:${event.chatId}:${sessionId}`,
      "assistant",
      event.text,
      "web_event_direct_session_append_failed",
      { chatId: event.chatId, runId, filename },
      "automation"
    );
  }

  async triggerTask(event: unknown, filename: string): Promise<void> {
    const task = event as MomEvent;
    if (!task || typeof task !== "object" || typeof task.chatId !== "string" || typeof task.text !== "string") {
      momWarn("web", "trigger_task_invalid_payload", { filename, botId: this.instanceId });
      throw new Error("Invalid task payload");
    }

    const delivery = this.resolveEventDeliveryMode(task);
    const syntheticMessageId = Date.now();
    const runId = task.status?.runId ?? createRunId(task.chatId, syntheticMessageId);

    momLog("web", "trigger_task_start", {
      runId,
      filename,
      botId: this.instanceId,
      chatId: task.chatId,
      eventType: task.type,
      delivery
    });

    try {
      if (delivery === "text" && (task.type === "one-shot" || task.type === "immediate")) {
        this.appendDirectEventMessage(task, runId, filename);
        momLog("web", "trigger_task_text_done", { runId, filename, chatId: task.chatId });
        return;
      }

      const synthetic: ChannelInboundMessage = {
        chatId: task.chatId,
        chatType: "private",
        messageId: syntheticMessageId,
        userId: "EVENT",
        userName: "EVENT",
        text: this.buildEventSyntheticText(task, filename),
        ts: (Date.now() / 1000).toFixed(6),
        attachments: [],
        imageContents: [],
        isEvent: true,
        taskId: task.taskId,
        sessionMode: resolveEventSessionMode(task),
        runId
      };

      await this.runSharedTextTask<WebSentMessageRef>(task.chatId, synthetic, {
        createBotMessageId: () => Date.now(),
        response: {
          sendText: async () => ({ messageId: Date.now() }),
          respondInThread: async (text) => {
            this.store.logBotResponse(task.chatId, text, Date.now());
          }
        },
        onSessionAppendWarning: (error) => {
          momWarn("web", "session_append_failed", {
            runId,
            chatId: task.chatId,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      });
      momLog("web", "trigger_task_agent_done", { runId, filename, chatId: task.chatId });
    } catch (error) {
      momError("web", "trigger_task_failed", {
        runId,
        filename,
        chatId: task.chatId,
        eventType: task.type,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }
}
