import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadPiExtensionsInProcess } from "$lib/server/plugins/piExtensions/processClient.js";
import { buildPiExtensionRuntimeSnapshot } from "$lib/server/plugins/piExtensions/runtimeSnapshot.js";

const FIXTURE = `import { Type } from "@sinclair/typebox";
export default function chat(pi: any) {
  const model = (ctx: any) => ctx.modelRegistry.getAll()[0];
  pi.registerTool({
    name: "chat",
    label: "Chat",
    description: "streams a chat model",
    parameters: Type.Object({ mode: Type.Optional(Type.String()) }),
    async execute(_id: string, params: { mode?: string }, _signal: AbortSignal, _onUpdate: unknown, ctx: any) {
      const registry = ctx.modelRegistry;
      const entry = model(ctx);
      const events: string[] = [];
      let final: any;
      let complete: any;
      let streamError = "";
      try {
        const stream = params.mode === "simple" ? registry.streamSimple(entry, { messages: [] }) : registry.stream(entry, { messages: [] });
        for await (const event of stream) events.push(event && event.type);
        final = await stream.result();
        complete = await registry.complete(entry, { messages: [] });
      } catch (error) { streamError = (error as Error).message; }
      return { content: [{ type: "text", text: JSON.stringify({ events, final, complete, streamError }) }], details: {} };
    }
  });
  pi.registerTool({
    name: "cancel_call",
    label: "Cancel",
    description: "aborts a stream immediately",
    parameters: Type.Object({}),
    async execute(_id: string, _params: unknown, _signal: AbortSignal, _onUpdate: unknown, ctx: any) {
      const controller = new AbortController();
      const stream = ctx.modelRegistry.stream(model(ctx), { messages: [] }, { signal: controller.signal });
      controller.abort(new Error("stopped by extension"));
      const events: string[] = [];
      let streamError = "";
      try { for await (const event of stream) events.push(event && event.type); await stream.result(); } catch (error) { streamError = (error as Error).message; }
      return { content: [{ type: "text", text: JSON.stringify({ events, streamError }) }], details: {} };
    }
  });
}
`;

async function withFixture<T>(run: (client: NonNullable<Awaited<ReturnType<typeof loadPiExtensionsInProcess>>["client"]>, dataDir: string) => Promise<T>): Promise<T> {
  const dataDir = mkdtempSync(join(tmpdir(), "molibot-pi-ext-stream-"));
  mkdirSync(join(dataDir, "extensions", "chat"), { recursive: true });
  writeFileSync(join(dataDir, "extensions", "chat", "index.ts"), FIXTURE, "utf8");
  const result = await loadPiExtensionsInProcess({ cwd: dataDir, agentDir: dataDir });
  try {
    assert.ok(result.client, "the worker client should exist");
    return await run(result.client, dataDir);
  } finally {
    result.client?.dispose();
    rmSync(dataDir, { recursive: true, force: true });
  }
}

function snapshot() {
  return buildPiExtensionRuntimeSnapshot({
    cwd: "/work",
    isIdle: false,
    models: { chat: [{ provider: "openai", id: "gpt", name: "GPT", api: "openai" }], classifier: [], image: [], providerAuth: { openai: true } }
  });
}

async function invoke(client: NonNullable<Awaited<ReturnType<typeof loadPiExtensionsInProcess>>["client"]>, dataDir: string, toolName: string, params: unknown, hostToken?: string) {
  const response = await client.request("invokeTool", {
    extensionId: "chat",
    toolName,
    toolCallId: "call-1",
    params,
    cwd: dataDir,
    runtime: snapshot(),
    ...(hostToken ? { hostToken } : {})
  });
  return JSON.parse(response.value.content[0].text);
}

test("a streamed chat call forwards provider events in order and resolves the final message", async () => {
  await withFixture(async (client, dataDir) => {
    const inputs: any[] = [];
    client.registerHostSession("tok-1", async (method, input, emit) => {
      if (method !== "modelRegistry.stream") throw new Error(`unexpected ${method}`);
      inputs.push(input);
      emit({ type: "message_start", message: { role: "assistant" } });
      emit({ type: "text_delta", delta: "hello" });
      emit({ type: "done", message: { role: "assistant", model: "gpt" } });
      return { message: { role: "assistant", model: "gpt", content: [{ type: "text", text: "hello" }] } };
    });
    const payload = await invoke(client, dataDir, "chat", {}, "tok-1");
    client.releaseHostSession("tok-1");

    assert.deepEqual(payload.events, ["message_start", "text_delta", "done"]);
    assert.equal(payload.final.model, "gpt");
    assert.equal(payload.complete.model, "gpt");
    assert.equal(payload.streamError, "");
    assert.deepEqual(inputs[0].model, { provider: "openai", id: "gpt" });
    assert.equal(inputs[0].simple, false);
  });
});

test("streamSimple marks the request as simple", async () => {
  await withFixture(async (client, dataDir) => {
    const simpleCalls: boolean[] = [];
    client.registerHostSession("tok-2", async (method, input, emit) => {
      if (method === "modelRegistry.stream") { simpleCalls.push(input.simple); emit({ type: "done" }); return { message: { role: "assistant", model: "gpt" } }; }
      return null;
    });
    const payload = await invoke(client, dataDir, "chat", { mode: "simple" }, "tok-2");
    client.releaseHostSession("tok-2");
    // streamSimple for the stream, non-simple `complete` for the completion.
    assert.deepEqual(simpleCalls, [true, false]);
    assert.equal(payload.final.model, "gpt");
  });
});

test("an oversized stream event fails the stream instead of crossing the IPC bound", async () => {
  await withFixture(async (client, dataDir) => {
    client.registerHostSession("tok-3", async (method, _input, emit) => {
      if (method !== "modelRegistry.stream") return null;
      emit({ type: "message_start" });
      emit({ type: "text_delta", delta: "x".repeat(300 * 1024) });
      return { message: { role: "assistant", model: "gpt" } };
    });
    const payload = await invoke(client, dataDir, "chat", {}, "tok-3");
    client.releaseHostSession("tok-3");
    assert.match(payload.streamError, /exceeded/);
  });
});

test("a host stream failure surfaces as a stream error", async () => {
  await withFixture(async (client, dataDir) => {
    client.registerHostSession("tok-4", async (method, _input, emit) => {
      if (method !== "modelRegistry.stream") return null;
      emit({ type: "message_start" });
      throw new Error("provider exploded");
    });
    const payload = await invoke(client, dataDir, "chat", {}, "tok-4");
    client.releaseHostSession("tok-4");
    assert.match(payload.streamError, /provider exploded/);
  });
});

test("aborting from the extension cancels the stream and notifies the host", async () => {
  await withFixture(async (client, dataDir) => {
    const seen: string[] = [];
    client.registerHostSession("tok-5", async (method, _input, emit) => {
      seen.push(method);
      if (method === "modelRegistry.stream") { emit({ type: "message_start" }); return { message: { role: "assistant", model: "gpt" } }; }
      return null; // modelRegistry.streamAbort
    });
    const payload = await invoke(client, dataDir, "cancel_call", {}, "tok-5");
    client.releaseHostSession("tok-5");
    assert.match(payload.streamError, /stopped by extension/);
    assert.ok(seen.includes("modelRegistry.streamAbort"), `expected a streamAbort, saw ${seen.join(",")}`);
  });
});
