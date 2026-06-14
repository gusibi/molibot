import assert from "node:assert/strict";
import test from "node:test";
import {
  FEISHU_STREAMING_ELEMENT_ID,
  buildFeishuFinalCard,
  buildFeishuStreamingCard,
  createFeishuCardEntity,
  sendFeishuCardById,
  setFeishuCardStreamingMode,
  streamFeishuCardContent,
  updateFeishuCardEntity
} from "$lib/server/channels/feishu/cardkit.js";

function createMockClient() {
  const calls: Array<{ name: string; payload: unknown }> = [];
  const client = {
    cardkit: {
      v1: {
        card: {
          create: async (payload: unknown) => {
            calls.push({ name: "card.create", payload });
            return { code: 0, msg: "ok", data: { card_id: "card_123" } };
          },
          update: async (payload: unknown) => {
            calls.push({ name: "card.update", payload });
            return { code: 0, msg: "ok", data: {} };
          },
          settings: async (payload: unknown) => {
            calls.push({ name: "card.settings", payload });
            return { code: 0, msg: "ok", data: {} };
          }
        },
        cardElement: {
          content: async (payload: unknown) => {
            calls.push({ name: "cardElement.content", payload });
            return { code: 0, msg: "ok", data: {} };
          }
        }
      }
    },
    im: {
      message: {
        create: async (payload: unknown) => {
          calls.push({ name: "im.message.create", payload });
          return { data: { message_id: "om_123" } };
        }
      }
    }
  };
  return { client: client as never, calls };
}

test("buildFeishuStreamingCard creates CardKit 2.0 streaming card with target element", () => {
  const card = buildFeishuStreamingCard({
    title: "Processing",
    answerText: "Hello",
    tools: [{ toolName: "Read", label: "Read file", status: "running" }],
    isWorking: true
  }) as Record<string, any>;

  assert.equal(card.schema, "2.0");
  assert.equal(card.config.streaming_mode, true);
  assert.equal(card.body.elements.some((element: any) => element.element_id === FEISHU_STREAMING_ELEMENT_ID), true);
  assert.equal(JSON.stringify(card).includes("Read file"), true);
});

test("buildFeishuFinalCard closes streaming mode and keeps tool summary", () => {
  const card = buildFeishuFinalCard({
    title: "Completed",
    answerText: "Done",
    tools: [{ toolName: "Bash", label: "Run tests", status: "success", summary: "passed" }],
    stopReason: "stop",
    elapsedMs: 1200
  }) as Record<string, any>;

  assert.equal(card.schema, "2.0");
  assert.equal(card.config.streaming_mode, false);
  assert.equal(JSON.stringify(card).includes("Done"), true);
  assert.equal(JSON.stringify(card).includes("passed"), true);
});

test("buildFeishuFinalCard splits headings into separate markdown elements", () => {
  const card = buildFeishuFinalCard({
    title: "Completed",
    answerText: ["# Heading 1", "Body", "## Heading 2", "More body"].join("\n"),
    tools: [],
    stopReason: "stop",
    elapsedMs: 1200
  }) as Record<string, any>;

  const markdownElements = card.body.elements.filter((element: any) => element.tag === "markdown");
  assert.equal(markdownElements.some((element: any) => element.content === "**Heading 1**"), true);
  assert.equal(markdownElements.some((element: any) => element.content === "**Heading 2**"), true);
  assert.equal(markdownElements.some((element: any) => element.content.includes("Body")), true);
});

test("buildFeishuFinalCard converts markdown tables into native table elements", () => {
  const card = buildFeishuFinalCard({
    title: "Completed",
    answerText: [
      "Summary",
      "",
      "| Name | Value |",
      "|------|-------|",
      "| A | 1 |",
      "| B | 2 |"
    ].join("\n"),
    tools: [],
    stopReason: "stop",
    elapsedMs: 1200
  }) as Record<string, any>;

  const table = card.body.elements.find((element: any) => element.tag === "table");
  assert.ok(table);
  assert.deepEqual(table.columns, [
    { name: "col_1", display_name: "Name", data_type: "lark_md", width: "auto" },
    { name: "col_2", display_name: "Value", data_type: "lark_md", width: "auto" }
  ]);
  assert.deepEqual(table.rows, [
    { col_1: "A", col_2: "1" },
    { col_1: "B", col_2: "2" }
  ]);
});

test("CardKit wrappers send exact SDK payloads", async () => {
  const { client, calls } = createMockClient();
  const card = buildFeishuStreamingCard({ title: "Processing", answerText: "", tools: [], isWorking: true });

  const cardId = await createFeishuCardEntity(client, card);
  const sent = await sendFeishuCardById(client, "oc_chat", cardId);
  await streamFeishuCardContent(client, cardId, FEISHU_STREAMING_ELEMENT_ID, "Hello", 2);
  await updateFeishuCardEntity(
    client,
    cardId,
    buildFeishuFinalCard({ title: "Done", answerText: "Hello", tools: [], stopReason: "stop", elapsedMs: 1 }),
    3
  );
  await setFeishuCardStreamingMode(client, cardId, false, 4);

  assert.deepEqual(sent, { message_id: "om_123" });
  assert.deepEqual(calls.map((call) => call.name), [
    "card.create",
    "im.message.create",
    "cardElement.content",
    "card.update",
    "card.settings"
  ]);
  assert.deepEqual(calls[0].payload, {
    data: { type: "card_json", data: JSON.stringify(card) }
  });
  assert.deepEqual(calls[1].payload, {
    params: { receive_id_type: "chat_id" },
    data: {
      receive_id: "oc_chat",
      msg_type: "interactive",
      content: JSON.stringify({ type: "card", data: { card_id: "card_123" } })
    }
  });
  assert.deepEqual(calls[2].payload, {
    path: { card_id: "card_123", element_id: FEISHU_STREAMING_ELEMENT_ID },
    data: { content: "Hello", sequence: 2 }
  });
  assert.deepEqual(calls[4].payload, {
    path: { card_id: "card_123" },
    data: { settings: JSON.stringify({ streaming_mode: false }), sequence: 4 }
  });
});

test("CardKit wrappers throw on body-level API errors", async () => {
  const { client } = createMockClient();
  (client as any).cardkit.v1.card.create = async () => ({ code: 230001, msg: "bad card" });

  await assert.rejects(
    () => createFeishuCardEntity(client, { schema: "2.0", config: {}, body: { elements: [] } }),
    /card.create failed: 230001 bad card/
  );
});
