import assert from "node:assert/strict";
import test from "node:test";
import type { RuntimeSettings } from "$lib/server/settings/schema";
import { testDesktopChannel } from "./desktopChannelTest";

const settings = {
  channels: { feishu: { instances: [{ id: "f1", name: "Feishu", enabled: true, agentId: "", credentials: { appId: "cli_saved", appSecret: "saved-secret" }, allowedChatIds: [] }] } }
} as unknown as RuntimeSettings;

test("desktop Feishu test reads saved credentials without returning them", async () => {
  let received: { appId: string; appSecret: string } | null = null;
  const result = await testDesktopChannel(settings, { channel: "feishu", instanceId: "f1" }, (input) => {
    received = input;
    return { request: async () => ({ code: 0, data: { pingBotInfo: { botName: "Moli" } } }) };
  });
  assert.deepEqual(received, { appId: "cli_saved", appSecret: "saved-secret" });
  assert.deepEqual(result, { ok: true, label: "Moli" });
  assert.equal(JSON.stringify(result).includes("saved-secret"), false);
});

test("desktop channel test accepts unsaved replacements and rejects unsupported channels", async () => {
  const result = await testDesktopChannel(settings, {
    channel: "feishu", instanceId: "f1", fields: { appId: "cli_new" }, secretValues: { appSecret: "new-secret" }
  }, ({ appId, appSecret }) => ({ request: async () => ({ code: appId === "cli_new" && appSecret === "new-secret" ? 0 : 1, data: { name: "New" } }) }));
  assert.equal(result.ok, true);
  assert.equal((await testDesktopChannel(settings, { channel: "qq", instanceId: "q1" })).ok, false);
});
