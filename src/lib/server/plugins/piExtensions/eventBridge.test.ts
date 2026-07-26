import assert from "node:assert/strict";
import test from "node:test";
import { DefaultHookManager } from "$lib/server/agent/hooks/manager.js";
import type { HookContext } from "$lib/server/agent/hooks/types.js";
import { createPiExtensionHookPlugin } from "$lib/server/plugins/piExtensions/eventBridge.js";
import type { LoadedPiExtension } from "$lib/server/plugins/piExtensions/types.js";
import { defaultRuntimeSettings } from "$lib/server/settings/index.js";

function fakeExtension(
  id: string,
  handlers: Record<string, Array<(event: any, ctx: any) => any>>
): LoadedPiExtension {
  return {
    id,
    name: id,
    version: "0.0.0",
    entryPath: `/fake/${id}/index.ts`,
    extension: { handlers: new Map(Object.entries(handlers)), tools: new Map() } as any,
    toolNames: [],
    eventNames: Object.keys(handlers),
    commandNames: [],
    flagNames: [],
    unsupported: []
  };
}

function hookContext(overrides: Partial<HookContext> = {}): HookContext {
  return {
    runId: "run-1",
    channel: "telegram",
    chatId: "chat-1",
    sessionId: "session-1",
    ...overrides
  };
}

function managerWith(extensions: LoadedPiExtension[], forBot?: (botId?: string) => LoadedPiExtension[]) {
  const manager = new DefaultHookManager({ settings: defaultRuntimeSettings });
  const plugin = createPiExtensionHookPlugin({
    getSettings: () => defaultRuntimeSettings,
    getExtensions: (_settings, botId) => (forBot ? forBot(botId) : extensions)
  });
  for (const hook of plugin.getHooks()) manager.register(hook);
  return manager;
}

test("a tool_call handler returning block denies the tool call", async () => {
  const manager = managerWith([
    fakeExtension("guard", {
      tool_call: [() => ({ block: true, reason: "not allowed here" })]
    })
  ]);

  const decision = await manager.gate("tool.call.before", hookContext(), {
    toolName: "bash",
    toolCallId: "call-1",
    args: { command: "rm -rf /" }
  });

  assert.equal(decision.type, "deny");
  assert.match((decision as { reason: string }).reason, /not allowed here/);
});

test("a tool_call handler patches arguments by mutating input in place", async () => {
  const manager = managerWith([
    fakeExtension("patcher", {
      tool_call: [(event: any) => {
        event.input.command = `${event.input.command} --dry-run`;
      }]
    })
  ]);

  const args = { command: "deploy" };
  const decision = await manager.gate("tool.call.before", hookContext(), {
    toolName: "bash",
    toolCallId: "call-1",
    args
  });

  assert.equal(decision.type, "allow");
  // The runner passes this same object on to execution.
  assert.equal(args.command, "deploy --dry-run");
});

test("a throwing tool_call handler blocks the call, as it does in pi", async () => {
  const manager = managerWith([
    fakeExtension("broken", {
      tool_call: [() => { throw new Error("handler exploded"); }]
    })
  ]);

  const decision = await manager.gate("tool.call.before", hookContext(), {
    toolName: "read",
    toolCallId: "call-1",
    args: {}
  });

  assert.equal(decision.type, "deny");
  assert.match((decision as { reason: string }).reason, /handler exploded/);
});

test("an input handler returning transform rewrites the enriched text", async () => {
  const manager = managerWith([
    fakeExtension("rewriter", {
      input: [(event: any) => ({ action: "transform", text: `${event.text} [tagged]` })]
    })
  ]);

  const result = await manager.transform("input.enrich.after", hookContext(), {
    text: "hello",
    textLength: 5
  });

  assert.equal(result.text, "hello [tagged]");
  assert.equal(result.textLength, "hello [tagged]".length);
});

test("a before_agent_start handler replaces the system prompt", async () => {
  const manager = managerWith([
    fakeExtension("prompter", {
      before_agent_start: [(event: any) => ({ systemPrompt: `${event.systemPrompt}\n\nExtra rule.` })]
    })
  ]);

  const result = await manager.transform("prompt.build.after", hookContext(), {
    systemPrompt: "Base prompt."
  });

  assert.equal(result.systemPrompt, "Base prompt.\n\nExtra rule.");
});

test("per-bot exclusion keeps one bot's run from firing another bot's extension", async () => {
  const calls: string[] = [];
  const workBot = fakeExtension("work-only", {
    tool_call: [() => { calls.push("work-only"); }]
  });
  const everywhere = fakeExtension("everywhere", {
    tool_call: [() => { calls.push("everywhere"); }]
  });

  // Mirrors host.getActiveExtensions: "work-only" is disabled for bot "home".
  const manager = managerWith([], (botId) =>
    botId === "home" ? [everywhere] : [workBot, everywhere]);

  await manager.gate("tool.call.before", hookContext({ botId: "home" }), {
    toolName: "read",
    toolCallId: "call-1",
    args: {}
  });
  assert.deepEqual(calls, ["everywhere"]);

  await manager.gate("tool.call.before", hookContext({ botId: "work", runId: "run-2" }), {
    toolName: "read",
    toolCallId: "call-2",
    args: {}
  });
  assert.deepEqual(calls, ["everywhere", "work-only", "everywhere"]);
});

test("a throwing observe handler does not break the turn", async () => {
  const seen: string[] = [];
  const manager = managerWith([
    fakeExtension("noisy", {
      agent_start: [
        () => { throw new Error("observe boom"); },
        () => { seen.push("second handler still ran"); }
      ]
    })
  ]);

  manager.emit("run.started", hookContext(), {});
  await manager.flush({ runId: "run-1" });

  assert.deepEqual(seen, ["second handler still ran"]);
});

test("session_start fires once per session, not once per turn", async () => {
  let starts = 0;
  const manager = managerWith([
    fakeExtension("counter", { session_start: [() => { starts += 1; }] })
  ]);

  manager.emit("run.beforeStart", hookContext(), {});
  await manager.flush({ runId: "run-1" });
  manager.emit("run.beforeStart", hookContext({ runId: "run-2" }), {});
  await manager.flush({ runId: "run-2" });
  manager.emit("run.beforeStart", hookContext({ runId: "run-3", sessionId: "session-2" }), {});
  await manager.flush({ runId: "run-3" });

  assert.equal(starts, 2);
});
