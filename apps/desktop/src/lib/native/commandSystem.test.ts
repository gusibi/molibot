import assert from "node:assert/strict";
import test from "node:test";
import {
  CommandSystem,
  CallbackCommandHostAdapter,
  MemoryCommandHostAdapter,
  commandIdForSettings,
  type CommandContext
} from "./commandSystem";

const context = (overrides: Partial<CommandContext> = {}): CommandContext => ({
  locale: "en",
  runtime: "browser",
  workspace: "chat",
  service: { restartAvailable: true, webAvailable: true },
  ...overrides
});

test("CommandSystem projects stable localized commands and settings destinations", () => {
  const system = new CommandSystem(new MemoryCommandHostAdapter());
  const snapshot = system.snapshot(context());

  assert.deepEqual(
    snapshot.find((command) => command.id === "app.open-settings"),
    {
      id: "app.open-settings",
      label: "Open Settings",
      keywords: ["preferences", "settings"],
      shortcut: "Cmd+,",
      scope: "application",
      recommendedRank: 3,
      enabled: true,
      disabledReason: undefined
    }
  );
  assert.equal(snapshot.find((command) => command.id === commandIdForSettings("memory"))?.label, "Memory");
  assert.equal(snapshot.find((command) => command.id === "workspace.automations")?.label, "Automations");
  assert.equal(snapshot.filter((command) => command.id.startsWith("settings.")).length, 22);

  const chinese = system.snapshot(context({ locale: "zh-CN" }));
  assert.equal(chinese.find((command) => command.id === "app.open-settings")?.label, "打开设置");
  assert.equal(chinese.find((command) => command.id === commandIdForSettings("memory"))?.label, "记忆");
});

test("CommandSystem recommends current workspace actions without creating a second catalog", () => {
  const system = new CommandSystem(new MemoryCommandHostAdapter());
  const snapshot = system.snapshot(context({ workspace: "automations" }));

  assert.equal(snapshot.find((command) => command.id === "workspace.automations")?.recommendedRank, 0);
  assert.equal(snapshot.find((command) => command.id === "workspace.skills")?.recommendedRank, 2);
  assert.equal(snapshot.find((command) => command.id === "chat.new")?.recommendedRank, 4);
});

test("CommandSystem exposes disabled actions with a readable reason", () => {
  const system = new CommandSystem(new MemoryCommandHostAdapter());
  const restart = system.snapshot(context({
    runtime: "desktop",
    service: { restartAvailable: false, webAvailable: true }
  }))
    .find((command) => command.id === "service.restart");

  assert.equal(restart?.enabled, false);
  assert.equal(restart?.disabledReason, "The desktop-managed service is not available to restart.");
});

test("CommandSystem disables desktop-only actions in browser preview", () => {
  const system = new CommandSystem(new MemoryCommandHostAdapter());
  const snapshot = system.snapshot(context());

  assert.equal(snapshot.find((command) => command.id === "app.open-web")?.enabled, false);
  assert.equal(snapshot.find((command) => command.id === "app.quit")?.enabled, false);
  assert.equal(snapshot.find((command) => command.id === "diagnostics.open")?.enabled, false);
  assert.equal(snapshot.find((command) => command.id === "service.restart")?.enabled, false);
  assert.equal(snapshot.find((command) => command.id === "app.open-chat")?.enabled, false);
  assert.equal(snapshot.find((command) => command.id === "app.open-chat")?.shortcut, undefined);
  assert.equal(
    snapshot.find((command) => command.id === "app.open-web")?.disabledReason,
    "This action is available only in the desktop app."
  );
});

test("CommandSystem requires a service address before opening Web", () => {
  const system = new CommandSystem(new MemoryCommandHostAdapter());
  const openWeb = system.snapshot(context({
    runtime: "desktop",
    service: { restartAvailable: true, webAvailable: false }
  })).find((command) => command.id === "app.open-web");

  assert.equal(openWeb?.enabled, false);
  assert.equal(openWeb?.disabledReason, "There is no service address to open.");
});

test("CommandSystem delegates execution to the configured host exactly once", async () => {
  const host = new MemoryCommandHostAdapter();
  const system = new CommandSystem(host);

  const result = await system.execute("chat.new", context());

  assert.deepEqual(result, { id: "chat.new", status: "executed" });
  assert.deepEqual(host.executed, ["chat.new"]);
});

test("CommandSystem never executes disabled or unknown IDs", async () => {
  const host = new MemoryCommandHostAdapter();
  const system = new CommandSystem(host);

  assert.deepEqual(
    await system.execute("service.restart", context({
      runtime: "desktop",
      service: { restartAvailable: false, webAvailable: true }
    })),
    {
      id: "service.restart",
      status: "disabled",
      reason: "The desktop-managed service is not available to restart."
    }
  );
  assert.deepEqual(await system.execute("unknown.command", context()), {
    id: "unknown.command",
    status: "unknown"
  });
  assert.deepEqual(host.executed, []);
});

test("CommandSystem returns a safe failure result when its host rejects", async () => {
  const system = new CommandSystem(new CallbackCommandHostAdapter(async () => {
    throw new Error("native operation failed");
  }));

  assert.deepEqual(await system.execute("chat.new", context()), {
    id: "chat.new",
    status: "failed"
  });
});
