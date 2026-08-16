import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { tmpdir } from "node:os";
import type { MomEvent } from "./events";
import {
  collectMemoryReflectionInternals,
  deliverMemoryTaskNotification,
  deliverMemoryReviewBatch,
  dispatchTaskEvent,
  dispatchProjectTaskEvent,
  ensureOwnerDailyMaterialsEvent,
  ensureOwnerMemoryMaintenanceEvent,
  ensureOwnerMemoryReflectionEvent,
  formatDailyMaterialsNotification,
  listMemoryReflectionNotificationTargets,
  migrateLegacyManagedMemoryEvents,
  migrateLegacyWebTaskEvents,
  resolveMemoryReflectionNotificationTarget
} from "./taskScheduler";
import { executeOwnerMemoryReflection, formatOwnerMemoryReflectionNotification, OwnerMemoryReflectionError } from "./ownerMemoryReflection";

test("migrates legacy Web scratch events into the bot-level watched directory", () => {
  const botsRoot = mkdtempSync(join(tmpdir(), "molibot-web-events-"));
  const legacyEventsDir = join(botsRoot, "default", "web:default:web-anonymous", "scratch", "events");
  const eventPath = join(legacyEventsDir, "periodic-123.json");
  const event = { type: "periodic", chatId: "web:default:web-anonymous", text: "Send summary" };
  mkdirSync(legacyEventsDir, { recursive: true });
  writeFileSync(eventPath, `${JSON.stringify(event)}\n`);

  try {
    const migrated = migrateLegacyWebTaskEvents(botsRoot);
    const destination = join(botsRoot, "default", "events", "periodic-123.json");

    assert.deepEqual(migrated, [destination]);
    assert.equal(existsSync(eventPath), false);
    assert.deepEqual(JSON.parse(readFileSync(destination, "utf8")), event);
  } finally {
    rmSync(botsRoot, { recursive: true, force: true });
  }
});

test("internal memory reflection bypasses channel task delivery", async () => {
  let internalCalls = 0;
  let channelCalls = 0;
  const event: MomEvent = {
    type: "periodic",
    chatId: "internal-memory",
    text: "",
    schedule: "0 3 * * *",
    timezone: "Asia/Shanghai",
    execution: "internal",
    internal: { kind: "memory-reflection", target: { ownerId: "owner", botId: "momo", timezone: "Asia/Shanghai", sourceScopes: [] } }
  };
  await dispatchTaskEvent(event, "memory-reflection.json", { triggerTask: async () => { channelCalls += 1; } } as any, async () => { internalCalls += 1; });
  assert.equal(internalCalls, 1);
  assert.equal(channelCalls, 0);
});

test("Project task dispatch requires a matching Project target and uses only the Project executor", async () => {
  const delivered: string[] = [];
  const event: MomEvent = {
    type: "periodic",
    taskId: "task-project",
    chatId: "project:work",
    target: { kind: "project", projectId: "work" },
    text: "Summarize today's work",
    delivery: "agent",
    sessionMode: "fresh",
    schedule: "0 18 * * *",
    timezone: "Asia/Shanghai"
  };
  await dispatchProjectTaskEvent(event, "periodic-work.json", "work", {
    triggerProjectTask: async (_event, filename) => { delivered.push(filename); },
    triggerTask: async () => { throw new Error("Channel delivery must not run"); }
  } as any);
  assert.deepEqual(delivered, ["periodic-work.json"]);
  await assert.rejects(
    () => dispatchProjectTaskEvent(event, "periodic-work.json", "other", { triggerProjectTask: async () => undefined } as any),
    /does not match/
  );
});

test("internal reflection sends one separate context-free notice only when requested", async () => {
  const deliveries: any[] = [];
  let taskCalls = 0;
  const event: MomEvent = {
    type: "periodic", chatId: "internal-memory", text: "", schedule: "15 4 * * *", timezone: "Asia/Shanghai", execution: "internal",
    internal: { kind: "memory-reflection", notificationChatId: "chat-1", target: { ownerId: "owner", botId: "momo", timezone: "Asia/Shanghai", sourceScopes: [] } }
  };
  await dispatchTaskEvent(event, "memory-reflection.json", {
    triggerTask: async () => { taskCalls += 1; },
    sendInternalNotice: async (chatId: string, text: string, metadata: unknown) => { deliveries.push({ chatId, text, metadata }); }
  } as any, async () => ({ notificationText: "新增 2 条候选", kind: "memory-reflection" }));
  assert.equal(taskCalls, 0, "internal completion notices must not enter the scheduled Agent task path");
  assert.deepEqual(deliveries, [{
    chatId: "chat-1",
    text: "新增 2 条候选",
    metadata: { kind: "memory-reflection", filename: "memory-reflection.json" }
  }]);
});

test("owner runtime creates one dynamic reflection event regardless of Bot count", () => {
  const eventsDir = mkdtempSync(join(tmpdir(), "molibot-reflection-event-"));
  try {
    const settings = { timezone: "Asia/Shanghai", plugins: { memory: { enabled: true, backend: "mory", reflectionTime: "03:00", reflectionNotifications: true } }, channels: { web: { instances: [{ id: "momo", enabled: true, allowedChatIds: [] }] }, telegram: { instances: [] } } } as any;
    const file = ensureOwnerMemoryReflectionEvent(eventsDir, settings);
    assert.ok(file);
    const event = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(event.execution, "internal");
    assert.deepEqual(event.managed, { by: "molibot", scope: "owner", kind: "memory-reflection", ownerId: "owner" });
    assert.equal(event.internal.target, undefined);
    assert.equal(event.schedule, "0 3 * * *");
    assert.equal(collectMemoryReflectionInternals(settings).length, 1);
    writeFileSync(file, JSON.stringify({ ...event, status: { state: "completed", runCount: 3 } }));
    settings.channels.telegram.instances.push({ id: "future-bot", enabled: true, allowedChatIds: ["chat-2"] });
    ensureOwnerMemoryReflectionEvent(eventsDir, settings);
    const updated = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(updated.status.runCount, 3);
    assert.equal(collectMemoryReflectionInternals(settings).length, 2);
    assert.equal(readdirSync(eventsDir).filter((name) => name === "memory-reflection.json").length, 1);
  } finally { rmSync(eventsDir, { recursive: true, force: true }); }
});

test("owner runtime creates an independent watched maintenance event after reflection", () => {
  const eventsDir = mkdtempSync(join(tmpdir(), "molibot-maintenance-event-"));
  try {
    const settings = { timezone: "Asia/Shanghai", plugins: { memory: { enabled: true, backend: "mory", reflectionTime: "03:30" } } } as any;
    const file = ensureOwnerMemoryMaintenanceEvent(eventsDir, settings);
    assert.ok(file);
    const event = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(event.execution, "internal");
    assert.equal(event.internal.kind, "memory-maintenance");
    assert.equal(event.schedule, "0 4 * * *");
    assert.deepEqual(event.managed, { by: "molibot", scope: "owner", kind: "memory-maintenance", ownerId: "owner" });
  } finally { rmSync(eventsDir, { recursive: true, force: true }); }
});

test("reflection notification targets include only authorized enabled Feishu and Telegram chats", () => {
  const settings = {
    plugins: { memory: { reflectionNotificationTarget: null } },
    channels: {
      telegram: { instances: [{ id: "tg", name: "News", enabled: true, allowedChatIds: ["chat-tg"], credentials: {} }] },
      feishu: { instances: [{ id: "fs", name: "Momo", enabled: true, allowedChatIds: ["chat-fs"], credentials: {} }] },
      qq: { instances: [{ id: "qq", name: "QQ", enabled: true, allowedChatIds: ["chat-qq"], credentials: {} }] },
      weixin: { instances: [{ id: "wx", name: "Weixin", enabled: true, allowedChatIds: ["chat-wx"], credentials: {} }] },
      web: { instances: [{ id: "web", name: "Web", enabled: true, allowedChatIds: [], credentials: {} }] },
      telegramDisabled: { instances: [] }
    }
  } as any;
  settings.channels.telegram.instances.push({ id: "off", name: "Off", enabled: false, allowedChatIds: ["chat-off"], credentials: {} });

  const targets = listMemoryReflectionNotificationTargets(settings);
  assert.deepEqual(targets.map((item) => item.target), [
    { channel: "telegram", botId: "tg", chatId: "chat-tg" },
    { channel: "feishu", botId: "fs", chatId: "chat-fs" }
  ]);
  assert.match(targets[0].label, /Telegram.*News.*chat-tg/);
  assert.match(targets[1].label, /Feishu.*Momo.*chat-fs/);
});

test("reflection notification target resolves the saved authorized destination and safely falls back", () => {
  const settings = {
    plugins: { memory: { reflectionNotificationTarget: { channel: "feishu", botId: "fs", chatId: "chat-fs" } } },
    channels: {
      telegram: { instances: [{ id: "tg", name: "TG", enabled: true, allowedChatIds: ["chat-tg"], credentials: {} }] },
      feishu: { instances: [{ id: "fs", name: "FS", enabled: true, allowedChatIds: ["chat-fs"], credentials: {} }] }
    }
  } as any;
  assert.deepEqual(resolveMemoryReflectionNotificationTarget(settings), { channel: "feishu", botId: "fs", chatId: "chat-fs" });
  settings.channels.feishu.instances[0].allowedChatIds = [];
  assert.deepEqual(resolveMemoryReflectionNotificationTarget(settings), { channel: "telegram", botId: "tg", chatId: "chat-tg" });
});

test("both memory tasks deliver through the same selected Telegram or Feishu target", async () => {
  const settings = {
    plugins: { memory: { reflectionNotificationTarget: { channel: "feishu", botId: "fs", chatId: "chat-fs" } } },
    channels: {
      telegram: { instances: [{ id: "tg", name: "TG", enabled: true, allowedChatIds: ["chat-tg"], credentials: {} }] },
      feishu: { instances: [{ id: "fs", name: "FS", enabled: true, allowedChatIds: ["chat-fs"], credentials: {} }] }
    }
  } as any;
  const deliveries: any[] = [];
  const channelManagers = new Map([
    ["telegram", new Map([["tg", { sendInternalNotice: async () => { throw new Error("wrong target"); } }]])],
    ["feishu", new Map([["fs", { sendInternalNotice: async (chatId: string, text: string, metadata: unknown) => deliveries.push({ chatId, text, metadata }) }]])]
  ]) as any;

  assert.equal(await deliverMemoryTaskNotification(channelManagers, settings, "反思完成", { kind: "memory-reflection", filename: "memory-reflection.json" }), true);
  assert.equal(await deliverMemoryTaskNotification(channelManagers, settings, "素材完成", { kind: "daily-materials", filename: "daily-materials.json" }), true);
  assert.deepEqual(deliveries, [
    { chatId: "chat-fs", text: "反思完成", metadata: { kind: "memory-reflection", filename: "memory-reflection.json" } },
    { chatId: "chat-fs", text: "素材完成", metadata: { kind: "daily-materials", filename: "daily-materials.json" } }
  ]);
});

test("daily materials completion notice is aggregated and deduplicates output paths", () => {
  assert.equal(formatDailyMaterialsNotification([]), undefined);
  assert.equal(formatDailyMaterialsNotification(["content/daily-materials/2026-07-17.md"]), "今日素材已生成：content/daily-materials/2026-07-17.md");
  assert.equal(
    formatDailyMaterialsNotification([
      "content/daily-materials/2026-07-17.md",
      "content/daily-materials/2026-07-17.md",
      "content/other/2026-07-17.md"
    ]),
    "今日素材已生成 2 个文件：\n- content/daily-materials/2026-07-17.md\n- content/other/2026-07-17.md"
  );
});

test("owner reflection formats one aggregate completion notice, including zero output", async () => {
  const result = await executeOwnerMemoryReflection(
    [{ kind: "memory-reflection", target: { ownerId: "owner", botId: "a", timezone: "Asia/Shanghai", sourceScopes: [] } } as any],
    async () => ({ localDate: "2026-08-07", scannedMessages: 0, createdCandidates: 0, pendingReviewCandidateIds: [] })
  );
  const notice = formatOwnerMemoryReflectionNotification(result, { pendingReviewCount: 0, skillDraftCount: 0 });
  assert.match(notice, /0 条消息/);
  assert.match(notice, /新增 0 条/);
});

test("owner reflection aggregates Bot results into one notice and reports terminal failure", async () => {
  const success = await executeOwnerMemoryReflection(
    [{ target: { botId: "a" } } as any, { target: { botId: "b" } } as any],
    async (internal) => internal.target?.botId === "a"
      ? { localDate: "2026-08-07", scannedMessages: 3, createdCandidates: 1, pendingReviewCandidateIds: ["candidate-1"] }
      : { localDate: "2026-08-07", scannedMessages: 4, createdCandidates: 2, pendingReviewCandidateIds: ["candidate-1", "candidate-2"] }
  );
  assert.deepEqual(success.pendingReviewCandidateIds, ["candidate-1", "candidate-2"]);
  const successNotice = formatOwnerMemoryReflectionNotification(success, { pendingReviewCount: 2, skillDraftCount: 0 });
  assert.match(successNotice, /2 个 Bot/);
  assert.match(successNotice, /7 条消息/);
  assert.match(successNotice, /新增 3 条候选/);
  assert.match(successNotice, /本次有 2 条待确认记忆/);

  await assert.rejects(() => executeOwnerMemoryReflection(
    [{ target: { botId: "a" } } as any, { target: { botId: "b" } } as any],
    async (internal) => {
      if (internal.target?.botId === "b") throw new Error("boom");
      return { localDate: "2026-08-07", scannedMessages: 2, createdCandidates: 1, pendingReviewCandidateIds: ["candidate-1"] };
    }
  ), (error: unknown) => {
    assert.ok(error instanceof OwnerMemoryReflectionError);
    assert.deepEqual(error.result.pendingReviewCandidateIds, ["candidate-1"]);
    const notice = formatOwnerMemoryReflectionNotification(error.result, { pendingReviewCount: 1, skillDraftCount: 0 });
    assert.match(notice, /执行失败/);
    assert.match(notice, /1 个 Bot/);
    return true;
  });
});

test("memory review delivery skips recorded items and stops when a target is not private", async () => {
  const recorded: unknown[] = [];
  const sent: string[] = [];
  const review = { recordDelivery: (input: unknown) => { recorded.push(input); return true; } } as any;
  const batch = {
    id: "batch-1",
    localDate: "2026-08-07",
    target: { channel: "telegram", botId: "momo", chatId: "chat-1" },
    skillDraftCount: 0,
    items: [
      { batchId: "batch-1", candidateId: "c1", ordinal: 1, value: "one", messageId: "10" },
      { batchId: "batch-1", candidateId: "c2", ordinal: 2, value: "two" },
      { batchId: "batch-1", candidateId: "c3", ordinal: 3, value: "three" }
    ]
  } as any;
  const managers = new Map([["telegram", new Map([["momo", {
    sendMemoryReviewItem: async (_chatId: string, item: { candidateId: string }) => {
      sent.push(item.candidateId);
      return item.candidateId === "c2" ? { messageId: "20" } : null;
    }
  }]])]]) as any;
  assert.deepEqual(await deliverMemoryReviewBatch(managers, review, batch), { delivered: 1, alreadyDelivered: 1, skipped: 1 });
  assert.deepEqual(sent, ["c2", "c3"]);
  assert.deepEqual(recorded, [{ batchId: "batch-1", candidateId: "c2", messageId: "20" }]);
});

test("owner managed event comparison ignores JSON object key order", () => {
  const eventsDir = mkdtempSync(join(tmpdir(), "molibot-managed-event-order-"));
  try {
    const settings = { timezone: "Asia/Shanghai", plugins: { memory: { enabled: true, backend: "mory", reflectionTime: "03:00" } } } as any;
    const file = ensureOwnerMemoryReflectionEvent(eventsDir, settings);
    assert.ok(file);
    const event = JSON.parse(readFileSync(file, "utf8")) as Extract<MomEvent, { type: "periodic" }>;
    const reordered = JSON.stringify({
      internal: event.internal,
      execution: event.execution,
      timezone: event.timezone,
      schedule: event.schedule,
      text: event.text,
      chatId: event.chatId,
      managed: {
        ownerId: event.managed?.ownerId,
        kind: event.managed?.kind,
        scope: event.managed?.scope,
        by: event.managed?.by
      },
      taskId: event.taskId,
      enabled: event.enabled,
      type: event.type
    });
    writeFileSync(file, reordered, "utf8");

    ensureOwnerMemoryReflectionEvent(eventsDir, settings);

    assert.equal(readFileSync(file, "utf8"), reordered);
  } finally { rmSync(eventsDir, { recursive: true, force: true }); }
});

test("owner daily materials event preserves status and disables without deleting", () => {
  const eventsDir = mkdtempSync(join(tmpdir(), "molibot-daily-materials-event-"));
  try {
    const settings = { timezone: "Asia/Shanghai", plugins: { memory: { dailyMaterials: { enabled: true, time: "23:30", projectId: "momo-agent", dir: "content/daily-materials", promptPath: "templates/daily-material-prompt.md", notifications: true } } }, channels: { web: { instances: [{ id: "momo", enabled: true, allowedChatIds: [] }] } } } as any;
    const file = ensureOwnerDailyMaterialsEvent(eventsDir, settings);
    assert.ok(file);
    const event = JSON.parse(readFileSync(file!, "utf8"));
    assert.equal(event.execution, "internal");
    assert.equal(event.internal.kind, "daily-materials");
    assert.equal(event.internal.target, undefined);
    assert.equal(event.schedule, "30 23 * * *");
    writeFileSync(file!, JSON.stringify({ ...event, status: { state: "completed", runCount: 2 } }));
    settings.plugins.memory.dailyMaterials.time = "22:15";
    ensureOwnerDailyMaterialsEvent(eventsDir, settings);
    assert.equal(JSON.parse(readFileSync(file!, "utf8")).status.runCount, 2);
    settings.plugins.memory.dailyMaterials.enabled = false;
    ensureOwnerDailyMaterialsEvent(eventsDir, settings);
    assert.equal(JSON.parse(readFileSync(file!, "utf8")).enabled, false);
  } finally { rmSync(eventsDir, { recursive: true, force: true }); }
});

test("legacy managed migration removes only recognized per-Bot memory events", () => {
  const botsRoot = mkdtempSync(join(tmpdir(), "molibot-managed-migration-"));
  const eventsDir = join(botsRoot, "momo", "events");
  mkdirSync(eventsDir, { recursive: true });
  const reflection = join(eventsDir, "memory-reflection.json");
  const materials = join(eventsDir, "daily-materials.json");
  const userTask = join(eventsDir, "periodic-user.json");
  writeFileSync(reflection, JSON.stringify({ type: "periodic", internal: { kind: "memory-reflection" } }));
  writeFileSync(materials, JSON.stringify({ type: "periodic", internal: { kind: "daily-materials" } }));
  writeFileSync(userTask, JSON.stringify({ type: "periodic", text: "Keep me" }));

  try {
    assert.deepEqual(migrateLegacyManagedMemoryEvents(botsRoot).sort(), [materials, reflection].sort());
    assert.equal(existsSync(reflection), false);
    assert.equal(existsSync(materials), false);
    assert.equal(existsSync(userTask), true);
    assert.deepEqual(migrateLegacyManagedMemoryEvents(botsRoot), []);
  } finally { rmSync(botsRoot, { recursive: true, force: true }); }
});
