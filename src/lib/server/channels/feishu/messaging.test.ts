import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFeishuPostContent,
  sendFeishuCard,
  sendFeishuText,
  editFeishuText
} from "$lib/server/channels/feishu/messaging.js";

function createMockClient() {
  const createCalls: unknown[] = [];
  const updateCalls: unknown[] = [];

  const client = {
    im: {
      message: {
        create: async (payload: unknown) => {
          createCalls.push(payload);
          return { data: { message_id: `om_${createCalls.length}` } };
        },
        update: async (payload: unknown) => {
          updateCalls.push(payload);
          return { data: { message_id: "om_updated" } };
        }
      }
    }
  };

  return { client: client as never, createCalls, updateCalls };
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
