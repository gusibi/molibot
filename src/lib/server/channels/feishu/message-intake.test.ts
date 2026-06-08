import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFeishuThreadScopeId,
  isFeishuGroupMessageTriggered,
  toFeishuInboundEvent
} from "$lib/server/channels/feishu/message-intake.js";

function message(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    chat_id: "oc_chat",
    chat_type: "group",
    message_id: "om_user",
    message_type: "text",
    content: JSON.stringify({ text: "hello" }),
    mentions: [],
    create_time: "1710000000123",
    ...overrides
  };
}

const sender = {
  sender_id: {
    open_id: "ou_user",
    union_id: "on_user"
  }
};

test("isFeishuGroupMessageTriggered ignores ordinary group messages without bot mention or known thread", () => {
  assert.equal(isFeishuGroupMessageTriggered(message(), { botOpenId: "ou_bot" }), false);
});

test("isFeishuGroupMessageTriggered accepts group messages that mention the bot", () => {
  assert.equal(
    isFeishuGroupMessageTriggered(message({
      mentions: [{ key: "@_user_1", id: { open_id: "ou_bot" }, name: "Molibot" }]
    }), { botOpenId: "ou_bot" }),
    true
  );
});

test("isFeishuGroupMessageTriggered accepts known bot thread messages without mention", () => {
  const triggered = isFeishuGroupMessageTriggered(message({
    thread_id: "omt_thread",
    parent_id: "om_parent"
  }), {
    botOpenId: "ou_bot",
    isKnownBotThread: ({ chatId, threadId, parentMessageId }) => {
      assert.equal(chatId, "oc_chat");
      assert.equal(threadId, "omt_thread");
      assert.equal(parentMessageId, "om_parent");
      return true;
    }
  });

  assert.equal(triggered, true);
});

test("isFeishuGroupMessageTriggered ignores unknown thread messages without mention", () => {
  assert.equal(isFeishuGroupMessageTriggered(message({
    thread_id: "omt_thread"
  }), {
    botOpenId: "ou_bot",
    isKnownBotThread: () => false
  }), false);
});

test("toFeishuInboundEvent preserves Feishu platform ids and thread scope", async () => {
  const event = await toFeishuInboundEvent({
    client: {} as never,
    store: {
      saveAttachment: () => {
        throw new Error("saveAttachment should not be called for text-only messages");
      }
    } as never,
    message: message({
      message_id: "om_user_123",
      thread_id: "omt_thread",
      parent_id: "om_parent",
      root_id: "om_root",
      content: JSON.stringify({ text: "@_user_1 continue" })
    }),
    sender
  });

  assert.equal(event?.chatId, "oc_chat");
  assert.equal(event?.scopeId, buildFeishuThreadScopeId("oc_chat", "omt_thread"));
  assert.equal(event?.platformMessageId, "om_user_123");
  assert.equal(event?.platformThreadId, "omt_thread");
  assert.equal(event?.platformParentMessageId, "om_parent");
  assert.equal(event?.platformRootMessageId, "om_root");
  assert.equal(event?.text, "continue");
});
