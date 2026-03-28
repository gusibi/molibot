import assert from "node:assert/strict";
import test from "node:test";
import { buildTextChannelContext } from "./contextBuilder.js";

function createEvent() {
  return {
    chatId: "chat-1",
    chatType: "private" as const,
    messageId: 1,
    userId: "user-1",
    text: "hello",
    ts: "1.000",
    attachments: [],
    imageContents: []
  };
}

test("buildTextChannelContext logs assistant replies and appends sessions", async () => {
  const logged: string[] = [];
  const appended: Array<{ role: string; text: string }> = [];

  const ctx = buildTextChannelContext({
    channel: "qq",
    event: createEvent(),
    workspaceDir: "/tmp/workspace",
    chatDir: "/tmp/workspace/chat-1",
    store: {
      logMessage: (_chatId: string, message: { text: string }) => {
        logged.push(message.text);
        return true;
      }
    } as never,
    sessions: {
      getOrCreateConversation: () => ({ id: "conv-1" }),
      appendMessage: (_id: string, role: string, text: string) => {
        appended.push({ role, text });
      }
    } as never,
    instanceId: "bot-1",
    activeSessionId: "default",
    conversationKey: "bot:bot-1:chat:chat-1:default",
    response: {
      sendText: async () => ({ messageId: "m-1" })
    },
    createBotMessageId: () => 42
  });

  await ctx.respond("first");

  assert.deepEqual(logged, ["first"]);
  assert.deepEqual(appended, [{ role: "assistant", text: "first" }]);
});

test("buildTextChannelContext falls back on replace when edit is unavailable", async () => {
  const sent: string[] = [];

  const ctx = buildTextChannelContext({
    channel: "weixin",
    event: createEvent(),
    workspaceDir: "/tmp/workspace",
    chatDir: "/tmp/workspace/chat-1",
    store: { logMessage: () => true } as never,
    sessions: {
      getOrCreateConversation: () => ({ id: "conv-1" }),
      appendMessage: () => undefined
    } as never,
    instanceId: "bot-1",
    activeSessionId: "default",
    conversationKey: "bot:bot-1:chat:chat-1:default",
    response: {
      sendText: async (text) => {
        sent.push(text);
        return null;
      }
    },
    createBotMessageId: () => 42,
    replaceWithoutEdit: async (text, state, fallbackCtx) => {
      if (!state.accumulatedText.trim()) {
        await fallbackCtx.respond(text);
        state.accumulatedText = text;
        return;
      }
      if (text === state.accumulatedText.trim()) return;
      state.accumulatedText = text;
    }
  });

  await ctx.replaceMessage("draft");
  await ctx.replaceMessage("draft");

  assert.deepEqual(sent, ["draft"]);
});
