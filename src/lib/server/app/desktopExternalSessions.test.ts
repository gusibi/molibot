import assert from "node:assert/strict";
import test from "node:test";
import type { Channel, Conversation, ConversationMessage } from "$lib/shared/types/message";
import type { ExternalSessionEntry } from "./desktopExternalSessions";
import {
  buildDesktopExternalSession,
  buildDesktopExternalSessionsSummary,
  buildDesktopExternalTranscript,
  buildDesktopExternalTranscriptMessage,
  maskExternalUserId,
  parseBotInstanceId
} from "./desktopExternalSessions";

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: "conv-1",
    channel: "telegram",
    externalUserId: "1234567890123456",
    title: "Project chat",
    createdAt: "2026-06-28T00:00:00.000Z",
    updatedAt: "2026-06-28T00:00:00.000Z",
    ...overrides
  };
}

function entry(channel: Channel, conversation: Conversation, externalUserId = conversation.externalUserId): ExternalSessionEntry {
  return { conversation, channel, externalUserId };
}

test("maskExternalUserId truncates long ids and passes short ids through", () => {
  assert.equal(maskExternalUserId("1234567890123456"), "12345678…");
  assert.equal(maskExternalUserId("abc"), "abc");
  assert.equal(maskExternalUserId(""), "");
  assert.equal(maskExternalUserId("   "), "");
});

test("buildDesktopExternalSession falls back to a masked id and private chat when metadata is missing", () => {
  const item = buildDesktopExternalSession(conversation());

  assert.equal(item.id, "conv-1");
  assert.equal(item.title, "Project chat");
  assert.equal(item.chatType, "private");
  assert.equal(item.senderName, "12345678…");
  assert.equal(item.platform, "telegram");
  assert.equal(item.senderAvatarUrl, undefined);
  assert.equal(item.threadTitle, undefined);
  assert.equal(item.botInstanceName, undefined);
  assert.equal(item.botInstanceId, undefined);

  // The raw external user id must not reach the WebView.
  assert.equal(JSON.stringify(item).includes("1234567890123456"), false);
});

test("parseBotInstanceId recovers the instance id from a channel session key", () => {
  assert.equal(parseBotInstanceId("bot:moli_news_bot:chat:7706709760:default"), "moli_news_bot");
  assert.equal(parseBotInstanceId("bot:feishu-momo:chat:oc_abc:default"), "feishu-momo");
  // Older `chat:<chatId>:...` keys have no Bot prefix → null.
  assert.equal(parseBotInstanceId("chat:7706709760:s-mloxc862"), null);
  assert.equal(parseBotInstanceId(""), null);
});

test("buildDesktopExternalSession recovers botInstanceId from the externalUserId session key", () => {
  // The conversation id is an opaque UUID; the Bot id lives in the index key.
  const item = buildDesktopExternalSession(conversation(), "bot:moli_news_bot:chat:7706709760:default");
  assert.equal(item.botInstanceId, "moli_news_bot");
  assert.equal(item.botInstanceName, undefined);

  // Older chat-only keys leave the Bot unresolved.
  const legacy = buildDesktopExternalSession(conversation(), "chat:7706709760:s-mloxc862");
  assert.equal(legacy.botInstanceId, undefined);
});

test("buildDesktopExternalSession projects metadata when present", () => {
  const item = buildDesktopExternalSession(
    conversation({
      external: {
        botInstanceName: "Sales Bot",
        senderName: "Alice",
        senderAvatarUrl: "https://example.test/a.png",
        chatType: "group",
        threadTitle: "Engineering",
        platform: "telegram"
      }
    })
  );

  assert.equal(item.chatType, "group");
  assert.equal(item.senderName, "Alice");
  assert.equal(item.senderAvatarUrl, "https://example.test/a.png");
  assert.equal(item.threadTitle, "Engineering");
  assert.equal(item.botInstanceName, "Sales Bot");
  assert.equal(item.platform, "telegram");
});

test("buildDesktopExternalSession falls back to an empty title default and uses a blank-sender fallback", () => {
  const item = buildDesktopExternalSession(
    conversation({ title: "", externalUserId: "" })
  );
  assert.equal(item.title, "New Session");
  assert.equal(item.senderName, "");
});

test("buildDesktopExternalSessionsSummary groups by known channel in order, excludes web/cli, and counts", () => {
  const summary = buildDesktopExternalSessionsSummary([
    entry("web", conversation({ id: "web-1" })),
    entry("cli", conversation({ id: "cli-1" })),
    entry("weixin", conversation({ id: "wx-1" })),
    entry("telegram", conversation({ id: "tg-1", updatedAt: "2026-06-28T02:00:00.000Z" })),
    entry("telegram", conversation({ id: "tg-2", updatedAt: "2026-06-28T01:00:00.000Z" }))
  ]);

  assert.deepEqual(summary.groups.map((g) => g.channel), ["telegram", "weixin"]);
  assert.equal(summary.groups[0].total, 2);
  assert.equal(summary.groups[1].total, 1);
  assert.equal(summary.counts.totalSessions, 3);
  assert.equal(JSON.stringify(summary).includes("web-1"), false);
  assert.equal(JSON.stringify(summary).includes("cli-1"), false);
});

test("buildDesktopExternalSessionsSummary returns an empty summary when no external sessions exist", () => {
  const summary = buildDesktopExternalSessionsSummary([
    entry("web", conversation({ id: "web-1" }))
  ]);
  assert.deepEqual(summary.groups, []);
  assert.equal(summary.counts.totalSessions, 0);
});

test("buildDesktopExternalSessionsSummary sorts sessions by updatedAt desc within a channel", () => {
  const summary = buildDesktopExternalSessionsSummary([
    entry("telegram", conversation({ id: "tg-old", updatedAt: "2026-06-01T00:00:00.000Z" })),
    entry("telegram", conversation({ id: "tg-new", updatedAt: "2026-06-28T00:00:00.000Z" }))
  ]);
  assert.deepEqual(summary.groups[0].sessions.map((s) => s.id), ["tg-new", "tg-old"]);
});

test("buildDesktopExternalSessionsSummary recovers each session's Bot id from its index key", () => {
  const summary = buildDesktopExternalSessionsSummary([
    entry("telegram", conversation({ id: "u1" }), "bot:moli_news_bot:chat:7706709760:default"),
    entry("telegram", conversation({ id: "u2" }), "bot:molipi_bot:chat:7706709760:default"),
    entry("telegram", conversation({ id: "u3" }), "chat:7706709760:s-legacy")
  ]);
  assert.deepEqual(
    summary.groups[0].sessions.map((s) => s.botInstanceId),
    ["moli_news_bot", "molipi_bot", undefined]
  );
});

function message(overrides: Partial<ConversationMessage> = {}): ConversationMessage {
  return {
    id: "msg-1",
    conversationId: "conv-1",
    role: "user",
    content: "hello",
    createdAt: "2026-06-28T00:00:00.000Z",
    ...overrides
  };
}

test("buildDesktopExternalTranscriptMessage drops system messages and the local attachment path", () => {
  const projected = buildDesktopExternalTranscriptMessage(
    message({
      id: "msg-1",
      role: "user",
      attachments: [{ original: "photo.png", local: "files/secret/path/photo.png", mediaType: "image", mimeType: "image/png", size: 1234 }]
    })
  );
  assert.equal(projected?.role, "user");
  assert.equal(projected?.attachments?.[0].original, "photo.png");
  assert.equal(projected?.attachments?.[0].mediaType, "image");
  assert.equal(JSON.stringify(projected).includes("local"), false);
  assert.equal(JSON.stringify(projected).includes("files/secret"), false);

  assert.equal(buildDesktopExternalTranscriptMessage(message({ role: "system" })), null);
});

test("buildDesktopExternalTranscript projects session metadata and ordered messages", () => {
  const transcript = buildDesktopExternalTranscript(
    conversation({
      external: { chatType: "group", senderName: "Alice", botInstanceName: "Sales Bot", platform: "telegram" }
    }),
    [
      message({ id: "m1", role: "user", content: "hi" }),
      message({ id: "m2", role: "system", content: "internal directive" }),
      message({ id: "m3", role: "assistant", content: "hello back" })
    ]
  );

  assert.equal(transcript.id, "conv-1");
  assert.equal(transcript.channel, "telegram");
  assert.equal(transcript.chatType, "group");
  assert.equal(transcript.senderName, "Alice");
  assert.deepEqual(transcript.messages.map((m) => m.id), ["m1", "m3"]);
  assert.equal(transcript.messages.every((m) => m.role !== "system"), true);
});
