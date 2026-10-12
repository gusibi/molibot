import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Type } from "@sinclair/typebox";
import { runToolCall, type AgentTool } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { RunBudget } from "../core/runtimeBudget.js";

const root = mkdtempSync(join(tmpdir(), "molibot-codemode-assembly-"));
process.env.DATA_DIR = root;
after(() => rmSync(root, { recursive: true, force: true }));

async function fixture(readOnly = false, delay = 0, approval?: "defer" | "deny", maxCalls = Infinity, disabledTools: string[] = [], modelCalls?: string[]) {
  const [{ createMomTools }, { MomRuntimeStore }, { defaultRuntimeSettings }] = await Promise.all([
    import("./index.js"), import("$lib/server/agent/session/store.js"), import("$lib/server/settings/defaults.js")
  ]);
  const workspace = mkdtempSync(join(root, "workspace-"));
  const store = new MomRuntimeStore(workspace);
  const effects: string[] = [];
  const ids: string[] = [];
  const requests: string[] = [];
  let started!: () => void;
  const start = new Promise<void>(resolve => { started = resolve; });
  const budget = new RunBudget({ maxToolCalls: maxCalls, maxToolFailures: 6, maxModelAttempts: 6 });
  const mode = approval ? "accept_edits" as const : "auto" as const;
  const mcp: AgentTool<any> = { name: "mcp__fixture__write", label: "Fixture write", description: "Write fixture",
    parameters: Type.Object({ value: Type.String() }), execute: async (id, args: any) => {
      started();
      await new Promise(resolve => setTimeout(resolve, delay));
      effects.push(args.value); writeFileSync(join(workspace, "written.txt"), args.value);
      return { content: [{ type: "text", text: args.value }], details: { id } };
    } };
  const assistantMessage: AssistantMessage = { role: "assistant", content: [], api: "openai-completions", provider: "fixture", model: "fixture",
    timestamp: Date.now(), stopReason: "toolUse", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
  const tools = createMomTools({ agentId: "fixture-agent", channel: "web", executionPolicy: { mode, source: "agent", executionTarget: "host", readOnly },
    cwd: workspace, workspaceDir: workspace, chatId: "fixture", sessionId: "session", timezone: "UTC", store,
    memory: { syncExternalMemories: async () => {}, createProfileTurnSnapshot: async () => ({ fingerprint: "", items: [] }),
      createPromptSnapshot: async () => ({ createdAt: "", fingerprint: "", query: "", promptText: "", selected: [], longTerm: [], daily: [] }) } as never,
    getSettings: () => ({ ...defaultRuntimeSettings, permissionMode: mode, agents: [...defaultRuntimeSettings.agents, { id: "fixture-agent", name: "Fixture", description: "", enabled: true, disabledTools }] }), updateSettings: patch => ({ ...defaultRuntimeSettings, ...patch }),
    getSelectedMcpServerIds: () => new Set(), setSelectedMcpServerIds: () => {}, getLoadedMcpTools: () => [mcp],
    refreshLoadedMcpTools: async () => ({ statuses: [], toolCount: 1 }), uploadFile: async () => {},
    onApprovalRequest: approval ? async request => { requests.push(request.requestId); return approval; } : undefined,
    onSideEffectPreflight: async effect => { ids.push(`intent:${effect.toolCallId}`); },
    onSideEffectReceipt: async effect => { ids.push(`receipt:${effect.toolCallId}`); },
    runNestedToolCall: (tool, id, args, signal) => runToolCall({ type: "toolCall", id, name: tool.name, arguments: args as never },
      { tools: [tool], assistantMessage, context: { messages: [assistantMessage], tools: [tool] }, signal,
        beforeToolCall: async () => { const started = budget.tryStartTool(); return started.ok ? undefined : { block: true, reason: started.reason }; } }),
    ...(modelCalls ? { modelOperationDeps: { models: modelFixture(modelCalls) } } : {})
  });
  return { tools, tool: tools.find(tool => tool.name === "codemode")!, workspace, effects, ids, requests, start, budget };
}

test("assembled Codemode dispatches nested writes without reentrant lease deadlock", async () => {
  const { tool, workspace, effects, ids } = await fixture();
  const result = await tool.execute("assembled", { code: 'text(await tools.mcp__fixture__write({value:"one"})); throw new Error("later failure");' });
  assert.match((result as any).error, /later failure/);
  assert.equal(readFileSync(join(workspace, "written.txt"), "utf8"), "one");
  assert.deepEqual(effects, ["one"]);
  assert.deepEqual(ids, ["intent:assembled:codemode:1", "receipt:assembled:codemode:1"]);
});

test("assembled read-only Codemode cannot discover or call MCP writes", async () => {
  const { tool, effects } = await fixture(true);
  const result = await tool.execute("readonly", { code: 'text(ALL_TOOLS.map(x=>x.name)); await tools.mcp__fixture__write({value:"forbidden"});' });
  assert.match((result as any).error, /does not exist/);
  assert.deepEqual(effects, []);
});

test("parallel script writes retain the shared serial execution slot", async () => {
  const { tool, effects, ids } = await fixture(false, 40);
  const result = await tool.execute("parallel", { code: 'await Promise.all([tools.mcp__fixture__write({value:"one"}), tools.mcp__fixture__write({value:"two"})]);' });
  assert.equal((result as any).error, undefined);
  assert.deepEqual(effects, ["one", "two"]);
  assert.deepEqual(ids, ["intent:parallel:codemode:1", "receipt:parallel:codemode:1", "intent:parallel:codemode:2", "receipt:parallel:codemode:2"]);
});

test("assembled output artifacts stay inside the current workspace scratch directory", async () => {
  const { tool, workspace } = await fixture();
  const result = await tool.execute("assembled-artifact", { code: '// @options: {"max_output_tokens":10}\ntext("x".repeat(1000));' });
  const outputRef = (result.details as any).outputRef;
  assert.ok(outputRef && !outputRef.startsWith(".."));
  assert.equal(readFileSync(join(workspace, outputRef), "utf8"), "x".repeat(1000));
});

test("assembled Stop waits for an already started write to settle", async () => {
  const { tool, effects, start } = await fixture(false, 100);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const execution = tool.execute("assembled-stop", { code: 'await tools.mcp__fixture__write({value:"settled"});' }, controller.signal);
    await start; controller.abort();
    await execution;
    assert.deepEqual(effects, ["settled"]);
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.deepEqual(effects, ["settled"]);
  } finally { clearTimeout(timer); }
});


test("assembly rechecks each nested call through Pi hooks and its budget", async () => {
  const { tool, effects, budget } = await fixture(false, 0, undefined, 1);
  const result = await tool.execute("budget", { code: 'await tools.mcp__fixture__write({value:"one"}); await tools.mcp__fixture__write({value:"two"});' });
  assert.deepEqual(effects, ["one"]);
  assert.match((result as any).error, /budget exceeded/);
  assert.equal(budget.snapshot().toolCalls, 1);
  assert.equal(budget.getExceededKind(), "toolCalls");
});

test("permission denial does not execute the nested operation", async () => {
  const { tool, effects } = await fixture(false, 0, "deny");
  const result = await tool.execute("denied", { code: 'await tools.mcp__fixture__write({value:"forbidden"});' });
  assert.ok((result as any).error);
  assert.deepEqual(effects, []);
});

test("approval resume executes only remaining operations and retains prior write receipts", async () => {
  const { tool, effects, ids, requests } = await fixture(false, 0, "defer");
  const result = await tool.execute("before-approval", { code: 'await tools.write({label:"Save first",path:"first.txt",content:"one"}); await tools.mcp__fixture__write({value:"two"});' });
  assert.equal((result as any).terminate, true);
  assert.deepEqual(effects, []);
  assert.deepEqual(ids, ["intent:before-approval:codemode:1", "receipt:before-approval:codemode:1"]);
  const { getApprovalBroker } = await import("$lib/server/approval/approvalBroker.js");
  const broker = getApprovalBroker();
  assert.equal(broker.getRequest(requests[0])?.status, "pending");
  broker.resolveRequest({ requestId: requests[0], status: "approved", selectedScope: "session" });
  const resumed = await tool.execute("remaining-operations", { code: 'text(await tools.mcp__fixture__write({value:"two"}));' });
  assert.equal((resumed as any).error, undefined);
  assert.deepEqual(effects, ["two"]);
  assert.deepEqual(ids, ["intent:before-approval:codemode:1", "receipt:before-approval:codemode:1", "intent:remaining-operations:codemode:1", "receipt:remaining-operations:codemode:1"]);
});


test("Agent tool exclusions apply to direct, deferred and nested Codemode calls", async () => {
  const { tools, tool, effects } = await fixture(false, 0, undefined, Infinity, ["bash", "write", "edit", "webSearch", "mcpInvoke"]);
  assert.ok(!tools.some(tool => ["bash", "write", "edit", "webSearch", "mcpInvoke"].includes(tool.name)));
  const result = await tool.execute("disabled", { code: 'await tools.mcp__fixture__write({value:"forbidden"});' });
  assert.match((result as any).error, /does not exist|disabled/);
  assert.deepEqual(effects, []);
  const other = await fixture();
  assert.ok(other.tools.some(tool => tool.name === "bash"), "another Agent retains its own tools");
});

function modelFixture(calls: string[]) {
  const classifier = { type: "classifier" as const, provider: "alpha", id: "cls", name: "Alpha classifier", api: "fixture", baseUrl: "", contextWindow: 4096 };
  const image = { type: "image" as const, provider: "alpha", id: "img", name: "Alpha image", api: "fixture", baseUrl: "", input: ["text", "image"], output: ["image"] };
  return {
    getModelsOfType: (type: string) => type === "classifier" ? [classifier] : [image],
    getModelOfType: (type: string, provider: string, id: string) => [classifier, image].find((m) => m.type === type && m.provider === provider && m.id === id),
    checkAuth: async () => ({ type: "api_key" as const }),
    classify: async () => { calls.push("classify"); return { api: "fixture", provider: "alpha", model: "cls", answers: { flag: { type: "bool", probability: 0.8 } }, stopReason: "stop" as const, timestamp: 1 }; },
    generateImages: async () => { calls.push("generateImages"); return { api: "fixture", provider: "alpha", model: "img",
      output: [{ type: "image" as const, mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" }], stopReason: "stop" as const, timestamp: 1 }; }
  } as never;
}

test("assembled Codemode scripts discover, classify and display generated models through the shared service", async () => {
  const modelCalls: string[] = [];
  const { tool } = await fixture(false, 0, undefined, Infinity, [], modelCalls);
  const result = await tool.execute("models", { code: `
    const catalog = await models.list();
    const cls = await models.classify({ state: { text: "hi" }, questions: {} });
    const gen = await models.generateImages({ prompt: "a cat" });
    image(gen.images[0]);
    text(JSON.stringify({ catalog: catalog.length, answer: cls.answers.flag, type: gen.images[0].type }));
  ` });
  assert.equal((result as any).error, undefined);
  assert.deepEqual(modelCalls, ["classify", "generateImages"]);
  const text = (result.content as Array<{ type: string; text?: string }>).filter(b => b.type === "text").map(b => b.text).join("\n");
  assert.match(text, /"catalog":2/);
  assert.match(text, /"answer":\{"type":"bool","probability":0\.8\}/);
  assert.match(text, /"type":"image"/);
  const images = (result.content as Array<{ type: string }>).filter(b => b.type === "image");
  assert.equal(images.length, 1, "the displayed image reaches the tool result");
});

test("model operations are absent when the caller cannot authorize them", async () => {
  const { tool } = await fixture();
  const result = await tool.execute("no-models", { code: 'await models.list();' });
  assert.match((result as any).error, /models is not defined/);
});

test("interrupted safe reads are marked replay-safe while writes, bash and codemode are not", async () => {
  const { tools } = await fixture();
  const replay = (name: string) => (tools.find((tool) => tool.name === name) as { replay?: string } | undefined)?.replay;
  assert.equal(replay("read"), "safe");
  assert.equal(replay("docExtract"), "safe");
  assert.equal(replay("conversation_search"), "safe");
  assert.equal(replay("write"), undefined);
  assert.equal(replay("bash"), undefined);
  assert.equal(replay("codemode"), undefined);
});
