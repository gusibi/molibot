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
  assert.equal(modelCalls, 1, "daily event must not re-extract the idle range");

  runtime.sessions.appendMessage(conversation.id, "user", "以后也保持简短");
  runtime.sessions.appendMessage(conversation.id, "assistant", "明白");
  await runtime.runInternalEvent(event, "memory-reflection.json");
  assert.equal(modelCalls, 2, "daily event extracts only the new exchange");
  assert.equal((await runtime.memoryExtraction.runSweep({ conversationId: conversation.id, force: true })).attempted, 0);
});
