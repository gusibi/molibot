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
    permissionMode: "manual",
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
  assert.equal(item.permissionMode, "manual");

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
    agentId: "default", permissionMode: null, allowedChatIds: [" chat-1 ", "chat-1", "chat-2"],
    fields: { streamOutput: "false" }
  });
  assert.equal(saved[0].credentials.token, "old-secret");
  assert.equal(saved[0].credentials.streamOutput, "false");
  assert.deepEqual(saved[0].allowedChatIds, ["chat-1", "chat-2"]);
  const replaced = saveDesktopChannelInstance({ ...settings, channels: { telegram: { instances: saved } } } as RuntimeSettings, {
    channel: "telegram", id: "default", name: "Updated", enabled: true, agentId: "default", permissionMode: null,
    allowedChatIds: [], fields: { streamOutput: "true" }, secretValues: { token: "new-secret" }
  });
  assert.equal(replaced[0].credentials.token, "new-secret");
});

test("channel delete removes exactly one known instance", () => {
  const settings = { channels: { qq: { instances: [instance({ id: "a" }), instance({ id: "b" })] } } } as unknown as RuntimeSettings;
  assert.deepEqual(deleteDesktopChannelInstance(settings, "qq", "a").map((row) => row.id), ["b"]);
  assert.throws(() => deleteDesktopChannelInstance(settings, "slack", "a"), /Unsupported/);
});

test("buildDesktopChannelsSummary lists Web first, then known external channels, and counts instances", () => {
  const summary = buildDesktopChannelsSummary({
    channels: {
      web: { instances: [instance({ id: "web-1" })] },
      weixin: { instances: [instance({ id: "wx", enabled: false })] },
      telegram: { instances: [instance({ id: "tg-1" }), instance({ id: "tg-2", enabled: false })] }
    }
  } as unknown as RuntimeSettings);

  assert.deepEqual(summary.groups.map((g) => g.channel), ["web", "telegram", "weixin"]);
  assert.equal(summary.groups[0].total, 1);
  assert.equal(summary.groups[0].enabled, 1);
  assert.equal(summary.groups[1].total, 2);
  assert.equal(summary.groups[1].enabled, 1);
  assert.equal(summary.counts.totalInstances, 4);
  assert.equal(summary.counts.enabledInstances, 2);
  assert.equal(JSON.stringify(summary).includes("SECRET-BOT-TOKEN"), false);
});

test("web instances save and delete through the channel path without credential fields", () => {
  const settings = {
    agents: [{ id: "default", name: "Momo", description: "", enabled: true }],
    channels: { web: { instances: [{ id: "default", name: "Default Web", enabled: true, agentId: "default", credentials: {}, allowedChatIds: [] }] } }
  } as unknown as RuntimeSettings;
  const saved = saveDesktopChannelInstance(settings, {
    channel: "web", id: "web-qa", name: "QA Web", enabled: true,
    agentId: "default", permissionMode: "manual", allowedChatIds: [], fields: {}
  });
  assert.deepEqual(saved.map((row) => row.id), ["default", "web-qa"]);
  assert.equal(saved[1].permissionMode, "manual");
  const removed = deleteDesktopChannelInstance({ ...settings, channels: { web: { instances: saved } } } as RuntimeSettings, "web", "web-qa");
  assert.deepEqual(removed.map((row) => row.id), ["default"]);
});

test("buildDesktopChannelInstance treats missing mode override as inherited", () => {
  const item = buildDesktopChannelInstance(instance({ permissionMode: undefined, allowedChatIds: [] }));
  assert.equal(item.permissionMode, null);
  assert.equal(item.allowedChatCount, 0);
});

test("buildDesktopChannelInstance exposes per-bot display overrides", () => {
  const item = buildDesktopChannelInstance(instance({
    display: { toolProgress: "off", showReasoning: "new", gatewayNotifyInterval: 30, runLogNotice: true }
  }));
  assert.deepEqual(item.display, { toolProgress: "off", showReasoning: "new", gatewayNotifyInterval: 30, runLogNotice: true });
  assert.equal(buildDesktopChannelInstance(instance()).display, null);
});

test("channel save persists display overrides and replaces the previous set wholesale", () => {
  const settings = {
    agents: [{ id: "default", name: "Default", description: "", enabled: true }],
    channels: { telegram: { instances: [instance({ display: { toolProgress: "verbose", runLogNotice: true } })] } }
  } as unknown as RuntimeSettings;
  const saved = saveDesktopChannelInstance(settings, {
    channel: "telegram", previousId: "default", id: "default", name: "Updated", enabled: true,
    agentId: "default", permissionMode: null, allowedChatIds: [],
    fields: { streamOutput: "true" },
    display: { toolProgress: "off", gatewayNotifyInterval: 45 }
  });
  // toolProgress replaced, runLogNotice dropped — the request is the whole truth.
  assert.deepEqual(saved[0].display, { toolProgress: "off", gatewayNotifyInterval: 45 });
});

test("channel save without display clears per-bot overrides so the bot follows global", () => {
  const settings = {
    agents: [{ id: "default", name: "Default", description: "", enabled: true }],
    channels: { telegram: { instances: [instance({ display: { toolProgress: "off" } })] } }
  } as unknown as RuntimeSettings;
  const saved = saveDesktopChannelInstance(settings, {
    channel: "telegram", previousId: "default", id: "default", name: "Updated", enabled: true,
    agentId: "default", permissionMode: null, allowedChatIds: [], fields: { streamOutput: "true" }
  });
  assert.equal(saved[0].display, undefined);
});

test("channel save ignores invalid display values instead of persisting them", () => {
  const settings = {
    agents: [{ id: "default", name: "Default", description: "", enabled: true }],
    channels: { telegram: { instances: [] } }
  } as unknown as RuntimeSettings;
  const saved = saveDesktopChannelInstance(settings, {
    channel: "telegram", id: "default", name: "New", enabled: true,
    agentId: "default", permissionMode: null, allowedChatIds: [], fields: {},
    display: { toolProgress: "shout" as never, showReasoning: null as never, gatewayNotifyInterval: null as never, runLogNotice: null as never }
  });
  // null means "clear the override"; invalid enum values are dropped — all inherit.
  assert.equal(saved[0].display, undefined);
});

test("buildDesktopChannelsSummary carries global display defaults", () => {
  const summary = buildDesktopChannelsSummary({
    display: { toolProgress: "new", showReasoning: "off", gatewayNotifyInterval: 0, runLogNotice: false },
    channels: { telegram: { instances: [instance({ id: "tg-1" })] } }
  } as unknown as RuntimeSettings);
  assert.deepEqual(summary.defaults, { toolProgress: "new", showReasoning: "off", gatewayNotifyInterval: 0, runLogNotice: false });
});
