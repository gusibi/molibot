import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ensureSqliteParentDir, storagePaths } from "$lib/server/infra/db/storage.js";
import { getModels } from "@mariozechner/pi-ai";
import type { RuntimeSettings, RuntimeThinkingLevel } from "$lib/server/settings/index.js";
import { RUNTIME_THINKING_LEVELS } from "$lib/server/settings/index.js";
import type { ApprovedHostBashEntry, HostBashApprovalRecord, HostBashStore } from "$lib/server/hostBash/index.js";
import { getHostBashStore } from "$lib/server/hostBash/index.js";
import { getApprovalBroker } from "$lib/server/approval/approvalBroker.js";
import {
  buildModelOptions,
  currentModelKey,
  parseModelRoute,
  resolveModelSelection,
  switchModelSelection,
  type ModelRoute
} from "$lib/server/settings/modelSwitch.js";
import { listOAuthProviderIds, removeStoredAuth, resolveAuthFilePath, startOAuthLogin, submitOAuthLoginCode } from "$lib/server/agent/identity/auth.js";
import { momLog } from "$lib/server/agent/common/log.js";
import {
  findSkillBySelector,
  formatSkillDetailText,
  formatSkillsDetailText,
  formatSkillsSummaryText,
  loadSkillsFromWorkspace
} from "$lib/server/agent/skills/skills.js";
import type { RunnerPool } from "$lib/server/agent/core/runnerPool.js";
import type { MomRuntimeStore } from "$lib/server/agent/session/store.js";
import { resolveThinkingLevel } from "$lib/server/providers/customThinking.js";
import { resolveGlobalSkillsDirFromWorkspacePath } from "$lib/server/agent/session/workspace.js";
import { formatRunLogText } from "$lib/server/agent/session/runDetail.js";
import { commandLocaleFromSettings, commandText, isChineseLocale } from "$lib/server/agent/commands/i18n.js";

const ACP_DISABLED_MESSAGE = "ACP has been removed from the active runtime path. Use the normal Agent workflow instead.";

export interface SharedRuntimeCommandContext<TTarget> {
  chatId: string;
  scopeId: string;
  text: string;
  target: TTarget;
}

export interface SharedRuntimeCommandOptions<TTarget> {
  channel: string;
  instanceId: string;
  workspaceDir: string;
  authScopePrefix: string;
  store: MomRuntimeStore;
  runners: RunnerPool;
  getSettings: () => RuntimeSettings;
  updateSettings?: (patch: Partial<RuntimeSettings>) => RuntimeSettings;
  hostBashStore?: HostBashStore;
  getAuthScopeKey?: (input: SharedRuntimeCommandContext<TTarget>) => string;
  isRunning: (scopeId: string) => boolean;
  stopRun: (scopeId: string) => { aborted: boolean; clearedStale?: boolean };
  steerRun?: (scopeId: string, text: string) => { queued: boolean };
  followUpRun?: (scopeId: string, text: string) => { queued: boolean };
  sendText: (target: TTarget, text: string) => Promise<void>;
  uploadFile?: (target: TTarget, filePath: string, title?: string, text?: string) => Promise<void>;
  executeApprovedHostBash?: (
    input: SharedRuntimeCommandContext<TTarget>,
    approved: ApprovedHostBashEntry | undefined,
    request: HostBashApprovalRecord
  ) => Promise<string | void>;
  onSessionMutation?: (scopeId: string) => void | Promise<void>;
  getQueueSize?: (scopeId: string) => number;
  listQueue?: (scopeId: string) => Promise<Array<{ id: number; status: string; preview: string; createdAt: string }>>;
  deleteQueued?: (scopeId: string, id: number) => Promise<"deleted" | "running" | "not_found">;
  getQueuedPreview?: (
    scopeId: string,
    id: number
  ) => Promise<{ status: "pending" | "running" | "not_found"; preview?: string }>;
  cancelQueuedPending?: (scopeId: string) => Promise<number>;
  enqueueFront?: (input: SharedRuntimeCommandContext<TTarget>, text: string) => Promise<number | null>;
  getStatusExtras?: (scopeId: string, target: TTarget) => string[];
  helpLines?: readonly string[];
}

type FixedCommandRenderMode = "plain" | "two_column_markdown_table";
type FixedCommandName = "status" | "help";

interface CommandTableRow {
  label: string;
  value: string;
}

interface CommandTableSection {
  title?: string;
  rows: CommandTableRow[];
}

interface ModelTableDisplayRow {
  indexLabel: string;
  provider: string;
  model: string;
}

const TWO_COLUMN_TABLE_CHANNELS = new Set(["feishu", "qq", "weixin"]);
const FIXED_COMMAND_RENDER_MODE: Record<FixedCommandName, FixedCommandRenderMode> = {
  status: "two_column_markdown_table",
  help: "two_column_markdown_table"
};

export class SharedRuntimeCommandService<TTarget> {
  private readonly thinkingLevels = new Set<string>(RUNTIME_THINKING_LEVELS);
  private readonly hostBashStore: HostBashStore;

  constructor(private readonly options: SharedRuntimeCommandOptions<TTarget>) {
    this.hostBashStore = options.hostBashStore ?? getHostBashStore();
  }

  private text(english: string, chinese: string): string {
    return commandText(commandLocaleFromSettings(this.options.getSettings()), english, chinese);
  }

  private get isChinese(): boolean {
    return isChineseLocale(this.options.getSettings().locale);
  }

  // Run ids are `${chatId}-${sessionId}-${messageId}`, so an active run must be
  // looked up by session, not by scope id. Stale "running" rows past the turn
  // lock timeout are treated as inactive, matching the orchestrator's lock TTL.
  private isRunActive(sessionId: string): boolean {
    try {
      ensureSqliteParentDir(storagePaths.settingsDbFile);
      const db = new DatabaseSync(storagePaths.settingsDbFile);
      const row = db.prepare(
        "SELECT started_at FROM runs WHERE session_id = ? AND status = 'running' ORDER BY started_at DESC LIMIT 1"
      ).get(sessionId) as { started_at: string } | undefined;
      db.close();
      if (!row) return false;
      const startedAt = Date.parse(row.started_at);
      return Number.isFinite(startedAt) && Date.now() - startedAt < 10 * 60 * 1000;
    } catch {
      return false;
    }
  }

  // Runs the approved host command without blocking the approval reply, so
  // channel UI (e.g. Feishu cards) can settle immediately even for long commands.
  private executeApprovedHostBashInBackground(
    input: SharedRuntimeCommandContext<TTarget>,
    approved: ApprovedHostBashEntry | undefined,
    record: HostBashApprovalRecord
  ): void {
    const execute = this.options.executeApprovedHostBash;
    if (!execute) return;
    void (async () => {
      // Let the approval reply (card update / text) go out before execution output.
      await new Promise((resolve) => setImmediate(resolve));
      // A blocked in-run bash waiter may have claimed execution already.
      if (typeof this.hostBashStore.claimExecution === "function" && !this.hostBashStore.claimExecution(record.id)) {
        return;
      }
      try {
        const runSummary = await execute(input, approved, record);
        this.hostBashStore.markExecution(record.id, "executed");
        if (runSummary) {
          await this.options.sendText(input.target, runSummary);
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.hostBashStore.markExecution(record.id, "failed", reason);
        await this.options.sendText(
          input.target,
          this.text(`Approved, but automatic execution failed: ${reason}`, `已批准，但自动执行失败：${reason}`)
        ).catch(() => undefined);
      }
    })();
  }

  // Duplicate clicks on an approval card (or repeated text replies) arrive after
  // the request is already resolved. Report what actually happened instead of
  // the misleading "no matching pending approval found".
  private describeResolvedApproval(approvalId?: string): string | null {
    if (!approvalId || typeof this.hostBashStore.getApprovalRecord !== "function") return null;
    const record = this.hostBashStore.getApprovalRecord(approvalId);
    if (!record || record.status === "pending") return null;
    switch (record.status) {
      case "approved":
      case "executing":
        return this.text(
          `This approval was already accepted; the command is executing (${record.displayName}).`,
          `该审批已通过，命令正在执行（${record.displayName}）。`
        );
      case "executed":
        return this.text(
          `This approval was already processed: approved and executed (${record.displayName}).`,
          `该审批已处理：已批准并执行（${record.displayName}）。`
        );
      case "failed":
        return this.text(
          `This approval was already processed, but execution failed: ${record.errorText || "unknown error"}`,
          `该审批已处理，但执行失败：${record.errorText || "未知错误"}`
        );
      case "rejected":
        return this.text(
          `This approval was already rejected (${record.displayName}).`,
          `该审批此前已被拒绝（${record.displayName}）。`
        );
      case "expired":
        return this.text(
          `This approval request has expired (${record.displayName}).`,
          `该审批请求已过期失效（${record.displayName}）。`
        );
      default:
        return null;
    }
  }

  // When a run is active, the blocked in-run bash waiter normally claims and
  // executes the approved command within its poll interval. If the waiter has
  // already given up (its wait timed out) the record stays "approved" — this
  // delayed check picks it up so the approval is never silently dropped.
  private scheduleHostBashExecutionFallback(
    input: SharedRuntimeCommandContext<TTarget>,
    approved: ApprovedHostBashEntry | undefined,
    record: HostBashApprovalRecord
  ): void {
    if (typeof this.hostBashStore.getApprovalRecord !== "function") return;
    setTimeout(() => {
      const current = this.hostBashStore.getApprovalRecord(record.id);
      if (current?.status === "approved") {
        this.executeApprovedHostBashInBackground(input, approved, current);
      }
    }, 3000).unref?.();
  }

  // The agent ToolRuntime gates high-risk tools through the ApprovalBroker and
  // polls it while the run waits. Host Bash approvals live in a separate store,
  // so without this bridge a user reply like "本会话允许" resolves the Host Bash
  // record but leaves the broker request pending until it times out.
  private resolvePendingBrokerRequests(
    scopeId: string,
    status: "approved" | "rejected",
    selectedScope: "once" | "session" | "persistent"
  ): void {
    try {
      const broker = getApprovalBroker();
      for (const request of broker.listPendingRequests()) {
        if (request.runId !== scopeId) continue;
        broker.resolveRequest({ requestId: request.id, status, selectedScope });
      }
    } catch {
      // Broker bridging is best-effort; Host Bash approval state is authoritative.
    }
  }

  async approveHostTool(
    input: SharedRuntimeCommandContext<TTarget>,
    approvalId?: string,
    scope?: "once" | "persistent"
  ): Promise<{
    ok: boolean;
    message: string;
    request?: HostBashApprovalRecord;
  }> {
    const sessionId = this.options.store.getActiveSession(input.scopeId);
    const approved = this.hostBashStore.approve(input.scopeId, approvalId || undefined, { sessionId, scope });
    if (!approved) {
      const resolved = this.describeResolvedApproval(approvalId);
      if (resolved) return { ok: true, message: resolved };
      return { ok: false, message: this.text("No matching pending Host Bash approval found.", "未找到匹配的待处理 Host Bash 审批。") };
    }
    this.resolvePendingBrokerRequests(input.scopeId, "approved", scope === "persistent" ? "persistent" : "once");
    const registered = approved.approved;
    const registeredEntries = approved.approvedEntries ?? (registered ? [registered] : []);
    let message = registered
      ? [
          this.text(`Approved Host Bash: ${registered.displayName}`, `已批准 Host Bash：${registered.displayName}`),
          this.text(
            `Whitelisted tools: ${registeredEntries.map((item) => item.toolId).join(", ")}`,
            `已加入白名单的工具：${registeredEntries.map((item) => item.toolId).join("、")}`
          ),
          this.text(`Command: ${registered.command}`, `命令：${registered.command}`)
        ].join("\n")
      : [
          this.text(`Approved one-time host action: ${approved.record.displayName}`, `已批准一次性主机操作：${approved.record.displayName}`),
          this.text(`Request ID: ${approved.record.id}`, `请求 ID：${approved.record.id}`),
          this.text(`Command: ${approved.record.command}`, `命令：${approved.record.command}`)
        ].join("\n");
    if (approved.record.pendingAction && this.options.executeApprovedHostBash) {
      if (this.isRunActive(sessionId)) {
        message += `\n\n${this.text("Approved. The waiting agent run is executing the command now.", "已批准。等待中的 Agent 运行正在执行该命令。")}`;
        this.scheduleHostBashExecutionFallback(input, approved.approved, approved.record);
      } else {
        this.executeApprovedHostBashInBackground(input, approved.approved, approved.record);
        message += `\n\n${this.text(
          "Approved. The command is now executing; results will follow in chat.",
          "已批准。命令正在执行，结果稍后会发到会话中。"
        )}`;
      }
    } else if (registered) {
      message += `\n${this.text("This command is now registered as a reusable Host Bash whitelist entry.", "该命令已登记为可复用的 Host Bash 白名单项。")}`;
    } else {
      message += `\n${this.text("This approval is one-time only and will not be reused for future host commands.", "该审批仅本次有效，不会用于后续主机命令。")}`;
    }
    return { ok: true, message, request: approved.record };
  }

  async approveHostToolForSession(input: SharedRuntimeCommandContext<TTarget>, approvalId?: string): Promise<{
    ok: boolean;
    message: string;
    request?: HostBashApprovalRecord;
  }> {
    const sessionId = this.options.store.getActiveSession(input.scopeId);
    const approved = this.hostBashStore.approve(input.scopeId, approvalId || undefined, { scope: "session", sessionId });
    if (!approved) {
      const resolved = this.describeResolvedApproval(approvalId);
      if (resolved) return { ok: true, message: resolved };
      return { ok: false, message: this.text("No matching pending Host Bash approval found.", "未找到匹配的待处理 Host Bash 审批。") };
    }
    this.resolvePendingBrokerRequests(input.scopeId, "approved", "session");
    this.options.store.setSessionHostApprovalMode(input.scopeId, sessionId, "session");
    this.options.store.appendRuntimeEvent(input.scopeId, {
      code: "SESSION_HOST_APPROVAL_ENABLED",
      level: "info",
      summary: "Enabled session-only sandbox fallback approval.",
      details: {
        sessionId,
        requestId: approved.record.id,
        command: approved.record.command
      }
    }, sessionId);

    let message = [
      `Approved for current session only: ${approved.record.displayName}`,
      `Request ID: ${approved.record.id}`,
      `Command: ${approved.record.command}`,
      `Session: ${sessionId}`,
      "Future sandbox permission denials in this session will fall back to Host Bash automatically."
    ].join("\n");
    if (approved.record.pendingAction && this.options.executeApprovedHostBash) {
      if (this.isRunActive(sessionId)) {
        message += "\n\nApproved. The waiting agent run is executing the command now.";
        this.scheduleHostBashExecutionFallback(input, undefined, approved.record);
      } else {
        this.executeApprovedHostBashInBackground(input, undefined, approved.record);
        message += `\n\n${this.text(
          "Approved. The command is now executing; results will follow in chat.",
          "已批准。命令正在执行，结果稍后会发到会话中。"
        )}`;
      }
    }
    return { ok: true, message, request: approved.record };
  }

  async rejectHostTool(input: SharedRuntimeCommandContext<TTarget>, approvalId?: string): Promise<{
    ok: boolean;
    message: string;
    request?: HostBashApprovalRecord;
  }> {
    const sessionId = this.options.store.getActiveSession(input.scopeId);
    const request = this.hostBashStore.reject(input.scopeId, approvalId, sessionId);
    if (!request) {
      const resolved = this.describeResolvedApproval(approvalId);
      if (resolved) return { ok: true, message: resolved };
      return { ok: false, message: this.text("No matching pending Host Bash approval found.", "未找到匹配的待处理 Host Bash 审批。") };
    }
    this.resolvePendingBrokerRequests(input.scopeId, "rejected", "once");
    return {
      ok: true,
      message: this.text(`Rejected Host Bash approval ${request.id} (${request.displayName}).`, `已拒绝 Host Bash 审批 ${request.id}（${request.displayName}）。`),
      request
    };
  }

  async handle(input: SharedRuntimeCommandContext<TTarget>): Promise<boolean> {
    const text = String(input.text ?? "").trim();
    const hostToolApprovalHandled = await this.tryHandleHostToolApproval(input, text);
    if (hostToolApprovalHandled) return true;
    if (!text.startsWith("/")) return false;

    const parts = text.split(/\s+/);
    const cmd = parts[0]?.toLowerCase() || "";
    const rawArg = parts.slice(1).join(" ").trim();

    if (cmd === "/acp" || cmd === "/approve" || cmd === "/deny") {
      await this.options.sendText(input.target, ACP_DISABLED_MESSAGE);
      return true;
    }

    if (cmd === "/stop") {
      const result = this.options.stopRun(input.scopeId);
      const cancelledQueued = (await this.options.cancelQueuedPending?.(input.scopeId)) ?? 0;
      if (result.aborted) {
        await this.options.sendText(
          input.target,
          cancelledQueued > 0
            ? this.text(`Stopping... Cleared ${cancelledQueued} queued task(s).`, `正在停止……已清除 ${cancelledQueued} 个排队任务。`)
            : this.text("Stopping...", "正在停止……")
        );
      } else if (result.clearedStale) {
        await this.options.sendText(
          input.target,
          cancelledQueued > 0
            ? this.text(`Cleared stale running task. Cleared ${cancelledQueued} queued task(s).`, `已清除失效的运行中任务，并清除 ${cancelledQueued} 个排队任务。`)
            : this.text("Cleared stale running task.", "已清除失效的运行中任务。")
        );
      } else {
        if (cancelledQueued > 0) {
          await this.options.sendText(input.target, this.text(`No active task. Cleared ${cancelledQueued} queued task(s).`, `没有运行中的任务，已清除 ${cancelledQueued} 个排队任务。`));
        } else {
          await this.options.sendText(input.target, this.text("Nothing running.", "当前没有运行中的任务。"));
        }
      }
      return true;
    }

    if (cmd === "/steer") {
      const queuedHandled = await this.tryHandleQueuedLiveCommand("steer", input, rawArg);
      if (queuedHandled) return true;
      if (!this.options.steerRun) {
        await this.options.sendText(input.target, this.text("Live steer is unavailable in current runtime.", "当前运行时不支持实时纠正。"));
        return true;
      }
      if (!rawArg) {
        await this.options.sendText(input.target, this.text("Usage: /steer <text>", "用法：/steer <文本>"));
        return true;
      }
      const result = this.options.steerRun(input.scopeId, rawArg);
      await this.options.sendText(
        input.target,
        result.queued
          ? this.text("Queued steering correction into current task.", "已将纠正内容注入当前任务。")
          : this.text("Nothing running. Send a normal message instead.", "当前没有运行中的任务，请直接发送普通消息。")
      );
      return true;
    }

    if (cmd === "/followup" || cmd === "/follow_up") {
      const queuedHandled = await this.tryHandleQueuedLiveCommand("followup", input, rawArg);
      if (queuedHandled) return true;
      if (!this.options.followUpRun) {
        await this.options.sendText(input.target, this.text("Live follow-up is unavailable in current runtime.", "当前运行时不支持实时追加任务。"));
        return true;
      }
      if (!rawArg) {
        await this.options.sendText(input.target, this.text("Usage: /followup <text>", "用法：/followup <文本>"));
        return true;
      }
      const result = this.options.followUpRun(input.scopeId, rawArg);
      await this.options.sendText(
        input.target,
        result.queued
          ? this.text("Queued follow-up after current task.", "已安排在当前任务完成后继续执行。")
          : this.text("Nothing running. Send a normal message instead.", "当前没有运行中的任务，请直接发送普通消息。")
      );
      return true;
    }

    if (cmd === "/queue") {
      const [subcommand = "list", ...rest] = rawArg.split(/\s+/).filter(Boolean);
      const queueArg = rest.join(" ").trim();

      if (!this.options.listQueue) {
        await this.options.sendText(input.target, this.text("Queue management is unavailable in current runtime.", "当前运行时不支持队列管理。"));
        return true;
      }

      if (!rawArg || subcommand === "list") {
        await this.options.sendText(input.target, await this.queueText(input.scopeId));
        return true;
      }

      if (subcommand === "front") {
        if (!this.options.enqueueFront) {
          await this.options.sendText(input.target, "Queue front insertion is unavailable in current runtime.");
          return true;
        }
        if (!queueArg) {
          await this.options.sendText(input.target, this.text("Usage: /queue front <text>", "用法：/queue front <文本>"));
          return true;
        }
        const queueId = await this.options.enqueueFront(input, queueArg);
        await this.options.sendText(
          input.target,
          queueId
            ? this.text(`Inserted at front of queue. Queue ID: ${queueId}`, `已插入队列最前方。队列 ID：${queueId}`)
            : this.text("Failed to insert queued task.", "插入排队任务失败。")
        );
        return true;
      }

      if (subcommand === "delete") {
        if (!this.options.deleteQueued) {
          await this.options.sendText(input.target, this.text("Queue deletion is unavailable in current runtime.", "当前运行时不支持删除排队任务。"));
          return true;
        }
        const id = Number.parseInt(queueArg, 10);
        if (!Number.isFinite(id) || id <= 0) {
          await this.options.sendText(input.target, this.text("Usage: /queue delete <queueId>", "用法：/queue delete <队列ID>"));
          return true;
        }
        const result = await this.options.deleteQueued(input.scopeId, id);
        await this.options.sendText(
          input.target,
          result === "deleted"
            ? this.text(`Deleted queued task ${id}.`, `已删除排队任务 ${id}。`)
            : result === "running"
              ? this.text(`Task ${id} is currently running. Use /stop to stop the current task first.`, `任务 ${id} 正在运行，请先使用 /stop 停止当前任务。`)
              : this.text(`Queue item ${id} was not found.`, `未找到队列任务 ${id}。`)
        );
        return true;
      }

      await this.options.sendText(
        input.target,
        [
          this.text("Queue usage:", "队列命令用法："),
          "/queue",
          "/queue front <text>",
          "/queue delete <queueId>"
        ].join("\n")
      );
      return true;
    }

    if (cmd === "/hosttools" || cmd === "/host-tools") {
      await this.handleHostToolsCommand(input, rawArg);
      return true;
    }

    if (cmd === "/new") {
      if (this.options.isRunning(input.scopeId)) {
        await this.options.sendText(input.target, this.text("Already working. Send /stop first, then /new.", "已有任务正在运行，请先发送 /stop，再发送 /new。"));
        return true;
      }
      const sessionId = this.options.store.createSession(input.scopeId);
      this.options.runners.reset(input.scopeId, sessionId);
      await this.options.sendText(input.target, this.text(`Created and switched to new session: ${sessionId}`, `已创建并切换到新会话：${sessionId}`));
      await this.options.onSessionMutation?.(input.scopeId);
      momLog(this.options.channel, "session_new", {
        chatId: input.chatId,
        scopeId: input.scopeId,
        sessionId,
        instanceId: this.options.instanceId
      });
      return true;
    }

    if (cmd === "/clear") {
      if (this.options.isRunning(input.scopeId)) {
        await this.options.sendText(input.target, this.text("Already working. Send /stop first, then /clear.", "已有任务正在运行，请先发送 /stop，再发送 /clear。"));
        return true;
      }
      const sessionId = this.options.store.getActiveSession(input.scopeId);
      this.options.store.clearSessionContext(input.scopeId, sessionId);
      this.options.runners.reset(input.scopeId, sessionId);
      await this.options.sendText(input.target, this.text(`Cleared context for session: ${sessionId}`, `已清除会话上下文：${sessionId}`));
      await this.options.onSessionMutation?.(input.scopeId);
      momLog(this.options.channel, "session_clear", {
        chatId: input.chatId,
        scopeId: input.scopeId,
        sessionId,
        instanceId: this.options.instanceId
      });
      return true;
    }

    if (cmd === "/sessions") {
      if (this.options.isRunning(input.scopeId)) {
        await this.options.sendText(input.target, this.text("Already working. Send /stop first, then switch sessions.", "已有任务正在运行，请先发送 /stop，再切换会话。"));
        return true;
      }
      if (rawArg) {
        const picked = this.resolveSessionSelection(input.scopeId, rawArg);
        if (!picked) {
          await this.options.sendText(input.target, this.text("Invalid session selector. Use /sessions to list available sessions.", "无效的会话选择器。使用 /sessions 查看可用会话。"));
          return true;
        }
        this.options.store.setActiveSession(input.scopeId, picked);
        await this.options.sendText(input.target, this.text(`Switched to session: ${picked}`, `已切换到会话：${picked}`));
        await this.options.onSessionMutation?.(input.scopeId);
        momLog(this.options.channel, "session_switch", {
          chatId: input.chatId,
          scopeId: input.scopeId,
          sessionId: picked,
          selector: rawArg,
          instanceId: this.options.instanceId
        });
        return true;
      }
      await this.options.sendText(input.target, this.formatSessionsOverview(input.scopeId));
      return true;
    }

    if (cmd === "/delete_sessions") {
      if (this.options.isRunning(input.scopeId)) {
        await this.options.sendText(input.target, this.text("Already working. Send /stop first, then delete sessions.", "已有任务正在运行，请先发送 /stop，再删除会话。"));
        return true;
      }
      if (!rawArg) {
        await this.options.sendText(
          input.target,
          `${this.formatSessionsOverview(input.scopeId)}\n\n${this.text("Delete usage:", "删除用法：")} /delete_sessions <index|sessionId>`
        );
        return true;
      }
      const picked = this.resolveSessionSelection(input.scopeId, rawArg);
      if (!picked) {
        await this.options.sendText(input.target, this.text("Invalid session selector. Use /delete_sessions to list available sessions.", "无效的会话选择器。使用 /delete_sessions 查看可删除会话。"));
        return true;
      }
      try {
        const result = this.options.store.deleteSession(input.scopeId, picked);
        this.options.runners.reset(input.scopeId, result.deleted);
        await this.options.onSessionMutation?.(input.scopeId);
        await this.options.sendText(
          input.target,
          this.text(
            `Deleted session: ${result.deleted}\nCurrent session: ${result.active}\nRemaining: ${result.remaining.length}`,
            `已删除会话：${result.deleted}\n当前会话：${result.active}\n剩余会话：${result.remaining.length}`
          )
        );
        momLog(this.options.channel, "session_deleted", {
          chatId: input.chatId,
          scopeId: input.scopeId,
          deleted: result.deleted,
          active: result.active,
          remaining: result.remaining.length,
          instanceId: this.options.instanceId
        });
      } catch (error) {
        await this.options.sendText(input.target, error instanceof Error ? error.message : String(error));
      }
      return true;
    }

    if (cmd === "/models") {
      if (this.options.isRunning(input.scopeId)) {
        await this.options.sendText(input.target, this.text("Already working. Send /stop first, then switch models.", "已有任务正在运行，请先发送 /stop，再切换模型。"));
        return true;
      }
      if (!rawArg) {
        await this.options.sendText(input.target, this.modelsText("text"));
        return true;
      }
      if (!this.options.updateSettings) {
        await this.options.sendText(input.target, this.text("Model switching is unavailable in current runtime.", "当前运行时不支持模型切换。"));
        return true;
      }
      const [firstArg = "", secondArg = ""] = rawArg
        .split(/\s+/)
        .map((value) => value.trim())
        .filter(Boolean);
      const maybeRoute = parseModelRoute(firstArg);
      const route: ModelRoute = maybeRoute ?? "text";
      const selector = maybeRoute ? secondArg : rawArg;
      const settings = this.options.getSettings();
      const options = buildModelOptions(settings, route);
      if (!selector) {
        await this.options.sendText(input.target, this.modelsText(route));
        return true;
      }
      const selected = resolveModelSelection(selector, options);
      if (!selected) {
        await this.options.sendText(input.target, `${this.text("Invalid model selector:", "无效的模型选择器：")} ${selector}\n\n${this.modelsText(route)}`);
        return true;
      }
      const switched = switchModelSelection({
        settings,
        route,
        selector,
        updateSettings: this.options.updateSettings
      });
      if (!switched) {
        await this.options.sendText(input.target, `${this.text("Invalid model selector:", "无效的模型选择器：")} ${selector}\n\n${this.modelsText(route)}`);
        return true;
      }
      await this.options.sendText(
        input.target,
        [
          this.text(`Switched ${route} model to: ${switched.selected.label}`, `已将 ${route} 模型切换为：${switched.selected.label}`),
          this.text("Runtime will auto-use built-in or custom transport based on the selected model.", "运行时会根据所选模型自动使用内置或自定义传输。"),
          this.text(`Use /models ${route} to check current active ${route} model.`, `使用 /models ${route} 查看当前启用的 ${route} 模型。`)
        ].join("\n")
      );
      momLog(this.options.channel, "model_switched_via_command", {
        chatId: input.chatId,
        scopeId: input.scopeId,
        route,
        selector,
        selectedKey: switched.selected.key,
        providerMode: switched.settings.providerMode,
        instanceId: this.options.instanceId
      });
      return true;
    }

    if (cmd === "/compact") {
      if (this.options.isRunning(input.scopeId)) {
        await this.options.sendText(input.target, this.text("Already working. Send /stop first, then /compact.", "已有任务正在运行，请先发送 /stop，再发送 /compact。"));
        return true;
      }
      const sessionId = this.options.store.getActiveSession(input.scopeId);
      try {
        const result = await this.options.runners.compact(input.scopeId, sessionId, {
          reason: "manual",
          customInstructions: rawArg || undefined
        });
        await this.options.sendText(
          input.target,
          result.changed
            ? [
                this.text("Conversation context compacted.", "会话上下文已压缩。"),
                `before≈${result.beforeTokens} tokens`,
                `after≈${result.afterTokens} tokens`,
                `summarized_messages=${result.summarizedMessages}`,
                `kept_messages=${result.keptMessages}`
              ].join("\n")
            : this.text("Nothing to compact yet.", "当前没有需要压缩的内容。")
        );
      } catch (error) {
        await this.options.sendText(input.target, error instanceof Error ? error.message : String(error));
      }
      return true;
    }

    if (cmd === "/login") {
      const [provider = "", ...rest] = rawArg.split(/\s+/).filter(Boolean);
      const codeOrUrl = rest.join(" ").trim();
      const scopeKey = this.options.getAuthScopeKey?.(input) ?? `${this.options.authScopePrefix}:${input.scopeId}`;
      if (!provider) {
        await this.options.sendText(
          input.target,
          [
            this.text(`Auth file: ${resolveAuthFilePath()}`, `认证文件：${resolveAuthFilePath()}`),
            this.text(`OAuth providers: ${listOAuthProviderIds().join(", ")}`, `OAuth 提供方：${listOAuthProviderIds().join(", ")}`),
            this.text("Usage:", "用法："),
            "/login <provider>",
            "/login <provider> <code-or-redirect-url>"
          ].join("\n")
        );
        return true;
      }

      try {
        if (codeOrUrl) {
          await submitOAuthLoginCode(scopeKey, provider, codeOrUrl);
          await this.options.sendText(
            input.target,
            this.text(`Login completed for '${provider}'. Credentials stored in ${resolveAuthFilePath()}.`, `'${provider}' 登录完成。认证信息已保存到 ${resolveAuthFilePath()}。`)
          );
          return true;
        }

        const pending = await startOAuthLogin(scopeKey, provider, {});
        const lines = [
          this.text(`Login started for '${provider}'.`, `'${provider}' 登录已开始。`),
          this.text(`Auth file: ${resolveAuthFilePath()}`, `认证文件：${resolveAuthFilePath()}`)
        ];
        if (pending.authUrl) lines.push(this.text(`Open: ${pending.authUrl}`, `打开：${pending.authUrl}`));
        if (pending.instructions) lines.push(pending.instructions);
        if (pending.promptMessage) lines.push(pending.promptMessage);
        lines.push(this.text(`Finish with: /login ${provider} <code-or-redirect-url>`, `完成登录：/login ${provider} <code-or-redirect-url>`));
        await this.options.sendText(input.target, lines.join("\n"));
      } catch (error) {
        await this.options.sendText(input.target, error instanceof Error ? error.message : String(error));
      }
      return true;
    }

    if (cmd === "/logout") {
      const provider = rawArg.split(/\s+/)[0] || "";
      if (!provider) {
        await this.options.sendText(input.target, this.text("Usage: /logout <provider>", "用法：/logout <provider>"));
        return true;
      }
      const removed = removeStoredAuth(provider);
      await this.options.sendText(
        input.target,
        removed
          ? this.text(`Removed stored auth for '${provider}'.`, `已删除 '${provider}' 的认证信息。`)
          : this.text(`No stored auth found for '${provider}'.`, `未找到 '${provider}' 的已保存认证信息。`)
      );
      return true;
    }

    if (cmd === "/skills") {
      await this.options.sendText(input.target, this.skillsText(input.scopeId, rawArg, false));
      return true;
    }

    if (cmd === "/skills-detail") {
      await this.options.sendText(input.target, this.skillsText(input.scopeId, rawArg, true));
      return true;
    }

    if (cmd === "/status" || cmd === "/state") {
      await this.options.sendText(input.target, this.statusText(input.scopeId, input.target));
      return true;
    }

    if (cmd === "/runlog") {
      const selector = rawArg.split(/\s+/)[0]?.trim() || "latest";
      const latestSummary = selector === "latest"
        ? this.options.store.readLatestRunSummary(input.scopeId)
        : null;
      const runId = selector === "latest"
        ? String(latestSummary?.runId ?? "").trim()
        : selector;
      if (!runId) {
        await this.options.sendText(input.target, this.text("No archived run log found yet.", "尚未找到归档运行记录。"));
        return true;
      }
      const rendered = formatRunLogText(runId, this.options.store.readRunDetail(input.scopeId, runId));
      if (this.options.uploadFile) {
        const dir = join(this.options.store.getScratchDir(input.scopeId), "runlogs");
        mkdirSync(dir, { recursive: true });
        const safeRunId = runId.replace(/[^a-zA-Z0-9._-]/g, "_") || "runlog";
        const filePath = join(dir, `${safeRunId}.txt`);
        writeFileSync(filePath, `${rendered}\n`, "utf8");
        await this.options.uploadFile(
          input.target,
          filePath,
          `${safeRunId}.txt`,
          `运行记录已导出：${runId}`
        );
      } else {
        await this.options.sendText(input.target, rendered);
      }
      return true;
    }

    if (cmd === "/thinking") {
      const sessionId = this.options.store.getActiveSession(input.scopeId);
      const normalized = rawArg.split(/\s+/)[0]?.trim().toLowerCase() ?? "";

      if (!normalized) {
        await this.options.sendText(input.target, this.thinkingText(input.scopeId));
        return true;
      }

      let nextOverride: RuntimeThinkingLevel | null;
      if (normalized === "default" || normalized === "reset" || normalized === "global") {
        nextOverride = null;
      } else if (this.thinkingLevels.has(normalized)) {
        nextOverride = normalized as RuntimeThinkingLevel;
      } else {
        await this.options.sendText(input.target, `${this.text("Invalid thinking level:", "无效的思考级别：")} ${normalized}\n\n${this.thinkingText(input.scopeId)}`);
        return true;
      }

      const applied = this.options.store.setSessionThinkingLevelOverride(input.scopeId, sessionId, nextOverride);
      const lines = [
        applied == null
          ? this.text("Session thinking reset to global default.", "当前会话思考级别已恢复为全局默认值。")
          : this.text(`Session thinking set to: ${applied}`, `当前会话思考级别已设置为：${applied}`),
        this.text(`Session: ${sessionId}`, `会话：${sessionId}`),
        ...this.buildSessionThinkingSummary(input.scopeId, sessionId)
      ];
      if (this.options.isRunning(input.scopeId)) {
        lines.push("");
        lines.push(this.text("Note: this change applies to the next request, not the one already running.", "注意：此更改从下一次请求开始生效，不影响当前正在运行的请求。"));
      }
      await this.options.sendText(input.target, lines.join("\n"));
      momLog(this.options.channel, "session_thinking_override_updated", {
        chatId: input.chatId,
        scopeId: input.scopeId,
        sessionId,
        thinkingLevelOverride: applied,
        instanceId: this.options.instanceId
      });
      return true;
    }

    if (cmd === "/sandbox") {
      const sessionId = this.options.store.getActiveSession(input.scopeId);
      const args = rawArg.split(/\s+/).filter(Boolean);

      if (args.length === 0) {
        await this.options.sendText(input.target, this.formatSandboxStatus(input.scopeId, sessionId));
        return true;
      }

      const scope = args[0]?.toLowerCase();

      // Session override only requires store access, not updateSettings
      if (scope !== "bot" && scope !== "agent") {
        const action = scope;
        let nextValue: boolean | null;
        if (action === "on") nextValue = true;
        else if (action === "off") nextValue = false;
        else if (action === "reset") nextValue = null;
        else {
          await this.options.sendText(input.target, "Usage:\n- /sandbox [on|off|reset]\n- /sandbox bot [on|off|reset]\n- /sandbox agent [on|off|reset]");
          return true;
        }

        this.options.store.setSessionSandboxOverride(input.scopeId, sessionId, nextValue);
        await this.options.sendText(
          input.target,
          `Session '${sessionId}' sandbox override set to: ${nextValue === null ? "Inherit" : nextValue ? "ON" : "OFF"}\n\n` +
          this.formatSandboxStatus(input.scopeId, sessionId)
        );
        return true;
      }

      // Bot and agent overrides require settings write access
      if (!this.options.updateSettings) {
        await this.options.sendText(input.target, this.text("Settings updates are unavailable in current runtime.", "当前运行时不支持更新设置。"));
        return true;
      }

      if (scope === "bot") {
        const action = args[1]?.toLowerCase();
        const settings = this.options.getSettings();
        const channel = this.options.channel;
        const instanceId = this.options.instanceId;
        const channelSettings = settings.channels[channel];
        if (!channelSettings) {
          await this.options.sendText(input.target, this.text(`Channel '${channel}' settings not found.`, `未找到渠道 '${channel}' 的设置。`));
          return true;
        }

        let nextValue: boolean | undefined;
        if (action === "on") nextValue = true;
        else if (action === "off") nextValue = false;
        else if (action === "reset") nextValue = undefined;
        else {
          await this.options.sendText(input.target, "Usage: /sandbox bot [on|off|reset]");
          return true;
        }

        const instances = channelSettings.instances.map((inst) => {
          if (inst.id === instanceId) {
            return { ...inst, sandboxEnabled: nextValue };
          }
          return inst;
        });
        
        this.options.updateSettings({
          channels: {
            ...settings.channels,
            [channel]: { ...channelSettings, instances }
          }
        });

        await this.options.sendText(
          input.target,
          `Bot '${instanceId}' sandbox override set to: ${nextValue === undefined ? "Inherit" : nextValue ? "ON" : "OFF"}\n\n` +
          this.formatSandboxStatus(input.scopeId, sessionId)
        );
        return true;
      }

      if (scope === "agent") {
        const action = args[1]?.toLowerCase();
        const settings = this.options.getSettings();
        const channel = this.options.channel;
        const instanceId = this.options.instanceId;
        const instance = settings.channels[channel]?.instances.find((inst) => inst.id === instanceId);
        const agentId = instance?.agentId;
        if (!agentId) {
          await this.options.sendText(input.target, this.text("No default agent linked to this bot instance.", "当前机器人没有绑定默认 Agent。"));
          return true;
        }

        let nextValue: boolean | undefined;
        if (action === "on") nextValue = true;
        else if (action === "off") nextValue = false;
        else if (action === "reset") nextValue = undefined;
        else {
          await this.options.sendText(input.target, "Usage: /sandbox agent [on|off|reset]");
          return true;
        }

        const agents = settings.agents.map((ag) => {
          if (ag.id === agentId) {
            return { ...ag, sandboxEnabled: nextValue };
          }
          return ag;
        });

        this.options.updateSettings({ agents });

        await this.options.sendText(
          input.target,
          `Agent '${agentId}' sandbox override set to: ${nextValue === undefined ? "Inherit" : nextValue ? "ON" : "OFF"}\n\n` +
          this.formatSandboxStatus(input.scopeId, sessionId)
        );
        return true;
      }

      // Default to session override
      const action = scope;
      let nextValue: boolean | null;
      if (action === "on") nextValue = true;
      else if (action === "off") nextValue = false;
      else if (action === "reset") nextValue = null;
      else {
        await this.options.sendText(input.target, "Usage:\n- /sandbox [on|off|reset]\n- /sandbox bot [on|off|reset]\n- /sandbox agent [on|off|reset]");
        return true;
      }

      this.options.store.setSessionSandboxOverride(input.scopeId, sessionId, nextValue);
      await this.options.sendText(
        input.target,
        `Session '${sessionId}' sandbox override set to: ${nextValue === null ? "Inherit" : nextValue ? "ON" : "OFF"}\n\n` +
        this.formatSandboxStatus(input.scopeId, sessionId)
      );
      return true;
    }

    if (cmd === "/toolprogress" || cmd === "/tool-progress") {
      const settings = this.options.getSettings();
      const channel = this.options.channel;
      const instanceId = this.options.instanceId;
      const channelSettings = settings.channels[channel];
      const instance = channelSettings?.instances.find((inst) => inst.id === instanceId);

      const normalized = rawArg.split(/\s+/)[0]?.trim().toLowerCase() ?? "";

      if (!normalized) {
        const globalVal = settings.display?.toolProgress ?? "all";
        const botVal = instance?.display?.toolProgress ?? "inherit";
        const effectiveVal = instance?.display?.toolProgress ?? globalVal;
        await this.options.sendText(
          input.target,
          this.text(`Tool progress display config for Bot '${instanceId}':`, `机器人 '${instanceId}' 的工具进度显示配置：`) + "\n" +
          `${this.text("- Global:", "- 全局：")} ${globalVal}\n` +
          `${this.text("- Bot:", "- 机器人：")} ${botVal}\n` +
          `${this.text("- Effective:", "- 实际生效：")} ${effectiveVal}\n\n` +
          `${this.text("To change, use:", "修改方式：")}\n` +
          `- /toolprogress [off|new|all|verbose|reset]`
        );
        return true;
      }

      if (!this.options.updateSettings) {
        await this.options.sendText(input.target, this.text("Settings updates are unavailable in current runtime.", "当前运行时不支持更新设置。"));
        return true;
      }

      let nextValue: "off" | "new" | "all" | "verbose" | undefined;
      if (normalized === "off") nextValue = "off";
      else if (normalized === "new") nextValue = "new";
      else if (normalized === "all") nextValue = "all";
      else if (normalized === "verbose") nextValue = "verbose";
      else if (normalized === "reset" || normalized === "inherit") nextValue = undefined;
      else {
        await this.options.sendText(input.target, "Usage: /toolprogress [off|new|all|verbose|reset]");
        return true;
      }

      const instances = (channelSettings?.instances ?? []).map((inst) => {
        if (inst.id === instanceId) {
          return {
            ...inst,
            display: {
              ...(inst.display ?? {}),
              toolProgress: nextValue
            }
          };
        }
        return inst;
      });

      this.options.updateSettings({
        channels: {
          ...settings.channels,
          [channel]: { ...channelSettings, instances }
        }
      });

      const effectiveVal = nextValue ?? settings.display?.toolProgress ?? "all";
      await this.options.sendText(
        input.target,
        this.text(`Bot '${instanceId}' tool progress display set to:`, `机器人 '${instanceId}' 的工具进度显示已设置为：`) +
        ` ${nextValue === undefined ? this.text("Inherit", "继承") : nextValue}\n` +
        `${this.text("Effective value:", "实际生效值：")} ${effectiveVal}`
      );

      return true;
    }

    if (cmd === "/showreasoning" || cmd === "/show-reasoning") {
      const settings = this.options.getSettings();
      const channel = this.options.channel;
      const instanceId = this.options.instanceId;
      const channelSettings = settings.channels[channel];
      const instance = channelSettings?.instances.find((inst) => inst.id === instanceId);

      const normalized = rawArg.split(/\s+/)[0]?.trim().toLowerCase() ?? "";

      if (!normalized) {
        const globalVal = settings.display?.showReasoning ?? "off";
        const botVal = instance?.display?.showReasoning ?? "inherit";
        const effectiveVal = instance?.display?.showReasoning ?? globalVal;
        await this.options.sendText(
          input.target,
          this.text(`Show reasoning config for Bot '${instanceId}':`, `机器人 '${instanceId}' 的思考过程显示配置：`) + "\n" +
          `${this.text("- Global:", "- 全局：")} ${globalVal}\n` +
          `${this.text("- Bot:", "- 机器人：")} ${botVal}\n` +
          `${this.text("- Effective:", "- 实际生效：")} ${effectiveVal}\n\n` +
          `${this.text("To change, use:", "修改方式：")}\n` +
          `- /showreasoning [off|on|stream|new|reset]`
        );
        return true;
      }

      if (!this.options.updateSettings) {
        await this.options.sendText(input.target, this.text("Settings updates are unavailable in current runtime.", "当前运行时不支持更新设置。"));
        return true;
      }

      let nextValue: "off" | "on" | "stream" | "new" | undefined;
      if (normalized === "off") nextValue = "off";
      else if (normalized === "on") nextValue = "on";
      else if (normalized === "stream") nextValue = "stream";
      else if (normalized === "new") nextValue = "new";
      else if (normalized === "reset" || normalized === "inherit") nextValue = undefined;
      else {
        await this.options.sendText(input.target, "Usage: /showreasoning [off|on|stream|new|reset]");
        return true;
      }

      const instances = (channelSettings?.instances ?? []).map((inst) => {
        if (inst.id === instanceId) {
          return {
            ...inst,
            display: {
              ...(inst.display ?? {}),
              showReasoning: nextValue
            }
          };
        }
        return inst;
      });

      this.options.updateSettings({
        channels: {
          ...settings.channels,
          [channel]: { ...channelSettings, instances }
        }
      });

      const effectiveVal = nextValue ?? settings.display?.showReasoning ?? "off";
      await this.options.sendText(
        input.target,
        this.text(`Bot '${instanceId}' show reasoning set to:`, `机器人 '${instanceId}' 的思考过程显示已设置为：`) +
        ` ${nextValue === undefined ? this.text("Inherit", "继承") : nextValue}\n` +
        `${this.text("Effective value:", "实际生效值：")} ${effectiveVal}`
      );

      return true;
    }

    if (cmd === "/help" || cmd === "/start") {
      await this.options.sendText(input.target, this.helpText());
      return true;
    }

    return false;
  }

  private isApprovalText(text: string): boolean {
    return /^(安装|批准|同意|确认|允许|通过|审批通过|批准通过|同意审批|审批同意|approve|approved|yes|y)$/i.test(text.trim());
  }

  private isOnceApprovalText(text: string): boolean {
    return /^(仅此一次|只此一次|仅本次|只本次|仅一次|just once|once|approve once)$/i.test(text.trim());
  }

  private isPersistentApprovalText(text: string): boolean {
    return /^(永久允许|永久批准|长期允许|始终允许|总是允许|一直允许|always|always allow|approve always)$/i.test(text.trim());
  }

  private isSessionApprovalText(text: string): boolean {
    return /^(本session允许|本轮session允许|本轮允许|允许本轮|允许会话|本会话允许|允许本会话|本会话通过|本轮通过|本次通过|本次审批通过|session允许|session批准|session通过|approve session|session approve)$/i.test(text.trim());
  }

  private isRejectText(text: string): boolean {
    return /^(拒绝|取消|不批准|审批拒绝|拒绝审批|deny|reject|no|n)$/i.test(text.trim());
  }

  private async tryHandleHostToolApproval(input: SharedRuntimeCommandContext<TTarget>, text: string): Promise<boolean> {
    const sessionId = this.options.store.getActiveSession(input.scopeId);
    const pending = this.hostBashStore.listPending(input.scopeId, sessionId);
    const isApprovalReply = this.isApprovalText(text)
      || this.isRejectText(text)
      || this.isSessionApprovalText(text)
      || this.isOnceApprovalText(text)
      || this.isPersistentApprovalText(text);
    if (!isApprovalReply) return false;
    if (pending.length === 0) {
      // No Host Bash record, but a high-risk tool may still be waiting on the
      // ApprovalBroker poll; resolve those so the run does not time out.
      const brokerPending = getApprovalBroker().listPendingRequests()
        .filter((request) => request.runId === input.scopeId);
      if (brokerPending.length === 0) return false;
      if (this.isRejectText(text)) {
        this.resolvePendingBrokerRequests(input.scopeId, "rejected", "once");
        await this.options.sendText(input.target, this.text("Rejected pending tool approval.", "已拒绝待处理的工具审批。"));
      } else {
        const scope = this.isSessionApprovalText(text)
          ? "session" as const
          : this.isPersistentApprovalText(text) ? "persistent" as const : "once" as const;
        this.resolvePendingBrokerRequests(input.scopeId, "approved", scope);
        await this.options.sendText(input.target, this.text("Approved. The waiting tool call will continue automatically.", "已批准。等待中的工具调用会自动继续执行。"));
      }
      return true;
    }

    if (pending.length > 1) {
      await this.options.sendText(
        input.target,
        [
          "There are multiple pending Host Bash approvals. Use one of:",
          ...pending.flatMap((item) => [
            `/hosttools approve ${item.id} - ${item.displayName}`,
            `/hosttools reject ${item.id} - ${item.displayName}`
          ])
        ].join("\n")
      );
      return true;
    }

    const request = pending[0];
    if (this.isRejectText(text)) {
      const rejected = await this.rejectHostTool(input, request.id);
      await this.options.sendText(input.target, rejected.message);
      return true;
    }

    if (this.isSessionApprovalText(text)) {
      const approved = await this.approveHostToolForSession(input, request.id);
      await this.options.sendText(input.target, approved.message);
      return true;
    }

    if (this.isPersistentApprovalText(text)) {
      const approved = await this.approveHostTool(input, request.id, "persistent");
      await this.options.sendText(input.target, approved.message);
      return true;
    }

    // Plain "批准"/"approve" and "仅此一次" both execute once without persisting,
    // so the default reply is least-privilege; persistence requires "永久允许".
    const approved = await this.approveHostTool(input, request.id, "once");
    await this.options.sendText(input.target, approved.message);
    return true;
  }

  private async handleHostToolsCommand(input: SharedRuntimeCommandContext<TTarget>, rawArg: string): Promise<void> {
    const [subcommand = "list", approvalId = ""] = rawArg.split(/\s+/).filter(Boolean);
    if (subcommand === "list") {
      const sessionId = this.options.store.getActiveSession(input.scopeId);
      const pending = this.hostBashStore.listPending(input.scopeId, sessionId);
      const approved = this.hostBashStore.listWhitelist().filter((item) => item.enabled);
      await this.options.sendText(
        input.target,
        [
          this.text(`Pending Host Bash approvals: ${pending.length}`, `待处理 Host Bash 审批：${pending.length}`),
          ...pending.map((item) => `- ${item.id}: ${item.displayName} (${item.command})`),
          "",
          this.text(`Host Bash whitelist entries: ${approved.length}`, `Host Bash 白名单项：${approved.length}`),
          ...approved.map((item) => `- ${item.toolId}: ${item.displayName} (${item.command})`)
        ].join("\n").trim()
      );
      return;
    }
    if (subcommand === "approve") {
      const approved = await this.approveHostTool(input, approvalId || undefined, "persistent");
      await this.options.sendText(input.target, approved.message);
      return;
    }
    if (subcommand === "approve-once") {
      const approved = await this.approveHostTool(input, approvalId || undefined, "once");
      await this.options.sendText(input.target, approved.message);
      return;
    }
    if (subcommand === "approve-session") {
      const approved = await this.approveHostToolForSession(input, approvalId || undefined);
      await this.options.sendText(input.target, approved.message);
      return;
    }
    if (subcommand === "reject") {
      const rejected = await this.rejectHostTool(input, approvalId || undefined);
      await this.options.sendText(input.target, rejected.message);
      return;
    }
    await this.options.sendText(
      input.target,
      [
        this.text("Host Bash usage:", "Host Bash 用法："),
        "/hosttools",
        "/hosttools approve <approvalId>",
        "/hosttools approve-once <approvalId>",
        "/hosttools approve-session <approvalId>",
        "/hosttools reject <approvalId>",
        this.text(
          "Or reply `批准`/`仅此一次` (run once), `永久允许` (whitelist the tool), when exactly one approval is pending in this chat.",
          "当当前会话只有一条待审批请求时，也可以回复 `批准`/`仅此一次`（仅执行一次）或 `永久允许`（加入白名单）。"
        ),
        this.text(
          "Reply `本会话允许`, `本session允许`, or `approve session` to allow only the current session.",
          "回复 `本会话允许`、`本session允许` 或 `approve session` 可仅允许当前会话。"
        )
      ].join("\n")
    );
  }

  private resolveSessionSelection(scopeId: string, selector: string): string | null {
    const sessions = this.options.store.listSessions(scopeId);
    const raw = selector.trim();
    if (!raw) return null;

    const asIndex = Number.parseInt(raw, 10);
    if (Number.isFinite(asIndex) && asIndex >= 1 && asIndex <= sessions.length) {
      return sessions[asIndex - 1] ?? null;
    }

    return sessions.includes(raw) ? raw : null;
  }

  private formatSessionsOverview(scopeId: string): string {
    const sessions = this.options.store.listSessions(scopeId);
    const active = this.options.store.getActiveSession(scopeId);
    const lines = [
      this.text(`Current session: ${active}`, `当前会话：${active}`),
      this.text(`Total sessions: ${sessions.length}`, `会话总数：${sessions.length}`),
      "",
      this.text("Sessions:", "会话列表：")
    ];
    for (let i = 0; i < sessions.length; i += 1) {
      const id = sessions[i];
      lines.push(`${i + 1}. ${id}${id === active ? this.text(" (current)", "（当前）") : ""}`);
    }
    lines.push("");
    lines.push(this.text("Switch: /sessions <index|sessionId>", "切换：/sessions <编号|sessionId>"));
    lines.push(this.text("Delete: /delete_sessions <index|sessionId>", "删除：/delete_sessions <编号|sessionId>"));
    return lines.join("\n");
  }

  private modelsText(route: ModelRoute): string {
    const settings = this.options.getSettings();
    const options = buildModelOptions(settings, route);
    const activeKey = currentModelKey(settings, route);
    const title = this.isChinese
      ? (route === "text" ? "当前模型列表" : `当前 ${route} 模型列表`)
      : (route === "text" ? "Current models" : `Current ${route} models`);
    const lines = [
      this.isChinese ? `${title}（共${options.length}个）：` : `${title} (${options.length} total):`,
      ""
    ];

    if (options.length === 0) {
      lines.push(this.text("(no configured models)", "（没有已配置的模型）"));
    } else {
      lines.push(this.text("| Number | Provider | Model |", "| 编号 | 供应商 | 模型 |"));
      lines.push("|------|--------|------|");
      for (let i = 0; i < options.length; i += 1) {
        const option = options[i];
        const row = this.modelTableDisplayRow(option.label, i + 1, option.key === activeKey);
        lines.push(`| ${row.indexLabel} | ${row.provider} | ${row.model} |`);
      }
    }

    lines.push("");
    lines.push(this.text(`Switch ${route} model:`, `切换 ${route} 模型：`));
    lines.push(this.text(`/models ${route} <number>`, `/models ${route} <编号>`));
    lines.push(`/models ${route} <key>`);
    if (route === "text") {
      lines.push("");
      lines.push(this.text("Quick switch:", "快捷切换："));
      lines.push(this.text("/models <number>", "/models <编号>"));
      lines.push("/models <key>");
    }
    return lines.join("\n");
  }

  private modelTableDisplayRow(label: string, index: number, isActive: boolean): ModelTableDisplayRow {
    const normalized = label
      .replace(/^\[PI\]\s*/, "[Built-in] ")
      .replace(/^\[Custom\]\s*/, "");
    const delimiter = " / ";
    const splitAt = normalized.indexOf(delimiter);
    const provider = splitAt >= 0 ? normalized.slice(0, splitAt).trim() : normalized.trim();
    const model = splitAt >= 0 ? normalized.slice(splitAt + delimiter.length).trim() : "";

    return {
      indexLabel: isActive ? this.text(`${index} ⭐ active`, `${index} ⭐ 当前活跃中`) : String(index),
      provider,
      model
    };
  }

  private skillsText(scopeId: string, rawArg = "", detailMode = false): string {
    const locale = commandLocaleFromSettings(this.options.getSettings());
    const { skills, diagnostics } = loadSkillsFromWorkspace(this.options.workspaceDir, scopeId, {
      disabledSkillPaths: this.options.getSettings().disabledSkillPaths
    });
    const globalSkillsDir = resolveGlobalSkillsDirFromWorkspacePath(this.options.workspaceDir);
    const botSkillsDir = `${this.options.workspaceDir}/skills`;
    const chatSkillsDir = `${this.options.workspaceDir}/${scopeId}/skills`;
    const footerLines = [
      `Workspace: ${this.options.workspaceDir}`,
      `Global skills dir: ${globalSkillsDir}`,
      `Bot skills dir: ${botSkillsDir}`,
      `Chat skills dir: ${chatSkillsDir}`
    ];
    const selector = rawArg.trim();
    if (selector) {
      const skill = findSkillBySelector(skills, selector);
      if (!skill) {
        return [
          `Skill not found: ${selector}`,
          "",
          formatSkillsSummaryText(skills, diagnostics, {
            emptyText: "(no skills loaded)",
            footerLines: [
              ...footerLines,
              "Usage: /skills",
              "Usage: /skills <id>",
              "Usage: /skills-detail"
            ]
          })
        ].join("\n");
      }
      return formatSkillDetailText(skill, locale);
    }

    if (detailMode) {
      return formatSkillsDetailText(skills, diagnostics, {
        emptyText: "(no skills loaded)",
        footerLines,
        locale
      });
    }

    return formatSkillsSummaryText(skills, diagnostics, {
      emptyText: "(no skills loaded)",
      footerLines: [
        ...footerLines,
        this.text("Use /skills <id> for details.", "使用 /skills <id> 查看详情。"),
        this.text("Use /skills-detail for the full list.", "使用 /skills-detail 查看完整列表。")
      ],
      locale
    });
  }

  private parseConfiguredModelKey(key: string): { mode: "pi" | "custom"; provider: string; model: string } | null {
    const raw = key.trim();
    if (!raw) return null;
    const [mode, provider, ...rest] = raw.split("|");
    if ((mode !== "pi" && mode !== "custom") || !provider || rest.length === 0) return null;
    const model = rest.join("|").trim();
    if (!model) return null;
    return { mode, provider: provider.trim(), model };
  }

  private resolveTextRouteThinkingSupport(settings: RuntimeSettings): boolean {
    const parsed = this.parseConfiguredModelKey(currentModelKey(settings, "text"));
    if (!parsed) return false;

    if (parsed.mode === "custom") {
      return settings.customProviders.find((provider) => provider.id === parsed.provider)?.supportsThinking === true;
    }

    try {
      const model = getModels(parsed.provider as any).find((row) => row.id === parsed.model);
      return Boolean(model?.reasoning);
    } catch {
      return false;
    }
  }

  private buildSessionThinkingSummary(scopeId: string, sessionId?: string): string[] {
    const settings = this.options.getSettings();
    const activeSessionId = sessionId ?? this.options.store.getActiveSession(scopeId);
    const sessionOverride = this.options.store.getSessionThinkingLevelOverride(scopeId, activeSessionId);
    const requested = sessionOverride ?? settings.defaultThinkingLevel;
    const reasoningSupported = this.resolveTextRouteThinkingSupport(settings);
    const effective = resolveThinkingLevel({ defaultThinkingLevel: requested }, reasoningSupported);

    return [
      this.text(`Global default: ${settings.defaultThinkingLevel}`, `全局默认：${settings.defaultThinkingLevel}`),
      this.text(`Session override: ${sessionOverride ?? "default"}`, `会话覆盖：${sessionOverride ?? "default"}`),
      this.text(`Next request target: ${requested}`, `下次请求目标：${requested}`),
      this.text(`Current text model supports thinking: ${reasoningSupported ? "yes" : "no"}`, `当前文本模型支持思考：${reasoningSupported ? "是" : "否"}`),
      this.text(`Effective next request: ${effective}`, `下次请求实际级别：${effective}`)
    ];
  }

  private thinkingText(scopeId: string): string {
    const sessionId = this.options.store.getActiveSession(scopeId);
    return [
      this.text(`Session: ${sessionId}`, `会话：${sessionId}`),
      ...this.buildSessionThinkingSummary(scopeId, sessionId),
      "",
      this.text("Set for current session:", "为当前会话设置："),
      "/thinking off",
      "/thinking low",
      "/thinking medium",
      "/thinking high",
      "",
      this.text("Reset to global default:", "恢复全局默认值："),
      "/thinking default"
    ].join("\n");
  }

  private resolveRouteSummary(settings: RuntimeSettings, route: ModelRoute): { label: string; key: string } {
    const key = currentModelKey(settings, route);
    const option = buildModelOptions(settings, route).find((row) => row.key === key);
    return {
      key,
      label: option?.label ?? "(not found in current options)"
    };
  }

  private formatNumber(value: number): string {
    return Math.max(0, Number(value) || 0).toLocaleString();
  }

  private shouldUseMarkdownTable(command: FixedCommandName): boolean {
    return (
      FIXED_COMMAND_RENDER_MODE[command] === "two_column_markdown_table" &&
      TWO_COLUMN_TABLE_CHANNELS.has(this.options.channel)
    );
  }

  private escapeMarkdownTableCell(value: string): string {
    return String(value ?? "")
      .replace(/\|/g, "\\|")
      .replace(/\r?\n/g, "<br>");
  }

  private renderTwoColumnSectionsAsMarkdown(sections: CommandTableSection[]): string {
    return sections
      .filter((section) => section.rows.length > 0)
      .map((section) => {
        const lines: string[] = [];
        if (section.title) lines.push(`**${section.title}**`);
        lines.push(this.text("| Item | Value |", "| 项目 | 值 |"));
        lines.push("| --- | --- |");
        for (const row of section.rows) {
          lines.push(`| ${this.escapeMarkdownTableCell(row.label)} | ${this.escapeMarkdownTableCell(row.value)} |`);
        }
        return lines.join("\n");
      })
      .join("\n\n");
  }

  private statusText(scopeId: string, target: TTarget): string {
    const settings = this.options.getSettings();
    const sessionId = this.options.store.getActiveSession(scopeId);
    const sessionStatus = this.options.store.getSessionStatusSnapshot(scopeId, sessionId);
    const textRoute = this.resolveRouteSummary(settings, "text");
    const visionRoute = this.resolveRouteSummary(settings, "vision");
    const sttRoute = this.resolveRouteSummary(settings, "stt");
    const ttsRoute = this.resolveRouteSummary(settings, "tts");
    const { skills } = loadSkillsFromWorkspace(this.options.workspaceDir, scopeId, {
      disabledSkillPaths: settings.disabledSkillPaths
    });

    const overviewRows: CommandTableRow[] = [
      { label: this.text("Bot", "机器人"), value: this.options.instanceId },
      { label: this.text("Scope", "作用域"), value: scopeId },
      { label: this.text("Session", "会话"), value: sessionId },
      { label: this.text("Status", "状态"), value: this.options.isRunning(scopeId) ? this.text("running", "运行中") : this.text("idle", "空闲") },
      ...(this.options.getQueueSize ? [{ label: this.text("Queued jobs", "排队任务"), value: String(this.options.getQueueSize(scopeId)) }] : []),
      { label: this.text("Session messages", "会话消息数"), value: this.formatNumber(sessionStatus.messageCount) },
      { label: this.text("Current context≈", "当前上下文≈"), value: `${this.formatNumber(sessionStatus.estimatedContextTokens)} tokens` },
      { label: this.text("Session runs", "会话运行次数"), value: this.formatNumber(sessionStatus.usage.runCount) },
      { label: this.text("Session token total", "会话 Token 总量"), value: this.formatNumber(sessionStatus.usage.totalTokens) },
      {
        label: this.text("Session input/output", "会话输入/输出"),
        value: `${this.formatNumber(sessionStatus.usage.inputTokens)} / ${this.formatNumber(sessionStatus.usage.outputTokens)}`
      },
      ...(
        sessionStatus.usage.cacheReadTokens > 0 || sessionStatus.usage.cacheWriteTokens > 0
          ? [{
              label: this.text("Session cache read/write", "会话缓存读取/写入"),
              value: `${this.formatNumber(sessionStatus.usage.cacheReadTokens)} / ${this.formatNumber(sessionStatus.usage.cacheWriteTokens)}`
            }]
          : []
      ),
      { label: this.text("Compactions", "压缩次数"), value: this.formatNumber(sessionStatus.compactionCount) },
      ...(
        sessionStatus.latestCompaction
          ? [{
              label: this.text("Last compaction", "最近一次压缩"),
              value: `${sessionStatus.latestCompaction.reason} (${this.formatNumber(sessionStatus.latestCompaction.tokensBefore)} -> ${this.formatNumber(sessionStatus.latestCompaction.tokensAfter)} tokens, ${this.formatNumber(sessionStatus.latestCompaction.summarizedMessages)} messages)`
            }]
          : []
      ),
      { label: this.text("Provider mode", "提供方模式"), value: settings.providerMode },
      { label: this.text("Loaded skills", "已加载技能"), value: String(skills.length) },
      ...(this.options.getStatusExtras?.(scopeId, target) ?? []).map((line) => {
        const separator = line.indexOf(":");
        if (separator < 0) return { label: this.text("Extra", "附加信息"), value: line };
        return {
          label: line.slice(0, separator).trim(),
          value: line.slice(separator + 1).trim()
        };
      })
    ];
    const thinkingRows = this.buildSessionThinkingSummary(scopeId, sessionId).map((line) => {
      const separator = line.indexOf(":");
      return {
        label: line.slice(0, separator).trim(),
        value: line.slice(separator + 1).trim()
      };
    });
    const modelRows: CommandTableRow[] = [
      { label: this.text("Text", "文本"), value: textRoute.label },
      { label: this.text("Text key", "文本 Key"), value: textRoute.key || this.text("(empty)", "（空）") },
      { label: this.text("Vision", "视觉"), value: visionRoute.label },
      { label: this.text("Vision key", "视觉 Key"), value: visionRoute.key || this.text("(empty)", "（空）") },
      { label: "STT", value: sttRoute.label },
      { label: "STT key", value: sttRoute.key || this.text("(empty)", "（空）") },
      { label: "TTS", value: ttsRoute.label },
      { label: "TTS key", value: ttsRoute.key || this.text("(empty)", "（空）") }
    ];

    if (this.shouldUseMarkdownTable("status")) {
      return this.renderTwoColumnSectionsAsMarkdown([
        { title: this.text("Status", "状态"), rows: overviewRows },
        { title: this.text("Thinking", "思考"), rows: thinkingRows },
        { title: this.text("Models", "模型"), rows: modelRows }
      ]);
    }

    return [
      ...overviewRows.map((row) => `${row.label}: ${row.value}`),
      "",
      this.text("Thinking:", "思考："),
      ...thinkingRows.map((row) => `${row.label}: ${row.value}`),
      "",
      this.text("Models:", "模型："),
      ...modelRows.map((row) => `${row.label}: ${row.value}`)
    ].join("\n");
  }

  private helpText(): string {
    const d = (english: string, chinese: string) => this.text(english, chinese);
    const commandRows: CommandTableRow[] = [
      { label: "/stop", value: d("stop current running task", "停止当前运行中的任务") },
      { label: "/steer <text|queueId>", value: d("inject a live correction into the current running task", "向当前运行中的任务注入实时纠正") },
      { label: "/followup <text|queueId>", value: d("run a follow-up turn after the current task finishes", "在当前任务完成后追加一轮任务") },
      { label: "/queue", value: d("list current running and queued tasks", "查看当前运行中和排队中的任务") },
      { label: "/queue front <text>", value: d("insert a text task at the front of queue", "将文本任务插入队列最前方") },
      { label: "/queue delete <queueId>", value: d("delete a pending queued task by id", "按 ID 删除排队任务") },
      { label: "/new", value: d("create and switch to a new session", "创建并切换到新会话") },
      { label: "/clear", value: d("clear context of current session", "清除当前会话上下文") },
      { label: "/sessions", value: d("list sessions and current active session", "查看会话列表和当前会话") },
      { label: "/sessions <index|sessionId>", value: d("switch active session", "切换当前会话") },
      { label: "/delete_sessions", value: d("list sessions and delete usage", "查看会话列表和删除用法") },
      { label: "/delete_sessions <index|sessionId>", value: d("delete a session", "删除会话") },
      { label: "/status", value: d("show current bot/session/runtime status", "查看当前机器人、会话和运行时状态") },
      { label: "/state", value: d("alias of /status", "/status 的别名") },
      { label: "/runlog latest", value: d("show the latest archived run log", "查看最新归档运行记录") },
      { label: "/runlog <runId>", value: d("show an archived run log by id", "按 ID 查看归档运行记录") },
      { label: "/thinking", value: d("show current session thinking setting", "查看当前会话思考设置") },
      { label: "/thinking <default|off|low|medium|high>", value: d("change thinking for current session only", "仅修改当前会话的思考级别") },
      { label: "/toolprogress", value: d("show current bot tool progress configuration", "查看当前机器人工具进度配置") },
      { label: "/toolprogress <off|new|all|verbose|reset>", value: d("change tool progress configuration for this bot instance", "修改当前机器人工具进度配置") },
      { label: "/showreasoning", value: d("show current show reasoning configuration", "查看当前思考过程显示配置") },
      { label: "/showreasoning <off|on|stream|new|reset>", value: d("change show reasoning configuration for this bot instance", "修改当前机器人的思考过程显示配置") },
      { label: "/sandbox", value: d("show current sandbox override configurations", "查看当前沙盒覆盖配置") },
      { label: "/sandbox <on|off|reset>", value: d("change sandbox override for current session only", "仅修改当前会话的沙盒覆盖") },
      { label: "/sandbox bot <on|off|reset>", value: d("change sandbox override for this bot instance", "修改当前机器人的沙盒覆盖") },
      { label: "/sandbox agent <on|off|reset>", value: d("change sandbox override for this agent", "修改当前 Agent 的沙盒覆盖") },
      { label: "/models", value: d("show text route models and current active model", "查看文本路由模型和当前模型") },
      { label: "/models <index|key>", value: d("switch text model", "切换文本模型") },
      { label: "/models <text|vision|stt|tts|subagent>", value: d("show models and current active model for that route", "查看指定路由的模型和当前模型") },
      { label: "/models <text|vision|stt|tts|subagent> <index|key>", value: d("switch route model", "切换指定路由模型") },
      { label: "/compact [instructions]", value: d("summarize older context of current session", "压缩当前会话的较早上下文") },
      ...(this.options.helpLines ?? []).map((line) => {
        const separator = line.indexOf(" - ");
        if (separator < 0) return { label: line, value: "" };
        return {
          label: line.slice(0, separator).trim(),
          value: line.slice(separator + 3).trim()
        };
      }),
      { label: "/skills", value: d("list loaded skill names and file paths", "查看已加载技能名称和文件路径") },
      { label: "/skills <id>", value: d("show details for one loaded skill", "查看单个技能详情") },
      { label: "/skills-detail", value: d("show full details for all loaded skills", "查看所有已加载技能的完整详情") },
      { label: "/help", value: d("show this help", "显示此帮助") }
    ];

    if (this.shouldUseMarkdownTable("help")) {
      return this.renderTwoColumnSectionsAsMarkdown([{ title: this.text("Available commands", "可用命令"), rows: commandRows }]);
    }

    return [this.text("Available commands:", "可用命令："), ...commandRows.map((row) => `${row.label} - ${row.value}`)].join("\n");
  }

  private async queueText(scopeId: string): Promise<string> {
    const rows = await this.options.listQueue?.(scopeId);
    if (!rows || rows.length === 0) {
      return this.text("Queue is empty.", "队列为空。");
    }
    const tableRows: CommandTableRow[] = rows.map((row) => ({
      label: `#${row.id} ${row.status}`,
      value: row.preview || this.text("(no preview)", "（无预览）")
    }));

    if (this.shouldUseMarkdownTable("help")) {
      return this.renderTwoColumnSectionsAsMarkdown([{ title: this.text("Queue", "队列"), rows: tableRows }]);
    }

    return [this.text("Queue:", "队列："), ...rows.map((row) => `#${row.id} [${row.status}] ${row.preview || this.text("(no preview)", "（无预览）")}`)].join("\n");
  }

  private async tryHandleQueuedLiveCommand(
    mode: "steer" | "followup",
    input: SharedRuntimeCommandContext<TTarget>,
    rawArg: string
  ): Promise<boolean> {
    if (!/^\d+$/.test(rawArg)) return false;
    if (!this.options.getQueuedPreview || !this.options.deleteQueued) return false;

    const id = Number.parseInt(rawArg, 10);
    if (!Number.isFinite(id) || id <= 0) return false;

    const queued = await this.options.getQueuedPreview(input.scopeId, id);
    if (queued.status === "not_found") {
      await this.options.sendText(input.target, `Queue item ${id} was not found.`);
      return true;
    }
    if (queued.status === "running") {
      await this.options.sendText(
        input.target,
        `Task ${id} is currently running. Use /${mode} <text> to correct the active task directly.`
      );
      return true;
    }

    const preview = String(queued.preview ?? "").trim();
    if (!preview) {
      await this.options.sendText(
        input.target,
        `Queue item ${id} has no text preview. Use /${mode} <text> instead.`
      );
      return true;
    }

    const liveResult = mode === "steer"
      ? this.options.steerRun?.(input.scopeId, preview)
      : this.options.followUpRun?.(input.scopeId, preview);
    if (!liveResult) return false;
    if (!liveResult.queued) {
      await this.options.sendText(
        input.target,
        `Nothing running. Queue item ${id} stays queued.`
      );
      return true;
    }

    const deleted = await this.options.deleteQueued(input.scopeId, id);
    if (deleted !== "deleted") {
      await this.options.sendText(
        input.target,
        `Injected queued task ${id}, but failed to remove it from queue. Use /queue delete ${id} if it still appears.`
      );
      return true;
    }

    await this.options.sendText(
      input.target,
      mode === "steer"
        ? `Injected queued task ${id} into current task.`
        : `Queued task ${id} will now run as live follow-up after the current task.`
    );
    return true;
  }

  private formatSandboxStatus(scopeId: string, sessionId: string): string {
    const settings = this.options.getSettings();
    const channel = this.options.channel;
    const instanceId = this.options.instanceId;
    
    // 1. Session Override
    const sessionOverride = this.options.store.getSessionSandboxOverride(scopeId, sessionId);
    const sessionText = sessionOverride === true
      ? this.text("ON (Override)", "开启（覆盖）")
      : sessionOverride === false
        ? this.text("OFF (Override)", "关闭（覆盖）")
        : this.text("Inherit", "继承");

    // 2. Bot Override
    const instance = settings.channels[channel]?.instances.find((inst) => inst.id === instanceId);
    const botOverride = instance?.sandboxEnabled;
    const botText = botOverride === true
      ? this.text("ON (Override)", "开启（覆盖）")
      : botOverride === false
        ? this.text("OFF (Override)", "关闭（覆盖）")
        : this.text("Inherit", "继承");

    // 3. Agent Override
    const agentId = instance?.agentId;
    const agent = agentId ? settings.agents.find((a) => a.id === agentId) : null;
    const agentOverride = agent?.sandboxEnabled;
    const agentText = agentOverride === true
      ? this.text("ON (Override)", "开启（覆盖）")
      : agentOverride === false
        ? this.text("OFF (Override)", "关闭（覆盖）")
        : this.text("Inherit", "继承");

    // 4. Global Default
    const globalDefault = settings.toolSandbox.enabled;
    const globalText = globalDefault ? this.text("ON (Default)", "开启（默认）") : this.text("OFF (Default)", "关闭（默认）");

    // Resolved Status
    let resolved = globalDefault;
    let resolvedFrom = "Global Default";
    
    if (agentOverride !== undefined) {
      resolved = agentOverride;
      resolvedFrom = `Agent Override (${agentId})`;
    }
    if (botOverride !== undefined) {
      resolved = botOverride;
      resolvedFrom = `Bot Override (${instanceId})`;
    }
    if (sessionOverride !== null) {
      resolved = sessionOverride;
      resolvedFrom = `Session Override (${sessionId})`;
    }

    return [
      this.text("=== Sandbox Configurations ===", "=== 沙盒配置 ==="),
      this.text(
        `Resolved Status: ${resolved ? "ENABLED" : "DISABLED"} (via ${resolvedFrom})`,
        `最终状态：${resolved ? "已开启" : "已关闭"}（来源：${resolvedFrom}）`
      ),
      "",
      this.text(`1. Session Override [${sessionId}]: ${sessionText}`, `1. 会话覆盖 [${sessionId}]：${sessionText}`),
      this.text(`2. Bot Override [${instanceId}]: ${botText}`, `2. 机器人覆盖 [${instanceId}]：${botText}`),
      this.text(`3. Agent Override [${agentId ?? "none"}]: ${agentText}`, `3. Agent 覆盖 [${agentId ?? "无"}]：${agentText}`),
      this.text(`4. Global Default: ${globalText}`, `4. 全局默认：${globalText}`),
      "",
      this.text("Usage:", "用法："),
      this.text(" - `/sandbox [on|off|reset]` : toggle session sandbox override", " - `/sandbox [on|off|reset]`：修改会话沙盒覆盖"),
      this.text(" - `/sandbox bot [on|off|reset]` : toggle current bot sandbox override", " - `/sandbox bot [on|off|reset]`：修改当前机器人沙盒覆盖"),
      this.text(" - `/sandbox agent [on|off|reset]` : toggle default agent sandbox override", " - `/sandbox agent [on|off|reset]`：修改默认 Agent 沙盒覆盖")
    ].join("\n");
  }
}
