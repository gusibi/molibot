import assert from "node:assert/strict";
import test from "node:test";
import { FeishuStreamingSession } from "$lib/server/channels/feishu/streamingSession.js";

function createMockClient(options: { failCardCreate?: boolean } = {}) {
  const cardCreateCalls: any[] = [];
  const cardUpdateCalls: any[] = [];
  const settingsCalls: any[] = [];
  const contentCalls: any[] = [];
  const messageCreateCalls: any[] = [];
  const messageUpdateCalls: any[] = [];

  const client = {
    cardkit: {
      v1: {
        card: {
          create: async (payload: any) => {
            cardCreateCalls.push(payload);
            if (options.failCardCreate) throw new Error("card create failed");
            return { code: 0, msg: "ok", data: { card_id: "card_1" } };
          },
          update: async (payload: any) => {
            cardUpdateCalls.push(payload);
            return { code: 0, msg: "ok", data: {} };
          },
          settings: async (payload: any) => {
            settingsCalls.push(payload);
            return { code: 0, msg: "ok", data: {} };
          }
        },
        cardElement: {
          content: async (payload: any) => {
            contentCalls.push(payload);
            return { code: 0, msg: "ok", data: {} };
          }
        }
      }
    },
    im: {
      message: {
        create: async (payload: any) => {
          messageCreateCalls.push(payload);
          return { data: { message_id: `om_${messageCreateCalls.length}` } };
        },
        update: async (payload: any) => {
          messageUpdateCalls.push(payload);
          return { data: { message_id: "om_updated" } };
        }
      }
    }
  };

  return {
    client: client as never,
    cardCreateCalls,
    cardUpdateCalls,
    settingsCalls,
    contentCalls,
    messageCreateCalls,
    messageUpdateCalls
  };
}

test("FeishuStreamingSession streams cumulative answer text into one CardKit message", async () => {
  const { client, messageCreateCalls, contentCalls, settingsCalls } = createMockClient();
  const session = new FeishuStreamingSession({ client, chatId: "oc_chat", runId: "run_1", title: "Molibot" });

  await session.handleRunnerEvent({ type: "assistant_message_event", event: { type: "text_delta", delta: "Hello" } as never });
  await session.flushNow();
  await session.handleRunnerEvent({ type: "assistant_message_event", event: { type: "text_delta", delta: " world" } as never });
  await session.flushNow();
  await session.finalize({ runId: "run_1", stopReason: "stop" });

  assert.equal(messageCreateCalls.length, 1);
  assert.equal(JSON.parse(messageCreateCalls[0].data.content).data.card_id, "card_1");
  assert.deepEqual(contentCalls.map((call) => call.data.content), ["Hello", "Hello world"]);
  assert.equal(settingsCalls.at(-1).data.settings, JSON.stringify({ streaming_mode: false }));
  assert.equal(session.finalText, "Hello world");
});

test("FeishuStreamingSession aggregates tool progress into CardKit updates", async () => {
  const { client, cardUpdateCalls } = createMockClient();
  const session = new FeishuStreamingSession({ client, chatId: "oc_chat", runId: "run_1", title: "Molibot" });

  await session.handleRunnerEvent({ type: "tool_execution_start", toolName: "Read", displayName: "Read", label: "Read file" });
  await session.flushNow();
  await session.handleRunnerEvent({ type: "tool_execution_end", toolName: "Read", displayName: "Read", summary: "passed", isError: false });
  await session.flushNow();
  await session.finalize({ runId: "run_1", stopReason: "stop" });

  assert.equal(cardUpdateCalls.some((call) => JSON.stringify(call).includes("Read file")), true);
  assert.equal(cardUpdateCalls.some((call) => JSON.stringify(call).includes("passed")), true);
});

test("FeishuStreamingSession uses one editable post fallback when CardKit creation fails", async () => {
  const { client, messageCreateCalls, messageUpdateCalls } = createMockClient({ failCardCreate: true });
  const session = new FeishuStreamingSession({ client, chatId: "oc_chat", runId: "run_1", title: "Molibot" });

  await session.handleRunnerEvent({ type: "assistant_message_event", event: { type: "text_delta", delta: "Hello" } as never });
  await session.flushNow();
  await session.handleRunnerEvent({ type: "assistant_message_event", event: { type: "text_delta", delta: " world" } as never });
  await session.flushNow();
  await session.finalize({ runId: "run_1", stopReason: "stop" });

  assert.equal(messageCreateCalls[0].data.msg_type, "post");
  assert.equal(messageUpdateCalls.length >= 1, true);
  assert.equal(messageCreateCalls.length, 1);
});
