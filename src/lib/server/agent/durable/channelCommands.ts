import { randomUUID } from "node:crypto";
import { getApprovalBroker } from "$lib/server/approval/approvalBroker.js";
import type { HostBashStore } from "$lib/server/hostBash/index.js";
import { commandLocaleFromSettings, commandText } from "$lib/server/agent/commands/i18n.js";
import { DurableExecutionCoordinator } from "./coordinator.js";
import type { DurableExecutionDetail, DurableExecutionListItem, DurableExecutionStatus } from "./types.js";

interface DurableChannelCommandInput {
  scopeId: string;
  text: string;
  sendText: (text: string) => Promise<void>;
}

interface PendingApproval {
  detail: DurableExecutionDetail & { projection: ReturnType<DurableExecutionCoordinator["inspect"]>["projection"] };
  approval: DurableExecutionDetail["approvals"][number];
}

const ACTIVE_STATUSES: DurableExecutionStatus[] = [
  "planned",
  "queued",
  "running",
  "verifying",
  "waiting_for_user",
  "waiting_for_approval",
  "paused",
  "recovery_required",
  "partial"
];

function normalizeHandle(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

function isApprovalText(value: string): boolean {
  return /^(安装|批准|同意|确认|允许|通过|审批通过|批准通过|同意审批|审批同意|approve|approved|yes|y)$/i.test(value.trim());
}

function isOnceApprovalText(value: string): boolean {
  return /^(仅此一次|只此一次|仅本次|只本次|仅一次|just once|once|approve once)$/i.test(value.trim());
}

function isPersistentApprovalText(value: string): boolean {
  return /^(永久允许|永久批准|长期允许|始终允许|总是允许|一直允许|always|always allow|approve always)$/i.test(value.trim());
}

function isSessionApprovalText(value: string): boolean {
  return /^(本session允许|本轮session允许|本轮允许|允许本轮|允许会话|本会话允许|允许本会话|本会话通过|本轮通过|本次通过|本次审批通过|session允许|session批准|session通过|approve session|session approve)$/i.test(value.trim());
}

function isRejectText(value: string): boolean {
  return /^(拒绝|取消|不批准|审批拒绝|拒绝审批|deny|reject|no|n)$/i.test(value.trim());
}

function actionId(action: string): string {
  return `durable-channel-${action}-${randomUUID()}`;
}

/**
 * Shared text-channel surface for Durable Execution controls.
 *
 * It resolves tasks by owner + bot + source channel + source chat before any
 * state-changing action. Channel adapters only provide delivery; this class
 * owns the short-handle and approval/decision contract.
 */
export class DurableChannelCommandService {
  private readonly coordinator: DurableExecutionCoordinator;
  private readonly ownerId: string;

  constructor(private readonly options: {
    ownerId?: string;
    channel: string;
    botId: string;
    getSettings: () => { locale?: string };
    hostBashStore: HostBashStore;
    coordinator?: DurableExecutionCoordinator;
  }) {
    this.ownerId = options.ownerId ?? "owner";
    this.coordinator = options.coordinator ?? new DurableExecutionCoordinator();
  }

  private text(english: string, chinese: string): string {
    return commandText(commandLocaleFromSettings(this.options.getSettings()), english, chinese);
  }

  private listItems(scopeId: string): DurableExecutionListItem[] {
    return this.coordinator
      .list({ ownerId: this.ownerId, botId: this.options.botId, statuses: ACTIVE_STATUSES, limit: 200 })
      .filter((item) => item.execution.sourceChannel === this.options.channel && item.execution.sourceChatId === scopeId);
  }

  private findItem(scopeId: string, handle: string): DurableExecutionListItem | null {
    const wanted = normalizeHandle(handle).toLowerCase();
    return this.listItems(scopeId).find((item) => item.execution.shortHandle.toLowerCase() === wanted) ?? null;
  }

  private findApproval(scopeId: string, handle: string, approvalId?: string): PendingApproval | null {
    const item = this.findItem(scopeId, handle);
    if (!item) return null;
    const detail = this.coordinator.inspect(this.ownerId, item.execution.id);
    const approval = detail.approvals.find((candidate) =>
      candidate.status === "pending" && (!approvalId || candidate.id === approvalId)
    );
    return approval ? { detail, approval } : null;
  }

  private pendingApprovals(scopeId: string): PendingApproval[] {
    return this.listItems(scopeId).flatMap((item) => {
      const detail = this.coordinator.inspect(this.ownerId, item.execution.id);
      return detail.approvals
        .filter((approval) => approval.status === "pending")
        .map((approval) => ({ detail, approval }));
    });
  }

  private statusText(item: DurableExecutionListItem): string {
    const progress = `${item.projection.progress.completed}/${item.projection.progress.total}`;
    const waiting = item.execution.waitingReason ? ` — ${item.execution.waitingReason}` : "";
    return `${item.execution.shortHandle} · ${item.execution.status} · ${progress} · ${item.execution.goal}${waiting}`;
  }

  private listText(scopeId: string): string {
    const items = this.listItems(scopeId);
    if (items.length === 0) return this.text("No active durable executions in this chat.", "当前会话没有进行中的长任务。");
    return [
      this.text("Durable executions", "长任务"),
      ...items.map((item) => `- ${this.statusText(item)}`),
      this.text("Use `/durable status #N` for details.", "使用 `/durable status #N` 查看详情。")
    ].join("\n");
  }

  private detailText(detail: ReturnType<DurableExecutionCoordinator["inspect"]>): string {
    const currentSteps = detail.steps.filter((step) => step.planVersion === detail.execution.currentPlanVersion);
    const openDecisions = detail.decisions.filter((decision) => decision.status === "open");
    const pendingApprovals = detail.approvals.filter((approval) => approval.status === "pending");
    const lines = [
      `${detail.execution.shortHandle} · ${detail.execution.status}`,
      detail.execution.goal,
      this.text(`Progress: ${detail.projection.progress.completed}/${detail.projection.progress.total}`, `进度：${detail.projection.progress.completed}/${detail.projection.progress.total}`),
      ...currentSteps.map((step) => `- ${step.status}: ${step.title}`)
    ];
    if (detail.execution.waitingReason) lines.push(`${this.text("Waiting", "等待原因")}：${detail.execution.waitingReason}`);
    if (openDecisions.length > 0) {
      lines.push(this.text("Open decisions", "待回答决定"));
      for (const decision of openDecisions) lines.push(`- ${decision.question} [${decision.options.join(" | ")}]`);
    }
    if (pendingApprovals.length > 0) {
      lines.push(this.text("Pending approvals", "待处理审批"));
      for (const approval of pendingApprovals) {
        lines.push(`- ${approval.id}: ${approval.title}${approval.repeatCount > 1 ? ` (${this.text(`repeat ${approval.repeatCount}`, `第 ${approval.repeatCount} 次`)})` : ""}`);
      }
    }
    return lines.join("\n");
  }

  private async resolveApproval(
    pending: PendingApproval,
    scopeId: string,
    status: "approved" | "rejected",
    selectedScope: "once" | "session" | "persistent"
  ): Promise<string> {
    const { approval, detail } = pending;
    if (approval.backend === "approval_broker") {
      const request = getApprovalBroker().getRequest(approval.requestId);
      if (!request || request.status !== "pending") {
        return this.text("The underlying approval is no longer pending.", "底层审批已不再等待处理。");
      }
      const resolved = getApprovalBroker().resolveRequest({
        requestId: approval.requestId,
        status,
        ...(status === "approved" ? { selectedScope } : {})
      });
      if (!resolved.request) return this.text("The approval could not be resolved.", "审批无法完成处理。");
    } else {
      const resolved = status === "approved"
        ? this.options.hostBashStore.approve(scopeId, approval.requestId, { scope: selectedScope })
        : this.options.hostBashStore.reject(scopeId, approval.requestId);
      if (!resolved) return this.text("The underlying Host Bash approval is no longer pending.", "底层 Host Bash 审批已不再等待处理。");
    }

    const result = this.coordinator.resolveApproval({
      ownerId: this.ownerId,
      executionId: detail.execution.id,
      approvalId: approval.id,
      status,
      selectedScope,
      expectedVersion: detail.execution.version,
      actionId: actionId("approval")
    });
    return status === "approved"
      ? this.text(`${result.execution.shortHandle} approved (${selectedScope}); it is queued to resume.`, `${result.execution.shortHandle} 已批准（${selectedScope}），已排队等待恢复。`)
      : this.text(`${result.execution.shortHandle} approval rejected.`, `${result.execution.shortHandle} 的审批已拒绝。`);
  }

  async handleNaturalApproval(input: DurableChannelCommandInput): Promise<boolean> {
    const normalized = input.text.trim();
    const approvalText = isApprovalText(normalized)
      || isOnceApprovalText(normalized)
      || isPersistentApprovalText(normalized)
      || isSessionApprovalText(normalized)
      || isRejectText(normalized);
    if (!approvalText) return false;
    const pending = this.pendingApprovals(input.scopeId);
    if (pending.length === 0) return false;
    if (pending.length > 1) {
      await input.sendText([
        this.text("Multiple durable approvals are pending; choose a handle.", "当前有多条长任务审批，请先选择任务句柄。"),
        ...pending.map((item) => `- ${item.detail.execution.shortHandle}: ${item.approval.title}`),
        this.text("Use `/durable approve #N once` or `/durable reject #N`.", "使用 `/durable approve #N once` 或 `/durable reject #N`。")
      ].join("\n"));
      return true;
    }
    const selectedScope = isSessionApprovalText(normalized)
      ? "session"
      : isPersistentApprovalText(normalized) ? "persistent" : "once";
    const message = await this.resolveApproval(pending[0], input.scopeId, isRejectText(normalized) ? "rejected" : "approved", selectedScope);
    await input.sendText(message);
    return true;
  }

  async handle(input: DurableChannelCommandInput): Promise<boolean> {
    const parts = input.text.trim().split(/\s+/).filter(Boolean);
    const command = parts[0]?.toLowerCase() ?? "";
    if (!["/durable", "/long-task", "/longtask", "/execution"].includes(command)) return false;
    const subcommand = parts[1]?.toLowerCase() ?? "list";
    const handle = parts[2] ?? "";

    if (subcommand === "list" || subcommand === "ls") {
      await input.sendText(this.listText(input.scopeId));
      return true;
    }
    if (subcommand === "status" || subcommand === "show") {
      const item = this.findItem(input.scopeId, handle);
      await input.sendText(item ? this.detailText(this.coordinator.inspect(this.ownerId, item.execution.id)) : this.text("Durable execution not found in this chat.", "当前会话中找不到这个长任务。"));
      return true;
    }

    if (["approve", "allow", "reject", "deny"].includes(subcommand)) {
      const extra = parts[3]?.toLowerCase();
      const approvalId = extra && !["once", "session", "persistent", "always"].includes(extra) ? parts[3] : undefined;
      const pending = this.findApproval(input.scopeId, handle, approvalId);
      if (!pending) {
        await input.sendText(this.text("Pending durable approval not found in this chat.", "当前会话中找不到待处理的长任务审批。"));
        return true;
      }
      const rejected = subcommand === "reject" || subcommand === "deny";
      const scope = parts[3]?.toLowerCase();
      const selectedScope = scope === "session" ? "session" : scope === "persistent" || scope === "always" ? "persistent" : "once";
      await input.sendText(await this.resolveApproval(pending, input.scopeId, rejected ? "rejected" : "approved", selectedScope));
      return true;
    }

    if (subcommand === "answer") {
      const item = this.findItem(input.scopeId, handle);
      const answer = parts.slice(3).join(" ").trim();
      const detail = item ? this.coordinator.inspect(this.ownerId, item.execution.id) : null;
      const decision = detail?.decisions.find((candidate) => candidate.status === "open");
      if (!detail || !decision || !answer || !decision.options.includes(answer)) {
        await input.sendText(this.text("Choose one exact option from the open decision, using `/durable answer #N <option>`.", "请使用 `/durable answer #N <选项>`，并填写待决定中列出的准确选项。"));
        return true;
      }
      const result = this.coordinator.answerDecision({
        ownerId: this.ownerId,
        executionId: detail.execution.id,
        decisionId: decision.id,
        answer,
        expectedVersion: detail.execution.version,
        actionId: actionId("decision")
      });
      await input.sendText(this.text(`${result.execution.shortHandle} accepted the decision and is queued to resume.`, `${result.execution.shortHandle} 已记录决定，已排队等待恢复。`));
      return true;
    }

    if (["pause", "resume", "cancel"].includes(subcommand)) {
      const item = this.findItem(input.scopeId, handle);
      if (!item) {
        await input.sendText(this.text("Durable execution not found in this chat.", "当前会话中找不到这个长任务。"));
        return true;
      }
      const result = subcommand === "pause"
        ? this.coordinator.pause({ ownerId: this.ownerId, executionId: item.execution.id, expectedVersion: item.execution.version, actionId: actionId("pause") })
        : subcommand === "resume"
          ? this.coordinator.resume({ ownerId: this.ownerId, executionId: item.execution.id, expectedVersion: item.execution.version, actionId: actionId("resume") })
          : this.coordinator.cancel({ ownerId: this.ownerId, executionId: item.execution.id, expectedVersion: item.execution.version, actionId: actionId("cancel") });
      await input.sendText(this.text(`${result.execution.shortHandle} is now ${result.execution.status}.`, `${result.execution.shortHandle} 当前状态：${result.execution.status}。`));
      return true;
    }

    await input.sendText([
      this.text("Durable command usage", "长任务命令用法"),
      "/durable list",
      "/durable status #N",
      "/durable approve #N [once|session|persistent]",
      "/durable reject #N",
      "/durable answer #N <option>",
      "/durable pause|resume|cancel #N"
    ].join("\n"));
    return true;
  }
}
