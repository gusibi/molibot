import assert from "node:assert/strict";
import test from "node:test";
import type { DesktopHomeNotification } from "@molibot/desktop-contract";
import {
  actionOpens,
  displayTime,
  matchesNotificationCategory,
  memoryReviewSummary,
  notificationTitle,
  notificationTypeLabel,
  openActionLabel,
  planProgressText,
  resolveActionOpenTarget,
  resolveSessionCompletedTarget
} from "./homeNotificationView";

function makeNotification(overrides: Partial<DesktopHomeNotification>): DesktopHomeNotification {
  return {
    id: "n-1",
    type: "task-result",
    payload: {},
    status: "unread",
    createdAt: "2026-11-10T08:00:00.000Z",
    updatedAt: "2026-11-10T08:00:00.000Z",
    ...overrides
  };
}

test("resolveActionOpenTarget falls back to payload fields when live pending item is gone", () => {
  const resolved = makeNotification({
    type: "action-required",
    status: "resolved",
    botId: "default",
    payload: {
      kind: "plan",
      title: "重构工作台",
      planId: "plan-42",
      sessionId: "sess-9",
      channel: "web"
    }
  });
  assert.equal(actionOpens(resolved), true);
  assert.deepEqual(resolveActionOpenTarget(resolved), {
    sessionId: "sess-9",
    channel: "web",
    title: "重构工作台",
    agentId: "default",
    planId: "plan-42"
  });
});

test("matchesNotificationCategory groups plan, memory, task, action and channel notifications accurately", () => {
  const planCompleted = makeNotification({ type: "plan-completed", payload: { planId: "p1", title: "Plan" } });
  const planApproval = makeNotification({ type: "action-required", payload: { kind: "plan", planId: "p2" } });
  const memory = makeNotification({ type: "memory-review" });
  const materials = makeNotification({ type: "materials" });
  const taskFailed = makeNotification({ type: "task-failed" });
  const crossChannel = makeNotification({ type: "cross-channel" });

  assert.equal(matchesNotificationCategory(planCompleted, "plan"), true);
  assert.equal(matchesNotificationCategory(planApproval, "plan"), true);
  assert.equal(matchesNotificationCategory(planApproval, "action"), true);
  assert.equal(matchesNotificationCategory(memory, "memory"), true);
  assert.equal(matchesNotificationCategory(materials, "task"), true);
  assert.equal(matchesNotificationCategory(taskFailed, "task"), true);
  assert.equal(matchesNotificationCategory(crossChannel, "channel"), true);
  assert.equal(matchesNotificationCategory(memory, "plan"), false);
});

test("notificationTitle, displayTime, memoryReviewSummary and planProgressText format known fields without fabrication", () => {
  const memory = makeNotification({
    type: "memory-review",
    payload: { localDate: "2026-11-10", createdCandidates: 3, committedMemories: 1, pendingReviewCount: 2, skillDraftCount: 1 }
  });
  assert.equal(notificationTitle(memory, true), "每日记忆反思");
  assert.equal(memoryReviewSummary(memory, true), "2026-11-10 · 新增候选 3 条 · 保存记忆 1 条 · 待确认 2 条 · 技能草稿 1 条");

  const plan = makeNotification({
    type: "plan-completed",
    payload: { title: "交付计划", updatedAt: "2026-11-10T10:30:00.000Z", progress: { completed: 4, total: 4 } }
  });
  assert.equal(notificationTitle(plan, true), "交付计划");
  assert.equal(displayTime(plan), "2026-11-10T10:30:00.000Z");
  assert.equal(planProgressText(plan, true), "已完成 4/4 步");
});

test("session-completed notifications format title, category, action label and target", () => {
  const sessionNote = makeNotification({
    type: "session-completed",
    refId: "sess-88",
    botId: "personal",
    projectId: "proj-3",
    payload: {
      sessionId: "sess-88",
      title: "季度复盘梳理",
      preview: "已汇总本季度关键指标与风险项。",
      agentId: "writer",
      projectId: "proj-3",
      channel: "web",
      completedAt: "2026-11-14T06:15:00.000Z"
    }
  });
  assert.equal(notificationTitle(sessionNote, true), "季度复盘梳理");
  assert.equal(notificationTypeLabel(sessionNote.type, true), "对话");
  assert.equal(openActionLabel(sessionNote, true), "定位到对话");
  assert.equal(displayTime(sessionNote), "2026-11-14T06:15:00.000Z");
  assert.equal(matchesNotificationCategory(sessionNote, "session"), true);
  assert.equal(matchesNotificationCategory(sessionNote, "task"), false);
  assert.deepEqual(resolveSessionCompletedTarget(sessionNote), {
    sessionId: "sess-88",
    projectId: "proj-3",
    agentId: "writer",
    channel: "web",
    title: "季度复盘梳理"
  });
});
