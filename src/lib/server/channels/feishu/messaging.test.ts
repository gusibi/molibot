import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFeishuHostToolApprovalCard,
  buildFeishuHostToolApprovalProcessingCard,
  buildFeishuHostToolApprovalResultCard,
  buildFeishuPostContent,
  sendFeishuCard,
  sendFeishuFile,
  sendFeishuText,
  editFeishuText
} from "$lib/server/channels/feishu/messaging.js";

function createMockClient() {
  const createCalls: unknown[] = [];
  const replyCalls: unknown[] = [];
  const updateCalls: unknown[] = [];
  const fileCreateCalls: unknown[] = [];
  const imageCreateCalls: unknown[] = [];

  const client = {
    im: {
      file: {
        create: async (payload: unknown) => {
          fileCreateCalls.push(payload);
          return { file_key: `file_${fileCreateCalls.length}` };
        }
      },
      image: {
        create: async (payload: unknown) => {
          imageCreateCalls.push(payload);
          return { image_key: `img_${imageCreateCalls.length}` };
        }
      },
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

  return { client: client as never, createCalls, replyCalls, updateCalls, fileCreateCalls, imageCreateCalls };
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

test("sendFeishuFile sends mp4 files as native Feishu media instead of audio", async () => {
  const { client, createCalls, fileCreateCalls, imageCreateCalls } = createMockClient();
  const mp4Bytes = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]);

  const result = await sendFeishuFile(client, "oc_chat", mp4Bytes, "clip.mp4");

  assert.deepEqual(result, { message_id: "om_1" });
  assert.equal(imageCreateCalls.length, 0);
  assert.equal(fileCreateCalls.length, 1);
  assert.deepEqual(fileCreateCalls[0], {
    data: {
      file_type: "mp4",
      file_name: "clip.mp4",
      file: mp4Bytes
    }
  });
  assert.deepEqual(createCalls[0], {
    params: { receive_id_type: "chat_id" },
    data: {
      receive_id: "oc_chat",
      msg_type: "media",
      content: JSON.stringify({ file_key: "file_1" })
    }
  });
});

test("sendFeishuFile sends non-mp4 video containers as files, not voice messages", async () => {
  const { client, createCalls, fileCreateCalls } = createMockClient();
  const webmBytes = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x42, 0x86, 0x81]);

  const result = await sendFeishuFile(client, "oc_chat", webmBytes, "clip.webm");

  assert.deepEqual(result, { message_id: "om_1" });
  assert.equal(fileCreateCalls.length, 1);
  assert.deepEqual(fileCreateCalls[0], {
    data: {
      file_type: "stream",
      file_name: "clip.webm",
      file: webmBytes
    }
  });
  assert.deepEqual(createCalls[0], {
    params: { receive_id_type: "chat_id" },
    data: {
      receive_id: "oc_chat",
      msg_type: "file",
      content: JSON.stringify({ file_key: "file_1" })
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
