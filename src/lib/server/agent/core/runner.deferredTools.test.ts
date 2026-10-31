import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createAssistantMessageEventStream, getCurrentTools } from "@earendil-works/pi-ai";
import type { RuntimeSettings } from "../../settings/schema.js";

const root = mkdtempSync(join(tmpdir(), "molibot-runner-deferred-"));
process.env.DATA_DIR = root;
after(() => rmSync(root, { recursive: true, force: true }));

for (const mode of ["direct", "codemode", "invalid"] as const) {
  test(`native Runner loads Prompt Box and completes ${mode} calls across turns`, { timeout: 20000 }, async () => {
    const [{ MomRunner }, { MomRuntimeStore }, { defaultRuntimeSettings }, registry, { storagePaths }, { getBuiltinMiniApp }, { materializeBuiltinMiniApp }] = await Promise.all([
      import("./runner.js"), import("../session/store.js"), import("../../settings/defaults.js"),
      import("../../miniapps/registry.js"), import("../../infra/db/storage.js"),
      import("../../miniapps/bootstrap.js"), import("../../miniapps/builtinPackage.js")
    ]);
    assert.equal(storagePaths.dataDir, root);
    materializeBuiltinMiniApp(storagePaths.miniAppCodeDir, getBuiltinMiniApp("prompt-box")!);
    const settings: RuntimeSettings = { ...defaultRuntimeSettings, permissionMode: "auto", providerMode: "custom",
      defaultCustomProviderId: "fixture", modelRouting: { ...defaultRuntimeSettings.modelRouting, textModelKey: "custom|fixture|fixture" },
      customProviders: [{ id: "fixture", name: "Fixture", enabled: true, protocol: "openai-compatible",
        baseUrl: "https://example.invalid/v1", apiKey: "fixture", path: "/chat/completions", defaultModel: "fixture",
        models: [{ id: "fixture", enabled: true, tags: ["text"], supportedRoles: ["system", "user", "assistant", "tool", "developer"] }] }]
    };
    registry.configureMiniAppSettings({ getSettings: () => settings, updateSettings: patch => Object.assign(settings, patch) });
    const host = registry.getMiniAppHost();
    host.refresh();
    const workspace = join(root, "agents", mode, "workspace");
    const store = new MomRuntimeStore(workspace);
    const runner = new MomRunner("web", mode, `session-${mode}`, store, () => settings, patch => ({ ...settings, ...patch }),
      { record: () => {} } as any, { record: () => {} } as any,
      { syncExternalMemories: async () => {}, createProfileTurnSnapshot: async () => ({ fingerprint: "", items: [] }),
        createPromptSnapshot: async () => ({ createdAt: "", fingerprint: "", query: "", promptText: "", selected: [], longTerm: [], daily: [] }) } as any);
    const agent = (runner as any).agent;
    const bindRun = agent.bindRun.bind(agent);
    // Exercise the real Runner and native task store without taking the live service lease.
    agent.bindRun = (input: any) => bindRun({ ...input, assertStorageOwnership: () => {} });
    const name = "miniapp__prompt-box__save_prompt";
    let generation = 0;
    let turn = 0;
    const replies: string[] = [];
    agent.streamFunction = (model: any, context: any) => {
      const step = generation++ % 3;
      const tools = getCurrentTools(context.messages);
      if (step === 0) assert.ok(!tools.some(tool => tool.name === name), "each turn starts with deferred tools unloaded");
      else assert.ok(tools.some(tool => tool.name === name), "loaded schema reaches the next model request");
      const args = { title: `${mode}-${turn}`, content: mode === "invalid" ? "x".repeat(10001) : `品质标准-${turn}` };
      const content = step === 0 ? [{ type: "toolCall", id: `search-${turn}`, name: "toolSearch", arguments: { query: `select:${name}` } }]
        : step === 1 ? [{ type: "toolCall", id: `save-${turn}`, name: mode === "codemode" ? "codemode" : name,
          arguments: mode === "codemode" ? { code: `text(await tools[${JSON.stringify(name)}](${JSON.stringify(args)}));` } : args }]
        : [{ type: "text", text: mode === "invalid" ? "内容超出长度限制，未保存。" : "已保存到 Prompt Box。" }];
      if (step === 2) {
        const results = context.messages.filter((message: any) => message.role === "toolResult");
        assert.ok(results.length > 0);
        assert.equal(Boolean(results.at(-1).isError), mode === "invalid");
      }
      const message = { role: "assistant", api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(),
        stopReason: step === 2 ? "stop" : "toolUse", content,
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "done", reason: message.stopReason, message } as any);
      stream.end();
      return stream;
    };
    try {
      for (turn = 1; turn <= 2; turn++) {
        const result = await runner.run({ channel: "web", workspaceDir: workspace, chatDir: workspace,
          message: { chatId: mode, chatType: "private", messageId: Date.now() + turn, userId: "fixture", text: turn === 1 ? "保存品质标准 @prompt-box" : "继续重试",
            ts: new Date().toISOString(), attachments: [], imageContents: [] },
          respond: async (text: string) => { replies.push(text); }, replaceMessage: async (text: string) => { replies.push(text); },
          respondInThread: async () => {}, setTyping: async () => {}, setWorking: async () => {}, deleteMessage: async () => {}, uploadFile: async () => {} } as any);
        assert.equal(result.stopReason, "stop");
        assert.equal(generation, turn * 3, "search, save, and final reply complete without replay");
        assert.ok(replies.some(text => text.includes(mode === "invalid" ? "未保存" : "已保存到 Prompt Box")));
        const response = await host.handleHttp("prompt-box", new Request("http://fixture.invalid/prompts"), "/prompts");
        const body = await response.json();
        const saved = body.prompts.filter((prompt: any) => prompt.title.startsWith(`${mode}-`));
        assert.equal(saved.length, mode === "invalid" ? 0 : turn);
        if (mode !== "invalid") assert.equal(saved.find((prompt: any) => prompt.title === `${mode}-${turn}`).content, `品质标准-${turn}`);
      }
    } finally { await agent.close(); await host.dispose(); registry.resetMiniAppHost(); }
  });
}
