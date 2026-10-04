import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createModels, createAssistantMessageEventStream, Type, type AssistantMessage, type Model, type TranscriptContext } from "@earendil-works/pi-ai";
import { HostBashStore } from "$lib/server/hostBash/store.js";
import { MomRuntimeStore } from "$lib/server/agent/session/store.js";
import { getBashToolDefinition } from "$lib/server/agent/tools/bash.js";
import { bindToolRuntime } from "$lib/server/agent/tools/preparedTool.js";
import { ToolRegistry, ToolRuntime } from "$lib/server/agent/tools/toolRuntime.js";
import { PiConversationRuntime } from "./piConversation.js";

const model: Model<"openai-completions"> = {
  api: "openai-completions", id: "fixture", provider: "fixture", name: "Fixture", baseUrl: "http://fixture.invalid",
  reasoning: false, input: ["text"], contextWindow: 8192, maxTokens: 1024,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
};
function modelsFor(answer: (context: TranscriptContext) => Pick<AssistantMessage, "content" | "stopReason" | "errorMessage">) {
  const models = createModels();
  const stream = (_model: unknown, context: TranscriptContext) => {
    const result = createAssistantMessageEventStream();
    const message: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
      timestamp: Date.now(), usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, ...answer(context) };
    if (message.stopReason === "error") result.push({ type: "error", reason: "error", error: message });
    else result.push({ type: "done", reason: message.stopReason === "toolUse" ? "toolUse" : "stop", message });
    result.end(); return result;
  };
  models.setProvider({ id: "fixture", name: "Fixture", getModels: () => [model],
    auth: { apiKey: { name: "Fixture key", resolve: async () => ({ auth: { apiKey: "fixture" } }) } }, stream, streamSimple: stream });
  return models;
}
function options(directory: string, models: ReturnType<typeof modelsFor>) {
  return { storagePath: join(directory, "pi.sqlite"), models,
    scope: { ownerId: "owner", executionId: "run", stepId: "step", planVersion: 1, authorityKey: "manual" },
    model: { provider: "fixture", modelId: "fixture" }, instructions: "Answer the admitted request.",
    assertStorageOwnership: () => {}, assertAuthority: () => {}, tools: [] };
}

for (const approvalPath of ["preparation", "hook"] as const) test(`a mixed native ${approvalPath} batch parks at approval and resumes each original call once`, { timeout: 10000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-mixed-approval-"));
  const effects: string[] = [];
  const preparations: string[] = [];
  let approved = false;
  let requests = 0;
  const tools = ["read", "approve", "write"].map(name => ({
    name, label: name, description: name, parameters: Type.Object({}),
    executionMode: "parallel" as const,
    ...(approvalPath === "preparation" && name === "approve" ? { prepareInvocation: async (_id: string, _args: unknown, _signal?: AbortSignal, _update?: unknown, requestId?: string) => {
      preparations.push(name);
      if (name === "approve" && !approved) return { content: [{ type: "text" as const, text: "Waiting" }],
        isError: true, terminate: true, metadata: { status: "waiting_for_approval", approvalRequestId: "original-approval" } };
      if (name === "approve") assert.equal(requestId, "original-approval");
      return { cancel: () => {}, execute: async () => {
        effects.push(name); return { content: [{ type: "text" as const, text: name }], details: {} };
      } };
    } } : {}),
    execute: async () => {
      if (approvalPath === "preparation" && name === "approve") throw new Error("Prepared execution must own the effect");
      effects.push(name); return { content: [{ type: "text" as const, text: name }], details: {} };
    }
  }));
  const models = modelsFor(context => {
    requests++;
    return context.messages.some(message => message.role === "toolResult" && message.toolName === "write")
      ? { stopReason: "stop", content: [{ type: "text", text: "Finished" }] }
      : { stopReason: "toolUse", content: tools.map(tool => ({ type: "toolCall", id: tool.name, name: tool.name, arguments: {} })) };
  });
  const create = () => new PiConversationRuntime({ ...options(directory, models), tools,
    ...(approvalPath === "hook" ? { beforeTool: async (call: { name: string }) =>
      call.name === "approve" && !approved ? { kind: "wait" as const, requestId: "original-approval" } : { kind: "allow" as const } } : {}) });
  const first = create();
  try {
    await first.open({ requestId: "inbound", content: "Run the batch" });
    assert.equal((await first.runInput()).status, "waiting_for_approval");
    await first.close();
    assert.deepEqual(effects, ["read"]);
    assert.deepEqual(preparations, approvalPath === "preparation" ? ["approve"] : []);
    assert.equal(requests, 1);
    approved = true;
    const restored = create();
    try {
      await restored.open({ requestId: "inbound", content: "Changed retry", resume: true });
      assert.equal((await restored.runInput()).status, "idle");
      assert.deepEqual(effects, ["read", "approve", "write"]);
      assert.deepEqual(preparations, approvalPath === "preparation" ? ["approve", "approve"] : []);
      assert.equal(requests, 2);
      assert.equal((await restored.context()).messages.filter(message => message.role === "toolResult").length, 3);
    } finally { await restored.close(); }
  } finally { await first.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("native continuation retains committed responses without manufacturing another user turn", async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-conversation-"));
  let requests = 0;
  const models = modelsFor(() => ++requests === 1
    ? { content: [], stopReason: "error", errorMessage: "401 fixture authentication failure" }
    : { content: [{ type: "text", text: "Recovered" }], stopReason: "stop" });
  const runtime = new PiConversationRuntime(options(directory, models));
  try {
    await runtime.open({ requestId: "inbound-1", content: "Answer" });
    await runtime.runInput();
    await runtime.continue("fallback-1");
    const context = await runtime.context();
    assert.equal(context.messages.filter(message => message.role === "user").length, 1);
    assert.equal(context.entries.flatMap(entry => entry.model ?? []).filter(message => message.role === "assistant").length, 2);
    assert.equal(requests, 2);
    await runtime.continue("fallback-1");
    assert.equal(requests, 2);
    await runtime.close();
    const reopened = new PiConversationRuntime(options(directory, models));
    try {
      await reopened.open({ requestId: "inbound-1", content: "Changed attempt text", resume: true });
      await reopened.runInput();
      assert.equal(requests, 2);
      const users = (await reopened.context()).messages.filter(message => message.role === "user");
      assert.equal(users[0]?.content, "Answer");
    } finally { await reopened.close(); }
  } finally { await runtime.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("tool visibility is configured independently from the authorized recovery registry", async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-loadout-"));
  const runtime = new PiConversationRuntime({ ...options(directory, modelsFor(() => ({ content: [], stopReason: "stop" }))),
    tools: [{ name: "read", description: "Read", label: "Read", parameters: Type.Object({}),
      execute: async () => ({ content: [{ type: "text", text: "read" }], details: {} }) }], visibleTools: [] });
  try {
    await runtime.open({ requestId: "inbound", content: "Read" });
    assert.equal((await runtime.agent()).tools.length, 0);
    await runtime.configure({ tools: ["read"] });
    assert.deepEqual((await runtime.agent()).tools.map(tool => tool.name), ["read"]);
    await assert.rejects(runtime.configure({ tools: ["unauthorized"] }), /not authorized/);
    await runtime.close();
    await assert.rejects(runtime.configure({ tools: [] }), /not open|closing/);
  } finally { await runtime.close(); rmSync(directory, { recursive: true, force: true }); }
});

for (const decision of ["approved", "rejected", "unknown"] as const) test(`native automatic Host Bash ${decision} resumes the original task without replaying sandbox`, async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-auto-host-"));
  const host = new HostBashStore(join(directory, "host.sqlite"));
  const store = new MomRuntimeStore(join(directory, "workspace"));
  let sandboxCalls = 0;
  let modelCalls = 0;
  const command = "printf approved";
  const definition = getBashToolDefinition({ cwd: directory, relocateRootArtifacts: false,
    hostApproval: { channel: "web", chatId: "chat", scopeId: "chat", sessionId: "session", runId: "run", store, hostBashStore: host } });
  const registry = new ToolRegistry(); registry.register(definition);
  const runtime = new ToolRuntime(registry, { decidePolicy: () => ({ type: "allow" }) });
  const tool = bindToolRuntime({ name: "bash", label: "Bash", description: definition.description, parameters: Type.Object({ label: Type.String(), command: Type.String() }) }, runtime,
    (signal, toolCallId) => ({ runId: "run", sessionId: "session", workspaceId: "", actorId: "chat", cwd: directory, signal, toolCallId,
      fs: { readText: async () => "", writeText: async () => {} }, network: { fetch: async () => ({}) }, emit: () => {},
      shell: { run: async () => { sandboxCalls++; if (decision === "unknown") throw new Error("fixture interrupted after external effect"); return { exitCode: 1, stdout: "", stderr: "Operation not permitted", sandboxApplied: true }; } },
      onApprovalRequest: async () => "defer" }));
  const models = modelsFor(context => {
    modelCalls++;
    return context.messages.some(message => message.role === "toolResult")
      ? { stopReason: "stop", content: [{ type: "text", text: "Finished" }] }
      : { stopReason: "toolUse", content: [{ type: "toolCall", id: "bash-one", name: "bash", arguments: { label: "Bash", command } }] };
  });
  const create = () => new PiConversationRuntime({ ...options(directory, models), tools: [tool] });
  const first = create();
  try {
    await first.open({ requestId: "inbound", content: "Run" });
    if (decision === "unknown") {
      await assert.rejects(first.runInput(), /outcome is unknown/);
      await first.close();
      const restored = create();
      try {
        await restored.open({ requestId: "inbound", content: "Changed retry", resume: true });
        await assert.rejects(restored.runInput(), /outcome is unknown/);
        assert.equal(sandboxCalls, 1);
        assert.equal(modelCalls, 1);
        assert.equal(host.listPending("chat").length, 0);
      } finally { await restored.close(); }
      return;
    }
    const waiting = await first.runInput();
    assert.equal(waiting.status, "waiting_for_approval", JSON.stringify((await first.context()).messages));
    assert.equal(sandboxCalls, 1);
    assert.equal(modelCalls, 1);
    assert.equal(existsSync(join(directory, "approved.txt")), false);
    const request = host.listPending("chat")[0]!;
    assert.ok(request);
    await first.close();
    if (decision === "approved") host.approve("chat", request.id, { scope: "once" });
    else host.reject("chat", request.id);
    const restored = create();
    try {
      await restored.open({ requestId: "inbound", content: "Changed retry", resume: true });
      assert.equal((await restored.runInput()).status, "idle");
      assert.equal(sandboxCalls, 1);
      assert.equal(modelCalls, 2);
      assert.equal(host.listPending("chat").length, 0);
      assert.equal(host.getApprovalRecord(request.id)?.status, decision === "approved" ? "executed" : "rejected");
      const receipt = (await restored.context()).messages.find(message => message.role === "toolResult");
      assert.ok(receipt?.role === "toolResult");
      assert.equal(receipt.isError, decision === "rejected");
      if (decision === "approved") assert.match(JSON.stringify(receipt.content), /approved/);
      assert.equal((await restored.context()).messages.filter(message => message.role === "toolResult").length, 1);
    } finally { await restored.close(); }
  } finally { await first.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("closing during initialization settles cleanup before another owner opens the same storage", async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-close-init-"));
  let reached!: () => void;
  let release!: () => void;
  const reachedBarrier = new Promise<void>(resolve => { reached = resolve; });
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const base = options(directory, modelsFor(() => ({ content: [], stopReason: "stop" })));
  const runtime = new PiConversationRuntime({ ...base, recoverTools: async () => { reached(); await barrier; return []; } });
  try {
    const opening = runtime.open({ requestId: "inbound", content: "Run" });
    await reachedBarrier;
    const closed = runtime.close();
    const rejected = assert.rejects(opening, /closed during initialization/);
    release();
    await rejected; await closed;
    const restored = new PiConversationRuntime(base);
    try { await restored.open({ requestId: "inbound", content: "Retry", resume: true }); await restored.runInput(); }
    finally { await restored.close(); }
  } finally { release(); await runtime.close(); rmSync(directory, { recursive: true, force: true }); }
});
