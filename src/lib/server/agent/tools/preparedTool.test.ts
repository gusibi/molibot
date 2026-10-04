import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "@sinclair/typebox";
import { bindToolRuntime } from "./preparedTool.js";
import { ToolRegistry, ToolRuntime } from "./toolRuntime.js";
import type { ToolDefinition, ToolExecutionContext } from "./toolTypes.js";

function context(signal?: AbortSignal): ToolExecutionContext {
  return {
    runId: "run", sessionId: "session", workspaceId: "", actorId: "owner", cwd: process.cwd(), signal,
    fs: { readText: async () => "", writeText: async () => {} }, shell: { run: async () => ({ exitCode: 0, stdout: "", stderr: "" }) },
    network: { fetch: async () => ({}) }, emit: () => {}
  };
}
function boundTool(def: ToolDefinition) {
  const registry = new ToolRegistry();
  registry.register(def);
  return bindToolRuntime({ name: def.id, label: def.name, description: def.description, parameters: Type.Object({}) },
    new ToolRuntime(registry, { decidePolicy: () => ({ type: "allow" }) }),
    (signal, toolCallId, onUpdate) => ({ ...context(signal), toolCallId, onUpdate }));
}

test("shared preparation preserves progress, error, usage and control without early execution", async () => {
  let calls = 0;
  const usage = { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 3,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  const tool = boundTool({
    id: "fixture", name: "Fixture", description: "fixture", inputSchema: Type.Object({}), risk: "low", source: "builtin",
    handler: async (_input, ctx) => {
      calls += 1;
      ctx.onUpdate?.({ content: [{ type: "text", text: "progress" }], details: {} });
      return { ok: false, error: "fixture failure", content: [{ type: "text", text: "partial" }], usage, terminate: true,
        metadata: { status: "fixture" }, details: { receipt: "one" } };
    }
  });
  const updates: unknown[] = [];
  const prepared = await tool.prepareInvocation("call", {}, undefined, update => updates.push(update));
  assert.ok("execute" in prepared);
  assert.equal(calls, 0);
  const result = await prepared.execute();
  assert.equal(calls, 1);
  assert.equal(updates.length, 1);
  assert.equal(result.isError, true);
  assert.equal(result.error, "fixture failure");
  assert.equal(result.terminate, true);
  assert.deepEqual(result.usage, usage);
  assert.deepEqual(result.details, { receipt: "one" });
  assert.deepEqual(result.metadata, { status: "fixture" });
  await assert.rejects(prepared.execute(), /already consumed/);
});

test("cancelling an admitted invocation prevents handler execution", async () => {
  let calls = 0;
  let cancellations = 0;
  const tool = boundTool({
    id: "fixture", name: "Fixture", description: "fixture", inputSchema: Type.Object({}), risk: "low", source: "builtin",
    prepare: async () => ({ cancel: () => { cancellations += 1; }, execute: async () => { calls += 1; return { ok: true }; } }),
    handler: async () => { throw new Error("Prepared invocation must own execution."); }
  });
  const prepared = await tool.prepareInvocation("call", {});
  assert.ok("execute" in prepared);
  prepared.cancel();
  await assert.rejects(prepared.execute(), /already consumed/);
  assert.equal(calls, 0);
  assert.equal(cancellations, 1);
});

test("a pre-intent approval suspension retains the authoritative request identity", async () => {
  const tool = boundTool({
    id: "fixture", name: "Fixture", description: "fixture", inputSchema: Type.Object({}), risk: "low", source: "builtin",
    prepare: async () => ({ ok: false, terminate: true, error: "Waiting", metadata: {
      status: "waiting_for_approval", approvalRequestId: "approval-one"
    } }), handler: async () => { throw new Error("Suspended invocation must not execute."); }
  });
  const result = await tool.execute("call", {});
  assert.equal(result.terminate, true);
  assert.deepEqual(result.metadata, { status: "waiting_for_approval", approvalRequestId: "approval-one" });
});
