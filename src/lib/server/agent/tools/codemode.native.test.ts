import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Type, createModels, createAssistantMessageEventStream, type AssistantMessage, type TranscriptContext } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { createCodemodeTool } from "./codemode.js";
import { currentPiInvocation } from "../durable/piInvocation.js";

const root = mkdtempSync(join(tmpdir(), "molibot-native-codemode-"));
process.env.DATA_DIR = root;
after(() => rmSync(root, { recursive: true, force: true }));
const model = { api: "openai-completions" as const, id: "fixture", provider: "fixture", name: "Fixture", baseUrl: "http://fixture.invalid",
  reasoning: false, input: ["text" as const], contextWindow: 8192, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };

async function fixture(answer: (context: TranscriptContext) => string | undefined, leafTools: AgentTool<any>[] = [], beforeTool?: import("../durable/piConversation.js").PiConversationOptions["beforeTool"]) {
  const directory = mkdtempSync(join(root, "fixture-"));
  const { PiConversationRuntime } = await import("../durable/piConversation.js");
  const models = createModels();
  let calls = 0;
  const requests: TranscriptContext[] = [];
  const stream = (_model: unknown, context: TranscriptContext) => {
    requests.push(context);
    const code = answer(context);
    const message: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(),
      content: code === undefined ? [{ type: "text", text: "Finished" }] : [{ type: "toolCall", id: `script-${++calls}`, name: "codemode", arguments: { code } }],
      stopReason: code === undefined ? "stop" : "toolUse", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    const result = createAssistantMessageEventStream();
    result.push({ type: "done", reason: code === undefined ? "stop" : "toolUse", message }); result.end(); return result;
  };
  models.setProvider({ id: "fixture", name: "Fixture", getModels: () => [model], stream, streamSimple: stream,
    auth: { apiKey: { name: "Fixture", resolve: async () => ({ auth: { apiKey: "fixture" } }) } } });
  const codemode = createCodemodeTool({ getTools: () => leafTools, artifactDir: join(directory, "artifacts"), workspaceDir: directory,
    invoke: (tool, id, args, signal) => currentPiInvocation()!.nested(tool, id, args, signal) });
  const create = () => new PiConversationRuntime({ storagePath: join(directory, "pi.sqlite"), models,
    scope: { ownerId: "fixture", executionId: "fixture", stepId: "fixture", planVersion: 1, authorityKey: "fixture" },
    model: { provider: "fixture", modelId: "fixture" }, instructions: "Fixture", tools: [codemode, ...leafTools],
    assertStorageOwnership: () => {}, assertAuthority: () => {}, beforeTool });
  return { create, requests };
}

const resultsOf = (context: TranscriptContext) => context.messages.filter(message => message.role === "toolResult");

test("official search ranks separate query terms and the native store commits only successful scripts", { timeout: 10000 }, async () => {
  const leaf: AgentTool<any> = { name: "query", label: "Query", description: "Search archived invoices by customer", parameters: Type.Object({}),
    execute: async () => ({ content: [{ type: "text", text: "invoice" }], details: {} }) };
  const { create, requests } = await fixture(context => {
    switch (resultsOf(context).length) {
      case 0: return 'text((await searchTools("customer invoices", {limit: 1})).map(x => x.name)); text(await describeTool("query")); store("cursor", 7);';
      case 1: return 'text(load("cursor")); store("cursor", 99); throw new Error("fixture failure");';
      case 2: return 'text(load("cursor"));';
      case 3: return 'text("full-output-" + "x".repeat(6000));';
      default: return undefined;
    }
  }, [leaf]);
  const runtime = create();
  try {
    await runtime.open({ requestId: "run", content: "Query" });
    assert.equal((await runtime.runInput()).status, "idle");
    const results = (await runtime.context()).messages.filter(message => message.role === "toolResult");
    assert.equal(results.length, 4);
    assert.match(JSON.stringify(results[0].content), /\[\\"query\\"\]/);
    assert.match(JSON.stringify(results[0].content), /query\(args:/);
    assert.equal(results[1].isError, true);
    assert.match(JSON.stringify(results[1].content), /fixture failure/);
    assert.match(JSON.stringify(results[2].content), /7/);
    assert.doesNotMatch(JSON.stringify(results[2].content), /99/);
    assert.match(JSON.stringify(results[3].content), new RegExp("full-output-" + "x".repeat(6000)));
    const rendered = JSON.stringify(requests[0]);
    assert.match(rendered, /searchTools/);
    assert.match(rendered, /"constrainedSampling":\{"type":"grammar"/);
    assert.match(rendered, /getModelsOfType|store\(key/);
    assert.doesNotMatch(rendered, /models\.list/);
  } finally { await runtime.close(); }
});

test("a native Codemode restart reuses a completed write and resumes only the interrupted safe read", { timeout: 10000 }, async () => {
  let writes = 0;
  let reads = 0;
  let started!: () => void;
  const reading = new Promise<void>(resolve => { started = resolve; });
  const tools: AgentTool<any>[] = [
    { name: "record", label: "Record", description: "Write a record", parameters: Type.Object({}), execute: async () => {
      writes++; return { content: [{ type: "text", text: "Written" }], details: {} };
    } },
    { name: "query", label: "Query", description: "Read", parameters: Type.Object({}), replay: "safe", execute: async (_id, _args, signal) => {
      reads++;
      if (reads === 1) {
        started();
        await new Promise<void>((_resolve, reject) => {
          if (signal?.aborted) reject(signal.reason);
          else signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      }
      return { content: [{ type: "text", text: "Read completed" }], details: {} };
    } }
  ];
  const { create } = await fixture(context => resultsOf(context).length ? undefined : 'await tools.record({}); text(await tools.query({}));', tools);
  const first = create();
  await first.open({ requestId: "run", content: "Write then read" });
  const running = first.runInput();
  void running.catch(() => {});
  await reading;
  await first.close();
  await running.catch(() => {});
  assert.equal(writes, 1);
  const restored = create();
  try {
    await restored.open({ requestId: "run", content: "Ignored retry", resume: true });
    assert.equal((await restored.runInput()).status, "idle");
    assert.equal(writes, 1, "the committed write must not run twice");
    assert.equal(reads, 2);
    const results = (await restored.context()).messages.filter(message => message.role === "toolResult");
    assert.equal(results.length, 1);
    assert.equal(results[0].isError, false);
    assert.match(JSON.stringify(results[0].content), /Read completed/);
  } finally { await restored.close(); }
});


test("native approval continues the original script without repeating an earlier effect", { timeout: 10000 }, async () => {
  let approved = false;
  const effects: string[] = [];
  const tools = ["record", "approve", "finish"].map(name => ({ name, label: name, description: name, parameters: Type.Object({}),
    execute: async () => { effects.push(name); return { content: [{ type: "text" as const, text: name }], details: {} }; } }));
  const { create } = await fixture(context => resultsOf(context).length ? undefined :
    'await tools.record({}); await tools.approve({}); text(await tools.finish({}));', tools,
    async call => call.name === "approve" && !approved ? { kind: "wait", requestId: "approval" } : { kind: "allow" });
  const first = create();
  try {
    await first.open({ requestId: "run", content: "Run" });
    assert.equal((await first.runInput()).status, "waiting_for_approval");
    assert.deepEqual(effects, ["record"]);
  } finally { await first.close(); }
  approved = true;
  const restored = create();
  try {
    await restored.open({ requestId: "run", content: "Run", resume: true });
    assert.equal((await restored.runInput()).status, "idle");
    assert.deepEqual(effects, ["record", "approve", "finish"]);
    const results = (await restored.context()).messages.filter(message => message.role === "toolResult");
    assert.equal(results.length, 1);
    assert.equal(results[0].isError, false);
    assert.match(JSON.stringify(results[0].content), /finish/);
  } finally { await restored.close(); }
});

test("official script recovery cannot replay an interrupted write with an unknown outcome", { timeout: 10000 }, async () => {
  let writes = 0;
  let started!: () => void;
  const writing = new Promise<void>(resolve => { started = resolve; });
  const tool: AgentTool<any> = { name: "record", label: "Record", description: "Write", parameters: Type.Object({}), execute: async (_id, _args, signal) => {
    writes++;
    started();
    if (writes === 1) await new Promise<void>((_resolve, reject) => {
      if (signal?.aborted) reject(signal.reason);
      else signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    return { content: [], details: {} };
  } };
  const { create } = await fixture(context => resultsOf(context).length ? undefined : 'await tools.record({}); text("must not continue");', [tool]);
  const first = create();
  await first.open({ requestId: "run", content: "Write" });
  const running = first.runInput();
  void running.catch(() => {});
  await writing;
  await first.close();
  await running.catch(() => {});
  const restored = create();
  try {
    await restored.open({ requestId: "run", content: "Write", resume: true });
    await assert.rejects(restored.runInput(), /External operation outcome is unknown/);
    assert.equal(writes, 1);
  } finally { await restored.close(); }
});
