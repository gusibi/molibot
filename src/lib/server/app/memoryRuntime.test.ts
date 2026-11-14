import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Set isolation before importing the runtime: its stores capture DATA_DIR at module load.
const root = mkdtempSync(join(tmpdir(), "molibot-memory-runtime-"));
process.env.DATA_DIR = root;
process.env.MOLIBOT_DISABLE_LIVE_CHANNELS = "1";

const { config } = await import("./env.js");
const { AssistantService } = await import("$lib/server/providers/assistantService.js");
const { SqliteTraceStore } = await import("$lib/server/agent/hooks/traceStore.js");
const { getRuntime } = await import("./runtime.js");

test("the production daily event uses the idle extractor, Writer and checkpoint", async (t) => {
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(config.dataDir, root);
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Network is forbidden in the memory runtime test"); });
  let modelCalls = 0;
  t.mock.method(AssistantService.prototype, "reply", async (_messages: unknown, prompt: string) => {
    if (prompt.startsWith("Extract durable personal memory")) {
      modelCalls++;
      return JSON.stringify({ memories: [{ domain: "owner", type: "user_preference", subject: "answer_length", value: "用户偏好简短直接的回答" }] });
    }
    return "偏好简短直接回答。";
  });
  const runtime = getRuntime();
  runtime.updateSettings({ plugins: { ...runtime.settings.plugins, memory: { ...runtime.settings.plugins.memory, reflectionNotifications: false } } });
  const agentId = runtime.settings.agents.find((agent) => agent.enabled)?.id;
  const conversation = runtime.sessions.createWebConversation("web:default:web-anonymous", undefined, agentId);
  runtime.sessions.appendMessage(conversation.id, "user", "我偏好简短直接的回答");
  runtime.sessions.appendMessage(conversation.id, "assistant", "好的");

  const idle = await runtime.memoryExtraction.runSweep({ conversationId: conversation.id, force: true });
  assert.equal(idle.committed, 1);
  const event = { type: "periodic" as const, schedule: "0 3 * * *", timezone: "Asia/Shanghai", chatId: "internal-memory-reflection", text: "Daily memory reflection", internal: { kind: "memory-reflection" as const } };
  const dailyResult = await runtime.runInternalEvent(event, "memory-reflection.json");
  assert.equal(dailyResult?.pendingReviewCount, 0);
  assert.equal(dailyResult?.skillDraftCount, 0);
  assert.equal(dailyResult?.totalConversations, 1);
  assert.equal(dailyResult?.scannedConversations, 1);
  assert.equal(dailyResult?.idleExtractedConversations, 1);
  assert.equal(dailyResult?.fallbackExtractedConversations, 0);
  assert.equal(dailyResult?.scannedMessages, 2);
  assert.equal(dailyResult?.idleScannedMessages, 2);
  assert.equal(dailyResult?.fallbackScannedMessages, 0);
  assert.equal(dailyResult?.committedMemories, 1);
  assert.equal(dailyResult?.idleCommittedMemories, 1);
  assert.equal(dailyResult?.fallbackCommittedMemories, 0);
  assert.equal(modelCalls, 1, "daily event must not re-extract the idle range");

  runtime.sessions.appendMessage(conversation.id, "user", "以后也保持简短");
  runtime.sessions.appendMessage(conversation.id, "assistant", "明白");
  const secondDailyResult = await runtime.runInternalEvent(event, "memory-reflection.json");
  assert.equal(secondDailyResult?.idleExtractedConversations, 1);
  assert.equal(secondDailyResult?.fallbackExtractedConversations, 1);
  assert.equal(secondDailyResult?.scannedConversations, 1);
  assert.equal(secondDailyResult?.idleScannedMessages, 2);
  assert.equal(secondDailyResult?.fallbackScannedMessages, 2);
  assert.equal(secondDailyResult?.scannedMessages, 4);
  assert.equal(modelCalls, 2, "daily event extracts only the new exchange");
  assert.equal((await runtime.memoryExtraction.runSweep({ conversationId: conversation.id, force: true })).attempted, 0);

  // Verify idle sweep also records an "idle" trigger trace fact.
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  let idleConversationId = "";
  try {
    const idleConversation = runtime.sessions.createWebConversation("web:default:web-anonymous", undefined, agentId);
    idleConversationId = idleConversation.id;
    runtime.sessions.appendMessage(idleConversation.id, "user", "以后请优先使用中文");
    runtime.sessions.appendMessage(idleConversation.id, "assistant", "好的");
    t.mock.timers.tick(5 * 60_000);
    const idleSweep = await runtime.memoryExtraction.runSweep({ mode: "idle" });
    assert.equal(idleSweep.attempted, 1);
  } finally {
    t.mock.timers.reset();
  }

  const traceStore = new SqliteTraceStore();
  try {
    const memoryFacts = traceStore.listRecentFacts(100).filter((fact) => fact.factType === "memory_extraction");
    const triggers = memoryFacts.map((fact) => fact.payload.memoryTrigger);
    assert.ok(triggers.includes("manual"), `expected manual trigger in ${JSON.stringify(triggers)}`);
    assert.ok(triggers.includes("idle"), `expected idle trigger in ${JSON.stringify(triggers)}`);
    assert.ok(triggers.includes("daily"), `expected daily trigger in ${JSON.stringify(triggers)}`);
    assert.ok(triggers.includes("daily_reflection"), `expected daily_reflection trigger in ${JSON.stringify(triggers)}`);

    const idleBatch = memoryFacts.find((fact) => fact.payload.memoryTrigger === "idle" && fact.sessionId === idleConversationId);
    assert.equal(idleBatch?.payload.scannedMessages, 2);

    const dailyBatch = memoryFacts.find((fact) => fact.payload.memoryTrigger === "daily" && fact.sessionId === conversation.id);
    assert.equal(dailyBatch?.payload.scannedMessages, 2);

    const reflectionSummary = memoryFacts.find((fact) => fact.payload.memoryTrigger === "daily_reflection");
    assert.equal(reflectionSummary?.status, "success");
    assert.equal(reflectionSummary?.payload.scannedMessages, 4);
  } finally {
    traceStore.close();
  }
});
