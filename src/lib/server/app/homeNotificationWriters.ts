import type { DesktopHandoverCrossChannel, DesktopHandoverPending, DesktopHomeMemoryReview } from "$lib/shared/desktop.js";
import type { HomeNotificationStore } from "./homeNotifications.js";

/**
 * Producer-side writers for the home notification center. Each helper owns one
 * producer's quiet rule: a notification is only written when the owner would
 * actually have something to see or review — an all-zero success is silence,
 * not a card.
 */

export interface ReflectionNotificationStats {
  localDate: string;
  completedTargets: number;
  failedTargets: number;
  failedSessions?: number;
  createdCandidates?: number;
  committedMemories?: number;
  pendingReviewCount?: number;
  skillDraftCount?: number;
}

export function recordReflectionHomeNotification(store: HomeNotificationStore, stats: ReflectionNotificationStats): void {
  const hasContent = (stats.pendingReviewCount ?? 0) > 0
    || (stats.skillDraftCount ?? 0) > 0
    || (stats.createdCandidates ?? 0) > 0
    || (stats.committedMemories ?? 0) > 0
    || stats.failedTargets > 0;
  if (!hasContent) return;
  store.record({
    type: "memory-review",
    dedupeKey: `memory-review:owner:${stats.localDate}`,
    payload: { ...stats }
  });
}

export interface MaterialsNotificationStats {
  localDate: string;
  createdFiles: string[];
}

export function recordMaterialsHomeNotification(store: HomeNotificationStore, stats: MaterialsNotificationStats): void {
  if (stats.createdFiles.length === 0) return;
  store.record({
    type: "materials",
    dedupeKey: `materials:owner:${stats.localDate}`,
    payload: { ...stats }
  });
}

/** One terminal task attempt, as seen by the event dispatcher. */
export interface TaskTerminalInput {
  taskId: string;
  executionId: string;
  text?: string;
  status: "success" | "error";
  error?: string;
}

export function recordTaskHomeNotification(store: HomeNotificationStore, input: TaskTerminalInput): void {
  const failed = input.status === "error";
  store.record({
    type: failed ? "task-failed" : "task-result",
    dedupeKey: `task:${input.taskId}:${input.executionId}`,
    refId: input.executionId,
    payload: { taskId: input.taskId, executionId: input.executionId, ...(input.text ? { text: input.text } : {}), ...(input.error ? { error: input.error } : {}) }
  });
}

/**
 * Reconcile the memory-review notification so the inbox lists pending
 * candidates the moment they exist, whatever produced them (backfill,
 * seeding, a run between reflections). Shares the reflection writer's dedupe
 * key. Live count updates preserve the nightly result and failure fields.
 *
 * The row records live counts, so a row the owner already read reopens
 * exactly once when the live pending count grows past what they last saw;
 * confirmations shrink the count and stay quiet.
 *
 * When nothing is left to review (all candidates confirmed or dismissed
 * elsewhere) unread rows resolve themselves: a card without data is noise.
 * Failure rows keep their failure marker until the owner reads them.
 */
export function reconcileMemoryReviewNotification(store: HomeNotificationStore, review: DesktopHomeMemoryReview | undefined, localDate: string): void {
  if (!review || review.unavailable) return;
  const dedupeKey = `memory-review:owner:${localDate}`;
  const pendingCount = review.pendingReviewCount ?? review.items.length;
  if (pendingCount === 0 && !review.skillDraftCount) {
    for (const row of store.listUnreadByType("memory-review")) {
      if (!(Number(row.payload.failedTargets) > 0)) store.resolveByDedupe(row.dedupeKey);
    }
    return;
  }
  const existing = store.getByDedupe(dedupeKey);
  const payload = {
    ...existing?.payload,
    pendingReviewCount: pendingCount,
    hasMore: Boolean(review.hasMore),
    skillDraftCount: review.skillDraftCount ?? 0
  };
  if (!existing || existing.status === "unread") {
    store.record({ type: "memory-review", dedupeKey, payload });
    return;
  }
  const previousCount = typeof existing.payload.pendingReviewCount === "number" ? existing.payload.pendingReviewCount : 0;
  if (payload.pendingReviewCount > previousCount) {
    store.reopenByDedupe(dedupeKey, payload);
  }
}

/**
 * Mirror `handover.pending` into action-required rows. The payload is a stable
 * snapshot without the volatile `expectedVersion`, so a reconcile that runs on
 * every handover read never re-opens a card the owner already read; actions
 * resolve through the live pending item, never the snapshot. Items that leave
 * `pending` (approved, answered, expired) resolve their rows.
 */
export function reconcilePendingNotifications(store: HomeNotificationStore, pending: readonly DesktopHandoverPending[]): void {
  const active = new Set<string>();
  for (const item of pending) {
    const dedupeKey = `pending:${item.id}`;
    active.add(dedupeKey);
    store.record({
      type: "action-required",
      dedupeKey,
      refId: item.id,
      botId: item.agentId,
      payload: {
        kind: item.kind,
        title: item.title,
        createdAt: item.createdAt,
        actionable: item.actionable,
        ...(item.detail ? { detail: item.detail } : {}),
        ...(item.waitKind ? { waitKind: item.waitKind } : {}),
        ...(item.requestId ? { requestId: item.requestId } : {}),
        ...(item.approvalId ? { approvalId: item.approvalId } : {}),
        ...(item.executionId ? { executionId: item.executionId } : {}),
        ...(item.decisionId ? { decisionId: item.decisionId } : {}),
        ...(item.planId ? { planId: item.planId } : {}),
        ...(item.sessionId ? { sessionId: item.sessionId } : {}),
        ...(item.channel ? { channel: item.channel } : {}),
        ...(item.options?.length ? { options: item.options } : {}),
        ...(item.goal ? { goal: item.goal } : {}),
        ...(item.scope ? { scope: item.scope } : {})
      }
    });
  }
  for (const row of store.listUnreadByType("action-required")) {
    if (!active.has(row.dedupeKey)) store.resolveByDedupe(row.dedupeKey);
  }
}

/**
 * The cross-channel unread aggregate: one row, re-opened only when a newer
 * reply changes the payload (count or latestAt). The row never resolves from a
 * reconcile — the aggregate can flicker out of the acknowledgment window, and
 * a resolved row would never resurrect, permanently muting future replies.
 * Only 已阅 ends the row.
 */
export function reconcileCrossChannelNotification(store: HomeNotificationStore, crossChannel?: DesktopHandoverCrossChannel): void {
  if (crossChannel && crossChannel.count > 0) {
    store.record({
      type: "cross-channel",
      dedupeKey: "cross-channel:owner",
      payload: { count: crossChannel.count, channels: crossChannel.channels, latestAt: crossChannel.latestAt }
    });
  }
}

/** One completed delegated plan, as the plan service reports it. */
export interface CompletedPlanInput {
  planId: string;
  title: string;
  updatedAt: string;
  progress?: { completed: number; total: number };
}

/** Completions older than this are history, not news; a first sweep must not backfill. */
const PLAN_COMPLETION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Mirror finished plans into plan-completed rows. Only fresh completions (the
 * window above) become cards; rows leave as unread when the plan is no longer
 * reported completed (deleted, archived out).
 */
export function reconcilePlanCompletions(store: HomeNotificationStore, plans: readonly CompletedPlanInput[], now = Date.now()): void {
  const completed = new Set<string>();
  for (const plan of plans) {
    const completedAt = Date.parse(plan.updatedAt);
    if (!Number.isFinite(completedAt) || now - completedAt > PLAN_COMPLETION_WINDOW_MS) continue;
    const dedupeKey = `plan-completed:${plan.planId}`;
    completed.add(dedupeKey);
    store.record({
      type: "plan-completed",
      dedupeKey,
      refId: plan.planId,
      payload: { planId: plan.planId, title: plan.title, updatedAt: plan.updatedAt, ...(plan.progress ? { progress: plan.progress } : {}) }
    });
  }
  for (const row of store.listUnreadByType("plan-completed")) {
    if (!completed.has(row.dedupeKey)) store.resolveByDedupe(row.dedupeKey);
  }
}
