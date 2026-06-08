import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FeishuThreadRegistry } from "$lib/server/channels/feishu/threadRegistry.js";

function withRegistry<T>(fn: (registry: FeishuThreadRegistry, dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "feishu-thread-registry-"));
  try {
    return fn(new FeishuThreadRegistry(dir, { maxBotMessages: 2, maxBotThreads: 2 }), dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("FeishuThreadRegistry records and matches active bot threads", () => {
  withRegistry((registry) => {
    registry.recordBotThread({ chatId: "oc_chat", threadId: "omt_1" });

    assert.deepEqual(registry.match({ chatId: "oc_chat", threadId: "omt_1" }), {
      allowed: true,
      reason: "thread_known"
    });
    assert.deepEqual(registry.match({ chatId: "oc_chat", threadId: "omt_2" }), {
      allowed: false
    });
  });
});

test("FeishuThreadRegistry treats replies to known bot messages as bot threads", () => {
  withRegistry((registry) => {
    registry.recordBotMessage({ chatId: "oc_chat", threadId: "omt_1", messageId: "om_bot" });

    assert.deepEqual(registry.match({ chatId: "oc_chat", threadId: "omt_2", parentMessageId: "om_bot" }), {
      allowed: true,
      reason: "parent_bot_message"
    });
    assert.deepEqual(registry.match({ chatId: "oc_chat", threadId: "omt_2" }), {
      allowed: true,
      reason: "thread_known"
    });
  });
});

test("FeishuThreadRegistry persists records and prunes old entries", () => {
  withRegistry((_registry, dir) => {
    const first = new FeishuThreadRegistry(dir, { maxBotMessages: 2, maxBotThreads: 2 });
    first.recordBotMessage({ chatId: "oc_chat", threadId: "omt_1", messageId: "om_1" });
    first.recordBotMessage({ chatId: "oc_chat", threadId: "omt_2", messageId: "om_2" });
    first.recordBotMessage({ chatId: "oc_chat", threadId: "omt_3", messageId: "om_3" });

    const second = new FeishuThreadRegistry(dir, { maxBotMessages: 2, maxBotThreads: 2 });
    assert.deepEqual(second.match({ chatId: "oc_chat", threadId: "omt_1" }), { allowed: false });
    assert.deepEqual(second.match({ chatId: "oc_chat", threadId: "omt_2" }), {
      allowed: true,
      reason: "thread_known"
    });
    assert.deepEqual(second.match({ chatId: "oc_chat", parentMessageId: "om_1" }), { allowed: false });
    assert.deepEqual(second.match({ chatId: "oc_chat", parentMessageId: "om_3" }), {
      allowed: true,
      reason: "parent_bot_message"
    });
  });
});
