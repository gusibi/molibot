import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadPiExtensionsInProcess } from "$lib/server/plugins/piExtensions/processClient.js";

const FIXTURE = `import { Type } from "@sinclair/typebox";
export default function nested(pi: any) {
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
