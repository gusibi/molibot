import assert from "node:assert/strict";
import test from "node:test";
import {
  FeishuCardActionCoordinator,
  normalizeFeishuWsCardActionEvent
} from "$lib/server/channels/feishu/cardAction.js";

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

test("FeishuCardActionCoordinator resolves concurrent duplicate callbacks once", async () => {
  const coordinator = new FeishuCardActionCoordinator<{ status: string }>();
  let calls = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const action = async () => {
    calls += 1;
    await gate;
    return { status: "approved" };
  };

  const first = coordinator.run("hta_1", action);
  const duplicate = coordinator.run("hta_1", action);
  release?.();

  assert.deepEqual(await first, { status: "approved" });
  assert.deepEqual(await duplicate, { status: "approved" });
  assert.equal(calls, 1);
});

test("FeishuCardActionCoordinator exposes in-flight and completed states", async () => {
  const coordinator = new FeishuCardActionCoordinator<{ status: string }>();
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const inFlight = coordinator.start("hta_1", async () => {
    await gate;
    return { status: "approved" };
  });
  assert.equal(inFlight.status, "in_flight");

  release?.();
  if (inFlight.status === "in_flight") await inFlight.promise;

  const completed = coordinator.start("hta_1", async () => ({ status: "rejected" }));
  assert.deepEqual(completed, {
    status: "completed",
    value: { status: "approved" }
  });
});

test("FeishuCardActionCoordinator returns the completed terminal result for later clicks", async () => {
  const coordinator = new FeishuCardActionCoordinator<{ status: string }>();
  let calls = 0;

  const first = await coordinator.run("hta_1", async () => {
    calls += 1;
    return { status: "approved" };
  });
  const duplicate = await coordinator.run("hta_1", async () => {
    calls += 1;
    return { status: "rejected" };
  });

  assert.deepEqual(first, { status: "approved" });
  assert.deepEqual(duplicate, { status: "approved" });
  assert.equal(calls, 1);
});
