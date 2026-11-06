import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { RuntimeSettings } from "$lib/server/settings/schema.js";

const root = mkdtempSync(join(tmpdir(), "molibot-context-refresh-"));
process.env.DATA_DIR = root;
const { MomRunner } = await import("./runner.js");
const { MomRuntimeStore } = await import("../session/store.js");
const { defaultRuntimeSettings } = await import("$lib/server/settings/defaults.js");
const { NOOP_HOOK_MANAGER } = await import("../hooks/types.js");
const { createAssistantMessageEventStream } = await import("@earendil-works/pi-ai");

async function createRunner(input: { chatId: string; workspaceDir: string }) {
  const settings: RuntimeSettings = { ...defaultRuntimeSettings, providerMode: "custom", defaultCustomProviderId: "fixture",
    modelRouting: { ...defaultRuntimeSettings.modelRouting, textModelKey: "custom|fixture|fixture" },
    customProviders: [{ id: "fixture", name: "Fixture", enabled: true, protocol: "openai-compatible", baseUrl: "https://example.invalid/v1",
      apiKey: "fixture", path: "/chat/completions", defaultModel: "fixture", models: [{ id: "fixture", enabled: true, tags: ["text"], supportedRoles: ["system", "user", "assistant", "tool"] }] }] };
  const memory = { syncExternalMemories: async () => {}, createProfileTurnSnapshot: async () => ({ fingerprint: "profile", items: [] }),
    createPromptSnapshot: async () => ({ createdAt: new Date().toISOString(), fingerprint: "fixture", query: "", promptText: "", selected: [], longTerm: [], daily: [] }) };
  const runner = new MomRunner("telegram", input.chatId, "session", new MomRuntimeStore(input.workspaceDir), () => settings, () => settings,
    { record: () => {} } as any, { record: () => {} } as any, memory as any, NOOP_HOOK_MANAGER);
  const agent = (runner as any).agent;
  const bind = agent.bindRun.bind(agent);
  agent.bindRun = (input: any) => bind({ ...input, assertStorageOwnership: () => {} });
  return runner;
}
function createRunnerContext(text: string) {
  return { channel: "telegram", workspaceDir: root, chatDir: root,
    message: { chatId: "background-context", chatType: "private", messageId: Date.now(), userId: "fixture", text,
      ts: new Date().toISOString(), attachments: [], imageContents: [], sessionId: "session" },
    respond: async () => {}, replaceMessage: async () => {}, respondInThread: async () => {}, setTyping: async () => {},
    setWorking: async () => {}, deleteMessage: async () => {}, uploadFile: async () => {} } as any;
}

test("a cached Runner reads background replies committed between conversational turns", async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), "molibot-background-context-"));
  try {
    const chatId = "background-context";
    const runner = await createRunner({ chatId, workspaceDir });
    const { zeroAssistantUsage } = await import("./runnerHelpers.js");
    const store = new MomRuntimeStore(workspaceDir);
    const sessionId = (runner as any).sessionId;
    store.appendContextMessage(chatId, { role: "user", content: "后台整理需求", timestamp: Date.now() }, sessionId);
    store.appendContextMessage(chatId, { role: "assistant", content: [{ type: "text", text: "后台结果：需求已整理" }], usage: zeroAssistantUsage(), timestamp: Date.now() } as any, sessionId);
    let observed = "";
    (runner as any).agent.streamFunction = (model: any, context: any) => {
      observed = JSON.stringify(context.messages);
      const output = createAssistantMessageEventStream();
      output.push({ type: "done", reason: "stop", message: {
        role: "assistant", api: model.api, provider: model.provider, model: model.id,
        content: [{ type: "text", text: "继续讨论这个结果。" }], stopReason: "stop", timestamp: Date.now(),
        usage: { ...zeroAssistantUsage(), cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
      } });
      output.end();
      return output;
    };
    const context = createRunnerContext("刚才整理的结果是什么？");
    context.message.chatId = chatId;
    context.message.sessionId = sessionId;
    const result = await runner.run(context);
    assert.equal(result.stopReason, "stop");
    assert.equal(observed.includes("后台结果：需求已整理"), true, "the next model request must include the committed background reply");
  } finally { rmSync(workspaceDir, { recursive: true, force: true }); }
});

test.after(() => rmSync(root, { recursive: true, force: true }));
