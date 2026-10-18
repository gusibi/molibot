import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import type { ChannelInboundMessage } from "$lib/server/agent/core/types.js";

const root = mkdtempSync(join(tmpdir(), "molibot-qq-stream-"));
process.env.DATA_DIR = root;
process.env.MOLIBOT_DISABLE_LIVE_CHANNELS = "1";
const { QQManager } = await import("./runtime.js");
const { registerBot, unregisterBot } = await import("#qqbot/src/api.js");
after(() => rmSync(root, { recursive: true, force: true }));

interface RuntimeTurnOptions {
  response: {
    sendText: (text: string) => Promise<unknown>;
    uploadFile: (filePath: string, title?: string, text?: string) => Promise<void>;
  };
  replaceWithoutEdit: (text: string, state: { hasResponded: boolean; accumulatedText: string }) => Promise<void>;
}

async function deliverStreamTurn(drive: (options: RuntimeTurnOptions) => Promise<void>): Promise<{
  frames: string[];
  fallback: string[];
}> {
  const frames: string[] = [];
  const fallback: string[] = [];
  registerBot("stream-error-test", {
    openStream: () => ({
      update: async (text: string) => { frames.push(text); },
      complete: async () => {},
      cancel: () => {}
    }),
    stop: () => {}
  } as unknown as Parameters<typeof registerBot>[1]);
  const manager = Object.assign(Object.create(QQManager.prototype), {
    instanceId: "stream-error-test",
    sdkAccount: { appId: "stream-error-test", clientSecret: "test" },
    getSettings: () => ({ channels: { qq: { instances: [] } }, display: {} }),
    startTypingKeepalive: () => null,
    commandService: { shouldSendRunArchiveNotice: () => false },
    sendChannelFile: async () => {},
    sendText: async (_target: unknown, text: string) => { fallback.push(text); return { messageId: "fallback" }; },
    runSharedTextTask: async (_chat: unknown, _event: unknown, options: RuntimeTurnOptions) => {
      await drive(options);
    }
  }) as { processEvent: (event: ChannelInboundMessage, target: { mode: string; id: string; replyToId: string }) => Promise<void> };
  try {
    await manager.processEvent({ chatId: "chat" } as ChannelInboundMessage, { mode: "c2c", id: "chat", replyToId: "inbound" });
  } finally {
    unregisterBot("stream-error-test");
  }
  return { frames, fallback };
}

test("a failed tool call leaves no error trace after a normal streamed answer", async () => {
  const { frames } = await deliverStreamTurn(async (options) => {
    await options.response.sendText("_→ toolSearch_");
    await options.response.sendText("_Error: a-share-paper-trading\nagent-browser\nquery-i_");
    await options.replaceWithoutEdit("语音发你了。想换音色或再长一点，说一声。", { hasResponded: false, accumulatedText: "" });
  });
  const delivered = frames.join("\n");
  assert.ok(delivered.includes("语音发你了。"), "main answer must still be delivered");
  assert.ok(!delivered.includes("Error:"), `buffered tool error leaked into the outbound stream:\n${delivered}`);
});

test("a file-only delivery also suppresses the buffered tool error", async () => {
  const { frames } = await deliverStreamTurn(async (options) => {
    await options.response.sendText("_Error: boom_");
    await options.response.uploadFile("/tmp/rensheng.ogg", "voice");
  });
  assert.ok(!frames.join("\n").includes("Error:"), "file delivery counts as a visible reply");
});

test("the buffered error still fires when the run produced no normal reply", async () => {
  const { frames } = await deliverStreamTurn(async (options) => {
    await options.response.sendText("_→ toolSearch_");
    await options.response.sendText("_Error: boom_");
  });
  assert.ok(frames.join("\n").includes("Error: boom"), "error fallback is the only notice a silent run gets");
});

for (const failure of ["first", "update", "complete", "none"] as const) {
  test(`C2C final delivery survives ${failure} stream failure`, async () => {
    const frames: string[] = [];
    const fallback: string[] = [];
    let updates = 0;
    registerBot("stream-test", {
      openStream: () => ({
        update: async (text: string) => {
          updates++;
          if (failure === "first" || (failure === "update" && updates > 1)) throw new Error("stream lost");
          frames.push(text);
        },
        complete: async () => { if (failure === "complete") throw new Error("completion lost"); },
        cancel: () => {}
      }),
      stop: () => {}
    } as unknown as Parameters<typeof registerBot>[1]);
    const manager = Object.assign(Object.create(QQManager.prototype), {
      instanceId: "stream-test", sdkAccount: { appId: "stream-test", clientSecret: "test" },
      getSettings: () => ({ channels: { qq: { instances: [] } }, display: {} }),
      startTypingKeepalive: () => null,
      commandService: { shouldSendRunArchiveNotice: () => false },
      sendText: async (_target: unknown, text: string) => { fallback.push(text); return { messageId: "fallback" }; },
      runSharedTextTask: async (_chat: unknown, _event: unknown, options: { replaceWithoutEdit: (text: string, state: { hasResponded: boolean; accumulatedText: string }) => Promise<void> }) => {
        const state = { hasResponded: false, accumulatedText: "" };
        await options.replaceWithoutEdit("Partial answer", state);
        await options.replaceWithoutEdit("Complete final answer", state);
      }
    }) as { processEvent: (event: ChannelInboundMessage, target: { mode: string; id: string; replyToId: string }) => Promise<void> };
    try {
      await manager.processEvent({ chatId: "chat" } as ChannelInboundMessage, { mode: "c2c", id: "chat", replyToId: "inbound" });
      assert.deepEqual(fallback, failure === "none" ? [] : ["Complete final answer"]);
      if (failure === "none") assert.equal(frames.at(-1), "Complete final answer");
    } finally { unregisterBot("stream-test"); }
  });
}
