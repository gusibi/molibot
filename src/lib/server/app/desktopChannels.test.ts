import assert from "node:assert/strict";
import test from "node:test";
import type { ChannelInstanceSettings, RuntimeSettings } from "$lib/server/settings/schema";
import {
  buildDesktopChannelInstance,
  buildDesktopChannelsSummary,
  deleteDesktopChannelInstance,
  saveDesktopChannelInstance
} from "./desktopChannels";

function instance(overrides: Partial<ChannelInstanceSettings> = {}): ChannelInstanceSettings {
  return {
    id: "default",
    name: "Main Bot",
    enabled: true,
    agentId: "default",
    credentials: { token: "123456:SECRET-BOT-TOKEN", appSecret: "sk-secret-app" },
    allowedChatIds: ["chat-1", "chat-2"],
    sandboxEnabled: true,
    ...overrides
  } as ChannelInstanceSettings;
}

test("buildDesktopChannelInstance drops secret values and exposes editable non-secret fields", () => {
  const item = buildDesktopChannelInstance(instance());

  assert.equal(item.id, "default");
  assert.equal(item.name, "Main Bot");
  assert.equal(item.enabled, true);
  assert.equal(item.agentId, "default");
  assert.equal(item.allowedChatCount, 2);
  assert.deepEqual(item.allowedChatIds, ["chat-1", "chat-2"]);
  assert.equal(item.sandboxEnabled, true);

  const serialized = JSON.stringify(item);
  assert.equal(serialized.includes("SECRET-BOT-TOKEN"), false);
  assert.equal(serialized.includes("sk-secret-app"), false);
  assert.equal(serialized.includes("credentials"), false);
  assert.deepEqual(item.configuredSecrets, ["token"]);
});

test("channel save preserves omitted secrets, replaces explicit secrets, and normalizes allowlist", () => {
  const settings = {
    agents: [{ id: "default", name: "Default", description: "", enabled: true }],
    channels: { telegram: { instances: [instance({ credentials: { token: "old-secret", streamOutput: "true" } })] } }
  } as unknown as RuntimeSettings;
  const saved = saveDesktopChannelInstance(settings, {
    channel: "telegram", previousId: "default", id: "default", name: "Updated", enabled: true,
    agentId: "default", sandboxEnabled: null, allowedChatIds: [" chat-1 ", "chat-1", "chat-2"],
    fields: { streamOutput: "false" }
  });
  assert.equal(saved[0].credentials.token, "old-secret");
  assert.equal(saved[0].credentials.streamOutput, "false");
  assert.deepEqual(saved[0].allowedChatIds, ["chat-1", "chat-2"]);
  const replaced = saveDesktopChannelInstance({ ...settings, channels: { telegram: { instances: saved } } } as RuntimeSettings, {
    channel: "telegram", id: "default", name: "Updated", enabled: true, agentId: "default", sandboxEnabled: null,
    allowedChatIds: [], fields: { streamOutput: "true" }, secretValues: { token: "new-secret" }
  });
  assert.equal(replaced[0].credentials.token, "new-secret");
});

test("channel delete removes exactly one known instance", () => {
  const settings = { channels: { qq: { instances: [instance({ id: "a" }), instance({ id: "b" })] } } } as unknown as RuntimeSettings;
  assert.deepEqual(deleteDesktopChannelInstance(settings, "qq", "a").map((row) => row.id), ["b"]);
  assert.throws(() => deleteDesktopChannelInstance(settings, "slack", "a"), /Unsupported/);
});

test("buildDesktopChannelsSummary excludes web, orders known channels, and counts instances", () => {
  const summary = buildDesktopChannelsSummary({
    channels: {
      web: { instances: [instance({ id: "web-1" })] },
      weixin: { instances: [instance({ id: "wx", enabled: false })] },
      telegram: { instances: [instance({ id: "tg-1" }), instance({ id: "tg-2", enabled: false })] }
    }
  } as unknown as RuntimeSettings);

  assert.deepEqual(summary.groups.map((g) => g.channel), ["telegram", "weixin"]);
  assert.equal(summary.groups[0].total, 2);
  assert.equal(summary.groups[0].enabled, 1);
  assert.equal(summary.counts.totalInstances, 3);
  assert.equal(summary.counts.enabledInstances, 1);
  assert.equal(JSON.stringify(summary).includes("SECRET-BOT-TOKEN"), false);
});

test("buildDesktopChannelInstance treats missing sandbox override as inherited", () => {
  const item = buildDesktopChannelInstance(instance({ sandboxEnabled: undefined, allowedChatIds: [] }));
  assert.equal(item.sandboxEnabled, null);
  assert.equal(item.allowedChatCount, 0);
});
