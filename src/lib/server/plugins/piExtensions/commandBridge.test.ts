import assert from "node:assert/strict";
import test from "node:test";
import { listPiExtensionCommands, runPiExtensionCommand } from "$lib/server/plugins/piExtensions/commandBridge.js";
import type { LoadedPiExtension } from "$lib/server/plugins/piExtensions/types.js";

function fakeExtension(
  id: string,
  commands: Record<string, { description?: string; handler: (args: string, ctx: any) => Promise<void> }>
): LoadedPiExtension {
  return {
    id,
    name: id,
    version: "0.0.0",
    entryPath: `/fake/${id}/index.ts`,
    extension: { commands: new Map(Object.entries(commands)), handlers: new Map(), tools: new Map() } as any,
    toolNames: [],
    eventNames: [],
    commandNames: Object.keys(commands),
    flagNames: [],
    unsupported: []
  };
}

test("an extension command runs and its notifications become the reply", async () => {
  const seen: string[] = [];
  const result = await runPiExtensionCommand("/greet", "world", {
    extensions: [fakeExtension("demo", {
      greet: {
        handler: async (args, ctx) => {
          seen.push(args);
          ctx.ui.notify(`hello ${args}`);
          ctx.ui.notify("careful", "warning");
        }
      }
    })],
    cwd: "/tmp"
  });

  assert.equal(result.handled, true);
  assert.deepEqual(seen, ["world"]);
  assert.equal(result.output, "hello world\n[warning] careful");
});

test("an unknown command is not handled, so built-ins and plain text still win", async () => {
  const result = await runPiExtensionCommand("/nope", "", {
    extensions: [fakeExtension("demo", { greet: { handler: async () => undefined } })],
    cwd: "/tmp"
  });

  assert.equal(result.handled, false);
  assert.equal(result.output, undefined);
});

test("a throwing command reports the failure instead of bubbling up", async () => {
  const result = await runPiExtensionCommand("/boom", "", {
    extensions: [fakeExtension("demo", {
      boom: { handler: async () => { throw new Error("command exploded"); } }
    })],
    cwd: "/tmp"
  });

  assert.equal(result.handled, true);
  assert.equal(result.error, "command exploded");
});

test("two extensions registering one command resolve first-loaded-wins", async () => {
  const calls: string[] = [];
  const result = await runPiExtensionCommand("/dup", "", {
    extensions: [
      fakeExtension("first", { dup: { handler: async () => { calls.push("first"); } } }),
      fakeExtension("second", { dup: { handler: async () => { calls.push("second"); } } })
    ],
    cwd: "/tmp"
  });

  assert.equal(result.handled, true);
  assert.deepEqual(calls, ["first"]);
});

test("help listing dedupes command names across extensions", () => {
  const listed = listPiExtensionCommands([
    fakeExtension("first", { dup: { description: "from first", handler: async () => undefined } }),
    fakeExtension("second", { dup: { description: "from second", handler: async () => undefined } }),
    fakeExtension("third", { other: { handler: async () => undefined } })
  ]);

  assert.deepEqual(listed, [
    { name: "dup", description: "from first", extensionId: "first" },
    { name: "other", description: undefined, extensionId: "third" }
  ]);
});

test("production extension commands return subprocess notifications", async () => {
  const extension: LoadedPiExtension = {
    id: "remote", name: "remote", version: "1", entryPath: "/remote/index.ts",
    client: { request: async () => ({ notifications: [{ message: "done", type: "info" }] }) } as any,
    commands: [{ name: "remote", description: "remote command" }],
    toolNames: [], eventNames: [], commandNames: ["remote"], flagNames: [], unsupported: []
  };
  const result = await runPiExtensionCommand("/remote", "", { extensions: [extension], cwd: "/tmp" });
  assert.deepEqual(result, { handled: true, output: "done" });
});
