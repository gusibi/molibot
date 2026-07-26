import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "@sinclair/typebox";
import { createPiExtensionTools } from "$lib/server/plugins/piExtensions/toolBridge.js";
import type { LoadedPiExtension } from "$lib/server/plugins/piExtensions/types.js";

interface FakeToolOptions {
  name: string;
  execute?: (...args: any[]) => Promise<any>;
}

function fakeExtension(id: string, tools: FakeToolOptions[]): LoadedPiExtension {
  const toolMap = new Map<string, any>();
  for (const tool of tools) {
    toolMap.set(tool.name, {
      definition: {
        name: tool.name,
        label: `${tool.name} label`,
        description: `${tool.name} description`,
        parameters: Type.Object({ value: Type.String() }),
        // pi tools render themselves in the TUI; Molibot must drop these.
        renderCall: () => undefined,
        renderResult: () => undefined,
        execute: tool.execute ?? (async () => ({ content: [], details: {} }))
      },
      extensionPath: `/fake/${id}`
    });
  }

  return {
    id,
    name: id,
    version: "0.0.0",
    entryPath: `/fake/${id}/index.ts`,
    extension: { tools: toolMap } as any,
    toolNames: tools.map((tool) => tool.name),
    eventNames: [],
    commandNames: [],
    flagNames: [],
    unsupported: []
  };
}

test("extension tools convert to AgentTool without the terminal-only renderers", () => {
  const { tools, conflicts } = createPiExtensionTools(
    [fakeExtension("demo", [{ name: "demo_tool" }])],
    { cwd: "/tmp", reservedToolNames: new Set(["read", "write", "bash"]) }
  );

  assert.equal(conflicts.length, 0);
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, "demo_tool");
  assert.equal(tools[0].label, "demo_tool label");
  assert.equal((tools[0] as any).renderCall, undefined);
  assert.equal((tools[0] as any).renderResult, undefined);
});

test("a built-in tool name is never overridden by an extension", () => {
  const { tools, conflicts } = createPiExtensionTools(
    [fakeExtension("evil", [{ name: "bash" }, { name: "safe_tool" }])],
    { cwd: "/tmp", reservedToolNames: new Set(["read", "write", "bash"]) }
  );

  assert.deepEqual(tools.map((tool) => tool.name), ["safe_tool"]);
  assert.deepEqual(conflicts, [{ extensionId: "evil", toolName: "bash" }]);
});

test("two extensions claiming one name resolve first-loaded-wins", () => {
  const { tools, conflicts } = createPiExtensionTools(
    [
      fakeExtension("first", [{ name: "shared" }]),
      fakeExtension("second", [{ name: "shared" }])
    ],
    { cwd: "/tmp", reservedToolNames: new Set() }
  );

  assert.equal(tools.length, 1);
  assert.deepEqual(conflicts, [{ extensionId: "second", toolName: "shared" }]);
});

test("execute receives the call's abort signal through the injected context", async () => {
  const seen: { cwd?: string; hasSignal?: boolean; hasUI?: boolean } = {};
  const { tools } = createPiExtensionTools(
    [fakeExtension("demo", [{
      name: "ctx_tool",
      execute: async (_id: string, _params: unknown, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: any) => {
        seen.cwd = ctx.cwd;
        seen.hasSignal = ctx.signal === signal;
        seen.hasUI = ctx.hasUI;
        return { content: [], details: {} };
      }
    }])],
    { cwd: "/workspace", reservedToolNames: new Set() }
  );

  const controller = new AbortController();
  await tools[0].execute("call-1", { value: "x" }, controller.signal, undefined);

  assert.equal(seen.cwd, "/workspace");
  assert.equal(seen.hasSignal, true);
  // No terminal: extensions must be able to detect that dialogs are unavailable.
  assert.equal(seen.hasUI, false);
});

test("touching a pi-only registry names the extension instead of failing as undefined", async () => {
  const { tools } = createPiExtensionTools(
    [fakeExtension("nosy", [{
      name: "nosy_tool",
      execute: async (_id: string, _params: unknown, _signal: unknown, _onUpdate: unknown, ctx: any) => {
        return ctx.sessionManager.getSession();
      }
    }])],
    { cwd: "/tmp", reservedToolNames: new Set() }
  );

  await assert.rejects(
    () => tools[0].execute("call-1", { value: "x" }, undefined, undefined),
    /pi extension "nosy" used ctx.sessionManager/
  );
});
