import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAssistantMessageEventStream, getCurrentTools, type AssistantMessage } from "@earendil-works/pi-ai";
import { MomRunner } from "$lib/server/agent/core/runner.js";
import { PiRunSession } from "$lib/server/agent/core/piRunSession.js";
import { MomRuntimeStore } from "$lib/server/agent/session/store.js";
import type { RuntimeSettings } from "$lib/server/settings/schema.js";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";
import { AiUsageTracker } from "$lib/server/usage/tracker.js";

test("production Runner records child generation and compaction once across native reopen", { timeout: 15000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-child-usage-runner-"));
  const workspace = join(directory, "moli-web", "fixture");
  mkdirSync(workspace, { recursive: true }); writeFileSync(join(workspace, "fixture.txt"), "Read fixture");
  const settings: RuntimeSettings = { ...defaultRuntimeSettings, providerMode: "custom" as const, defaultCustomProviderId: "child-usage-fixture",
    modelRouting: { ...defaultRuntimeSettings.modelRouting, textModelKey: "custom|child-usage-fixture|fixture" },
    customProviders: [{ id: "child-usage-fixture", name: "Fixture", enabled: true, protocol: "openai-compatible" as const,
      baseUrl: "https://fixture.invalid/v1", apiKey: "fixture-key", path: "/chat/completions", defaultModel: "fixture",
      models: [{ id: "fixture", enabled: true, tags: ["text"], supportedRoles: ["system", "user", "assistant", "tool"] }] }] };
  const tracker = new AiUsageTracker({ usageDir: join(directory, "usage") });
  const runner = new MomRunner("web", "chat", "session", new MomRuntimeStore(workspace), () => settings, () => settings,
    tracker, { record: () => {} } as never,
    { syncExternalMemories: async () => {}, createProfileTurnSnapshot: async () => ({ fingerprint: "fixture", items: [] }),
      createPromptSnapshot: async () => ({ createdAt: new Date().toISOString(), fingerprint: "fixture", query: "", promptText: "", selected: [], longTerm: [], daily: [] }) } as never,
    { emit: () => {}, flush: async () => {}, transform: async (_stage: unknown, _context: unknown, value: unknown) => value,
      gate: async () => ({ type: "allow" }) } as never);
  const agent = (runner as unknown as { agent: PiRunSession }).agent;
  const model = agent.state.model!;
  const originalBind = agent.bindRun.bind(agent);
  let admission: Parameters<typeof agent.bindRun>[0];
  agent.bindRun = input => { admission = { ...input, childCompaction: { enabled: true, reserveTokens: model.contextWindow - 200, keepRecentTokens: 1 } }; originalBind(admission); };
  let rootRequests = 0, childRequests = 0, summaries = 0;
  agent.streamFunction = (selected, context) => {
    const summary = JSON.stringify(context).includes("context summarization assistant");
    const child = !getCurrentTools(context.messages).some(tool => tool.name === "subagent");
    const message: AssistantMessage = { role: "assistant", api: selected.api, provider: selected.provider, model: selected.id,
      timestamp: Date.now(), content: [{ type: "text", text: "Done" }], stopReason: "stop",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    if (summary) { summaries++; message.content = [{ type: "text", text: "Stored child summary" }]; }
    else if (child && ++childRequests === 1) {
      message.stopReason = "toolUse"; message.content = [{ type: "toolCall", id: "read", name: "read", arguments: { path: join(workspace, "fixture.txt") } }];
      message.usage.input = model.contextWindow; message.usage.totalTokens = model.contextWindow + 1;
    } else if (!child && ++rootRequests === 1) {
      message.stopReason = "toolUse"; message.content = [{ type: "toolCall", id: "delegate", name: "subagent", arguments: { agent: "scout", task: "Inspect the fixture file and report." } }];
    }
    const stream = createAssistantMessageEventStream(); stream.push({ type: "done", reason: message.stopReason === "toolUse" ? "toolUse" : "stop", message }); stream.end(); return stream;
  };
  try {
    const result = await runner.run({ channel: "web", workspaceDir: workspace, chatDir: join(workspace, "chat"),
      message: { chatId: "chat", sessionId: "session", userId: "actor", text: "Inspect with scout", messageId: 1,
        ts: "1", attachments: [], imageContents: [], chatType: "private" }, respond: async () => {}, replaceMessage: async () => {},
      respondInThread: async () => {}, setWorking: async () => {}, setTyping: async () => {}, deleteMessage: async () => {}, uploadFile: async () => {} });
    assert.equal(result.stopReason, "stop", result.errorMessage);
    assert.equal(summaries, 1); assert.equal(childRequests, 2);
    const childRecords = tracker.list().filter(record => record.requestId?.includes(":child:"));
    assert.equal(childRecords.reduce((total, record) => total + record.totalTokens, 0), model.contextWindow + 5);
    assert.equal(childRecords.length, 3);
    assert.ok(childRecords.every(record => record.model === model.id && record.provider === model.provider));
    const before = tracker.getSessionUsage("session").totalTokens;
    agent.startTurn(); originalBind(admission!); await agent.prompt("Inspect with scout"); await agent.close();
    assert.equal(new AiUsageTracker({ usageDir: join(directory, "usage") }).getSessionUsage("session").totalTokens, before);
    assert.equal(summaries, 1); assert.equal(childRequests, 2);
  } finally { await agent.close(); rmSync(directory, { recursive: true, force: true }); }
});
