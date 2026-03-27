import assert from "node:assert/strict";
import test from "node:test";
import { sendTelegramChatAction } from "./formatting.js";

test("sendTelegramChatAction retries transient network failures until a later attempt succeeds", async () => {
  let attempts = 0;
  const bot = {
    api: {
      async sendChatAction(): Promise<void> {
        attempts += 1;
        if (attempts === 1 || attempts === 2) {
          throw new Error("Network request for 'sendChatAction' failed!");
        }
        if (attempts === 3) {
          throw new Error("socket hang up");
        }
        if (attempts === 4) {
          throw new Error("ECONNRESET");
        }
      }
    }
  };

  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((handler: TimerHandler, _timeout?: number, ...args: unknown[]) => {
    if (typeof handler === "function") {
      queueMicrotask(() => handler(...args));
    }
    return 0 as never;
  }) as unknown as typeof setTimeout;

  try {
    await sendTelegramChatAction(bot as never, "7706709760", "typing");
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }

  assert.equal(attempts, 5);
});
