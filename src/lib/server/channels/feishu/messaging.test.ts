import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFeishuHostToolApprovalCard,
  buildFeishuHostToolApprovalProcessingCard,
  buildFeishuHostToolApprovalResultCard,
  buildFeishuPostContent,
  sendFeishuCard,
  sendFeishuText,
  editFeishuText
} from "$lib/server/channels/feishu/messaging.js";

function createMockClient() {
  const createCalls: unknown[] = [];
  const replyCalls: unknown[] = [];
  const updateCalls: unknown[] = [];

  const client = {
    im: {
      message: {
        create: async (payload: unknown) => {
          createCalls.push(payload);
          return { data: { message_id: `om_${createCalls.length}` } };
        },
        reply: async (payload: unknown) => {
          replyCalls.push(payload);
          return { data: { message_id: `om_reply_${replyCalls.length}` } };
        },
        update: async (payload: unknown) => {
          updateCalls.push(payload);
          return { data: { message_id: "om_updated" } };
        }
      }
    }
  };

  return { client: client as never, createCalls, replyCalls, updateCalls };
}

test("buildFeishuPostContent wraps markdown in a Feishu post md segment", () => {
  const content = JSON.parse(buildFeishuPostContent("# Title\n\n- item"));

  assert.deepEqual(Object.keys(content), ["zh_cn"]);
  assert.equal(content.zh_cn.content[0][0].tag, "md");
  assert.match(content.zh_cn.content[0][0].text, /Title/);
  assert.match(content.zh_cn.content[0][0].text, /item/);
});

test("sendFeishuText sends ordinary replies as post messages", async () => {
  const { client, createCalls } = createMockClient();

  const result = await sendFeishuText(client, "oc_chat", "Hello **Feishu**");

  assert.deepEqual(result, { message_id: "om_1" });
  assert.equal(createCalls.length, 1);
  assert.deepEqual(createCalls[0], {
    params: { receive_id_type: "chat_id" },
    data: {
      receive_id: "oc_chat",
      msg_type: "post",
      content: buildFeishuPostContent("Hello **Feishu**")
    }
  });
});

test("sendFeishuText replies in thread when reply options are provided", async () => {
  const { client, createCalls, replyCalls } = createMockClient();

  const result = await sendFeishuText(client, "oc_chat", "Thread reply", {
    replyToMessageId: "om_parent",
    replyInThread: true
  });

  assert.deepEqual(result, { message_id: "om_reply_1" });
  assert.equal(createCalls.length, 0);
  assert.deepEqual(replyCalls[0], {
    path: { message_id: "om_parent" },
    data: {
      msg_type: "post",
      content: buildFeishuPostContent("Thread reply"),
      reply_in_thread: true
    }
  });
});

test("editFeishuText updates ordinary replies as post messages", async () => {
  const { client, updateCalls } = createMockClient();

  const result = await editFeishuText(client, "om_123", "Updated **post**");

  assert.equal(result, "om_123");
  assert.equal(updateCalls.length, 1);
  assert.deepEqual(updateCalls[0], {
    path: { message_id: "om_123" },
    data: {
      msg_type: "post",
      content: buildFeishuPostContent("Updated **post**")
    }
  });
});

test("sendFeishuCard keeps explicit cards as interactive messages", async () => {
  const { client, createCalls } = createMockClient();
  const card = {
    config: { wide_screen_mode: true },
    elements: [{ tag: "markdown", content: "Needs approval" }]
  };

  const result = await sendFeishuCard(client, "oc_chat", card as never);

  assert.deepEqual(result, { message_id: "om_1" });
  assert.equal(createCalls.length, 1);
  assert.deepEqual(createCalls[0], {
    params: { receive_id_type: "chat_id" },
    data: {
      receive_id: "oc_chat",
      msg_type: "interactive",
      content: JSON.stringify(card)
    }
  });
});

test("sendFeishuCard replies in thread when reply options are provided", async () => {
  const { client, createCalls, replyCalls } = createMockClient();
  const card = {
    config: { wide_screen_mode: true },
    elements: [{ tag: "markdown", content: "Thread card" }]
  };

  const result = await sendFeishuCard(client, "oc_chat", card as never, {
    replyToMessageId: "om_parent",
    replyInThread: true
  });

  assert.deepEqual(result, { message_id: "om_reply_1" });
  assert.equal(createCalls.length, 0);
  assert.deepEqual(replyCalls[0], {
    path: { message_id: "om_parent" },
    data: {
      msg_type: "interactive",
      content: JSON.stringify(card),
      reply_in_thread: true
    }
  });
});

test("buildFeishuHostToolApprovalResultCard creates a button-free terminal card", () => {
  const card = buildFeishuHostToolApprovalResultCard({
    type: "host_bash_approval",
    requestId: "hta_1",
    title: "需要你的确认",
    body: "【操作】执行 Bash\n【命令】printf ok",
    options: [
      { id: "approve", label: "批准", style: "primary" }
    ],
    request: {
      toolId: "printf",
      displayName: "printf",
      command: "printf ok",
      args: [],
      approvalMode: "persistent",
      reason: "test",
      permissions: { envAllowlist: [], filesystem: "scratch-only", network: "none" },
      requestedAt: "2026-06-05T00:00:00.000Z"
    }
  }, "已批准");

  assert.equal(card.header?.title.content, "审批已处理");
  assert.equal(card.elements?.some((element) => element.tag === "action"), false);
});

test("buildFeishuHostToolApprovalCard preserves scoped Feishu thread action target", () => {
  const card = buildFeishuHostToolApprovalCard({
    type: "host_bash_approval",
    requestId: "hta_thread",
    title: "需要你的确认",
    body: "【操作】执行 Bash\n【命令】printf ok",
    options: [
      { id: "approve_session", label: "本会话批准", style: "primary" }
    ],
    request: {
      toolId: "printf",
      displayName: "printf",
      command: "printf ok",
      args: [],
      approvalMode: "persistent",
      reason: "test",
      permissions: { envAllowlist: [], filesystem: "scratch-only", network: "none" },
      requestedAt: "2026-06-08T00:00:00.000Z"
    }
  }, {
    botId: "feishu-default",
    chatId: "oc_chat",
    scopeId: "oc_chat__thread_omt_thread"
  });

  const actionBlock = card.elements?.find((element) => element.tag === "action") as any;
  assert.equal(actionBlock.actions[0].value.chatId, "oc_chat");
  assert.equal(actionBlock.actions[0].value.scopeId, "oc_chat__thread_omt_thread");
});

test("buildFeishuHostToolApprovalProcessingCard creates a button-free processing card", () => {
  const card = buildFeishuHostToolApprovalProcessingCard({
    type: "host_bash_approval",
    requestId: "hta_1",
    title: "需要你的确认",
    body: "【操作】执行 Bash\n【命令】printf ok",
    options: [
      { id: "approve", label: "批准", style: "primary" }
    ],
    request: {
      toolId: "printf",
      displayName: "printf",
      command: "printf ok",
      args: [],
      approvalMode: "persistent",
      reason: "test",
      permissions: { envAllowlist: [], filesystem: "scratch-only", network: "none" },
      requestedAt: "2026-06-05T00:00:00.000Z"
    }
  });

  assert.equal(card.header?.title.content, "审批处理中");
  assert.equal(card.elements?.some((element) => element.tag === "action"), false);
});
