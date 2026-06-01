import assert from "node:assert/strict";
import test from "node:test";
import { normalizeFeishuWsCardActionEvent } from "$lib/server/channels/feishu/cardAction.js";

test("normalizeFeishuWsCardActionEvent converts card.action.trigger payloads", () => {
  const normalized = normalizeFeishuWsCardActionEvent({
    context: {
      open_chat_id: "oc_chat",
      open_message_id: "om_message"
    },
    operator: {
      open_id: "ou_user",
      user_id: "user_1"
    },
    tenant_key: "tenant_1",
    token: "token_1",
    action: {
      tag: "button",
      value: {
        kind: "host_bash_approval",
        action: "approve",
        botId: "feishu-default",
        chatId: "oc_chat",
        requestId: "hta_1"
      }
    }
  });

  assert.deepEqual(normalized, {
    chatId: "oc_chat",
    messageId: "om_message",
    event: {
      open_id: "ou_user",
      user_id: "user_1",
      tenant_key: "tenant_1",
      open_message_id: "om_message",
      token: "token_1",
      action: {
        value: {
          kind: "host_bash_approval",
          action: "approve",
          botId: "feishu-default",
          chatId: "oc_chat",
          requestId: "hta_1"
        },
        tag: "button",
        option: undefined,
        timezone: undefined
      }
    }
  });
});

test("normalizeFeishuWsCardActionEvent rejects payloads without chat, message, or operator ids", () => {
  assert.equal(normalizeFeishuWsCardActionEvent({}), null);
  assert.equal(normalizeFeishuWsCardActionEvent({
    context: { open_chat_id: "oc_chat", open_message_id: "om_message" },
    action: { value: {} }
  }), null);
});

test("normalizeFeishuWsCardActionEvent accepts stringified action values", () => {
  const normalized = normalizeFeishuWsCardActionEvent({
    context: {
      open_chat_id: "oc_chat",
      open_message_id: "om_message"
    },
    operator: {
      open_id: "ou_user"
    },
    action: {
      value: JSON.stringify({
        kind: "host_bash_approval",
        action: "reject",
        botId: "feishu-default",
        chatId: "oc_chat",
        requestId: "hta_2"
      })
    }
  });

  assert.equal(normalized?.event.action.value.kind, "host_bash_approval");
  assert.equal(normalized?.event.action.value.action, "reject");
  assert.equal(normalized?.event.action.value.requestId, "hta_2");
});
