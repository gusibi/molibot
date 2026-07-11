import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { tmpdir } from "node:os";
import { dispatchTaskEvent, ensureDailyMaterialsEvent, ensureMemoryReflectionEvent, migrateLegacyWebTaskEvents } from "./taskScheduler";

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
  const event = {
    type: "periodic",
    chatId: "internal-memory",
    text: "",
    schedule: "0 3 * * *",
    timezone: "Asia/Shanghai",
    execution: "internal",
    internal: { kind: "memory-reflection", target: { ownerId: "owner", botId: "momo", timezone: "Asia/Shanghai", sourceScopes: [] } }
  } as const;
  await dispatchTaskEvent(event, "memory-reflection.json", { triggerTask: async () => { channelCalls += 1; } } as any, async () => { internalCalls += 1; });
  assert.equal(internalCalls, 1);
  assert.equal(channelCalls, 0);
});

test("internal reflection sends one separate direct notice only when requested", async () => {
  const deliveries: any[] = [];
  const event = {
    type: "periodic", chatId: "internal-memory", text: "", schedule: "15 4 * * *", timezone: "Asia/Shanghai", execution: "internal",
    internal: { kind: "memory-reflection", notificationChatId: "chat-1", target: { ownerId: "owner", botId: "momo", timezone: "Asia/Shanghai", sourceScopes: [] } }
  } as const;
  await dispatchTaskEvent(event, "memory-reflection.json", { triggerTask: async (notice) => { deliveries.push(notice); } } as any, async () => ({ notificationText: "新增 2 条候选" }));
  assert.deepEqual(deliveries, [{ type: "immediate", chatId: "chat-1", text: "新增 2 条候选", delivery: "text" }]);
});

test("memory-first runtime creates one internal daily reflection event without overwriting it", () => {
  const eventsDir = mkdtempSync(join(tmpdir(), "molibot-reflection-event-"));
  try {
    const settings = { timezone: "Asia/Shanghai", plugins: { memory: { enabled: true, backend: "mory", reflectionTime: "03:00", reflectionNotifications: true } }, channels: { web: { instances: [{ id: "momo", enabled: true, allowedChatIds: [] }] } } } as any;
    const file = ensureMemoryReflectionEvent(eventsDir, "web", "momo", settings);
    assert.ok(file);
    const event = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(event.execution, "internal");
    assert.equal(event.schedule, "0 3 * * *");
    writeFileSync(file, JSON.stringify({ ...event, status: { state: "completed", runCount: 3 } }));
    settings.plugins.memory.reflectionTime = "04:30";
    ensureMemoryReflectionEvent(eventsDir, "web", "momo", settings);
    const updated = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(updated.schedule, "30 4 * * *");
    assert.equal(updated.internal.notificationChatId, "web:momo:web-anonymous");
    assert.equal(updated.status.runCount, 3);
  } finally { rmSync(eventsDir, { recursive: true, force: true }); }
});

test("daily materials managed event preserves status and disables without deleting", () => {
  const eventsDir = mkdtempSync(join(tmpdir(), "molibot-daily-materials-event-"));
  try {
    const settings = { timezone: "Asia/Shanghai", plugins: { memory: { dailyMaterials: { enabled: true, time: "23:30", projectId: "momo-agent", dir: "content/daily-materials", promptPath: "templates/daily-material-prompt.md", notifications: true } } }, channels: { web: { instances: [{ id: "momo", enabled: true, allowedChatIds: [] }] } } } as any;
    const file = ensureDailyMaterialsEvent(eventsDir, "web", "momo", settings);
    assert.ok(file);
    const event = JSON.parse(readFileSync(file!, "utf8"));
    assert.equal(event.execution, "internal");
    assert.equal(event.internal.kind, "daily-materials");
    assert.equal(event.internal.output.projectId, "momo-agent");
    assert.equal(event.schedule, "30 23 * * *");
    writeFileSync(file!, JSON.stringify({ ...event, status: { state: "completed", runCount: 2 } }));
    settings.plugins.memory.dailyMaterials.time = "22:15";
    ensureDailyMaterialsEvent(eventsDir, "web", "momo", settings);
    assert.equal(JSON.parse(readFileSync(file!, "utf8")).status.runCount, 2);
    settings.plugins.memory.dailyMaterials.enabled = false;
    ensureDailyMaterialsEvent(eventsDir, "web", "momo", settings);
    assert.equal(JSON.parse(readFileSync(file!, "utf8")).enabled, false);
  } finally { rmSync(eventsDir, { recursive: true, force: true }); }
});
