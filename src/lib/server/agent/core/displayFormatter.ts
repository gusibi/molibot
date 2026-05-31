import type { RunnerUiEvent, FileAttachment } from "$lib/server/agent/core/types.js";
import { formatSubagentProgressLabel, formatSubagentProgressSummary } from "$lib/server/agent/subagentProgress.js";

export interface DisplayConfig {
  toolProgress: "off" | "new" | "all" | "verbose";
  showReasoning: "off" | "on" | "stream" | "new";
  gatewayNotifyInterval: number;
}

export interface FormattedToolEntry {
  toolName: string;
  displayName?: string;
  label: string;
  summary?: string;
  isError: boolean;
  status: "running" | "success" | "error";
  startedAt: number;
  endedAt?: number;
}

export class DisplayFormatter {
  public answerText = "";
  public thinkingText = "";
  public thinkingState: "idle" | "thinking" | "done" = "idle";
  public tools: FormattedToolEntry[] = [];
  public isWorking = false;
  private currentRunningToolName: string | null = null;

  constructor() {}

  public feedTextDelta(delta: string): void {
    this.answerText += delta;
  }

  public feedEvent(event: RunnerUiEvent): void {
    if (event.type === "assistant_message_event") {
      const ae = event.event;
      if (ae.type === "thinking_start") {
        this.thinkingState = "thinking";
      } else if (ae.type === "thinking_delta" && ae.delta) {
        this.thinkingState = "thinking";
        this.thinkingText += ae.delta;
      } else if (ae.type === "thinking_end") {
        this.thinkingState = "done";
      } else if (ae.type === "text_delta" && ae.delta) {
        this.answerText += ae.delta;
      }
      return;
    }

    if (event.type === "tool_execution_start") {
      this.isWorking = true;
      this.currentRunningToolName = event.toolName;
      // Mark any other running tool as completed to be safe
      for (const t of this.tools) {
        if (t.status === "running") {
          t.status = "success";
          t.endedAt = Date.now();
        }
      }
      this.tools.push({
        toolName: event.toolName,
        displayName: event.displayName,
        label: event.label,
        isError: false,
        status: "running",
        startedAt: Date.now()
      });
      return;
    }

    if (event.type === "tool_execution_end") {
      this.isWorking = false;
      this.currentRunningToolName = null;
      const existing = [...this.tools].reverse().find(
        (t) => t.toolName === event.toolName && t.status === "running"
      );
      if (existing) {
        existing.status = event.isError ? "error" : "success";
        existing.isError = event.isError;
        existing.summary = event.summary;
        existing.endedAt = Date.now();
        existing.displayName = event.displayName ?? existing.displayName;
      } else {
        this.tools.push({
          toolName: event.toolName,
          displayName: event.displayName,
          label: event.toolName,
          summary: event.summary,
          isError: event.isError,
          status: event.isError ? "error" : "success",
          startedAt: Date.now(),
          endedAt: Date.now()
        });
      }
      return;
    }

    if (event.type === "subagent_execution") {
      const toolName =
        event.phase === "task_start" || event.phase === "task_end"
          ? `subagent:${event.agent ?? "subagent"}:${event.taskIndex ?? 0}`
          : `subagent:${event.phase}`;

      const label = formatSubagentProgressLabel(event);
      const summary =
        event.phase === "task_end" || event.phase === "end"
          ? formatSubagentProgressSummary(event)
          : undefined;

      if (event.phase === "start" || event.phase === "task_start") {
        this.isWorking = true;
        this.currentRunningToolName = toolName;
        this.tools.push({
          toolName,
          displayName: "Subagent",
          label,
          isError: false,
          status: "running",
          startedAt: Date.now()
        });
      } else {
        this.isWorking = false;
        this.currentRunningToolName = null;
        const existing = [...this.tools].reverse().find(
          (t) => t.toolName === toolName && t.status === "running"
        );
        if (existing) {
          existing.status = event.stopReason === "error" ? "error" : "success";
          existing.isError = event.stopReason === "error";
          existing.summary = summary ?? label;
          existing.endedAt = Date.now();
        } else {
          this.tools.push({
            toolName,
            displayName: "Subagent",
            label,
            summary: summary ?? label,
            isError: event.stopReason === "error",
            status: event.stopReason === "error" ? "error" : "success",
            startedAt: Date.now(),
            endedAt: Date.now()
          });
        }
      }
    }
  }

  public getToolIcon(toolName: string, isError = false, isRunning = false): string {
    if (isRunning) return "⏳";
    if (isError) return "❌";
    const name = toolName.toLowerCase();
    if (name.includes("search")) return "🔎";
    if (name.includes("event")) return "📅";
    if (name.includes("bash") || name.includes("terminal")) return "💻";
    if (name.includes("subagent")) return "🧭";
    if (name.includes("read")) return "📖";
    if (name.includes("write") || name.includes("edit")) return "✏️";
    if (name.includes("memory")) return "🧠";
    if (name.includes("skill")) return "🧩";
    if (name.includes("profile")) return "👤";
    if (name.includes("model")) return "🔀";
    if (name.includes("mcp")) return "🔌";
    return "🛠";
  }

  public formatToolProgressText(
    config: DisplayConfig,
    fallbackText = ""
  ): string {
    const mode = config.toolProgress;
    if (mode === "off") return "";

    const activeTools = this.tools;
    if (activeTools.length === 0) return fallbackText;

    if (mode === "new") {
      const running = activeTools.find((t) => t.status === "running");
      if (running) {
        const icon = this.getToolIcon(running.toolName, false, true);
        const name = running.displayName || running.toolName || running.label;
        return `${icon} 正在运行: ${name}...`;
      }
      return "";
    }

    const lines: string[] = [];
    const maxVisible = 8;
    const visible = activeTools.slice(-maxVisible);
    const hidden = activeTools.length - visible.length;

    for (const entry of visible) {
      const name = entry.displayName || entry.toolName || entry.label;
      const isRunning = entry.status === "running";
      const icon = this.getToolIcon(entry.toolName, entry.isError, isRunning);
      
      if (mode === "verbose" && entry.summary) {
        const summary = this.summarizeText(entry.summary, 30);
        lines.push(`${icon} ${name}: "${summary}"`);
      } else {
        lines.push(`${icon} ${name}`);
      }
    }

    if (hidden > 0) {
      lines.unshift(`… 还有 ${hidden} 项工具调用`);
    }

    return lines.join("\n");
  }

  public renderMarkdown(_platform: string, config: DisplayConfig): string {
    return this.renderCombinedMarkdown(config);
  }

  public renderAnswerMarkdown(): string {
    return this.answerText.trim();
  }

  public renderReasoningMarkdown(config: DisplayConfig): string {
    const reasoningMode = config.showReasoning;
    if (reasoningMode === "off") return "";
    if (!this.thinkingText.trim()) return "";
    if (reasoningMode === "on" && this.thinkingState !== "done") return "";

    const body = reasoningMode === "new"
      ? this.getLatestReasoningSnippet()
      : this.thinkingText.trim();
    if (!body) return "";

    const header = reasoningMode === "new"
      ? "🧠 *思考进度*"
      : this.thinkingState === "thinking"
        ? "🧠 *模型思考中...*"
        : "💡 *思考过程*";
    const lines = body.split("\n");
    const blockquote = lines.map((line) => `> ${line}`).join("\n");
    return `${header}\n${blockquote}`;
  }

  public getLatestReasoningSnippet(max = 120): string {
    const normalized = this.thinkingText.replace(/\r\n?/g, "\n").trim();
    if (!normalized) return "";
    const compact = normalized.replace(/\s+/g, " ");
    const trailingFragment = compact.match(/[^。！？；.!?;]+$/)?.[0]?.trim();
    if (trailingFragment) {
      if (trailingFragment.length <= max) return trailingFragment;
      return trailingFragment.slice(Math.max(0, trailingFragment.length - max + 1)).trimStart();
    }
    const sentenceMatches = [...compact.matchAll(/[^。！？；.!?;]+[。！？；.!?;]/g)];
    const latestSentence = sentenceMatches.at(-1)?.[0]?.trim();
    const candidate = latestSentence || compact;
    if (candidate.length <= max) return candidate;
    return `${candidate.slice(Math.max(0, candidate.length - max + 1)).trimStart()}`;
  }

  public renderCombinedMarkdown(config: DisplayConfig): string {
    const parts: string[] = [];

    // 1. Reasoning Block
    const reasoningText = this.renderReasoningMarkdown(config);
    if (reasoningText && config.showReasoning !== "new") parts.push(reasoningText);

    // 2. Tool Progress Block (Only for Telegram or channels wanting text-based overlay)
    const progressText = this.formatToolProgressText(config);
    if (progressText) {
      parts.push(`*运行状态:*\n\`\`\`\n${progressText}\n\`\`\``);
    }

    // 3. Final Answer Block
    const answerText = this.renderAnswerMarkdown();
    if (answerText) {
      parts.push(answerText);
    } else if (this.isWorking && parts.length === 0) {
      parts.push("⏳ _运行中..._");
    }

    return parts.join("\n\n");
  }

  private summarizeText(text: string, max = 30): string {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (normalized.length <= max) return normalized;
    return `${normalized.slice(0, Math.max(0, max - 1))}…`;
  }
}
