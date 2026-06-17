import assert from "node:assert/strict";
import test from "node:test";
import {
  editTelegramMessage,
  editTelegramText,
  formatTelegramText,
  sendTelegramChatAction,
  sendTelegramText,
  sendTelegramTextSafely,
  summarizeTelegramToolProgressText,
  syncTelegramTextMessages
} from "$lib/server/channels/telegram/formatting.js";

test("sendTelegramChatAction retries transient network failures until a later attempt succeeds", async () => {
  let attempts = 0;
  const bot = {
    api: {
      async sendChatAction(): Promise<void> {
        attempts += 1;
        if (attempts === 1 || attempts === 2) {
          throw new Error("Network request for 'sendChatAction' failed!");
        }
        if (attempts === 3) {
          throw new Error("socket hang up");
        }
        if (attempts === 4) {
          throw new Error("ECONNRESET");
        }
      }
    }
  };

  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((handler: TimerHandler, _timeout?: number, ...args: unknown[]) => {
    if (typeof handler === "function") {
      queueMicrotask(() => handler(...args));
    }
    return 0 as never;
  }) as unknown as typeof setTimeout;

  try {
    await sendTelegramChatAction(bot as never, "7706709760", "typing");
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }

  assert.equal(attempts, 5);
});

test("sendTelegramTextSafely suppresses final timeout failure instead of rethrowing", async () => {
  let attempts = 0;
  const bot = {
    api: {
      async sendMessage(): Promise<{ message_id: number }> {
        attempts += 1;
        return await new Promise<{ message_id: number }>(() => undefined);
      }
    }
  };

  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((handler: TimerHandler, _timeout?: number, ...args: unknown[]) => {
    if (typeof handler === "function") {
      queueMicrotask(() => handler(...args));
    }
    return 0 as never;
  }) as unknown as typeof setTimeout;

  try {
    const delivered = await sendTelegramTextSafely(bot as never, "7706709760", "Internal error.");
    assert.equal(delivered, false);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }

  assert.equal(attempts, 7);
});

test("summarizeTelegramToolProgressText limits summaries to 20 characters", () => {
  const summary = summarizeTelegramToolProgressText("This is a long tool output that should be compressed");
  assert.equal(summary.length <= 20, true);
  assert.equal(summary.endsWith("…"), true);
});

test("sendTelegramText prefers Telegram rich messages for markdown output", async () => {
  const richSends: Array<{ richMessage: Record<string, unknown>; options?: Record<string, unknown> }> = [];
  const plainSends: string[] = [];
  const bot = {
    api: {
      async sendRichMessage(_chatId: string, richMessage: Record<string, unknown>, options?: Record<string, unknown>): Promise<{ message_id: number }> {
        richSends.push({ richMessage, options });
        return { message_id: 101 };
      },
      async sendMessage(_chatId: string, text: string): Promise<{ message_id: number }> {
        plainSends.push(text);
        return { message_id: 102 };
      }
    }
  };

  const sent = await sendTelegramText(bot as never, "chat-rich", "**hello**", { message_thread_id: 3 });

  assert.deepEqual(sent, { message_id: 101, message_ids: [101] });
  assert.deepEqual(richSends, [{ richMessage: { markdown: "**hello**" }, options: { message_thread_id: 3 } }]);
  assert.deepEqual(plainSends, []);
});

test("editTelegramText prefers Telegram rich messages for markdown output", async () => {
  const richEdits: Array<{ messageId: number; richMessage: Record<string, unknown> }> = [];
  const htmlEdits: string[] = [];
  const bot = {
    api: {
      async editMessageText(_chatId: string, messageId: number, textOrRich: string | Record<string, unknown>): Promise<void> {
        if (typeof textOrRich === "string") {
          htmlEdits.push(textOrRich);
        } else {
          richEdits.push({ messageId, richMessage: textOrRich });
        }
      },
      async sendMessage(): Promise<{ message_id: number }> {
        return { message_id: 103 };
      },
      async sendRichMessage(): Promise<{ message_id: number }> {
        return { message_id: 104 };
      }
    }
  };

  await editTelegramText(bot as never, "chat-rich", 44, "# Title");

  assert.deepEqual(richEdits, [{ messageId: 44, richMessage: { markdown: "# Title" } }]);
  assert.deepEqual(htmlEdits, []);
});

test("formatTelegramText always delegates text to grammY rich markdown", () => {
  const formatted = formatTelegramText("| Number | Name |\n| --- | --- |\n| 1 | web-search |");

  assert.equal(formatted.text, "| Number | Name |\n| --- | --- |\n| 1 | web-search |");
  assert.deepEqual(formatted.richMessage, { markdown: "| Number | Name |\n| --- | --- |\n| 1 | web-search |" });

  const plain = formatTelegramText("plain text");
  assert.equal(plain.text, "plain text");
  assert.deepEqual(plain.richMessage, { markdown: "plain text" });
});

test("sendTelegramText falls back from rich markdown to plain grammY send", async () => {
  const plainSends: Array<{ text: string; options?: Record<string, unknown> }> = [];
  const bot = {
    api: {
      async sendRichMessage(): Promise<{ message_id: number }> {
        throw new Error("rich markdown failed");
      },
      async sendMessage(_chatId: string, text: string, options?: Record<string, unknown>): Promise<{ message_id: number }> {
        plainSends.push({ text, options });
        return { message_id: 105 };
      }
    }
  };

  const sent = await sendTelegramText(bot as never, "chat-rich", "**hello**", { message_thread_id: 3 });

  assert.deepEqual(sent, { message_id: 105, message_ids: [105] });
  assert.deepEqual(plainSends, [{ text: "**hello**", options: { message_thread_id: 3 } }]);
});

test("editTelegramText splits MESSAGE_TOO_LONG edits into first edit plus follow-up send", async () => {
  const edits: Array<{ text: string; options?: Record<string, unknown> }> = [];
  const sends: Array<{ text: string; options?: Record<string, unknown> }> = [];
  let nextMessageId = 200;
  const bot = {
    api: {
      async editMessageText(_chatId: string, _messageId: number, text: string, options?: Record<string, unknown>): Promise<void> {
        edits.push({ text, options });
        if (text.length > 4096) {
          throw new Error("Call to 'editMessageText' failed! (400: Bad Request: MESSAGE_TOO_LONG)");
        }
      },
      async sendMessage(_chatId: string, text: string, options?: Record<string, unknown>): Promise<{ message_id: number }> {
        sends.push({ text, options });
        return { message_id: nextMessageId += 1 };
      }
    }
  };

  const text = `${"a".repeat(4200)}\n${"b".repeat(180)}`;
  await editTelegramText(bot as never, "chat-1", 42, text, undefined, { message_thread_id: 7 });

  assert.equal(edits.length, 2);
  assert.equal(sends.length, 1);
  assert.ok(edits[0].text.length > 4096);
  assert.ok(edits[1].text.length <= 4096);
  assert.ok(sends[0].text.length <= 4096);
  assert.deepEqual(sends[0].options, { message_thread_id: 7 });
});

test("editTelegramMessage keeps plain fallback when overlong edit is split", async () => {
  const edits: Array<{ text: string; options?: Record<string, unknown> }> = [];
  const sends: Array<{ text: string; options?: Record<string, unknown> }> = [];
  let nextMessageId = 500;
  const bot = {
    api: {
      async editMessageText(_chatId: string, _messageId: number, text: string, options?: Record<string, unknown>): Promise<void> {
        edits.push({ text, options });
        if (text.length > 4096) {
          throw new Error("Call to 'editMessageText' failed! (400: Bad Request: MESSAGE_TOO_LONG)");
        }
      },
      async sendMessage(_chatId: string, text: string, options?: Record<string, unknown>): Promise<{ message_id: number }> {
        sends.push({ text, options });
        return { message_id: nextMessageId += 1 };
      }
    }
  };

  const text = Array.from({ length: 1100 }, () => "# a").join("\n");
  await editTelegramMessage(bot as never, "chat-2", 43, text, { message_thread_id: 9, disable_notification: true });

  assert.equal(edits.length >= 2, true);
  assert.equal(sends.length >= 1, true);
  assert.equal(sends[0].options?.message_thread_id, 9);
  assert.equal(sends[0].options?.disable_notification, true);
});

test("syncTelegramTextMessages edits existing chunks instead of resending the second chunk", async () => {
  const edits: Array<{ messageId: number; text: string }> = [];
  const sends: Array<{ text: string }> = [];
  const deletes: number[] = [];
  let nextMessageId = 700;
  const bot = {
    api: {
      async editMessageText(_chatId: string, messageId: number, text: string): Promise<void> {
        edits.push({ messageId, text });
      },
      async sendMessage(_chatId: string, text: string): Promise<{ message_id: number }> {
        sends.push({ text });
        return { message_id: nextMessageId += 1 };
      },
      async deleteMessage(_chatId: string, messageId: number): Promise<void> {
        deletes.push(messageId);
      }
    }
  };

  const first = await syncTelegramTextMessages(bot as never, "chat-3", [], `${"a".repeat(3500)}\nfirst`);
  const second = await syncTelegramTextMessages(bot as never, "chat-3", first.message_ids, `${"a".repeat(3500)}\nsecond`);
  const third = await syncTelegramTextMessages(bot as never, "chat-3", second.message_ids, "short");

  assert.deepEqual(first.message_ids, [701, 702]);
  assert.deepEqual(second.message_ids, [701, 702]);
  assert.deepEqual(third.message_ids, [701]);
  assert.equal(sends.length, 2);
  assert.deepEqual(edits.map((entry) => entry.messageId), [701, 702, 701]);
  assert.deepEqual(deletes, [702]);
});

test("syncTelegramTextMessages retains newly created chunk ids after a partial send failure", async () => {
  const messageIds: number[] = [];
  let sends = 0;
  const bot = {
    api: {
      async editMessageText(): Promise<void> {},
      async sendMessage(): Promise<{ message_id: number }> {
        sends += 1;
        if (sends === 3) throw new Error("send failed");
        return { message_id: 800 + sends };
      },
      async deleteMessage(): Promise<void> {}
    }
  };

  await assert.rejects(
    syncTelegramTextMessages(bot as never, "chat-4", messageIds, "a".repeat(7100)),
    /send failed/
  );

  assert.deepEqual(messageIds, [801, 802]);
});
