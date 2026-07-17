import assert from "node:assert/strict";
import test from "node:test";
import { ConversationSearchIndex, type ConversationSearchDocument } from "$lib/server/sessions/conversationSearch.js";
import { listAuthorizedConversationSources } from "$lib/server/sessions/conversationAuthorization.js";

function doc(overrides: Partial<ConversationSearchDocument> = {}): ConversationSearchDocument {
  return {
    messageId: "m1",
    conversationId: "c1",
    role: "user",
    content: "上个月我们讨论了火星旅行计划",
    createdAt: "2026-06-01T10:00:00.000Z",
    botId: "bot-a",
    channel: "telegram",
    chatId: "chat-a",
    purpose: "chat",
    sourceKey: "telegram:bot-a:chat-a",
    ...overrides
  };
}

test("Jieba search tokens plus CJK bigrams are authorization-filtered in SQL", () => {
  const index = new ConversationSearchIndex(":memory:");
  index.enqueueUpsert(doc());
  index.enqueueUpsert(doc({ messageId: "m2", conversationId: "c2", botId: "bot-b", chatId: "chat-b", sourceKey: "telegram:bot-b:chat-b" }));
  index.enqueueUpsert(doc({ messageId: "m3", conversationId: "c3", origin: "automation", purpose: "automation" }));
  const hits = index.search({
    query: "火星旅行",
    authorizedSources: listAuthorizedConversationSources({ botId: "bot-a", channel: "telegram", chatId: "chat-a" })
  });
  assert.deepEqual(hits.map((item) => item.conversationMessageId), ["m1"]);
  assert.equal(hits[0]?.conversationId, "c1");
  index.close();
});

test("delete, truncate tombstones and reconciliation cannot be revived by backfill", () => {
  const index = new ConversationSearchIndex(":memory:");
  const first = doc();
  const second = doc({ messageId: "m2", content: "旧分支里的木星会议", createdAt: "2026-06-02T10:00:00.000Z" });
  index.backfill(first.sourceKey, [first, second], 1);
  index.enqueueDeleteMessage(second.sourceKey, second.conversationId, second.messageId);
  index.backfill(first.sourceKey, [first, second], 20);
  const authorizedSources = listAuthorizedConversationSources({ botId: "bot-a", channel: "telegram", chatId: "chat-a" });
  assert.equal(index.search({ query: "木星会议", authorizedSources }).length, 0);
  index.enqueueDeleteConversation(first.sourceKey, first.conversationId);
  index.enqueueUpsert(first);
  assert.equal(index.search({ query: "火星旅行", authorizedSources }).length, 0);
  index.close();
});

test("interrupted backfill resumes from cursor while live tombstones win", () => {
  const index = new ConversationSearchIndex(":memory:");
  const docs = Array.from({ length: 5 }, (_, i) => doc({
    messageId: `m${i}`,
    conversationId: `c${i}`,
    content: `中文检索样本 ${i}`,
    createdAt: `2026-06-0${i + 1}T10:00:00.000Z`
  }));
  assert.deepEqual(index.backfill(docs[0].sourceKey, docs, 2).done, false);
  index.enqueueDeleteConversation(docs[3].sourceKey, docs[3].conversationId);
  assert.deepEqual(index.backfill(docs[0].sourceKey, docs, 2).done, false);
  assert.deepEqual(index.backfill(docs[0].sourceKey, docs, 2).done, true);
  const hits = index.search({
    query: "中文检索",
    authorizedSources: listAuthorizedConversationSources({ botId: "bot-a", channel: "telegram", chatId: "chat-a" }),
    limit: 10
  });
  assert.deepEqual(new Set(hits.map((item) => item.conversationId)), new Set(["c0", "c1", "c2", "c4"]));
  index.close();
});
