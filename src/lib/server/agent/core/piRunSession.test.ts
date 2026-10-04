import { AiUsageTracker } from "$lib/server/usage/tracker.js";
import { currentPiInvocation } from "$lib/server/agent/durable/piInvocation.js";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAssistantMessageEventStream, type AssistantMessage, type Model } from "@earendil-works/pi-ai";
import { getPiModels, SESSION_AFFINITY_HEADER } from "$lib/server/providers/piRuntime.js";
import { PiRunSession } from "./piRunSession.js";
import type { PreparedAgentTool } from "$lib/server/agent/tools/preparedTool.js";

const model: Model<"openai-completions"> = { api: "openai-completions", id: "fixture", provider: "fixture", name: "Fixture",
  baseUrl: "http://fixture.invalid", reasoning: false, input: ["text"], contextWindow: 8192, maxTokens: 1024,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
const answer = (): AssistantMessage => ({ role: "assistant", api: model.api, provider: model.provider, model: model.id,
  content: [{ type: "text", text: "Done" }], stopReason: "stop", timestamp: Date.now(),
  usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });

function binding(directory: string) {
  return { storagePath: join(directory, "pi.sqlite"), requestId: "inbound", admissionKey: "manual",
    models: [model], scope: { ownerId: "owner", executionId: "run", stepId: "step", planVersion: 1, authorityKey: "manual" },
    assertStorageOwnership: () => {}, assertAuthority: () => {} };
}

test("native run adapter preserves a mixed approval batch across close and reopen", { timeout: 10000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-run-approval-"));
  const effects: string[] = [];
  let approved = false;
  let requests = 0;
  const approval: PreparedAgentTool = {
    name: "approve", label: "Approve", description: "Approve", parameters: { type: "object", properties: {} },
    prepareInvocation: async (_id, _args, _signal, _update, requestId) => {
      if (!approved) return { content: [{ type: "text", text: "Waiting" }], details: {}, isError: true, terminate: true,
        metadata: { status: "waiting_for_approval", approvalRequestId: "original-approval" } };
      assert.equal(requestId, "original-approval");
      return { cancel: () => {}, execute: async () => {
        effects.push("approve"); return { content: [{ type: "text", text: "Approved" }], details: {} };
      } };
    },
    execute: async () => { throw new Error("Prepared execution must own the effect"); }
  };
  const tools = ["read", "write"].map(name => ({ name, label: name, description: name,
    parameters: { type: "object" as const, properties: {} },
    execute: async () => { effects.push(name); return { content: [{ type: "text" as const, text: name }], details: {} }; } }));
  const options = { initialState: { model, systemPrompt: "Run", messages: [], tools: [tools[0]!, approval, tools[1]!] },
    getApiKey: () => "fixture", streamFn: () => {
      requests++;
      const message: AssistantMessage = requests === 1 ? { ...answer(), stopReason: "toolUse",
        content: ["read", "approve", "write"].map(name => ({ type: "toolCall", id: name, name, arguments: {} })) } : answer();
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "done" as const, reason: message.stopReason === "toolUse" ? "toolUse" as const : "stop" as const, message });
      stream.end(); return stream;
    } };
  const first = new PiRunSession(options);
  const suspensions: unknown[] = [];
  first.subscribe(event => { if (event.type === "tool_execution_end" && event.toolName === "approve") suspensions.push(event.result); });
  try {
    first.startTurn(); first.bindRun(binding(directory)); await first.prompt("Run the batch"); await first.close();
    assert.deepEqual(effects, ["read"]);
    assert.equal(requests, 1);
    assert.equal(suspensions.length, 1);
    assert.match(JSON.stringify(suspensions[0]), /original-approval/);
    approved = true;
    const restored = new PiRunSession(options);
    try {
      restored.startTurn(); restored.bindRun(binding(directory)); await restored.prompt("Changed retry");
      assert.deepEqual(effects, ["read", "approve", "write"]);
      assert.equal(requests, 2);
      const users = restored.state.messages.filter(message => message.role === "user");
      assert.equal(users.length, 1);
      assert.equal(users[0]?.content, "Run the batch");
      assert.equal(restored.state.messages.filter(message => message.role === "toolResult").length, 3);
    } finally { await restored.close(); }
  } finally { await first.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("native run projects canonical entries with stable identities and resumes without another provider request", async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-run-"));
  let requests = 0;
  const options = { initialState: { model, tools: [], messages: [], systemPrompt: "Answer" }, getApiKey: () => "fixture",
    streamFn: () => { requests++; const output = createAssistantMessageEventStream();
      output.push({ type: "done" as const, reason: "stop" as const, message: answer() }); output.end(); return output; } };
  const receipts: string[] = [];
  const run = new PiRunSession(options);
  run.subscribe(event => { if (event.type === "message_end") receipts.push(run.sourceIdFor(event.message)!); });
  try {
    run.startTurn(); run.bindRun(binding(directory)); await run.prompt("Original"); await run.close();
    assert.equal(requests, 1);
    assert.equal(receipts.length, 1);
    const restored = new PiRunSession(options);
    restored.subscribe(event => { if (event.type === "message_end") receipts.push(restored.sourceIdFor(event.message)!); });
    try { restored.startTurn(); restored.bindRun(binding(directory)); await restored.prompt("Changed attempt"); }
    finally { await restored.close(); }
    assert.equal(requests, 1);
    assert.equal(receipts[0], receipts[1]);
  } finally { await run.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("Stop during initialization prevents the first provider request", async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-stop-"));
  let reached!: () => void;
  const reachedBarrier = new Promise<void>(resolve => { reached = resolve; });
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  let requests = 0;
  const run = new PiRunSession({ initialState: { model, tools: [], messages: [], systemPrompt: "Answer" },
    getApiKey: () => "fixture", streamFn: () => { requests++; throw new Error("Must not request"); } });
  try {
    run.startTurn(); run.bindRun({ ...binding(directory), recoverTools: async () => { reached(); await barrier; return []; } });
    const work = run.prompt("Original");
    const failed = assert.rejects(work, /abort/i);
    await reachedBarrier; run.abort(); release(); await failed;
    assert.equal(requests, 0);
  } finally { release(); await run.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("native tool callbacks keep the original assistant when a provider reuses a call id and preserve overrides", async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-tool-origin-"));
  let requests = 0;
  const origins: number[] = [];
  const afterOrigins: number[] = [];
  const effects: number[] = [];
  const n = (args: unknown): number => {
    assert.ok(args && typeof args === "object" && "n" in args && typeof args.n === "number");
    return args.n;
  };
  const run = new PiRunSession({ initialState: { model, systemPrompt: "Run", messages: [], tools: [{
    name: "read", label: "Read", description: "Read", parameters: { type: "object", properties: { n: { type: "number" } }, required: ["n"] },
    execute: async (_id, args) => { effects.push(n(args)); return { content: [{ type: "text", text: `raw:${n(args)}` }], details: { n: n(args) } }; }
  }] }, getApiKey: () => "fixture",
    beforeToolCall: async context => { origins.push(context.assistantMessage.timestamp); return undefined; },
    afterToolCall: async context => { afterOrigins.push(context.assistantMessage.timestamp); return { content: [{ type: "text", text: `overridden:${n(context.args)}` }], details: { overridden: true } }; },
    streamFn: () => {
      requests++;
      const message: AssistantMessage = { ...answer(), timestamp: requests, stopReason: requests < 3 ? "toolUse" : "stop",
        content: requests < 3 ? [{ type: "toolCall", id: "reused-id", name: "read", arguments: { n: requests } }] : [{ type: "text", text: "Done" }] };
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "done", reason: requests < 3 ? "toolUse" : "stop", message }); stream.end(); return stream;
    } });
  try {
    run.startTurn(); run.bindRun(binding(directory)); await run.prompt("Read twice");
    assert.deepEqual(origins, [1, 2]);
    assert.deepEqual(afterOrigins, [1, 2]);
    assert.deepEqual(effects, [1, 2]);
    const results = run.state.messages.filter(message => message.role === "toolResult");
    assert.deepEqual(results.map(message => message.content), [[{ type: "text", text: "overridden:1" }], [{ type: "text", text: "overridden:2" }]]);
  } finally { await run.close(); rmSync(directory, { recursive: true, force: true }); }
});

for (const action of ["finish", "stop", "unsupported", "cancel-failed", "expired"] as const) test(`native Deferred ${action} keeps the original handle, credentials and Session affinity`, { timeout: 10000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-run-deferred-"));
  const deferredModel = { ...model, provider: "native-deferred-fixture" };
  let submits = 0;
  const polled: string[] = [];
  const cancelled: string[] = [];
  const authentication: { key: boolean; session: boolean }[] = [];
  let reached!: () => void;
  const barrier = new Promise<void>(resolve => { reached = resolve; });
  const nativeModels = getPiModels();
  nativeModels.setProvider({ id: deferredModel.provider, name: "Fixture", getModels: () => [deferredModel],
    auth: { apiKey: { name: "Fixture", resolve: async () => ({ auth: { apiKey: "global-key-must-not-replace-run-key" } }) } },
    stream: () => { throw new Error("Polling must not submit again"); },
    streamSimple: () => { throw new Error("Polling must not submit again"); },
    fetchDeferred: (_model, handle, opts) => {
      polled.push(handle.id);
      authentication.push({ key: opts?.apiKey === "fixture-key", session: opts?.headers?.[SESSION_AFFINITY_HEADER] === "session-affinity" });
      reached();
      const stream = createAssistantMessageEventStream();
      const message = { ...answer(), provider: deferredModel.provider };
      if (action === "expired") { stream.push({ type: "error", reason: "error", error: { ...message, stopReason: "error", errorMessage: "Original job expired" } }); stream.end(); }
      else if (action === "finish") { stream.push({ type: "done", reason: "stop", message }); stream.end(); }
      else opts?.signal?.addEventListener("abort", () => {
        const aborted = { ...message, stopReason: "aborted" as const, content: [] };
        stream.push({ type: "error", reason: "aborted", error: aborted }); stream.end();
      }, { once: true });
      return stream;
    },
    cancelDeferred: action === "unsupported" ? undefined : async (_model, handle, opts) => {
      authentication.push({ key: opts?.apiKey === "fixture-key", session: opts?.headers?.[SESSION_AFFINITY_HEADER] === "session-affinity" });
      cancelled.push(handle.id);
      if (action === "cancel-failed") throw new Error("Remote cancellation failed");
    }
  });
  const run = new PiRunSession({ initialState: { model: deferredModel, systemPrompt: "Answer", messages: [], tools: [] },
    sessionId: "session-affinity", getApiKey: () => "fixture-key",
    streamFn: () => {
      submits++;
      const stream = createAssistantMessageEventStream();
      const message: AssistantMessage = { ...answer(), provider: deferredModel.provider, content: [], stopReason: "deferred",
        deferred: { id: "original-remote-handle", provider: deferredModel.provider, modelId: deferredModel.id, api: deferredModel.api, pollAfterMs: 1 } };
      stream.push({ type: "done", reason: "deferred", message }); stream.end(); return stream;
    } });
  try {
    const outcomes: string[] = [];
    run.startTurn(); run.bindRun({ ...binding(directory), models: [deferredModel], onDeferredCancel: async outcome => { outcomes.push(outcome); } });
    const work = run.prompt("Answer asynchronously");
    const settled = work.then(() => undefined, error => error);
    await Promise.race([barrier, settled.then(error => { throw error ?? new Error("Deferred response finished before polling"); })]);
    if (["stop", "unsupported", "cancel-failed"].includes(action)) run.abort();
    await settled;
    assert.deepEqual(authentication, ["stop", "cancel-failed"].includes(action) ? [{ key: true, session: true }, { key: true, session: true }] : [{ key: true, session: true }]);
    assert.equal(submits, 1);
    assert.deepEqual(polled, ["original-remote-handle"]);
    assert.deepEqual(cancelled, ["stop", "cancel-failed"].includes(action) ? ["original-remote-handle"] : []);
    assert.deepEqual(outcomes, action === "unsupported" ? ["unsupported"] : action === "cancel-failed" ? ["failed"] : action === "stop" ? ["requested"] : []);
    if (action === "expired") assert.match(JSON.stringify(run.state.messages), /Original job expired/);
    if (action === "finish") assert.match(JSON.stringify(run.state.messages), /Done/);
  } finally { await run.close(); nativeModels.deleteProvider(deferredModel.provider); rmSync(directory, { recursive: true, force: true }); }
});

test("native context compaction is used by the next request and survives reopen", { timeout: 10000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-compaction-"));
  const requests: string[] = [];
  const generations = new Set<string>();
  const options = { initialState: { model, systemPrompt: "Answer", messages: [], tools: [] },
    getApiKey: () => "fixture", streamFn: (_model: Model<any>, context: { messages: readonly import("@earendil-works/pi-ai").Message[] }) => {
      requests.push(JSON.stringify(context.messages));
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "done" as const, reason: "stop" as const, message: answer() }); stream.end(); return stream;
    } };
  const run = new PiRunSession(options);
  try {
    run.startTurn(); run.bindRun({ ...binding(directory), beforeGeneration: id => { generations.add(id); } });
    await run.prompt("old oversized context");
    await run.replaceContext([{ role: "user", content: "[context summary] short", timestamp: 1 }]);
    await run.continue();
    assert.match(requests[1]!, /context summary/);
    assert.doesNotMatch(requests[1]!, /old oversized context/);
    assert.equal(generations.size, 2);
    await run.close();
    const restored = new PiRunSession(options);
    try {
      restored.startTurn(); restored.bindRun(binding(directory)); await restored.prompt("retry input");
      assert.equal(requests.length, 2);
      assert.doesNotMatch(JSON.stringify(restored.state.messages), /old oversized context/);
      assert.match(JSON.stringify(restored.state.messages), /context summary/);
    } finally { await restored.close(); }
  } finally { await run.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("native parent owns and restores the same child conversation across approval suspension", { timeout: 10000 }, async () => {
  const { currentPiInvocation } = await import("$lib/server/agent/durable/piInvocation.js");
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-owned-child-"));
  let approved = false;
  let reads = 0;
  let writes = 0;
  let rootRequests = 0;
  let childRequests = 0;
  const childIds: string[] = [];
  const childTools = [{ name: "read", label: "Read", description: "Read", replay: "safe" as const,
    parameters: { type: "object" as const, properties: {} }, execute: async () => {
      reads++; return { content: [{ type: "text" as const, text: "Read" }], details: {} };
    } }, { name: "write", label: "Write", description: "Write", parameters: { type: "object" as const, properties: {} },
    prepareInvocation: async (_id: string, _args: unknown, _signal?: AbortSignal, _update?: unknown, requestId?: string) => {
      if (!approved) return { content: [{ type: "text" as const, text: "Waiting" }], details: {}, isError: true, terminate: true,
        metadata: { status: "waiting_for_approval", approvalRequestId: "child-approval" } };
      assert.equal(requestId, "child-approval");
      return { cancel: () => {}, execute: async () => {
        writes++; return { content: [{ type: "text" as const, text: "Written" }], details: {} };
      } };
    }, execute: async () => { throw new Error("Preparation owns the child effect"); }
  }];
  const delegate = { name: "subagent", label: "Delegate", description: "Delegate", replay: "safe" as const,
    parameters: { type: "object" as const, properties: {} }, execute: async () => {
      const native = currentPiInvocation();
      assert.ok(native);
      const child = await native.child({ key: "worker:1", model, instructions: "CHILD", tools: ["read", "write"], readOnlyShell: false });
      childIds.push(child.sessionId);
      try { await child.prompt("Child task"); return { content: [{ type: "text" as const, text: "Child completed" }], details: {} }; }
      finally { await child.dispose(); }
    } };
  const options = { initialState: { model, systemPrompt: "ROOT", messages: [], tools: [delegate] }, getApiKey: () => "fixture",
    streamFn: (_model: Model<any>, context: import("@earendil-works/pi-ai").TranscriptContext) => {
      const child = JSON.stringify(context).includes("CHILD");
      const round = child ? ++childRequests : ++rootRequests;
      const message: AssistantMessage = round === 1 ? { ...answer(), stopReason: "toolUse", content: child
        ? ["read", "write"].map(name => ({ type: "toolCall", id: name, name, arguments: {} }))
        : [{ type: "toolCall", id: "delegate", name: "subagent", arguments: {} }] } : answer();
      const stream = createAssistantMessageEventStream(); stream.push({ type: "done" as const, reason: message.stopReason === "toolUse" ? "toolUse" as const : "stop" as const, message }); stream.end(); return stream;
    } };
  const bound = { ...binding(directory), childTools: () => childTools };
  const run = new PiRunSession(options);
  try {
    run.startTurn(); run.bindRun(bound); await run.prompt("Delegate work"); await run.close();
    assert.equal(reads, 1, JSON.stringify(run.state.messages)); assert.equal(writes, 0); assert.equal(rootRequests, 1); assert.equal(childRequests, 1);
    approved = true;
    const restored = new PiRunSession(options);
    try {
      restored.startTurn(); restored.bindRun(bound); await restored.prompt("Retry");
      assert.equal(reads, 1); assert.equal(writes, 1);
      assert.equal(rootRequests, 2); assert.equal(childRequests, 2);
      assert.equal(new Set(childIds).size, 1);
    } finally { await restored.close(); }
  } finally { await run.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("child failure budget preserves its executed receipt and blocks the next request", { timeout: 10000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-child-budget-"));
  let effects = 0, childRequests = 0, rootRequests = 0;
  let childMessages: any[] = [];
  const traces: Array<{ stage: string; data: Record<string, unknown> }> = [];
  const childTool = { name: "write", label: "Write", description: "Write", parameters: { type: "object" as const, properties: {} },
    execute: async () => { effects++; return { content: [{ type: "text" as const, text: "Partial write failed" }], details: {}, isError: true }; } };
  const delegate = { name: "subagent", label: "Delegate", description: "Delegate", replay: "safe" as const,
    parameters: { type: "object" as const, properties: {} }, execute: async () => {
      const native = currentPiInvocation()!;
      const child = await native.child({ key: "budget-worker", model, instructions: "CHILD_BUDGET", tools: ["write"], readOnlyShell: false });
      try { await child.prompt("Write"); return { content: [{ type: "text" as const, text: "Child settled" }], details: {} }; }
      finally { childMessages = [...child.state.messages]; await child.dispose(); }
    } };
  const options = { initialState: { model, systemPrompt: "ROOT", messages: [], tools: [delegate] },
    streamFn: (_model: Model<any>, context: import("@earendil-works/pi-ai").TranscriptContext) => {
      const child = JSON.stringify(context).includes("CHILD_BUDGET");
      const round = child ? ++childRequests : ++rootRequests;
      const message: AssistantMessage = round === 1 ? { ...answer(), stopReason: "toolUse", content: [{ type: "toolCall", id: "call", name: child ? "write" : "subagent", arguments: {} }] } : answer();
      const stream = createAssistantMessageEventStream(); stream.push({ type: "done", reason: message.stopReason === "toolUse" ? "toolUse" : "stop", message }); stream.end(); return stream;
    } };
  const bound = { ...binding(directory), childTools: () => [childTool], childBudgetLimits: { maxToolCalls: 5, maxToolFailures: 1, maxModelAttempts: 5 },
    onChildTrace: (stage: string, data: Record<string, unknown>) => traces.push({ stage, data }) };
  const run = new PiRunSession(options);
  try {
    run.startTurn(); run.bindRun(bound); await assert.rejects(run.prompt("Delegate"), /tool failures/); await run.close();
    assert.equal(effects, 1); assert.equal(childRequests, 1, JSON.stringify({ childMessages, traces }));
    assert.equal(childMessages.filter(message => message.role === "toolResult").length, 1);
    assert.equal(childMessages.find(message => message.role === "toolResult").isError, true);
    const before = traces.find(trace => trace.stage === "tool.call.before")!;
    const after = traces.find(trace => trace.stage === "tool.call.error")!;
    assert.equal(before.data.toolCallId, after.data.toolCallId);
    assert.match(String(before.data.toolCallId), /^pi:child:/);
    const restored = new PiRunSession(options);
    try { restored.startTurn(); restored.bindRun(bound); await assert.rejects(restored.prompt("Retry"), /tool failures/); assert.equal(effects, 1); assert.equal(childRequests, 1); }
    finally { await restored.close(); }
  } finally { await run.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("parallel native children sharing a provider call id retain separate preparations", { timeout: 10000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-child-parallel-"));
  const effects: string[] = [];
  const rounds = new Map<string, number>();
  const childTools = [{ name: "write", label: "Write", description: "Write", parameters: { type: "object" as const, properties: { value: { type: "string" } } },
    prepareInvocation: async (_id: string, args: any) => ({ cancel: () => {}, execute: async () => {
      effects.push(args.value); return { content: [{ type: "text" as const, text: args.value }], details: {} };
    } }), execute: async () => { throw new Error("Prepared execution required"); } }];
  const delegate = { name: "subagent", label: "Delegate", description: "Delegate", replay: "safe" as const,
    parameters: { type: "object" as const, properties: {} }, execute: async () => {
      const native = currentPiInvocation()!;
      await Promise.all(["A", "B"].map(async key => {
        const child = await native.child({ key, model, instructions: `CHILD_${key}`, tools: ["write"], readOnlyShell: false });
        try { await child.prompt("Write"); } finally { await child.dispose(); }
      }));
      return { content: [{ type: "text" as const, text: "Both completed" }], details: {} };
    } };
  const run = new PiRunSession({ initialState: { model, systemPrompt: "ROOT", messages: [], tools: [delegate] },
    streamFn: (_model, context) => {
      const text = JSON.stringify(context); const key = text.includes("CHILD_A") ? "A" : text.includes("CHILD_B") ? "B" : "ROOT";
      const round = (rounds.get(key) ?? 0) + 1; rounds.set(key, round);
      const message: AssistantMessage = round === 1 ? { ...answer(), stopReason: "toolUse", content: [{ type: "toolCall", id: "shared-id", name: key === "ROOT" ? "subagent" : "write", arguments: { value: key } }] } : answer();
      const stream = createAssistantMessageEventStream(); stream.push({ type: "done", reason: message.stopReason === "toolUse" ? "toolUse" : "stop", message }); stream.end(); return stream;
    } });
  try { run.startTurn(); run.bindRun({ ...binding(directory), childTools: () => childTools }); await run.prompt("Delegate"); assert.deepEqual(effects.sort(), ["A", "B"]); }
  finally { await run.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("read-only child shell authority blocks writes at the native tool boundary", { timeout: 10000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-child-readonly-"));
  let effects = 0, childRequests = 0, rootRequests = 0;
  let receipt = "";
  const bash = { name: "bash", label: "Bash", description: "Bash", parameters: { type: "object" as const, properties: { command: { type: "string" } } },
    execute: async () => { effects++; return { content: [{ type: "text" as const, text: "Executed" }], details: {} }; } };
  const delegate = { name: "subagent", label: "Delegate", description: "Delegate", replay: "safe" as const, parameters: { type: "object" as const, properties: {} },
    execute: async () => {
      const child = await currentPiInvocation()!.child({ key: "reader", model, instructions: "READONLY_CHILD", tools: ["bash"], readOnlyShell: true });
      try { await child.prompt("Inspect"); receipt = JSON.stringify(child.state.messages); return { content: [{ type: "text" as const, text: "Inspected" }], details: {} }; }
      finally { await child.dispose(); }
    } };
  const run = new PiRunSession({ initialState: { model, systemPrompt: "ROOT", messages: [], tools: [delegate] }, streamFn: (_model, context) => {
    const child = JSON.stringify(context).includes("READONLY_CHILD"); const round = child ? ++childRequests : ++rootRequests;
    const message: AssistantMessage = round === 1 ? { ...answer(), stopReason: "toolUse", content: [{ type: "toolCall", id: "call", name: child ? "bash" : "subagent", arguments: child ? { command: "touch changed.txt" } : {} }] } : answer();
    const stream = createAssistantMessageEventStream(); stream.push({ type: "done", reason: message.stopReason === "toolUse" ? "toolUse" : "stop", message }); stream.end(); return stream;
  } });
  try { run.startTurn(); run.bindRun({ ...binding(directory), childTools: () => [bash] }); await run.prompt("Inspect"); assert.equal(effects, 0); assert.match(receipt, /read-only inspection/); }
  finally { await run.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("child model fallback continues the same owned conversation with its admitted catalog", { timeout: 10000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-child-fallback-"));
  const fallback = { ...model, id: "fallback" };
  const children: string[] = [], requested: string[] = [];
  let rootRequests = 0;
  const delegate = { name: "subagent", label: "Delegate", description: "Delegate", replay: "safe" as const, parameters: { type: "object" as const, properties: {} },
    execute: async () => {
      for (const selected of [model, fallback]) {
        const child = await currentPiInvocation()!.child({ key: "fallback-child", model: selected, allowedModels: [model, fallback], instructions: "FALLBACK_CHILD", tools: [], readOnlyShell: true });
        children.push(child.sessionId);
        try { await child.prompt("Answer"); } finally { await child.dispose(); }
      }
      return { content: [{ type: "text" as const, text: "Fallback completed" }], details: {} };
    } };
  const run = new PiRunSession({ initialState: { model, systemPrompt: "ROOT", messages: [], tools: [delegate] }, streamFn: (selected, context) => {
    const child = JSON.stringify(context).includes("FALLBACK_CHILD");
    let message: AssistantMessage;
    if (child) { requested.push(selected.id); message = selected.id === model.id ? { ...answer(), stopReason: "error", errorMessage: "Temporary provider failure" } : { ...answer(), model: selected.id }; }
    else message = ++rootRequests === 1 ? { ...answer(), stopReason: "toolUse", content: [{ type: "toolCall", id: "call", name: "subagent", arguments: {} }] } : answer();
    const stream = createAssistantMessageEventStream();
    if (message.stopReason === "error") stream.push({ type: "error", reason: "error", error: message });
    else stream.push({ type: "done", reason: message.stopReason === "toolUse" ? "toolUse" : "stop", message });
    stream.end(); return stream;
  } });
  try { run.startTurn(); run.bindRun({ ...binding(directory), childTools: () => [] }); await run.prompt("Delegate"); assert.deepEqual(requested, [model.id, fallback.id]); assert.equal(new Set(children).size, 1); }
  finally { await run.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("child compaction uses its native ledger and parent generation budget", { timeout: 10000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-child-compaction-"));
  const childModel = { ...model, id: "compact-child", contextWindow: 1200 };
  let rootRequests = 0, childRequests = 0, summaries = 0;
  let totalTokens = 0, childModels = 0;
  const paid: string[] = [];
  const usageDir = join(directory, "usage");
  let tracker = new AiUsageTracker({ usageDir });
  const usageReceipt = (receipt: Parameters<NonNullable<import("$lib/server/agent/durable/piConversation.js").PiConversationOptions["onChildUsage"]>>[0]) => tracker.record({ requestId: receipt.id, channel: "web", botId: "fixture", sessionId: "child-test", provider: receipt.provider, model: receipt.model, api: receipt.api, inputTokens: receipt.usage.input, outputTokens: receipt.usage.output, cacheReadTokens: receipt.usage.cacheRead, cacheWriteTokens: receipt.usage.cacheWrite, totalTokens: receipt.usage.totalTokens });
  const read = { name: "read", label: "Read", description: "Read", parameters: { type: "object" as const, properties: {} }, execute: async () => ({ content: [{ type: "text" as const, text: "Read completed" }], details: {} }) };
  const delegate = { name: "subagent", label: "Delegate", description: "Delegate", replay: "safe" as const, parameters: { type: "object" as const, properties: {} }, execute: async () => {
    const child = await currentPiInvocation()!.child({ key: "compact-worker", model: childModel, instructions: "CHILD_COMPACT", tools: ["read"], readOnlyShell: true });
    try { await child.prompt("Original task ".repeat(10)); totalTokens = child.state.usage!.totalTokens; childModels = child.state.budget!.modelAttempts; return { content: [{ type: "text" as const, text: "Child complete" }], details: {} }; }
    finally { await child.dispose(); }
  } };
  const run = new PiRunSession({ initialState: { model, systemPrompt: "ROOT", messages: [], tools: [delegate] }, streamFn: (selected, context) => {
    const text = JSON.stringify(context);
    const summary = text.includes("context summarization assistant");
    const child = selected.id === childModel.id;
    let message: AssistantMessage;
    if (summary) { summaries++; message = { ...answer(), model: selected.id, content: [{ type: "text", text: "Stored task summary" }] }; }
    else if (child) {
      childRequests++;
      if (childRequests === 1) message = { ...answer(), model: selected.id, stopReason: "toolUse", content: [{ type: "toolCall", id: "read", name: "read", arguments: {} }], usage: { ...answer().usage, input: 5000, totalTokens: 5001 } };
      else { assert.ok(text.includes("Stored task summary")); assert.ok(!text.includes("Original task ".repeat(5))); message = { ...answer(), model: selected.id }; }
    } else message = ++rootRequests === 1 ? { ...answer(), stopReason: "toolUse", content: [{ type: "toolCall", id: "delegate", name: "subagent", arguments: {} }] } : answer();
    const stream = createAssistantMessageEventStream(); stream.push({ type: "done", reason: message.stopReason === "toolUse" ? "toolUse" : "stop", message }); stream.end(); return stream;
  } });
  try {
    run.startTurn(); run.bindRun({ ...binding(directory), childTools: () => [read], childCompaction: { enabled: true, reserveTokens: 200, keepRecentTokens: 1 },
      onChildUsage: usageReceipt, childBudgetLimits: { maxToolCalls: 5, maxToolFailures: 5, maxModelAttempts: 5 }, beforeGeneration: id => { if (id.includes(":child:")) paid.push(id); } });
    await run.prompt("Delegate");
    assert.equal(summaries, 1, JSON.stringify(run.state.messages)); assert.equal(childRequests, 2);
    assert.equal(totalTokens, 5005); assert.equal(childModels, 3); assert.equal(paid.length, 3); assert.equal(new Set(paid).size, 3);
    assert.equal(tracker.getSessionUsage("child-test").totalTokens, 5005);
    assert.ok(tracker.list().every(record => record.model === childModel.id));
    const receipts = tracker.list().length;
    await run.close(); tracker = new AiUsageTracker({ usageDir });
    run.startTurn(); run.bindRun({ ...binding(directory), childTools: () => [read], onChildUsage: usageReceipt });
    await run.prompt("Delegate");
    assert.equal(tracker.getSessionUsage("child-test").totalTokens, 5005);
    assert.equal(tracker.list().length, receipts);
    assert.equal(summaries, 1); assert.equal(childRequests, 2);
  } finally { await run.close(); rmSync(directory, { recursive: true, force: true }); }
});
