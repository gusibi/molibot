import type {
  DesktopHandoverPending,
  DesktopHomeNotification,
  DesktopHomeNotificationType
} from "@molibot/desktop-contract";

export type NotificationStatusFilter = "all" | "unread" | "read";
export type NotificationCategoryFilter = "all" | "session" | "plan" | "memory" | "task" | "action" | "channel";

export interface NotificationOpenTarget {
  sessionId?: string;
  projectId?: string;
  channel?: string;
  title?: string;
  agentId?: string;
  planId?: string;
  executionId?: string;
}

export function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

export function payloadText(item: DesktopHomeNotification, key: string): string {
  const value = item.payload[key];
  return typeof value === "string" ? value.trim() : "";
}

export function payloadList(item: DesktopHomeNotification, key: string): string[] {
  return stringList(item.payload[key]);
}

export function notificationTitle(item: DesktopHomeNotification, zh: boolean): string {
  const text = item.payload.text;
  if (typeof text === "string" && text.trim()) return text.trim();
  if (item.type === "session-completed") {
    const title = payloadText(item, "title");
    return title || (zh ? "对话已完成" : "Conversation completed");
  }
  if (item.type === "memory-review") return zh ? "每日记忆反思" : "Daily memory reflection";
  if (item.type === "materials") return zh ? "今日素材已生成" : "Daily materials are ready";
  if (item.type === "action-required") {
    const title = payloadText(item, "title");
    return title || (zh ? "有待处理事项" : "Needs your attention");
  }
  if (item.type === "plan-completed") {
    const title = payloadText(item, "title");
    return title || (zh ? "计划已完成" : "Plan completed");
  }
  if (item.type === "cross-channel") {
    const count = numberField(item.payload.count) ?? 0;
    return zh ? `渠道有 ${count} 条新回复` : `Replied to ${count} messages`;
  }
  return zh ? "后台任务" : "Background task";
}

export function notificationTypeLabel(type: DesktopHomeNotificationType, zh: boolean): string {
  switch (type) {
    case "session-completed": return zh ? "对话" : "Chat";
    case "plan-completed": return zh ? "计划完成" : "Plan";
    case "memory-review": return zh ? "记忆反思" : "Memory";
    case "materials": return zh ? "每日素材" : "Materials";
    case "task-result": return zh ? "后台任务" : "Task";
    case "task-failed": return zh ? "任务失败" : "Task failed";
    case "action-required": return zh ? "待处理" : "Action";
    case "cross-channel": return zh ? "渠道回复" : "Channels";
  }
}

export function openActionLabel(item: DesktopHomeNotification, zh: boolean): string {
  switch (item.type) {
    case "session-completed":
      return zh ? "定位到对话" : "Open conversation";
    case "plan-completed":
      return zh ? "查看计划" : "View plan";
    case "memory-review":
      return zh ? "打开记忆中心" : "Open Memory Center";
    case "materials":
      return zh ? "打开文件与附件" : "Open files and attachments";
    case "cross-channel":
      return zh ? "打开历史" : "Open history";
    case "action-required":
      return payloadText(item, "planId") ? (zh ? "查看计划" : "View plan") : (zh ? "查看来源对话" : "Open source");
    case "task-result":
    case "task-failed":
      return zh ? "打开自动任务" : "Open automations";
  }
}

export function notificationStatusLabel(status: DesktopHomeNotification["status"], zh: boolean): string {
  if (status === "unread") return zh ? "未读" : "Unread";
  if (status === "resolved") return zh ? "已处理" : "Resolved";
  return zh ? "已读" : "Read";
}

/** Reconciled rows show the underlying event's time, not when the row landed. */
export function displayTime(item: DesktopHomeNotification): string {
  if (item.type === "session-completed") return payloadText(item, "completedAt") || item.updatedAt || item.createdAt;
  if (item.type === "action-required") return payloadText(item, "createdAt") || item.createdAt;
  if (item.type === "plan-completed") return payloadText(item, "updatedAt") || item.createdAt;
  if (item.type === "cross-channel") return payloadText(item, "latestAt") || item.createdAt;
  return item.createdAt;
}

export function failureText(item: DesktopHomeNotification): string {
  const text = item.payload.error;
  return typeof text === "string" ? text : "";
}

export function executionId(item: DesktopHomeNotification): string {
  return typeof item.payload.executionId === "string" ? item.payload.executionId : (item.refId ?? "");
}

export function reflectionFailureCount(item: DesktopHomeNotification): number {
  return numberField(item.payload.failedTargets) ?? 0;
}

export function memoryReviewSummary(item: DesktopHomeNotification, zh: boolean): string {
  const parts: string[] = [];
  const localDate = payloadText(item, "localDate");
  if (localDate) parts.push(localDate);
  const created = numberField(item.payload.createdCandidates);
  if (created !== undefined) parts.push(zh ? `新增候选 ${created} 条` : `${created} candidate(s) created`);
  const committed = numberField(item.payload.committedMemories);
  if (committed !== undefined) parts.push(zh ? `保存记忆 ${committed} 条` : `${committed} memory/memories saved`);
  const pending = numberField(item.payload.pendingReviewCount);
  if (pending !== undefined) {
    const suffix = item.payload.hasMore ? "+" : "";
    parts.push(zh ? `待确认 ${pending}${suffix} 条` : `${pending}${suffix} pending review`);
  }
  const drafts = numberField(item.payload.skillDraftCount);
  if (drafts && drafts > 0) parts.push(zh ? `技能草稿 ${drafts} 条` : `${drafts} skill draft(s)`);
  return parts.join(" · ");
}

export function planProgressText(item: DesktopHomeNotification, zh: boolean): string {
  const progress = item.payload.progress;
  if (!progress || typeof progress !== "object" || Array.isArray(progress)) return "";
  const completed = numberField((progress as { completed?: unknown }).completed);
  const total = numberField((progress as { total?: unknown }).total);
  if (completed === undefined || total === undefined) return "";
  return zh ? `已完成 ${completed}/${total} 步` : `Completed ${completed}/${total}`;
}

/** A pending item with a source (session, plan or run) opens it from its title or action link. */
export function actionOpens(item: DesktopHomeNotification): boolean {
  return Boolean(payloadText(item, "sessionId") || payloadText(item, "planId") || payloadText(item, "executionId"));
}

export function resolveActionOpenTarget(
  item: DesktopHomeNotification,
  live?: DesktopHandoverPending
): NotificationOpenTarget {
  if (live) {
    return {
      sessionId: live.sessionId,
      channel: live.channel,
      title: live.title,
      agentId: live.agentId,
      planId: live.planId,
      executionId: live.executionId
    };
  }
  const sessionId = payloadText(item, "sessionId");
  const channel = payloadText(item, "channel");
  const title = payloadText(item, "title");
  const planId = payloadText(item, "planId");
  const execId = payloadText(item, "executionId");
  return {
    ...(sessionId ? { sessionId } : {}),
    ...(channel ? { channel } : {}),
    ...(title ? { title } : {}),
    ...(item.botId ? { agentId: item.botId } : {}),
    ...(planId ? { planId } : {}),
    ...(execId ? { executionId: execId } : {})
  };
}

export function resolveSessionCompletedTarget(item: DesktopHomeNotification): NotificationOpenTarget {
  return {
    sessionId: payloadText(item, "sessionId") || item.refId,
    projectId: payloadText(item, "projectId") || item.projectId,
    agentId: payloadText(item, "agentId") || item.botId,
    channel: payloadText(item, "channel") || "web",
    title: payloadText(item, "title") || undefined
  };
}

export function matchesNotificationCategory(
  item: DesktopHomeNotification,
  category: NotificationCategoryFilter
): boolean {
  switch (category) {
    case "all":
      return true;
    case "session":
      return item.type === "session-completed";
    case "plan":
      return item.type === "plan-completed"
        || (item.type === "action-required" && (Boolean(payloadText(item, "planId")) || payloadText(item, "kind") === "plan"));
    case "memory":
      return item.type === "memory-review";
    case "task":
      return item.type === "task-result" || item.type === "task-failed" || item.type === "materials";
    case "action":
      return item.type === "action-required";
    case "channel":
      return item.type === "cross-channel";
  }
}
