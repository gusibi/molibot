import assert from "node:assert/strict";
import test from "node:test";
import { DefaultHookManager } from "$lib/server/agent/hooks/manager.js";
import type { HookContext, RuntimeHook } from "$lib/server/agent/hooks/types.js";

const context: HookContext = {
  runId: "run-1",
  channel: "web",
  chatId: "chat-1",
  sessionId: "session-1",
  workspaceId: "personal",
  actorId: "user-1"
};

test("register rejects duplicate hook ids", () => {
  const manager = new DefaultHookManager();
  const hook: RuntimeHook = {
    id: "dup",
    kind: "observe",
    stages: ["run.started"],
    handle: () => {}
  };

  manager.register(hook);
  assert.throws(() => manager.register(hook), /already registered/i);
});

test("emit is non-blocking and flush drains observe hooks by priority", async () => {
  const manager = new DefaultHookManager();
  const calls: string[] = [];

  manager.register({
    id: "slow",
    kind: "observe",
    stages: ["run.started"],
    priority: 20,
    async handle() {
      await new Promise((resolve) => setTimeout(resolve, 25));
      calls.push("slow");
    }
  });
  manager.register({
    id: "fast",
    kind: "observe",
    stages: ["run.started"],
    priority: 10,
    handle() {
      calls.push("fast");
    }
  });

  manager.emit("run.started", context, { textLength: 5 });
  assert.deepEqual(calls, [], "emit should not run observe hooks synchronously");
  await manager.flush({ timeoutMs: 1000 });
  assert.deepEqual(calls, ["fast", "slow"]);
});

test("non-critical observe hook failures are captured and do not reject flush", async () => {
  const manager = new DefaultHookManager();
  const errors: string[] = [];

  manager.onError((error) => {
    errors.push(`${error.hookId}:${error.stage}:${error.error.message}`);
  });
  manager.register({
    id: "bad-observer",
    kind: "observe",
    stages: ["run.started"],
    handle() {
      throw new Error("boom");
    }
  });

  manager.emit("run.started", context, {});
  await manager.flush({ timeoutMs: 1000 });
  assert.deepEqual(errors, ["bad-observer:run.started:boom"]);
});

test("gate returns first deny decision in priority order", async () => {
  const manager = new DefaultHookManager();

  manager.register({
    id: "allow-first",
    kind: "gate",
    stages: ["tool.call.before"],
    priority: 1,
    handle: () => ({ type: "allow" })
  });
  manager.register({
    id: "deny-second",
    kind: "gate",
    stages: ["tool.call.before"],
    priority: 2,
    handle: () => ({ type: "deny", reason: "blocked by test", code: "TEST_BLOCK" })
  });
  manager.register({
    id: "deny-third",
    kind: "gate",
    stages: ["tool.call.before"],
    priority: 3,
    handle: () => ({ type: "deny", reason: "should not be reached" })
  });

  const decision = await manager.gate("tool.call.before", context, { toolName: "bash" });
  assert.deepEqual(decision, { type: "deny", reason: "blocked by test", code: "TEST_BLOCK" });
});

test("transform is pass-through while disabled", async () => {
  const manager = new DefaultHookManager({ transformEnabled: false });

  manager.register({
    id: "replace-transform",
    kind: "transform",
    stages: ["prompt.build.after"],
    handle: () => ({ type: "replace", payload: { value: "changed" } })
  });

  const original = { value: "original" };
  const transformed = await manager.transform("prompt.build.after", context, original);
  assert.equal(transformed, original);
});

test("plugin registration initializes hooks and unregister destroys plugin hooks", async () => {
  const manager = new DefaultHookManager();
  let initialized = false;
  let destroyed = false;

  await manager.registerPlugin({
    id: "plugin-1",
    name: "Plugin 1",
    init() {
      initialized = true;
    },
    getHooks() {
      return [{
        id: "plugin-1:observer",
        kind: "observe",
        stages: ["run.started"],
        handle: () => {}
      }];
    },
    destroy() {
      destroyed = true;
    }
  });

  assert.equal(initialized, true);
  assert.equal(manager.list().some((hook) => hook.id === "plugin-1:observer"), true);

  const removed = await manager.unregisterPlugin("plugin-1");
  assert.equal(removed, true);
  assert.equal(destroyed, true);
  assert.equal(manager.list().some((hook) => hook.id === "plugin-1:observer"), false);
});

test("flush returns after timeout even when observe hook is slow", async () => {
  const manager = new DefaultHookManager();

  manager.register({
    id: "very-slow",
    kind: "observe",
    stages: ["run.started"],
    async handle() {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  });

  manager.emit("run.started", context, {});
  const startedAt = Date.now();
  await manager.flush({ timeoutMs: 20 });
  assert.ok(Date.now() - startedAt < 150);
});
