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

interface BooleanLayerStatus {
  enabled: boolean;
  source: string;
  globalDefault: boolean;
  botOverride?: boolean;
  sessionOverride?: boolean | null;
}

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
      ? this.renderMarkdownBulletList(this.text("Approved Host Bash", "已批准 Host Bash"), [
          { label: this.text("Action", "操作"), value: registered.displayName },
          {
            label: this.text("Whitelisted tools", "已加入白名单的工具"),
            value: registeredEntries.map((item) => this.code(item.toolId)).join(", ")
          },
          { label: this.text("Command", "命令"), value: this.code(registered.command) }
        ])
      : this.renderMarkdownBulletList(this.text("Approved one-time host action", "已批准一次性主机操作"), [
          { label: this.text("Action", "操作"), value: approved.record.displayName },
          { label: this.text("Request ID", "请求 ID"), value: this.code(approved.record.id) },
          { label: this.text("Command", "命令"), value: this.code(approved.record.command) }
        ]);
    if (approved.record.pendingAction && this.options.executeApprovedHostBash) {
      if (this.isRunActive(sessionId)) {
        message += `\n\n- ${this.text("Approved. The waiting agent run is executing the command now.", "已批准。等待中的 Agent 运行正在执行该命令。")}`;
        this.scheduleHostBashExecutionFallback(input, approved.approved, approved.record);
      } else {
        this.executeApprovedHostBashInBackground(input, approved.approved, approved.record);
        message += `\n\n- ${this.text(
          "Approved. The command is now executing; results will follow in chat.",
          "已批准。命令正在执行，结果稍后会发到会话中。"
        )}`;
      }
    } else if (registered) {
      message += `\n\n- ${this.text("This command is now registered as a reusable Host Bash whitelist entry.", "该命令已登记为可复用的 Host Bash 白名单项。")}`;
    } else {
      message += `\n\n- ${this.text("This approval is one-time only and will not be reused for future host commands.", "该审批仅本次有效，不会用于后续主机命令。")}`;
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

    let message = this.renderMarkdownBulletList(this.text("Approved for current session only", "已批准当前会话"), [
      { label: this.text("Action", "操作"), value: approved.record.displayName },
      { label: this.text("Request ID", "请求 ID"), value: this.code(approved.record.id) },
      { label: this.text("Command", "命令"), value: this.code(approved.record.command) },
      { label: this.text("Session", "会话"), value: this.code(sessionId) },
      {
        label: this.text("Effect", "效果"),
        value: this.text(
          "Future sandbox permission denials in this session will fall back to Host Bash automatically.",
          "当前会话后续沙盒权限拒绝会自动回退到 Host Bash。"
        )
      }
    ]);
    if (approved.record.pendingAction && this.options.executeApprovedHostBash) {
      if (this.isRunActive(sessionId)) {
        message += `\n\n- ${this.text("Approved. The waiting agent run is executing the command now.", "已批准。等待中的 Agent 运行正在执行该命令。")}`;
        this.scheduleHostBashExecutionFallback(input, undefined, approved.record);
      } else {
        this.executeApprovedHostBashInBackground(input, undefined, approved.record);
        message += `\n\n- ${this.text(
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
    if (!text.startsWith("/")) {
      const hostToolApprovalHandled = await this.tryHandleHostToolApproval(input, text);
      if (hostToolApprovalHandled) return true;
      return false;
    }

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
            ? this.text(`Stopped. Cleared ${cancelledQueued} queued task(s).`, `已停止，并清除 ${cancelledQueued} 个排队任务。`)
            : this.text("Stopped.", "已停止。")
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
        await this.options.sendText(input.target, this.renderMarkdownCommandList(this.text("Steer usage", "实时纠正用法"), ["/steer <text>"]));
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
        await this.options.sendText(input.target, this.renderMarkdownCommandList(this.text("Follow-up usage", "追加任务用法"), ["/followup <text>"]));
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
          await this.options.sendText(input.target, this.renderMarkdownCommandList(this.text("Queue front usage", "队列插队用法"), ["/queue front <text>"]));
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
          await this.options.sendText(input.target, this.renderMarkdownCommandList(this.text("Queue delete usage", "队列删除用法"), ["/queue delete <queueId>"]));
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
        this.renderMarkdownCommandList(this.text("Queue usage", "队列命令用法"), [
          "/queue",
          "/queue front <text>",
          "/queue delete <queueId>"
        ])
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
          [
            this.formatSessionsOverview(input.scopeId),
            this.renderMarkdownCommandList(this.text("Delete usage", "删除用法"), ["/delete_sessions <index|sessionId>"])
          ].join("\n\n")
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
          this.renderMarkdownBulletList(this.text("Session deleted", "会话已删除"), [
            { label: this.text("Deleted", "已删除"), value: this.code(result.deleted) },
            { label: this.text("Current", "当前会话"), value: this.code(result.active) },
            { label: this.text("Remaining", "剩余会话"), value: String(result.remaining.length) }
          ])
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
        await this.options.sendText(input.target, `${this.renderMarkdownBulletList(this.text("Invalid model selector", "无效的模型选择器"), [{ label: this.text("Selector", "选择器"), value: this.code(selector) }])}\n\n${this.modelsText(route)}`);
        return true;
      }
      const switched = switchModelSelection({
        settings,
        route,
        selector,
        updateSettings: this.options.updateSettings
      });
      if (!switched) {
        await this.options.sendText(input.target, `${this.renderMarkdownBulletList(this.text("Invalid model selector", "无效的模型选择器"), [{ label: this.text("Selector", "选择器"), value: this.code(selector) }])}\n\n${this.modelsText(route)}`);
        return true;
      }
      await this.options.sendText(
        input.target,
        this.renderMarkdownBulletList(this.text("Model switched", "模型已切换"), [
          { label: this.text("Route", "路由"), value: this.code(route) },
          { label: this.text("Selected model", "已选模型"), value: switched.selected.label },
          {
            label: this.text("Transport", "传输"),
            value: this.text("Runtime will auto-use built-in or custom transport based on the selected model.", "运行时会根据所选模型自动使用内置或自定义传输。")
          },
          { label: this.text("Check", "查看"), value: this.code(`/models ${route}`) }
        ])
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
            ? this.renderMarkdownBulletList(this.text("Conversation context compacted", "会话上下文已压缩"), [
                { label: this.text("Before", "压缩前"), value: `≈${result.beforeTokens} tokens` },
                { label: this.text("After", "压缩后"), value: `≈${result.afterTokens} tokens` },
                { label: this.text("Summarized messages", "已总结消息数"), value: String(result.summarizedMessages) },
                { label: this.text("Kept messages", "保留消息数"), value: String(result.keptMessages) }
              ])
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
            this.renderMarkdownBulletList(this.text("OAuth login", "OAuth 登录"), [
              { label: this.text("Auth file", "认证文件"), value: this.code(resolveAuthFilePath()) },
              { label: this.text("OAuth providers", "OAuth 提供方"), value: listOAuthProviderIds().map((id) => this.code(id)).join(", ") }
            ]),
            this.renderMarkdownCommandList(this.text("Usage", "用法"), [
              "/login <provider>",
              "/login <provider> <code-or-redirect-url>"
            ])
          ].join("\n\n")
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
          this.renderMarkdownBulletList(this.text("Login started", "登录已开始"), [
            { label: this.text("Provider", "提供方"), value: this.code(provider) },
            { label: this.text("Auth file", "认证文件"), value: this.code(resolveAuthFilePath()) }
          ])
        ];
        if (pending.authUrl) lines.push(this.renderMarkdownBulletList(this.text("Next step", "下一步"), [{ label: this.text("Open", "打开"), value: pending.authUrl }]));
        if (pending.instructions) lines.push(pending.instructions);
        if (pending.promptMessage) lines.push(pending.promptMessage);
        lines.push(this.renderMarkdownCommandList(this.text("Finish with", "完成登录"), [`/login ${provider} <code-or-redirect-url>`]));
        await this.options.sendText(input.target, lines.join("\n\n"));
      } catch (error) {
        await this.options.sendText(input.target, error instanceof Error ? error.message : String(error));
      }
      return true;
    }

    if (cmd === "/logout") {
      const provider = rawArg.split(/\s+/)[0] || "";
      if (!provider) {
        await this.options.sendText(input.target, this.renderMarkdownCommandList(this.text("Logout usage", "登出用法"), ["/logout <provider>"]));
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
      const args = rawArg.split(/\s+/).filter(Boolean);
      const subcommand = args[0]?.toLowerCase() || "latest";

      if (subcommand === "status") {
        await this.options.sendText(input.target, this.formatRunLogNoticeStatus(input.scopeId));
        return true;
      }

      if (subcommand === "list") {
        const limit = Number.parseInt(args[1] ?? "", 10);
        await this.options.sendText(input.target, this.formatRunLogList(input.scopeId, Number.isFinite(limit) ? limit : 10));
        return true;
      }

      if (subcommand === "on" || subcommand === "off" || subcommand === "reset") {
        const sessionId = this.options.store.getActiveSession(input.scopeId);
        const nextValue = subcommand === "reset" ? null : subcommand === "on";
        this.options.store.setSessionRunLogNoticeOverride(input.scopeId, sessionId, nextValue);
        await this.options.sendText(
          input.target,
          [
            this.renderMarkdownBulletList(this.text("Runlog notice updated", "Runlog 通知已更新"), [
              { label: this.text("Session", "会话"), value: this.code(sessionId) },
              { label: this.text("Override", "覆盖值"), value: nextValue === null ? this.text("inherit", "继承") : this.boolText(nextValue) }
            ]),
            "",
            this.formatRunLogNoticeStatus(input.scopeId)
          ].join("\n")
        );
        return true;
      }

      if (subcommand === "bot" || subcommand === "global") {
        if (!this.options.updateSettings) {
          await this.options.sendText(input.target, this.text("Settings updates are unavailable in current runtime.", "当前运行时不支持更新设置。"));
          return true;
        }
        const action = args[1]?.toLowerCase();
        if (action !== "on" && action !== "off" && action !== "reset") {
          await this.options.sendText(input.target, this.renderMarkdownCommandList(this.text("Runlog usage", "Runlog 用法"), [
            "/runlog bot [on|off|reset]",
            "/runlog global [on|off|reset]"
          ]));
          return true;
        }

        const settings = this.options.getSettings();
        if (subcommand === "global") {
          const nextValue = action === "reset" ? false : action === "on";
          this.options.updateSettings({
            display: {
              ...(settings.display ?? { toolProgress: "all", showReasoning: "off", gatewayNotifyInterval: 0 }),
              runLogNotice: nextValue
            }
          });
          await this.options.sendText(
            input.target,
            [
              this.renderMarkdownBulletList(this.text("Runlog notice updated", "Runlog 通知已更新"), [
                { label: this.text("Global default", "全局默认"), value: this.boolText(nextValue) }
              ]),
              "",
              this.formatRunLogNoticeStatus(input.scopeId)
            ].join("\n")
          );
          return true;
        }

        const channel = this.options.channel;
        const channelSettings = settings.channels[channel];
        if (!channelSettings) {
          await this.options.sendText(input.target, this.text(`Channel '${channel}' settings not found.`, `未找到渠道 '${channel}' 的设置。`));
          return true;
        }
        const nextValue = action === "reset" ? undefined : action === "on";
        const instances = channelSettings.instances.map((inst) => inst.id === this.options.instanceId
          ? {
              ...inst,
              display: {
                ...(inst.display ?? {}),
                runLogNotice: nextValue
              }
            }
          : inst);
        this.options.updateSettings({
          channels: {
            ...settings.channels,
            [channel]: { ...channelSettings, instances }
          }
        });
        await this.options.sendText(
          input.target,
          [
            this.renderMarkdownBulletList(this.text("Runlog notice updated", "Runlog 通知已更新"), [
              { label: this.text("Bot", "机器人"), value: this.code(this.options.instanceId) },
              { label: this.text("Override", "覆盖值"), value: nextValue === undefined ? this.text("inherit", "继承") : this.boolText(nextValue) }
            ]),
            "",
            this.formatRunLogNoticeStatus(input.scopeId)
          ].join("\n")
        );
        return true;
      }

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
        await this.options.sendText(input.target, `${this.renderMarkdownBulletList(this.text("Invalid thinking level", "无效的思考级别"), [{ label: this.text("Value", "值"), value: this.code(normalized) }])}\n\n${this.thinkingText(input.scopeId)}`);
        return true;
      }

      const applied = this.options.store.setSessionThinkingLevelOverride(input.scopeId, sessionId, nextOverride);
      const lines = [
        this.renderMarkdownBulletList(this.text("Session thinking updated", "会话思考级别已更新"), [
          { label: this.text("Session", "会话"), value: this.code(sessionId) },
          {
            label: this.text("Override", "覆盖值"),
            value: applied == null ? this.text("global default", "全局默认值") : this.code(applied)
          }
        ]),
        this.thinkingText(input.scopeId)
      ];
      if (this.options.isRunning(input.scopeId)) {
        lines.push("");
        lines.push(`- ${this.text("Note: this change applies to the next request, not the one already running.", "注意：此更改从下一次请求开始生效，不影响当前正在运行的请求。")}`);
      }
      await this.options.sendText(input.target, lines.join("\n\n"));
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
          await this.options.sendText(input.target, this.sandboxUsageText());
          return true;
        }

        this.options.store.setSessionSandboxOverride(input.scopeId, sessionId, nextValue);
        await this.options.sendText(
          input.target,
          [
            this.renderMarkdownBulletList(this.text("Sandbox updated", "沙盒配置已更新"), [
              { label: this.text("Session", "会话"), value: this.code(sessionId) },
              { label: this.text("Override", "覆盖值"), value: nextValue === null ? this.text("inherit", "继承") : this.boolText(nextValue) }
            ]),
            this.formatSandboxStatus(input.scopeId, sessionId)
          ].join("\n\n")
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
          await this.options.sendText(input.target, this.renderMarkdownCommandList(this.text("Sandbox bot usage", "机器人沙盒用法"), ["/sandbox bot [on|off|reset]"]));
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
          [
            this.renderMarkdownBulletList(this.text("Sandbox updated", "沙盒配置已更新"), [
              { label: this.text("Bot", "机器人"), value: this.code(instanceId) },
              { label: this.text("Override", "覆盖值"), value: nextValue === undefined ? this.text("inherit", "继承") : this.boolText(nextValue) }
            ]),
            this.formatSandboxStatus(input.scopeId, sessionId)
          ].join("\n\n")
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
          await this.options.sendText(input.target, this.renderMarkdownCommandList(this.text("Sandbox agent usage", "Agent 沙盒用法"), ["/sandbox agent [on|off|reset]"]));
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
          [
            this.renderMarkdownBulletList(this.text("Sandbox updated", "沙盒配置已更新"), [
              { label: "Agent", value: this.code(agentId) },
              { label: this.text("Override", "覆盖值"), value: nextValue === undefined ? this.text("inherit", "继承") : this.boolText(nextValue) }
            ]),
            this.formatSandboxStatus(input.scopeId, sessionId)
          ].join("\n\n")
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
        await this.options.sendText(input.target, this.sandboxUsageText());
        return true;
      }

      this.options.store.setSessionSandboxOverride(input.scopeId, sessionId, nextValue);
      await this.options.sendText(
        input.target,
        [
          this.renderMarkdownBulletList(this.text("Sandbox updated", "沙盒配置已更新"), [
            { label: this.text("Session", "会话"), value: this.code(sessionId) },
            { label: this.text("Override", "覆盖值"), value: nextValue === null ? this.text("inherit", "继承") : this.boolText(nextValue) }
          ]),
          this.formatSandboxStatus(input.scopeId, sessionId)
        ].join("\n\n")
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
          [
            this.renderMarkdownBulletList(this.text("Tool progress display config", "工具进度显示配置"), [
              { label: this.text("Bot", "机器人"), value: this.code(instanceId) },
              { label: this.text("Global", "全局"), value: this.code(globalVal) },
              { label: this.text("Bot override", "机器人覆盖"), value: this.code(botVal) },
              { label: this.text("Effective", "实际生效"), value: this.code(effectiveVal) }
            ]),
            this.renderMarkdownCommandList(this.text("To change", "修改方式"), ["/toolprogress [off|new|all|verbose|reset]"])
          ].join("\n\n")
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
        await this.options.sendText(input.target, this.renderMarkdownCommandList(this.text("Tool progress usage", "工具进度用法"), ["/toolprogress [off|new|all|verbose|reset]"]));
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
        this.renderMarkdownBulletList(this.text("Tool progress updated", "工具进度显示已更新"), [
          { label: this.text("Bot", "机器人"), value: this.code(instanceId) },
          { label: this.text("Override", "覆盖值"), value: nextValue === undefined ? this.text("inherit", "继承") : this.code(nextValue) },
          { label: this.text("Effective", "实际生效"), value: this.code(effectiveVal) }
        ])
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
          [
            this.renderMarkdownBulletList(this.text("Show reasoning config", "思考过程显示配置"), [
              { label: this.text("Bot", "机器人"), value: this.code(instanceId) },
              { label: this.text("Global", "全局"), value: this.code(globalVal) },
              { label: this.text("Bot override", "机器人覆盖"), value: this.code(botVal) },
              { label: this.text("Effective", "实际生效"), value: this.code(effectiveVal) }
            ]),
            this.renderMarkdownCommandList(this.text("To change", "修改方式"), ["/showreasoning [off|on|stream|new|reset]"])
          ].join("\n\n")
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
        await this.options.sendText(input.target, this.renderMarkdownCommandList(this.text("Show reasoning usage", "思考过程显示用法"), ["/showreasoning [off|on|stream|new|reset]"]));
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
        this.renderMarkdownBulletList(this.text("Show reasoning updated", "思考过程显示已更新"), [
          { label: this.text("Bot", "机器人"), value: this.code(instanceId) },
          { label: this.text("Override", "覆盖值"), value: nextValue === undefined ? this.text("inherit", "继承") : this.code(nextValue) },
          { label: this.text("Effective", "实际生效"), value: this.code(effectiveVal) }
        ])
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
        this.renderMarkdownCommandList(
          this.text("Multiple Host Bash approvals pending", "存在多条待处理 Host Bash 审批"),
          pending.flatMap((item) => [
            `/hosttools approve ${item.id}`,
            `/hosttools reject ${item.id}`
          ]),
          pending.map((item) => `${this.code(item.id)}: ${item.displayName}`)
        )
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
          this.renderMarkdownBulletList(this.text("Pending Host Bash approvals", "待处理 Host Bash 审批"), [
            { label: this.text("Count", "数量"), value: String(pending.length) },
            ...pending.map((item) => ({
              label: item.id,
              value: `${item.displayName} (${this.code(item.command)})`
            }))
          ]),
          this.renderMarkdownBulletList(this.text("Host Bash whitelist entries", "Host Bash 白名单项"), [
            { label: this.text("Count", "数量"), value: String(approved.length) },
            ...approved.map((item) => ({
              label: item.toolId,
              value: `${item.displayName} (${this.code(item.command)})`
            }))
          ])
        ].join("\n\n")
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
        this.renderMarkdownCommandList(this.text("Host Bash usage", "Host Bash 用法"), [
          "/hosttools",
          "/hosttools approve <approvalId>",
          "/hosttools approve-once <approvalId>",
          "/hosttools approve-session <approvalId>",
          "/hosttools reject <approvalId>"
        ]),
        this.renderMarkdownBulletList(this.text("Text replies", "文本回复"), [
          {
            label: this.text("Run once", "仅执行一次"),
            value: this.text("Reply `批准` or `仅此一次` when exactly one approval is pending.", "当当前会话只有一条待审批请求时，回复 `批准` 或 `仅此一次`。")
          },
          {
            label: this.text("Whitelist", "加入白名单"),
            value: this.text("Reply `永久允许`.", "回复 `永久允许`。")
          },
          {
            label: this.text("Current session", "当前会话"),
            value: this.text("Reply `本会话允许`, `本session允许`, or `approve session`.", "回复 `本会话允许`、`本session允许` 或 `approve session`。")
          }
        ])
      ].join("\n\n")
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
      this.renderMarkdownBulletList(this.text("Session overview", "会话概览"), [
        { label: this.text("Current session", "当前会话"), value: this.code(active) },
        { label: this.text("Total sessions", "会话总数"), value: String(sessions.length) }
      ]),
      "",
      `**${this.text("Sessions", "会话列表")}**`
    ];
    for (let i = 0; i < sessions.length; i += 1) {
      const id = sessions[i];
      lines.push(`${i + 1}. ${this.code(id)}${id === active ? this.text(" (current)", "（当前）") : ""}`);
    }
    lines.push("");
    lines.push(this.renderMarkdownCommandList(this.text("Session commands", "会话命令"), [
      "/sessions <index|sessionId>",
      "/delete_sessions <index|sessionId>"
    ]));
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
      this.isChinese ? `**${title}**（共 ${options.length} 个）` : `**${title}** (${options.length} total)`,
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
    lines.push(this.renderMarkdownCommandList(this.text(`Switch ${route} model`, `切换 ${route} 模型`), [
      this.text(`/models ${route} <number>`, `/models ${route} <编号>`),
      `/models ${route} <key>`
    ]));
    if (route === "text") {
      lines.push("");
      lines.push(this.renderMarkdownCommandList(this.text("Quick switch", "快捷切换"), [
        this.text("/models <number>", "/models <编号>"),
        "/models <key>"
      ]));
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
              this.text("Skills commands:", "技能命令："),
              "- `/skills`",
              "- `/skills <id>`",
              "- `/skills-detail`"
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
        this.text("Use `/skills <id>` for details.", "使用 `/skills <id>` 查看详情。"),
        this.text("Use `/skills-detail` for the full list.", "使用 `/skills-detail` 查看完整列表。")
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
      this.renderMarkdownBulletList(this.text("Thinking status", "思考状态"), [
        { label: this.text("Session", "会话"), value: this.code(sessionId) },
        ...this.buildSessionThinkingSummary(scopeId, sessionId).map((line) => {
          const separator = line.indexOf(":");
          return {
            label: line.slice(0, separator).trim(),
            value: line.slice(separator + 1).trim()
          };
        })
      ]),
      this.renderMarkdownCommandList(this.text("Set for current session", "为当前会话设置"), [
        "/thinking off",
        "/thinking low",
        "/thinking medium",
        "/thinking high"
      ]),
      this.renderMarkdownCommandList(this.text("Reset to global default", "恢复全局默认值"), ["/thinking default"])
    ].join("\n\n");
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
        if (section.title) lines.push(`**${section.title}**`, "");
        lines.push(this.text("| Item | Value |", "| 项目 | 值 |"));
        lines.push("| --- | --- |");
        for (const row of section.rows) {
          lines.push(`| ${this.escapeMarkdownTableCell(row.label)} | ${this.escapeMarkdownTableCell(row.value)} |`);
        }
        return lines.join("\n");
      })
      .join("\n\n");
  }

  private renderTwoColumnSectionsAsMarkdownList(sections: CommandTableSection[]): string {
    return sections
      .filter((section) => section.rows.length > 0)
      .map((section) => {
        const lines: string[] = [];
        if (section.title) lines.push(`**${section.title}**`);
        for (const row of section.rows) {
          lines.push(`- **${row.label}**: ${row.value}`);
        }
        return lines.join("\n");
      })
      .join("\n\n");
  }

  private boolText(value: boolean): string {
    return value ? this.text("on", "开启") : this.text("off", "关闭");
  }

  private code(value: string): string {
    return `\`${String(value ?? "").replace(/`/g, "\\`")}\``;
  }

  private renderMarkdownBulletList(title: string, rows: CommandTableRow[]): string {
    const lines = [`**${title}**`];
    for (const row of rows) {
      lines.push(`- **${row.label}**: ${row.value}`);
    }
    return lines.join("\n");
  }

  private renderMarkdownCommandList(title: string, commands: string[], notes: string[] = []): string {
    return [
      `**${title}**`,
      ...commands.map((command) => `- ${this.code(command)}`),
      ...(notes.length > 0 ? ["", ...notes.map((note) => `- ${note}`)] : [])
    ].join("\n");
  }

  private resolveRunLogNoticeStatus(scopeId: string, sessionId?: string): BooleanLayerStatus {
    const settings = this.options.getSettings();
    const activeSessionId = sessionId ?? this.options.store.getActiveSession(scopeId);
    const sessionOverride = this.options.store.getSessionRunLogNoticeOverride(scopeId, activeSessionId);
    const instance = settings.channels[this.options.channel]?.instances.find((inst) => inst.id === this.options.instanceId);
    const botOverride = instance?.display?.runLogNotice;
    const globalDefault = settings.display?.runLogNotice ?? false;

    if (sessionOverride !== null) {
      return {
        enabled: sessionOverride,
        source: `session:${activeSessionId}`,
        globalDefault,
        botOverride,
        sessionOverride
      };
    }
    if (botOverride !== undefined) {
      return {
        enabled: botOverride,
        source: `bot:${this.options.instanceId}`,
        globalDefault,
        botOverride,
        sessionOverride
      };
    }
    return {
      enabled: globalDefault,
      source: settings.display?.runLogNotice === undefined ? "default" : "global",
      globalDefault,
      botOverride,
      sessionOverride
    };
  }

  public shouldSendRunArchiveNotice(scopeId: string, sessionId?: string): boolean {
    return this.resolveRunLogNoticeStatus(scopeId, sessionId).enabled;
  }

  private formatRunLogNoticeStatus(scopeId: string): string {
    const sessionId = this.options.store.getActiveSession(scopeId);
    const status = this.resolveRunLogNoticeStatus(scopeId, sessionId);
    const botText = status.botOverride === undefined ? this.text("inherit", "继承") : this.boolText(status.botOverride);
    const sessionText = status.sessionOverride === null ? this.text("inherit", "继承") : this.boolText(Boolean(status.sessionOverride));
    return [
      `**${this.text("Runlog notice status", "Runlog 通知状态")}**`,
      `- **${this.text("Effective", "实际生效")}**: ${this.boolText(status.enabled)} (${status.source})`,
      `- **${this.text("Session", "会话")}**: ${sessionText}`,
      `- **${this.text("Bot", "机器人")}**: ${botText}`,
      `- **${this.text("Global", "全局")}**: ${this.boolText(status.globalDefault)}`,
      "",
      `**${this.text("Commands", "命令")}**`,
      "- `/runlog on`",
      "- `/runlog off`",
      "- `/runlog reset`",
      "- `/runlog bot on|off|reset`",
      "- `/runlog global on|off|reset`"
    ].join("\n");
  }

  private formatRunLogList(scopeId: string, limit = 10): string {
    const rows = this.options.store.listRunSummaries(scopeId, limit);
    if (rows.length === 0) return this.text("No archived run log found yet.", "尚未找到归档运行记录。");

    const lines = [
      `**${this.text(`Recent run logs (${rows.length})`, `最近运行记录（${rows.length} 条）`)}**`
    ];
    rows.forEach((row, index) => {
      const runId = String(row.runId ?? "").trim() || "(unknown)";
      const stopReason = String(row.stopReason ?? row.status ?? "").trim() || "unknown";
      const createdAt = String(row.createdAt ?? row.timestamp ?? "").trim();
      const summary = String(row.summary ?? row.errorMessage ?? "").trim();
      lines.push(`${index + 1}. ${this.code(runId)} - ${stopReason}${createdAt ? ` - ${createdAt}` : ""}${summary ? ` - ${summary}` : ""}`);
    });
    lines.push("");
    lines.push(this.renderMarkdownCommandList(this.text("Open", "查看"), ["/runlog <runId>"]));
    return lines.join("\n");
  }

  private resolveSandboxState(scopeId: string, sessionId: string): BooleanLayerStatus {
    const settings = this.options.getSettings();
    const instance = settings.channels[this.options.channel]?.instances.find((inst) => inst.id === this.options.instanceId);
    const agentId = instance?.agentId;
    const agent = agentId ? settings.agents.find((row) => row.id === agentId) : undefined;
    const sessionOverride = this.options.store.getSessionSandboxOverride(scopeId, sessionId);
    const botOverride = instance?.sandboxEnabled;
    const agentOverride = agent?.sandboxEnabled;
    const globalDefault = settings.toolSandbox.enabled;

    if (sessionOverride !== null) return { enabled: sessionOverride, source: `session:${sessionId}`, globalDefault, botOverride, sessionOverride };
    if (botOverride !== undefined) return { enabled: botOverride, source: `bot:${this.options.instanceId}`, globalDefault, botOverride, sessionOverride };
    if (agentOverride !== undefined) return { enabled: agentOverride, source: `agent:${agentId}`, globalDefault, botOverride, sessionOverride };
    return { enabled: globalDefault, source: "global", globalDefault, botOverride, sessionOverride };
  }

  private resolveTtsToolSummary(settings: RuntimeSettings): { label: string; detail: string } {
    const tts = settings.ttsGenerate;
    if (!tts?.enabled) {
      return { label: this.text("off (built-in tool)", "关闭（内置工具）"), detail: "" };
    }
    const providerId = tts.defaultProvider;
    const providerLabel = providerId === "macos" ? "macOS say" : providerId === "xiaomi" ? this.text("Xiaomi MiMo", "小米 MiMo") : providerId;
    const provider = tts.providers?.[providerId];
    const providerEnabled = provider?.enabled !== false;
    const parts: string[] = [];
    if (providerId === "xiaomi") {
      const xiaomi = tts.providers?.xiaomi;
      if (xiaomi?.model) parts.push(xiaomi.model);
      if (xiaomi?.voice) parts.push(xiaomi.voice);
    } else if (providerId === "macos") {
      const macos = tts.providers?.macos;
      if (macos?.voice) parts.push(macos.voice);
    }
    const suffix = providerEnabled ? "" : this.text(" (provider disabled)", "（该提供方已禁用）");
    return {
      label: `[${this.text("Built-in", "内置")}] ${providerLabel}${suffix}`,
      detail: parts.join(" / ")
    };
  }

  private resolveDisplayStatus() {
    const settings = this.options.getSettings();
    const instance = settings.channels[this.options.channel]?.instances.find((inst) => inst.id === this.options.instanceId);
    const globalDisplay = settings.display ?? { toolProgress: "all" as const, showReasoning: "off" as const, gatewayNotifyInterval: 0, runLogNotice: false };
    return {
      toolProgress: {
        value: instance?.display?.toolProgress ?? globalDisplay.toolProgress,
        source: instance?.display?.toolProgress === undefined ? "global" : `bot:${this.options.instanceId}`
      },
      showReasoning: {
        value: instance?.display?.showReasoning ?? globalDisplay.showReasoning,
        source: instance?.display?.showReasoning === undefined ? "global" : `bot:${this.options.instanceId}`
      }
    };
  }

  private statusText(scopeId: string, target: TTarget): string {
    const settings = this.options.getSettings();
    const sessionId = this.options.store.getActiveSession(scopeId);
    const sessionStatus = this.options.store.getSessionStatusSnapshot(scopeId, sessionId);
    const textRoute = this.resolveRouteSummary(settings, "text");
    const visionRoute = this.resolveRouteSummary(settings, "vision");
    const sttRoute = this.resolveRouteSummary(settings, "stt");
    const ttsTool = this.resolveTtsToolSummary(settings);
    const sandboxState = this.resolveSandboxState(scopeId, sessionId);
    const runLogNotice = this.resolveRunLogNoticeStatus(scopeId, sessionId);
    const displayStatus = this.resolveDisplayStatus();
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
      { label: "Sandbox", value: `${sandboxState.enabled ? "on" : "off"} (${sandboxState.source})` },
      { label: "Runlog notice", value: `${runLogNotice.enabled ? "on" : "off"} (${runLogNotice.source})` },
      { label: "Tool progress", value: `${displayStatus.toolProgress.value} (${displayStatus.toolProgress.source})` },
      { label: "Show reasoning", value: `${displayStatus.showReasoning.value} (${displayStatus.showReasoning.source})` },
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
      { label: "TTS", value: ttsTool.label },
      ...(ttsTool.detail ? [{ label: this.text("TTS voice", "TTS 音色"), value: ttsTool.detail }] : [])
    ];

    const statusSections = [
      { title: this.text("Status", "状态"), rows: overviewRows },
      { title: this.text("Thinking", "思考"), rows: thinkingRows },
      { title: this.text("Models", "模型"), rows: modelRows }
    ];

    return this.renderTwoColumnSectionsAsMarkdownList(statusSections);
  }

  private helpText(): string {
    const d = (english: string, chinese: string) => this.text(english, chinese);

    // Common commands surfaced in the Telegram "/" menu and used day-to-day.
    const essentialRows: CommandTableRow[] = [
      { label: "/new", value: d("create and switch to a new session", "创建并切换到新会话") },
      { label: "/clear", value: d("clear context of current session", "清除当前会话上下文") },
      { label: "/stop", value: d("stop current running task", "停止当前运行中的任务") },
      { label: "/sessions", value: d("list sessions, or switch with /sessions <index|sessionId>", "查看会话列表，或用 /sessions <编号|sessionId> 切换") },
      { label: "/status", value: d("show current bot/session/runtime status", "查看当前机器人、会话和运行时状态") },
      { label: "/models", value: d("show or switch model (/models <index|key>)", "查看或切换模型（/models <编号|key>）") },
      { label: "/skills", value: d("list loaded skill names and file paths", "查看已加载技能名称和文件路径") },
      { label: "/help", value: d("show this help", "显示此帮助") }
    ];

    // Power-user commands; fully supported but kept out of the "/" menu.
    const advancedRows: CommandTableRow[] = [
      { label: "/steer <text|queueId>", value: d("inject a live correction into the current running task", "向当前运行中的任务注入实时纠正") },
      { label: "/followup <text|queueId>", value: d("run a follow-up turn after the current task finishes", "在当前任务完成后追加一轮任务") },
      { label: "/queue", value: d("list current running and queued tasks", "查看当前运行中和排队中的任务") },
      { label: "/queue front <text>", value: d("insert a text task at the front of queue", "将文本任务插入队列最前方") },
      { label: "/queue delete <queueId>", value: d("delete a pending queued task by id", "按 ID 删除排队任务") },
      { label: "/delete_sessions [index|sessionId]", value: d("list sessions, or delete one by selector", "查看会话列表，或按选择器删除会话") },
      { label: "/compact [instructions]", value: d("summarize older context of current session", "压缩当前会话的较早上下文") },
      { label: "/skills <id>", value: d("show details for one loaded skill", "查看单个技能详情") },
      { label: "/skills-detail", value: d("show full details for all loaded skills", "查看所有已加载技能的完整详情") },
      { label: "/thinking [default|off|low|medium|high]", value: d("show or change thinking for current session only", "查看或仅修改当前会话的思考级别") },
      { label: "/models <route> [index|key]", value: d("show or switch model for a route (text|vision|stt|tts|subagent)", "查看或切换指定路由的模型（text|vision|stt|tts|subagent）") },
      { label: "/sandbox [scope] [on|off|reset]", value: d("show or change sandbox override (session / bot / agent)", "查看或修改沙盒覆盖（会话 / 机器人 / Agent）") },
      { label: "/runlog [latest|<runId>|list]", value: d("show or list archived run logs", "查看或列出归档运行记录") },
      { label: "/runlog status | [bot|global] <on|off|reset>", value: d("show or change automatic runlog notice", "查看或修改自动 runlog 通知") },
      { label: "/toolprogress [off|new|all|verbose|reset]", value: d("show or change tool progress display for this bot", "查看或修改当前机器人的工具进度显示") },
      { label: "/showreasoning [off|on|stream|new|reset]", value: d("show or change reasoning display for this bot", "查看或修改当前机器人的思考过程显示") },
      ...(this.options.helpLines ?? []).map((line) => {
        const separator = line.indexOf(" - ");
        if (separator < 0) return { label: line, value: "" };
        return {
          label: line.slice(0, separator).trim(),
          value: line.slice(separator + 3).trim()
        };
      })
    ];

    return this.renderTwoColumnSectionsAsMarkdown([
      { title: this.text("Common commands", "常用命令"), rows: essentialRows },
      { title: this.text("Advanced commands", "高级命令"), rows: advancedRows }
    ]);
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

    return this.renderTwoColumnSectionsAsMarkdown([{ title: this.text("Queue", "队列"), rows: tableRows }]);
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

  private sandboxUsageText(): string {
    return this.renderMarkdownCommandList(this.text("Sandbox usage", "沙盒用法"), [
      "/sandbox [on|off|reset]",
      "/sandbox bot [on|off|reset]",
      "/sandbox agent [on|off|reset]"
    ]);
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
      this.renderMarkdownBulletList(this.text("Sandbox configuration", "沙盒配置"), [
        {
          label: this.text("Resolved status", "最终状态"),
          value: this.text(
            `${resolved ? "enabled" : "disabled"} (via ${resolvedFrom})`,
            `${resolved ? "已开启" : "已关闭"}（来源：${resolvedFrom}）`
          )
        },
        { label: this.text("Session override", "会话覆盖"), value: `${this.code(sessionId)}: ${sessionText}` },
        { label: this.text("Bot override", "机器人覆盖"), value: `${this.code(instanceId)}: ${botText}` },
        { label: this.text("Agent override", "Agent 覆盖"), value: `${this.code(agentId ?? "none")}: ${agentText}` },
        { label: this.text("Global default", "全局默认"), value: globalText }
      ]),
      this.sandboxUsageText()
    ].join("\n\n");
  }
}
