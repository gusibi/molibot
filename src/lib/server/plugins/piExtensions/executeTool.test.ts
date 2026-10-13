import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadPiExtensionsInProcess } from "$lib/server/plugins/piExtensions/processClient.js";

const FIXTURE = `import { Type } from "@sinclair/typebox";
export default function nested(pi: any) {
  pi.registerTool({ name: "nested_options", label: "Nested options", description: "receives progress and cancels only its nested call", parameters: Type.Object({}),
    async execute(_id: string, _args: unknown, _signal: AbortSignal, _update: unknown, ctx: any) {
      const controller = new AbortController(); const updates: unknown[] = [];
      const outcome = await ctx.executeTool("inner", {}, { signal: controller.signal, onUpdate: (value: unknown) => { updates.push(value); controller.abort(); } });
      return { content: [{ type: "text", text: JSON.stringify({ outcome, updates }) }], details: {} };
    }
  });
  pi.registerTool({
    name: "nested",
    label: "Nested",
    description: "runs a nested tool",
    parameters: Type.Object({}),
    async execute(_id: string, _params: unknown, _signal: AbortSignal, _onUpdate: unknown, ctx: any) {
      const outcome = await ctx.executeTool("inner", { text: "hi" });
      return { content: [{ type: "text", text: JSON.stringify(outcome) }], details: {} };
    }
  });
  pi.registerTool({
    name: "read_tools",
    label: "Read tools",
    description: "lists the callable tools",
    parameters: Type.Object({}),
    async execute(_id: string, _params: unknown, _signal: AbortSignal, _onUpdate: unknown, ctx: any) {
      return { content: [{ type: "text", text: JSON.stringify(ctx.tools.map((tool: any) => tool.name)) }], details: {} };
    }
  });
  pi.registerTool({
    name: "stop_run",
    label: "Stop",
    description: "aborts the run",
    parameters: Type.Object({}),
    async execute(_id: string, _params: unknown, _signal: AbortSignal, _onUpdate: unknown, ctx: any) {
      ctx.abort();
      return { content: [{ type: "text", text: "aborted" }], details: {} };
    }
  });
  pi.registerTool({
    name: "hang",
    label: "Hang",
    description: "never resolves and ignores cancellation",
    parameters: Type.Object({}),
    async execute() { await new Promise(() => undefined); }
  });
  pi.registerTool({
    name: "do_compact",
    label: "Compact",
    description: "triggers compaction",
    parameters: Type.Object({}),
    async execute(_id: string, _params: unknown, _signal: AbortSignal, _onUpdate: unknown, ctx: any) {
      ctx.compact();
      return { content: [{ type: "text", text: "compacting" }], details: {} };
    }
  });
  pi.on("tool_call", async (_event: any, ctx: any) => {
    const nested = await ctx.executeTool("inner", { text: "hi" });
    return { content: [{ type: "text", text: JSON.stringify({
      tools: ctx.tools.map((tool: any) => tool.name),
      nested: nested.result.content[0].text
    }) }], details: {} };
  });
}
`;

async function withFixture<T>(run: (client: NonNullable<Awaited<ReturnType<typeof loadPiExtensionsInProcess>>["client"]>, dataDir: string) => Promise<T>): Promise<T> {
  const dataDir = mkdtempSync(join(tmpdir(), "molibot-pi-ext-exec-"));
  mkdirSync(join(dataDir, "extensions", "nested"), { recursive: true });
  writeFileSync(join(dataDir, "extensions", "nested", "index.ts"), FIXTURE, "utf8");
  const result = await loadPiExtensionsInProcess({ cwd: dataDir, agentDir: dataDir });
  try {
    assert.ok(result.client, "the worker client should exist");
    return await run(result.client, dataDir);
  } finally {
    result.client?.dispose();
    rmSync(dataDir, { recursive: true, force: true });
  }
}

async function invoke(client: NonNullable<Awaited<ReturnType<typeof loadPiExtensionsInProcess>>["client"]>, dataDir: string, hostToken?: string) {
  const response = await client.request("invokeTool", {
    extensionId: "nested",
    toolName: "nested",
    toolCallId: "call-1",
    params: {},
    cwd: dataDir,
    ...(hostToken ? { hostToken } : {})
  });
  return JSON.parse(response.value.content[0].text);
}

test("ctx.executeTool routes a nested call through the host session and returns its outcome", async () => {
  await withFixture(async (client, dataDir) => {
    let seen: { method: string; input: unknown } | undefined;
    client.registerHostSession("tok-1", async (method, input) => {
      seen = { method, input };
      return {
        toolCall: { type: "toolCall", id: "call-1/inner", name: "inner", arguments: { text: "hi" } },
        result: { content: [{ type: "text", text: "inner-ran" }], details: {} },
        isError: false
      };
    });
    const outcome = await invoke(client, dataDir, "tok-1");
    client.releaseHostSession("tok-1");

    assert.deepEqual(seen, { method: "executeTool", input: { toolName: "inner", args: { text: "hi" } } });
    assert.equal(outcome.isError, false);
    assert.equal(outcome.result.content[0].text, "inner-ran");
    assert.equal(outcome.toolCall.name, "inner");
  });
});

test("ctx.executeTool reports isError when no host session owns the invocation", async () => {
  await withFixture(async (client, dataDir) => {
    const outcome = await invoke(client, dataDir);
    assert.equal(outcome.isError, true);
    assert.match(outcome.result.content[0].text, /not available/i);
  });
});

test("a host-side nested failure comes back as an error outcome, not a throw", async () => {
  await withFixture(async (client, dataDir) => {
    client.registerHostSession("tok-2", async () => { throw new Error("denied by policy"); });
    const outcome = await invoke(client, dataDir, "tok-2");
    client.releaseHostSession("tok-2");
    assert.equal(outcome.isError, true);
    assert.match(outcome.result.content[0].text, /denied by policy/);
  });
});

test("ctx.tools exposes the callable tool catalog", async () => {
  await withFixture(async (client, dataDir) => {
    const response = await client.request("invokeTool", {
      extensionId: "nested",
      toolName: "read_tools",
      toolCallId: "call-tools",
      params: {},
      cwd: dataDir,
      tools: [
        { name: "inner", label: "Inner", description: "inner", parameters: { type: "object" } },
        { name: "read", label: "Read", description: "read", parameters: { type: "object" } }
      ]
    });
    assert.deepEqual(JSON.parse(response.value.content[0].text), ["inner", "read"]);
  });
});

test("ctx.abort notifies the host", async () => {
  await withFixture(async (client, dataDir) => {
    const seen: string[] = [];
    client.registerHostSession("tok-abort", async (method) => { seen.push(method); return null; });
    await client.request("invokeTool", {
      extensionId: "nested", toolName: "stop_run", toolCallId: "call-stop", params: {}, cwd: dataDir, hostToken: "tok-abort"
    });
    client.releaseHostSession("tok-abort");
    assert.deepEqual(seen, ["abort"]);
  });
});

test("ctx.compact notifies the host", async () => {
  await withFixture(async (client, dataDir) => {
    const seen: string[] = [];
    client.registerHostSession("tok-compact", async (method) => { seen.push(method); return null; });
    await client.request("invokeTool", {
      extensionId: "nested", toolName: "do_compact", toolCallId: "call-compact", params: {}, cwd: dataDir, hostToken: "tok-compact"
    });
    client.releaseHostSession("tok-compact");
    assert.deepEqual(seen, ["compact"]);
  });
});

test("an extension that ignores cancellation cannot hang the service", async () => {
  await withFixture(async (client, dataDir) => {
    let faulted = false;
    client.onFault(() => { faulted = true; });
    const controller = new AbortController();
    const pending = client.request("invokeTool", {
      extensionId: "nested", toolName: "hang", toolCallId: "call-hang", params: {}, cwd: dataDir
    }, controller.signal);
    setTimeout(() => controller.abort(), 30);
    await assert.rejects(() => pending, /abort|exited|timed out/i);
    assert.equal(faulted, true);
  });
});

test("event handlers receive the run context and can call nested tools", async () => {
  await withFixture(async (client, dataDir) => {
    client.registerHostSession("tok-event", async (method) => {
      if (method === "executeTool") {
        return { toolCall: { type: "toolCall", id: "e/inner", name: "inner", arguments: {} }, result: { content: [{ type: "text", text: "inner-ran" }], details: {} }, isError: false };
      }
      return null;
    });
    const response = await client.request("invokeEvent", {
      extensionId: "nested",
      event: "tool_call",
      handlerIndex: 0,
      payload: { type: "tool_call" },
      cwd: dataDir,
      tools: [{ name: "inner", label: "Inner", description: "inner", parameters: { type: "object" } }],
      hostToken: "tok-event"
    });
    client.releaseHostSession("tok-event");
    const value = JSON.parse(response.results[0].content[0].text);
    assert.deepEqual(value.tools, ["inner"]);
    assert.equal(value.nested, "inner-ran");
  });
});

test("a released host session cannot serve a later request", async () => {
  await withFixture(async (client, dataDir) => {
    // Registered then immediately released: the token no longer routes anywhere.
    client.registerHostSession("tok-3", async () => ({ result: { content: [], details: {} }, isError: false }));
    client.releaseHostSession("tok-3");
    const outcome = await invoke(client, dataDir, "tok-3");
    assert.equal(outcome.isError, true);
    assert.match(outcome.result.content[0].text, /has ended/i);
  });
});

test("the invocation signal reaches a cooperative extension before forced termination", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-extension-signal-"));
  let client: Awaited<ReturnType<typeof loadPiExtensionsInProcess>>["client"] | undefined;
  try {
    const extDir = join(dir, ".pi", "extensions");
    mkdirSync(extDir, { recursive: true });
    writeFileSync(join(extDir, "signal.ts"), `import { Type } from "@sinclair/typebox";
export default function(pi: any) { pi.registerTool({ name: "signal_probe", label: "Signal", description: "Wait for cancellation", parameters: Type.Object({}), async execute(_id: string, _args: any, signal: AbortSignal, _update: any, ctx: any) {
  await ctx.executeTool("ready", { same: signal === ctx.signal });
  if (!signal.aborted) await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
  await ctx.executeTool("cancelled", { aborted: ctx.signal.aborted });
  return { content: [{ type: "text", text: "cancelled" }], details: {} };
} }); }`);
    const loaded = await loadPiExtensionsInProcess({ cwd: dir, agentDir: join(dir, ".pi") });
    client = loaded.client;
    const controller = new AbortController();
    const observations: unknown[] = [];
    let ready!: () => void;
    const started = new Promise<void>(resolve => { ready = resolve; });
    client.registerHostSession("probe", async (_method, args) => { observations.push(args); ready(); return {}; });
    const pending = client.request("invokeTool", { extensionId: loaded.extensions[0]!.id, toolName: "signal_probe", toolCallId: "one", params: {}, hostToken: "probe" }, controller.signal);
    await started;
    controller.abort();
    await assert.rejects(pending, /aborted/);
    assert.deepEqual(observations, [{ toolName: "ready", args: { same: true } }, { toolName: "cancelled", args: { aborted: true } }]);
  } finally { client?.dispose(); rmSync(dir, { recursive: true, force: true }); }
});

test("an in-flight host response cannot cross a released invocation", async () => {
  await withFixture(async (client, dataDir) => {
    let started!: () => void; let release!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const barrier = new Promise<void>(resolve => { release = resolve; });
    client.registerHostSession("old-owner", async () => { started(); await barrier; return { isError: false, result: { content: [{ type: "text", text: "old result" }] } }; });
    const pending = client.request("invokeTool", { extensionId: "nested", cwd: dataDir, toolName: "nested", toolCallId: "old", params: {}, hostToken: "old-owner" });
    await entered; client.releaseHostSession("old-owner"); release();
    const response = await pending;
    const outcome = JSON.parse(response.value.content[0].text);
    assert.equal(outcome.isError, true);
    assert.match(outcome.result.content[0].text, /invocation.*ended/);
  });
});

test("oversized IPC input fails before dispatch and leaves the worker usable", async () => {
  await withFixture(async (client, dataDir) => {
    await assert.rejects(client.request("invokeTool", { extensionId: "nested", params: { text: "x".repeat(64 * 1024 * 1024) } }), /IPC payload exceeded/);
    client.registerHostSession("bounded", async () => ({ isError: false, result: { content: [{ type: "text", text: "still usable" }] } }));
    assert.equal((await invoke(client, dataDir, "bounded")).isError, false);
    client.releaseHostSession("bounded");
  });
});


test("executeTool options preserve progress and per-call cancellation over IPC", async () => {
  await withFixture(async (client, dataDir) => {
    let cancelled = false;
    client.registerHostSession("options", async (_method, _input, emit, signal) => {
      const aborted = new Promise<void>(resolve => signal!.addEventListener("abort", () => { cancelled = true; resolve(); }, { once: true }));
      emit({ content: [{ type: "text", text: "working" }], details: {} });
      await aborted;
      return { isError: true, result: { content: [{ type: "text", text: "cancelled" }], details: {} } };
    });
    const response = await client.request("invokeTool", { extensionId: "nested", toolName: "nested_options", toolCallId: "options", params: {}, cwd: dataDir, hostToken: "options" });
    const value = JSON.parse(response.value.content[0].text);
    assert.equal(cancelled, true);
    assert.equal(value.outcome.isError, true);
    assert.equal(value.updates[0].content[0].text, "working");
    assert.equal(value.outcome.result.content[0].text, "cancelled");
    client.releaseHostSession("options");
  });
});
