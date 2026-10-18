import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import { config } from "$lib/server/app/env.js";
import { resetServiceOwnershipCache } from "$lib/server/app/serviceOwnership.js";
import { MomRunner } from "$lib/server/agent/core/runner.js";
import { PiRunSession } from "$lib/server/agent/core/piRunSession.js";
import { MomRuntimeStore } from "$lib/server/agent/session/store.js";
import type { RuntimeSettings } from "$lib/server/settings/schema.js";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";
import { AiUsageTracker } from "$lib/server/usage/tracker.js";

test("Runner attributes Project-mode usage to the project pseudo-agent", { timeout: 15000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-project-usage-runner-"));
  // The runner asserts service ownership against `config.dataDir`; point it at
  // the throwaway directory so the lease is our own (see piChildUsage.test.ts).
  const originalDataDir = config.dataDir;
  config.dataDir = directory;
  resetServiceOwnershipCache();
  const workspace = join(directory, "moli-web", "fixture");
  const projectRoot = join(directory, "project-root");
  const projectScratch = join(projectRoot, "scratch");
  mkdirSync(workspace, { recursive: true });
  mkdirSync(projectScratch, { recursive: true });
  const settings: RuntimeSettings = { ...defaultRuntimeSettings, providerMode: "custom" as const, defaultCustomProviderId: "project-usage-fixture",
    modelRouting: { ...defaultRuntimeSettings.modelRouting, textModelKey: "custom|project-usage-fixture|fixture" },
    customProviders: [{ id: "project-usage-fixture", name: "Fixture", enabled: true, protocol: "openai-compatible" as const,
      baseUrl: "https://fixture.invalid/v1", apiKey: "fixture-key", path: "/chat/completions", defaultModel: "fixture",
      models: [{ id: "fixture", enabled: true, tags: ["text"], supportedRoles: ["system", "user", "assistant", "tool"] }] }] };
  const tracker = new AiUsageTracker({ usageDir: join(directory, "usage") });
  const memoryStub = { syncExternalMemories: async () => {}, createProfileTurnSnapshot: async () => ({ fingerprint: "fixture", items: [] }),
    createPromptSnapshot: async () => ({ createdAt: new Date().toISOString(), fingerprint: "fixture", query: "", promptText: "", selected: [], longTerm: [], daily: [] }) } as never;
  const hookStub = { emit: () => {}, flush: async () => {}, transform: async (_stage: unknown, _context: unknown, value: unknown) => value,
    gate: async () => ({ type: "allow" }) } as never;
  const buildRunner = (sessionId: string): { runner: MomRunner; agent: PiRunSession } => {
    const runner = new MomRunner("web", "chat", sessionId, new MomRuntimeStore(workspace), () => settings, () => settings,
      tracker, { record: () => {} } as never, memoryStub, hookStub);
    const agent = (runner as unknown as { agent: PiRunSession }).agent;
    agent.streamFunction = (selected) => {
      const message: AssistantMessage = { role: "assistant", api: selected.api, provider: selected.provider, model: selected.id,
        timestamp: Date.now(), content: [{ type: "text", text: "Done" }], stopReason: "stop",
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      const stream = createAssistantMessageEventStream(); stream.push({ type: "done", reason: "stop", message }); stream.end(); return stream;
    };
    return { runner, agent };
  };
  const baseContext = (sessionId: string) => ({ channel: "web" as const, workspaceDir: workspace, chatDir: join(workspace, "chat"),
    message: { chatId: "chat", sessionId, userId: "actor", text: "Say hi", messageId: 1,
      ts: "1", attachments: [], imageContents: [], chatType: "private" as const }, respond: async () => {}, replaceMessage: async () => {},
    respondInThread: async () => {}, setWorking: async () => {}, setTyping: async () => {}, deleteMessage: async () => {}, uploadFile: async () => {} });
  const agents: PiRunSession[] = [];
  try {
    const projectHandle = buildRunner("session");
    agents.push(projectHandle.agent);
    const projectRun = await projectHandle.runner.run({ ...baseContext("session"),
      project: { id: "p-fixture", name: "Fixture Project", rootPath: projectRoot, scratchDir: projectScratch } });
    assert.equal(projectRun.stopReason, "stop", projectRun.errorMessage);
    const attributed = tracker.list();
    assert.ok(attributed.length > 0, "the project run must record usage");
    assert.ok(attributed.every(record => record.agentId === "project"), `expected every project-run record to carry agentId "project", got ${JSON.stringify(attributed.map(record => record.agentId))}`);
    assert.equal((projectHandle.runner as unknown as { activeProject?: unknown }).activeProject, undefined, "the runner clears its active project when the run ends");

    // A non-project session on the same workspace stays unattributed (the
    // pseudo-agent never applies outside Project mode).
    const plainHandle = buildRunner("session-plain");
    agents.push(plainHandle.agent);
    const plainRun = await plainHandle.runner.run(baseContext("session-plain"));
    assert.equal(plainRun.stopReason, "stop", plainRun.errorMessage);
    const plainRecords = tracker.list().filter(record => record.agentId === undefined);
    assert.ok(plainRecords.length > 0, "the non-project run must record usage");
  } finally { await Promise.all(agents.map(agent => agent.close().catch(() => undefined))); resetServiceOwnershipCache(); config.dataDir = originalDataDir; rmSync(directory, { recursive: true, force: true }); }
});
