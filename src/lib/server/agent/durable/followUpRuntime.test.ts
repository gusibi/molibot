import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ChannelInboundMessage, DurableAttemptHooks, DurableAttemptResult } from "$lib/server/agent/core/types.js";
import { HomeNotificationStore } from "$lib/server/app/homeNotifications.js";
import { recordFollowUpHomeNotification } from "$lib/server/app/homeNotificationWriters.js";
import { OutboxDeliveryError } from "$lib/server/channels/shared/outbox.js";
import { PlanService } from "$lib/server/agent/plans/service.js";
import { createFollowUpTool } from "$lib/server/agent/tools/followUp.js";
import { observeFollowUpSources } from "./followUpEvidence.js";
import { deriveFollowUpLifecycle } from "./followUpStore.js";
import { DurableExecutionRuntime } from "./runtime.js";
import { DurableExecutionConflictError } from "./types.js";
import { DurableExecutionStore } from "./store.js";

function okAttemptResult(text: string, totalTokens = 100): DurableAttemptResult {
  return {
    text,
    contextSessionId: "ctx-test",
    result: { stopReason: "stop", usage: { input: totalTokens, output: 0, totalTokens } } as any
  };
}

function runFollowUpWakeup(runtime: DurableExecutionRuntime, executionId: string, expectedVersion: number) {
  return (runtime as unknown as {
    execute: (input: { executionId: string; expectedVersion: number; label: string }) => Promise<unknown>;
  }).execute({ executionId, expectedVersion, label: "test-verify" });
}

function createTestEnv(handler: (inbound: ChannelInboundMessage, hooks?: DurableAttemptHooks) => Promise<DurableAttemptResult>) {
  const dir = mkdtempSync(join(tmpdir(), "molibot-followup-s1-"));
  const workDir = join(dir, "project");
  const outsideDir = join(dir, "outside");
  const dbFile = join(dir, "durable.sqlite");
  const notifDbFile = join(dir, "notifications.sqlite");
  const store = new DurableExecutionStore(dbFile);
  const notifications = new HomeNotificationStore(notifDbFile);

  const webManagers = new Map<string, any>();
  webManagers.set("bot-1", {
    apply: () => {},
    stop: () => {},
    runDurableAttempt: handler
  });
  const channelManagers = new Map<string, Map<string, any>>([["web", webManagers]]);

  const runtime = new DurableExecutionRuntime({
    channelManagers,
    store,
    dataDir: dir,
    wakeupMode: "db",
    onFollowUpNotify: (input) => recordFollowUpHomeNotification(notifications, input)
  });

  return {
    dir,
    workDir,
    outsideDir,
    dbFile,
    store,
    notifications,
    runtime,
    cleanup: () => {
      store.close();
      notifications.close();
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

test("follow-up S1: idempotent create by requestId and conflict on payload mismatch", () => {
  const env = createTestEnv(async () => okAttemptResult(""));
  try {
    const now = new Date("2026-11-21T10:00:00.000Z");
    const baseInput = {
      ownerId: "owner-1",
      botId: "bot-1",
      agentId: "momo",
      title: "跟进周五方案交付",
      goal: "检查 proposal.md 是否补齐预算章节",
      projectId: "proj-1",
      workDir: env.workDir,
      sources: [{ kind: "project_file" as const, relativePath: "proposal.md" }],
      timezone: "Asia/Shanghai",
      checkIntervalMs: 60_000,
      nextCheckAt: new Date("2026-11-21T10:01:00.000Z"),
      expiresAt: new Date("2026-11-22T10:00:00.000Z"),
      notifyTarget: { kind: "desktop" as const },
      requestId: "req-follow-1",
      now
    };

    const first = env.store.followUp.createFollowUp(baseInput);
    assert.equal(first.created, true);
    assert.equal(first.task.mode, "follow_up");
    assert.equal(first.followUp.authorizationRevision, 1);

    // Same requestId + same payload returns original task idempotently.
    const replay = env.store.followUp.createFollowUp(baseInput);
    assert.equal(replay.created, false);
    assert.equal(replay.task.executionId, first.task.executionId);

    // Same requestId + different payload rejects with conflict.
    assert.throws(
      () => env.store.followUp.createFollowUp({ ...baseInput, title: "完全不同的事项" }),
      (err: unknown) => err instanceof DurableExecutionConflictError
    );
  } finally {
    env.cleanup();
  }
});

test("follow-up S1 vertical loop: observe -> notify -> unchanged short-circuit -> changed silent -> complete", async () => {
  const dir = mkdtempSync(join(tmpdir(), "molibot-followup-loop-"));
  const workDir = join(dir, "project");
  const dbFile = join(dir, "durable.sqlite");
  const notifDbFile = join(dir, "notifications.sqlite");
  const store = new DurableExecutionStore(dbFile);
  const notifications = new HomeNotificationStore(notifDbFile);

  const fs = await import("node:fs");
  fs.mkdirSync(workDir, { recursive: true });
  writeFileSync(join(workDir, "proposal.md"), "# 方案\n\n## 背景\n已完成\n\n## 预算\n（待补充）\n", "utf8");

  let modelCalls = 0;
  let nextDecision: "notify" | "silent" = "notify";
  const webManagers = new Map<string, any>([
    ["bot-1", {
      apply: () => {},
      stop: () => {},
      runDurableAttempt: async (inbound: ChannelInboundMessage, hooks?: DurableAttemptHooks) => {
        modelCalls += 1;
        assert.match(inbound.text, /跟进检查/);
        assert.match(inbound.text, /proposal\.md/);
        await hooks?.submitKanbanReceipt?.({
          conclusion: nextDecision === "notify" ? "预算章节仍待补充" : "预算章节已补齐，无需打扰",
          decision: nextDecision,
          ...(nextDecision === "notify" ? {
            notify: { text: "proposal.md 的预算章节目前仍为空，需要补充。" }
          } : {})
        });
        return okAttemptResult("checked", 120);
      }
    }]
  ]);

  const runtime = new DurableExecutionRuntime({
    channelManagers: new Map([["web", webManagers]]),
    store,
    dataDir: dir,
    wakeupMode: "db",
    onFollowUpNotify: (input) => recordFollowUpHomeNotification(notifications, input)
  });

  try {
    const now = new Date();
    const { task } = store.followUp.createFollowUp({
      ownerId: "owner-1",
      botId: "bot-1",
      agentId: "momo",
      title: "跟进周五方案交付",
      goal: "检查 proposal.md 预算章节",
      projectId: "proj-1",
      workDir,
      sources: [{ kind: "project_file", relativePath: "proposal.md" }],
      timezone: "Asia/Shanghai",
      checkIntervalMs: 60_000,
      nextCheckAt: new Date(now.getTime() - 1000),
      expiresAt: new Date(now.getTime() + 3_600_000),
      notifyTarget: { kind: "desktop" },
      now
    });

    // 1. First check: sees missing budget -> calls model -> writes Desktop notification & delivery ledger.
    const exec1 = store.getById(task.executionId)!;
    await runFollowUpWakeup(runtime, task.executionId, exec1.version);
    assert.equal(modelCalls, 1);

    const decisions1 = store.followUp.listDecisions(task.executionId);
    assert.equal(decisions1.length, 1);
    assert.equal(decisions1[0].decision, "notify");

    const deliveries = store.followUp.listDeliveries(task.executionId);
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].status, "sent");

    const unread = notifications.list({ status: "unread", type: "follow-up" });
    assert.equal(unread.length, 1);
    assert.equal(unread[0].refId, task.executionId);
    assert.match(String(unread[0].payload.summary), /预算章节/);

    // 2. Second check with UNCHANGED file: short-circuits to `silent`, ZERO additional model calls.
    const exec2 = store.getById(task.executionId)!;
    await runFollowUpWakeup(runtime, task.executionId, exec2.version);
    assert.equal(modelCalls, 1, "unchanged source must not invoke the model");
    const decisions2 = store.followUp.listDecisions(task.executionId);
    assert.equal(decisions2.length, 2);
    assert.equal(decisions2[1].decision, "silent");
    assert.equal(decisions2[1].reasonCode, "evidence_unchanged");
    assert.equal(notifications.list({ status: "unread", type: "follow-up" }).length, 1);

    // 3. File changes -> model IS invoked, returns `silent` -> still no new notification.
    writeFileSync(join(workDir, "proposal.md"), "# 方案\n\n## 背景\n已完成\n\n## 预算\n总计 5 万元\n", "utf8");
    nextDecision = "silent";
    const exec3 = store.getById(task.executionId)!;
    await runFollowUpWakeup(runtime, task.executionId, exec3.version);
    assert.equal(modelCalls, 2);
    assert.equal(notifications.list({ status: "unread", type: "follow-up" }).length, 1);

    // 4. Restart store on the same DB -> state persists cleanly, and user completes the follow-up.
    store.close();
    const restartedStore = new DurableExecutionStore(dbFile);
    try {
      const persistedTask = restartedStore.kanban.getTask(task.executionId)!;
      assert.equal(persistedTask.mode, "follow_up");
      assert.equal(restartedStore.followUp.listDecisions(task.executionId).length, 3);
      assert.equal(restartedStore.followUp.listDeliveries(task.executionId).length, 1);

      const exec4 = restartedStore.getById(task.executionId)!;
      restartedStore.followUp.completeFollowUp({
        executionId: task.executionId,
        ownerId: "owner-1",
        expectedVersion: exec4.version
      });
      const completedExec = restartedStore.getById(task.executionId)!;
      assert.equal(deriveFollowUpLifecycle(completedExec.status, persistedTask.closeReason), "completed");
    } finally {
      restartedStore.close();
    }
  } finally {
    notifications.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("follow-up S1: bad receipt does not stall, expiry terminates cleanly, and Project slot is never held", async () => {
  const env = createTestEnv(async () => {
    // Deliberately submit NO receipt to simulate malformed/missing model output.
    return okAttemptResult("forgot to call receipt tool", 50);
  });
  const fs = await import("node:fs");
  fs.mkdirSync(env.workDir, { recursive: true });
  writeFileSync(join(env.workDir, "notes.md"), "initial draft", "utf8");

  try {
    const now = new Date();
    const { task: followUpTask } = env.store.followUp.createFollowUp({
      ownerId: "owner-1",
      botId: "bot-1",
      agentId: "momo",
      title: "持续观察笔记",
      goal: "观察 notes.md 变化",
      projectId: "proj-shared",
      workDir: env.workDir,
      sources: [{ kind: "project_file", relativePath: "notes.md" }],
      timezone: "Asia/Shanghai",
      checkIntervalMs: 30_000,
      nextCheckAt: new Date(now.getTime() - 1000),
      expiresAt: new Date(now.getTime() + 120_000),
      notifyTarget: { kind: "desktop" },
      now
    });

    // Run check with missing receipt -> must record analysis_failed and remain `queued` (NOT waiting_for_user).
    const exec1 = env.store.getById(followUpTask.executionId)!;
    await runFollowUpWakeup(env.runtime, followUpTask.executionId, exec1.version);
    const afterBadReceipt = env.store.getById(followUpTask.executionId)!;
    assert.equal(afterBadReceipt.status, "queued");
    assert.equal(env.store.followUp.listDecisions(followUpTask.executionId)[0]?.decision, "analysis_failed");

    // Project advance slot MUST remain free so an execute task on the same Project is never blocked.
    assert.equal(env.store.kanban.getProjectSlot("project:proj-shared"), null);

    // Snooze updates nextCheckAt and bumps version.
    const snoozeTarget = new Date(now.getTime() + 60_000);
    const snoozed = env.store.followUp.snoozeFollowUp({
      executionId: followUpTask.executionId,
      ownerId: "owner-1",
      expectedVersion: afterBadReceipt.version,
      until: snoozeTarget,
      now
    });
    assert.equal(snoozed.nextCheckAt, snoozeTarget.toISOString());

    // Create a second follow-up that is already past expiresAt when wakeup runs -> expires cleanly without calling model.
    const { task: expiringTask } = env.store.followUp.createFollowUp({
      ownerId: "owner-1",
      botId: "bot-1",
      agentId: "momo",
      title: "即将到期事项",
      goal: "到期后自动停止",
      projectId: "proj-shared",
      workDir: env.workDir,
      sources: [{ kind: "project_file", relativePath: "notes.md" }],
      timezone: "Asia/Shanghai",
      checkIntervalMs: 30_000,
      nextCheckAt: new Date(now.getTime() - 2000),
      expiresAt: new Date(now.getTime() + 10),
      notifyTarget: { kind: "desktop" },
      now: new Date(now.getTime() - 5000)
    });
    await new Promise(resolve => setTimeout(resolve, 25));
    const expExec = env.store.getById(expiringTask.executionId)!;
    await runFollowUpWakeup(env.runtime, expiringTask.executionId, expExec.version);
    const afterExpire = env.store.getById(expiringTask.executionId)!;
    const afterExpireTask = env.store.kanban.getTask(expiringTask.executionId)!;
    assert.equal(afterExpire.status, "cancelled");
    assert.equal(afterExpireTask.closeReason, "expired");
    assert.equal(deriveFollowUpLifecycle(afterExpire.status, afterExpireTask.closeReason), "expired");
  } finally {
    env.cleanup();
  }
});

test("follow-up evidence observer blocks traversal, symlinks outside project, missing and binary files", async () => {
  const dir = mkdtempSync(join(tmpdir(), "molibot-followup-ev-"));
  const workDir = join(dir, "proj");
  const outsideDir = join(dir, "outside");
  const fs = await import("node:fs");
  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(outsideDir, { recursive: true });
  writeFileSync(join(outsideDir, "secret.txt"), "top secret", "utf8");
  symlinkSync(join(outsideDir, "secret.txt"), join(workDir, "escape.txt"));
  writeFileSync(join(workDir, "bin.dat"), Buffer.from([0x00, 0x01, 0x02, 0xff]));

  try {
    const { observations } = observeFollowUpSources({
      workDir,
      sources: [
        { kind: "project_file", relativePath: "../outside/secret.txt" },
        { kind: "project_file", relativePath: "escape.txt" },
        { kind: "project_file", relativePath: "missing.md" }
      ],
      previousObservations: new Map()
    });
    assert.equal(observations[0].status, "unavailable");
    assert.equal(observations[0].errorCode, "path_outside_project");
    assert.equal(observations[1].status, "unavailable");
    assert.equal(observations[1].errorCode, "symlink_outside_project");
    assert.equal(observations[2].status, "unavailable");
    assert.equal(observations[2].errorCode, "file_not_found");

    const binResult = observeFollowUpSources({
      workDir,
      sources: [{ kind: "project_file", relativePath: "bin.dat" }],
      previousObservations: new Map()
    });
    assert.equal(binResult.observations[0].status, "unavailable");
    assert.equal(binResult.observations[0].errorCode, "binary_or_non_utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("follow-up S2: fixed check-in still delivers deterministic fallback reminder even when model fails", async () => {
  let modelCalls = 0;
  const env = createTestEnv(async () => {
    modelCalls += 1;
    throw new Error("upstream model provider timeout");
  });
  const fs = await import("node:fs");
  fs.mkdirSync(env.workDir, { recursive: true });
  writeFileSync(join(env.workDir, "spec.md"), "# Spec\nDrafting...", "utf8");

  try {
    const now = new Date();
    const fixedAt = new Date(now.getTime() - 500).toISOString();
    const { task } = env.store.followUp.createFollowUp({
      ownerId: "owner-1",
      botId: "bot-1",
      agentId: "momo",
      title: "周四晚核对方案",
      goal: "核对 spec.md 进度",
      projectId: "proj-1",
      workDir: env.workDir,
      sources: [{ kind: "project_file", relativePath: "spec.md" }],
      timezone: "Asia/Shanghai",
      checkIntervalMs: 60_000,
      nextCheckAt: new Date(now.getTime() - 1000),
      fixedCheckins: [fixedAt],
      expiresAt: new Date(now.getTime() + 3_600_000),
      notifyTarget: { kind: "desktop" },
      now
    });

    const exec1 = env.store.getById(task.executionId)!;
    await runFollowUpWakeup(env.runtime, task.executionId, exec1.version);
    assert.equal(modelCalls, 1);

    const decisions = env.store.followUp.listDecisions(task.executionId);
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0].decision, "notify");
    assert.equal(decisions[0].reasonCode, "fixed_checkin_fallback");

    const unread = env.notifications.list({ status: "unread", type: "follow-up" });
    assert.equal(unread.length, 1);
    assert.match(String(unread[0].payload.summary), /按约定核对/);
    assert.match(String(unread[0].payload.summary), /未能核实/);
  } finally {
    env.cleanup();
  }
});

test("follow-up S2: missingEvidencePolicy reports unavailability honestly once and never claims incomplete", async () => {
  let modelCalls = 0;
  const env = createTestEnv(async () => {
    modelCalls += 1;
    return okAttemptResult("should not be called");
  });
  const fs = await import("node:fs");
  fs.mkdirSync(env.workDir, { recursive: true });

  try {
    const now = new Date();
    const { task } = env.store.followUp.createFollowUp({
      ownerId: "owner-1",
      botId: "bot-1",
      agentId: "momo",
      title: "缺失来源测试",
      goal: "检查不存在的草稿",
      projectId: "proj-1",
      workDir: env.workDir,
      sources: [{ kind: "project_file", relativePath: "not-yet-created.md" }],
      missingEvidencePolicy: "notify_unavailable",
      timezone: "Asia/Shanghai",
      checkIntervalMs: 60_000,
      nextCheckAt: new Date(now.getTime() - 1000),
      expiresAt: new Date(now.getTime() + 3_600_000),
      notifyTarget: { kind: "desktop" },
      now
    });

    // First check: notifies unavailability honestly without invoking the model.
    const exec1 = env.store.getById(task.executionId)!;
    await runFollowUpWakeup(env.runtime, task.executionId, exec1.version);
    assert.equal(modelCalls, 0);
    const unread1 = env.notifications.list({ status: "unread", type: "follow-up" });
    assert.equal(unread1.length, 1);
    assert.match(String(unread1[0].payload.summary), /无法读取/);
    assert.match(String(unread1[0].payload.summary), /并非判定未完成/);

    // Second check with same unavailable state: fingerprint unchanged -> short-circuits silent, no duplicate spam.
    const exec2 = env.store.getById(task.executionId)!;
    await runFollowUpWakeup(env.runtime, task.executionId, exec2.version);
    assert.equal(modelCalls, 0);
    assert.equal(env.notifications.list({ status: "unread", type: "follow-up" }).length, 1);
  } finally {
    env.cleanup();
  }
});

test("follow-up S2: Plan/Execution evidence adapter tracks changes and enforces owner isolation", () => {
  const env = createTestEnv(async () => okAttemptResult(""));
  try {
    const planTask = env.store.kanban.createTask({
      ownerId: "owner-1",
      botId: "bot-1",
      form: "single",
      agentId: "momo",
      title: "主方案任务",
      goal: "产出正式方案",
      projectId: "proj-1",
      completionConditions: [{ description: "完成预算章节" }]
    });
    const otherOwnerTask = env.store.kanban.createTask({
      ownerId: "owner-other",
      botId: "bot-1",
      form: "single",
      agentId: "momo",
      title: "他人任务",
      goal: "不可跨 owner 读取",
      projectId: "proj-1",
      completionConditions: [{ description: "私密" }]
    });

    const first = observeFollowUpSources({
      ownerId: "owner-1",
      projectId: "proj-1",
      sources: [
        { kind: "plan", planId: planTask.executionId },
        { kind: "execution", executionId: otherOwnerTask.executionId }
      ],
      previousObservations: new Map(),
      readExecutionDetail: (id) => env.store.getDetail(id)
    });

    assert.equal(first.observations[0].status, "available");
    assert.match(first.observations[0].textContent ?? "", /产出正式方案/);
    assert.equal(first.observations[1].status, "unavailable");
    assert.equal(first.observations[1].errorCode, "owner_mismatch");
  } finally {
    env.cleanup();
  }
});

test("follow-up S1/S2: PlanService and followUp Agent tool support create -> get -> snooze -> complete", async () => {
  const env = createTestEnv(async () => okAttemptResult(""));
  try {
    const planService = new PlanService(env.store);
    const tool = createFollowUpTool({
      planService,
      ownerId: "owner-1",
      botId: "bot-1",
      agentId: "momo",
      timezone: "Asia/Shanghai",
      projectId: "proj-1",
      workDir: env.workDir
    });

    const now = Date.now();
    const createRes = await tool.execute("c1", {
      action: "create",
      title: "工具委托跟进",
      goal: "检查 readme.md 更新",
      sources: [{ kind: "project_file", relativePath: "readme.md" }],
      checkIntervalMinutes: 30,
      expiresAt: new Date(now + 86_400_000).toISOString(),
      requestId: "tool-req-1"
    });
    const created = JSON.parse((createRes.content[0] as { text: string }).text);
    assert.equal(created.created, true);
    assert.equal(created.lifecycle, "active");

    const getRes = await tool.execute("g1", { action: "get", executionId: created.executionId });
    const fetched = JSON.parse((getRes.content[0] as { text: string }).text);
    assert.equal(fetched.mode, "follow_up");
    assert.equal(fetched.followUp.lifecycle, "active");

    const snoozeUntil = new Date(now + 7_200_000).toISOString();
    const snoozeRes = await tool.execute("s1", {
      action: "snooze",
      executionId: created.executionId,
      expectedVersion: fetched.version,
      until: snoozeUntil
    });
    const snoozed = JSON.parse((snoozeRes.content[0] as { text: string }).text);
    assert.equal(snoozed.snoozed, true);
    assert.equal(snoozed.nextCheckAt, snoozeUntil);

    const completeRes = await tool.execute("done1", {
      action: "complete",
      executionId: created.executionId,
      expectedVersion: snoozed.version
    });
    const completed = JSON.parse((completeRes.content[0] as { text: string }).text);
    assert.equal(completed.completed, true);
    assert.equal(completed.lifecycle, "completed");
  } finally {
    env.cleanup();
  }
});

test("follow-up S3: channel target delivers via shared sendInternalNotice with deliveryKey and records unknown on uncertain outcome", async () => {
  const dir = mkdtempSync(join(tmpdir(), "molibot-followup-s3-"));
  const workDir = join(dir, "project");
  const dbFile = join(dir, "durable.sqlite");
  const notifDbFile = join(dir, "notifications.sqlite");
  const store = new DurableExecutionStore(dbFile);
  const notifications = new HomeNotificationStore(notifDbFile);
  const fs = await import("node:fs");
  fs.mkdirSync(workDir, { recursive: true });
  writeFileSync(join(workDir, "deliverable.md"), "# 交付\n缺少预算", "utf8");

  const sentNotices: Array<{ chatId: string; text: string; metadata: any }> = [];
  let channelMode: "ok" | "unknown" = "ok";

  const webManagers = new Map<string, any>([
    ["bot-1", {
      apply: () => {},
      stop: () => {},
      runDurableAttempt: async (_inbound: ChannelInboundMessage, hooks?: DurableAttemptHooks) => {
        await hooks?.submitKanbanReceipt?.({
          conclusion: "发现缺口",
          decision: "notify",
          notify: { text: "deliverable.md 仍缺少预算部分。" }
        });
        return okAttemptResult("checked");
      }
    }]
  ]);
  const telegramManagers = new Map<string, any>([
    ["tg-bot-1", {
      apply: () => {},
      stop: () => {},
      sendInternalNotice: async (chatId: string, text: string, metadata: any) => {
        sentNotices.push({ chatId, text, metadata });
        if (channelMode === "unknown") {
          throw new OutboxDeliveryError("unknown", "socket hang up after write", { deliveryKey: metadata.deliveryKey });
        }
      }
    }]
  ]);

  const runtime = new DurableExecutionRuntime({
    channelManagers: new Map([
      ["web", webManagers],
      ["telegram", telegramManagers]
    ]),
    store,
    dataDir: dir,
    wakeupMode: "db",
    onFollowUpNotify: (input) => recordFollowUpHomeNotification(notifications, input)
  });

  try {
    const now = new Date();
    const { task: okTask } = store.followUp.createFollowUp({
      ownerId: "owner-1",
      botId: "bot-1",
      agentId: "momo",
      title: "渠道投递测试",
      goal: "检查 deliverable.md",
      projectId: "proj-1",
      workDir,
      sources: [{ kind: "project_file", relativePath: "deliverable.md" }],
      timezone: "Asia/Shanghai",
      checkIntervalMs: 60_000,
      nextCheckAt: new Date(now.getTime() - 1000),
      expiresAt: new Date(now.getTime() + 3_600_000),
      notifyTarget: { kind: "channel", channel: "telegram", instanceId: "tg-bot-1", chatId: "chat-99" },
      now
    });

    const exec1 = store.getById(okTask.executionId)!;
    await runFollowUpWakeup(runtime, okTask.executionId, exec1.version);

    assert.equal(sentNotices.length, 1);
    assert.equal(sentNotices[0].chatId, "chat-99");
    assert.match(sentNotices[0].text, /渠道投递测试/);
    assert.ok(sentNotices[0].metadata.deliveryKey);
    assert.ok(Number.isFinite(sentNotices[0].metadata.expiresAt));
    assert.equal(store.followUp.listDeliveries(okTask.executionId)[0]?.status, "sent");
    assert.equal(store.followUp.listDeliveries(okTask.executionId)[0]?.externalReceipt, "telegram:tg-bot-1");

    // Uncertain outbox error records `unknown` in the follow-up delivery ledger.
    channelMode = "unknown";
    const { task: unkTask } = store.followUp.createFollowUp({
      ownerId: "owner-1",
      botId: "bot-1",
      agentId: "momo",
      title: "不确定投递测试",
      goal: "检查 deliverable.md",
      projectId: "proj-1",
      workDir,
      sources: [{ kind: "project_file", relativePath: "deliverable.md" }],
      timezone: "Asia/Shanghai",
      checkIntervalMs: 60_000,
      nextCheckAt: new Date(now.getTime() - 1000),
      expiresAt: new Date(now.getTime() + 3_600_000),
      notifyTarget: { kind: "channel", channel: "telegram", instanceId: "tg-bot-1", chatId: "chat-99" },
      now
    });
    const exec2 = store.getById(unkTask.executionId)!;
    await runFollowUpWakeup(runtime, unkTask.executionId, exec2.version);
    assert.equal(store.followUp.listDeliveries(unkTask.executionId)[0]?.status, "unknown");
  } finally {
    store.close();
    notifications.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
