import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveScopeRecords,
  resolveSessionScopedOverride
} from "$lib/server/agent/permissions/overrideResolver.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";

/**
 * The five-level chain is shared by the sandbox flag and the permission mode.
 * These assert the precedence itself, so a change in one consumer cannot
 * quietly re-order it for the other (CLAUDE.md pitfall 7).
 */

function settingsFixture(): RuntimeSettings {
  return {
    channels: {
      web: {
        instances: [
          { id: "bot-a", agentId: "agent-1", sandboxEnabled: undefined },
          { id: "bot-b", agentId: "agent-1", sandboxEnabled: false }
        ]
      }
    },
    agents: [
      { id: "agent-1", sandboxEnabled: undefined },
      { id: "agent-2", sandboxEnabled: false }
    ]
  } as unknown as RuntimeSettings;
}

const IDENTITY = { chatId: "c", sessionId: "s", channel: "web", botId: "bot-a" };

test("the session level wins over everything below it", () => {
  const value = resolveSessionScopedOverride<string>(settingsFixture(), IDENTITY, {
    session: () => "session",
    project: "project",
    instance: () => "instance",
    agent: () => "agent",
    global: () => "global"
  });
  assert.equal(value, "session");
});

test("project wins when the session has no value", () => {
  const value = resolveSessionScopedOverride<string>(settingsFixture(), IDENTITY, {
    session: () => null,
    project: "project",
    instance: () => "instance",
    agent: () => "agent",
    global: () => "global"
  });
  assert.equal(value, "project");
});

test("the chain falls through instance and agent to the global default", () => {
  const order: string[] = [];
  const value = resolveSessionScopedOverride<string>(settingsFixture(), IDENTITY, {
    session: () => { order.push("session"); return null; },
    project: undefined,
    instance: () => { order.push("instance"); return undefined; },
    agent: () => { order.push("agent"); return undefined; },
    global: () => { order.push("global"); return "global"; }
  });
  assert.equal(value, "global");
  assert.deepEqual(order, ["session", "instance", "agent", "global"], "levels are consulted most-specific first");
});

test("a level that returns false is a value, not an absence", () => {
  // The bug this prevents: treating `false` as "not set" would make "sandbox
  // off at this level" silently inherit "on" from the level above.
  const value = resolveSessionScopedOverride<boolean>(settingsFixture(), IDENTITY, {
    session: () => false,
    global: () => true
  });
  assert.equal(value, false);
});

test("null and undefined both mean keep looking", () => {
  for (const empty of [null, undefined]) {
    const value = resolveSessionScopedOverride<string>(settingsFixture(), IDENTITY, {
      session: () => empty,
      global: () => "global"
    });
    assert.equal(value, "global");
  }
});

test("an agent is inherited from the bot instance when not named explicitly", () => {
  const records = resolveScopeRecords(settingsFixture(), IDENTITY);
  assert.equal(records.instance?.id, "bot-a");
  assert.equal(records.agent?.id, "agent-1", "the instance's agent is what an agent-level setting applies to");
});

test("an explicit agentId outranks the instance's own agent", () => {
  const records = resolveScopeRecords(settingsFixture(), { ...IDENTITY, agentId: "agent-2" });
  assert.equal(records.agent?.id, "agent-2");
});

test("an unknown channel or bot resolves no records and still terminates", () => {
  const records = resolveScopeRecords(settingsFixture(), { channel: "nope", botId: "nobody" });
  assert.equal(records.instance, undefined);
  assert.equal(records.agent, undefined);

  const value = resolveSessionScopedOverride<string>(settingsFixture(), { channel: "nope", botId: "nobody" }, {
    instance: () => "instance",
    agent: () => "agent",
    global: () => "global"
  });
  assert.equal(value, "global");
});
