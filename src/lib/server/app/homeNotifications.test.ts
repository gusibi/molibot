import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HomeNotificationStore } from "./homeNotifications.js";
import {
  recordReflectionHomeNotification,
  recordMaterialsHomeNotification,
  recordTaskHomeNotification,
  reconcileCrossChannelNotification,
  reconcileMemoryReviewNotification,
  reconcilePendingNotifications,
  reconcilePlanCompletions
} from "./homeNotificationWriters.js";

function withStore(run: (store: HomeNotificationStore) => Promise<void> | void): Promise<void> | void {
  const dir = mkdtempSync(join(tmpdir(), "molibot-home-notifications-"));
  const store = new HomeNotificationStore(join(dir, "notifications.sqlite"));
  const finish = (): void => { store.close(); rmSync(dir, { recursive: true, force: true }); };
  try {
    const result = run(store);
    if (result instanceof Promise) return result.finally(finish);
    finish();
  } catch (cause) {
    finish();
    throw cause;
  }
}

function withReopenableStore(run: (store: HomeNotificationStore, reopen: () => HomeNotificationStore) => Promise<void> | void): Promise<void> | void {
  const dir = mkdtempSync(join(tmpdir(), "molibot-home-notifications-"));
  const dbFile = join(dir, "notifications.sqlite");
  const store = new HomeNotificationStore(dbFile);
  const reopen = (): HomeNotificationStore => new HomeNotificationStore(dbFile);
  const finish = (): void => { store.close(); rmSync(dir, { recursive: true, force: true }); };
  try {
    const result = run(store, reopen);
    if (result instanceof Promise) return result.finally(finish);
    finish();
  } catch (cause) {
    finish();
    throw cause;
  }
}

test("notification rows round-trip through a reopened store with payload and status intact", () => withReopenableStore((store, reopen) => {
  store.record({ type: "memory-review", dedupeKey: "memory-review:owner:2026-11-07", payload: { pendingReviewCount: 2, scannedConversations: 497 } });
  store.record({ type: "materials", dedupeKey: "materials:owner:2026-11-07", payload: { createdFiles: ["daily/a.md"] } });
  store.record({ type: "task-failed", dedupeKey: "task:t1:e1", refId: "e1", payload: { taskId: "t1", error: "boom" } });
  store.close();

  const reopened = reopen();
  const unread = reopened.listUnread();
  assert.deepEqual(unread.map(item => item.type), ["task-failed", "materials", "memory-review"]);
  const review = unread.find(item => item.type === "memory-review")!;
  assert.equal(review.payload.pendingReviewCount, 2);
  assert.equal(review.status, "unread");
  assert.equal(review.readAt, undefined);
}));

test("recording is idempotent per dedupe key and changed payload reopens the row", () => withStore((store) => {  const first = store.record({ type: "memory-review", dedupeKey: "memory-review:owner:2026-11-07", payload: { pendingReviewCount: 1 } });
  const again = store.record({ type: "memory-review", dedupeKey: "memory-review:owner:2026-11-07", payload: { pendingReviewCount: 1 } });
  assert.equal(again.id, first.id);
  assert.equal(store.listUnread().length, 1);

  store.markRead(first.id);
  assert.equal(store.listUnread().length, 0);

  const changed = store.record({ type: "memory-review", dedupeKey: "memory-review:owner:2026-11-07", payload: { pendingReviewCount: 3 } });
  assert.equal(changed.id, first.id);
  assert.equal(changed.status, "unread");
  assert.equal(changed.payload.pendingReviewCount, 3);
  assert.equal(store.listUnread().length, 1);
}));

test("resolved rows never resurrect and read state is owner-level, not per browser", () => withStore((store) => {
  store.record({ type: "task-failed", dedupeKey: "task:t1:e1", payload: { taskId: "t1" } });
  store.resolveByDedupe("task:t1:e1");
  const rereun = store.record({ type: "task-failed", dedupeKey: "task:t1:e1", payload: { taskId: "t1", error: "again" } });
  assert.equal(rereun.status, "resolved");
  assert.equal(store.listUnread().length, 0);

  store.record({ type: "materials", dedupeKey: "materials:owner:2026-11-08", payload: {} });
  assert.equal(store.markAllRead(), 1);
  assert.equal(store.listUnread().length, 0);
  assert.equal(store.markAllRead(), 0);
  const resolved = store.get(store.listUnread()[0]?.id ?? "");
  assert.equal(resolved, null);
}));

test("retention drops terminal rows past the window, unread rows survive", () => withStore((store) => {
  store.record({ type: "materials", dedupeKey: "m:1", payload: {} });
  store.record({ type: "materials", dedupeKey: "m:2", payload: {} });
  store.record({ type: "materials", dedupeKey: "m:3", payload: {} });
  store.markRead(store.listUnread().find(item => item.dedupeKey === "m:1")!.id);
  store.markRead(store.listUnread().find(item => item.dedupeKey === "m:2")!.id);
  // Simulate age by rewriting updated_at through the underlying connection.
  const aged = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
  (store as unknown as { db: { prepare(sql: string): { run(...args: unknown[]): unknown } } }).db
    .prepare("UPDATE home_notifications SET updated_at = ? WHERE dedupe_key IN ('m:1', 'm:2')")
    .run(aged);
  store.record({ type: "memory-review", dedupeKey: "r:1", payload: {} });
  assert.equal(store.retain({ keepDays: 30 }), 2);
  assert.deepEqual(store.listUnread().map(item => item.dedupeKey), ["r:1", "m:3"]);
}));

test("writers stay quiet on an all-zero success and record real content and failures", () => withStore((store) => {
  recordReflectionHomeNotification(store, { localDate: "2026-11-07", completedTargets: 1, failedTargets: 0 });
  recordMaterialsHomeNotification(store, { localDate: "2026-11-07", createdFiles: [] });
  assert.equal(store.listUnread().length, 0);
  recordReflectionHomeNotification(store, { localDate: "2026-11-07", completedTargets: 1, failedTargets: 0, pendingReviewCount: 2 });
  recordMaterialsHomeNotification(store, { localDate: "2026-11-07", createdFiles: ["daily/a.md"] });
  recordTaskHomeNotification(store, { taskId: "t1", executionId: "e1", text: "导出数据", status: "error", error: "boom" });
  const unread = store.listUnread();
  assert.equal(unread.length, 3);
  const failed = unread.find(item => item.type === "task-failed")!;
  assert.equal(failed.refId, "e1");
  assert.equal(failed.payload.error, "boom");
  assert.equal(failed.payload.text, "导出数据");
  const review = unread.find(item => item.type === "memory-review")!;
  assert.equal(review.payload.pendingReviewCount, 2);
}));

test("pending reconcile mirrors items, never rewrites read rows, and resolves leavers", () => withStore((store) => {
  const approval = {
    id: "approval:1", kind: "approval" as const, title: "Run the deploy", detail: "deploy --now", createdAt: "2026-11-07T01:00:00Z",
    agentId: "default", actionable: true, requestId: "req-1", scope: "production deploy"
  };
  reconcilePendingNotifications(store, [approval]);
  const row = store.listUnreadByType("action-required")[0];
  assert.equal(row.refId, "approval:1");
  assert.equal(row.botId, "default");
  assert.equal(row.payload.kind, "approval");
  assert.equal(row.payload.requestId, "req-1");
  assert.equal("expectedVersion" in row.payload, false);

  // An identical reconcile after 已阅 leaves the row read — no churn, no reopen.
  store.markRead(row.id);
  reconcilePendingNotifications(store, [approval]);
  assert.equal(store.listUnreadByType("action-required").length, 0);
  assert.equal(store.get(row.id)?.status, "read");

  // Changed content re-opens the row for a fresh look.
  reconcilePendingNotifications(store, [{ ...approval, detail: "deploy --now --force" }]);
  assert.equal(store.listUnreadByType("action-required").length, 1);
  assert.equal(store.get(row.id)?.payload.detail, "deploy --now --force");

  // An item that left the pending list resolves its row.
  reconcilePendingNotifications(store, []);
  assert.equal(store.listUnreadByType("action-required").length, 0);
  assert.equal(store.get(row.id)?.status, "resolved");
}));

test("cross-channel aggregate reopens on newer replies and only 已阅 ends it", () => withStore((store) => {
  reconcileCrossChannelNotification(store, { count: 3, channels: ["feishu", "weixin"], latestAt: "2026-11-07T09:00:00Z" });
  const row = store.listUnreadByType("cross-channel")[0];
  assert.equal(row.payload.count, 3);
  assert.deepEqual(row.payload.channels, ["feishu", "weixin"]);

  store.markRead(row.id);
  reconcileCrossChannelNotification(store, { count: 3, channels: ["feishu", "weixin"], latestAt: "2026-11-07T09:00:00Z" });
  assert.equal(store.listUnreadByType("cross-channel").length, 0);

  reconcileCrossChannelNotification(store, { count: 4, channels: ["feishu"], latestAt: "2026-11-07T10:00:00Z" });
  assert.equal(store.listUnreadByType("cross-channel").length, 1);

  // The aggregate can leave the acknowledgment window; that must not resolve
  // the row — a resolved row would never resurrect and mute future replies.
  reconcileCrossChannelNotification(store, undefined);
  assert.equal(store.listUnreadByType("cross-channel").length, 1);
}));

test("plan completions record fresh finishes, skip stale history, and resolve on removal", () => withStore((store) => {
  const now = Date.now();
  reconcilePlanCompletions(store, [
    { planId: "p1", title: "Fresh plan", updatedAt: new Date(now - 60_000).toISOString(), progress: { completed: 3, total: 3 } },
    { planId: "p2", title: "Old plan", updatedAt: new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString() }
  ], now);
  const rows = store.listUnreadByType("plan-completed");
  assert.deepEqual(rows.map(row => row.refId), ["p1"]);
  assert.equal(rows[0].payload.title, "Fresh plan");
  assert.deepEqual(rows[0].payload.progress, { completed: 3, total: 3 });

  reconcilePlanCompletions(store, [], now);
  assert.equal(store.listUnreadByType("plan-completed").length, 0);
  assert.equal(store.get(rows[0].id)?.status, "resolved");
}));

test("memory-review reconcile records fresh candidates, reopens a read row on growth, and stays quiet on shrink", () => withStore((store) => {
  const day = "2026-11-07";
  const review = (count: number) => ({
    items: Array.from({ length: Math.min(10, count) }, (_, i) => ({ id: `c${i}` })) as import("$lib/shared/desktop.js").DesktopMemoryCandidate[],
    pendingReviewCount: count, hasMore: count > 10, unavailable: false
  });

  reconcileMemoryReviewNotification(store, review(2), day);
  const row = store.getByDedupe(`memory-review:owner:${day}`)!;
  assert.equal(row.status, "unread");
  assert.equal(row.payload.pendingReviewCount, 2);

  // An identical reconcile after 已阅 keeps the row read — no churn.
  store.markRead(row.id);
  reconcileMemoryReviewNotification(store, review(2), day);
  assert.equal(store.get(row.id)?.status, "read");

  // Candidates confirmed by the owner shrink the live count; that is not news.
  reconcileMemoryReviewNotification(store, review(1), day);
  assert.equal(store.get(row.id)?.status, "read");

  // New candidates grew the count past what the owner last saw: reopen once.
  reconcileMemoryReviewNotification(store, review(5), day);
  const reopened = store.getByDedupe(`memory-review:owner:${day}`)!;
  assert.equal(reopened.status, "unread");
  assert.equal(reopened.payload.pendingReviewCount, 5);
  assert.equal(store.listUnread().length, 1);
}));

test("memory-review reconcile resolves unread rows when nothing is left to review, keeps failures", () => withStore((store) => {
  const day = "2026-11-07";
  const review = (count: number, extra: Record<string, unknown> = {}) => ({
    items: Array.from({ length: Math.min(10, count) }, (_, i) => ({ id: `c${i}` })) as import("$lib/shared/desktop.js").DesktopMemoryCandidate[],
    pendingReviewCount: count, hasMore: count > 10, unavailable: false, ...extra
  });

  // Yesterday's and today's rows both point at the same live candidate pool;
  // once it drains, neither may keep a contentless card on the home.
  const stale = store.record({ type: "memory-review", dedupeKey: "memory-review:owner:2026-11-06", payload: { pendingReviewCount: 3 } });
  const failed = store.record({ type: "memory-review", dedupeKey: "memory-review:owner:2026-11-05", payload: { pendingReviewCount: 0, failedTargets: 2 } });

  reconcileMemoryReviewNotification(store, review(0), day);
  assert.equal(store.get(stale.id)?.status, "resolved");
  assert.equal(store.get(failed.id)?.status, "unread", "failure rows keep their marker until read");
  assert.equal(store.listUnread().length, 1);

  // An empty live review never writes a fresh row either.
  reconcileMemoryReviewNotification(store, review(0), day);
  assert.equal(store.getByDedupe(`memory-review:owner:${day}`), null);

  // Candidates appearing again starts a fresh row.
  reconcileMemoryReviewNotification(store, review(4), day);
  assert.equal(store.getByDedupe(`memory-review:owner:${day}`)?.status, "unread");

  // A read error proves nothing about the rows; leave them alone.
  const before = store.listUnread().length;
  reconcileMemoryReviewNotification(store, { items: [], hasMore: false, unavailable: true }, day);
  assert.equal(store.listUnread().length, before);
}));

test("memory-review reconcile preserves reflection failures and clears stale live counters", () => withStore((store) => {
  const day = "2026-11-08";
  const stats = { localDate: day, completedTargets: 1, failedTargets: 2, failedSessions: 3, committedMemories: 4, pendingReviewCount: 20, skillDraftCount: 2 };
  recordReflectionHomeNotification(store, stats);
  const row = store.getByDedupe(`memory-review:owner:${day}`)!;
  const review = (count: number) => ({ items: [], pendingReviewCount: count, hasMore: count > 10, unavailable: false });
  reconcileMemoryReviewNotification(store, review(20), day);
  reconcileMemoryReviewNotification(store, review(1), day);
  const updated = store.get(row.id)!;
  for (const key of ["localDate", "completedTargets", "failedTargets", "failedSessions", "committedMemories"] as const) {
    assert.equal(updated.payload[key], stats[key]);
  }
  assert.equal(updated.payload.pendingReviewCount, 1);
  assert.equal(Boolean(updated.payload.hasMore), false);
  assert.equal(Number(updated.payload.skillDraftCount ?? 0), 0);
  reconcileMemoryReviewNotification(store, review(0), day);
  assert.equal(store.get(row.id)?.status, "unread");
  store.markRead(row.id);
  reconcileMemoryReviewNotification(store, review(2), day);
  assert.equal(store.get(row.id)?.status, "unread");
  assert.equal(store.get(row.id)?.payload.failedTargets, 2);
}));

test("reopenByDedupe re-opens only a read or resolved row and refreshes payload and time", () => withStore((store) => {
  const row = store.record({ type: "memory-review", dedupeKey: "memory-review:owner:2026-11-07", payload: { pendingReviewCount: 1 } });
  store.markRead(row.id);
  const reopened = store.reopenByDedupe("memory-review:owner:2026-11-07", { pendingReviewCount: 4 });
  assert.equal(reopened?.status, "unread");
  assert.equal(reopened?.payload.pendingReviewCount, 4);
  assert.equal(reopened?.readAt, undefined);
  assert.equal(store.listUnread().length, 1);

  // An unread row is left alone (record() owns unread updates).
  const untouched = store.reopenByDedupe("memory-review:owner:2026-11-07", { pendingReviewCount: 9 });
  assert.equal(untouched?.payload.pendingReviewCount, 4);

  // A resolved row can also come back when a caller proves growth.
  store.resolveByDedupe("memory-review:owner:2026-11-07");
  const revived = store.reopenByDedupe("memory-review:owner:2026-11-07", { pendingReviewCount: 6 });
  assert.equal(revived?.status, "unread");
  assert.equal(revived?.payload.pendingReviewCount, 6);

  assert.equal(store.reopenByDedupe("missing:key", {}), null);
}));
