import assert from "node:assert/strict";
import test from "node:test";
import { MemoryProfileBuilder, type MemoryProfileScope } from "./profileBuilder.js";
import type { MemoryRecord } from "./types.js";

const scope: MemoryProfileScope = {
  ownerId: "owner",
  botId: "momo",
  channel: "web",
  externalUserId: "chat-a",
  conversationId: "conversation-a",
  includeOwner: true,
  includeAgentSelf: true,
  authorizedNamespaces: ["owner:owner", "chat:momo:web:chat-a", "agent:momo"]
};

function record(id: string, patch: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id,
    channel: "web",
    externalUserId: "chat-a",
    content: id,
    tags: [],
    layer: "long_term",
    namespace: "chat:momo:web:chat-a",
    domain: "owner",
    type: "user_preference",
    subject: id,
    state: "active",
    version: 1,
    confidence: 0.7,
    utility: 0.5,
    accessCount: 0,
    injectionCount: 0,
    createdAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z",
    ...patch
  };
}

test("profile builder keeps an old pinned preference above 200 recent records and reports honest metadata", async () => {
  const rows = Array.from({ length: 205 }, (_, index) => record(`recent-${index}`, {
    confidence: 0.4,
    createdAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z"
  }));
  rows.push(record("stable-old", {
    namespace: "owner:owner",
    pinned: true,
    confidence: 0.95,
    utility: 0.9,
    injectionCount: 20,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z"
  }));
  rows.push(record("other-bot", { namespace: "chat:other:web:chat-a", pinned: true }));
  rows.push(record("private", { privacySuppressed: true, pinned: true }));
  rows.push(record("disputed", { state: "disputed", pinned: true }));
  const builder = new MemoryProfileBuilder(async () => ({ items: rows, scannedCount: rows.length, truncated: false }));
  const result = await builder.build(scope, { limitPerSection: 10, now: new Date("2026-07-17T00:00:00.000Z") });
  assert.equal(result.stablePreferences[0]?.id, "stable-old");
  assert.equal(result.recentItems.some((item) => item.id === "stable-old"), false);
  assert.equal(result.stablePreferences.some((item) => ["other-bot", "private", "disputed"].includes(item.id)), false);
  assert.deepEqual(result.attentionItems.map((item) => item.id).sort(), ["disputed", "private"]);
  assert.equal(result.meta.stablePreferences.scannedCount, rows.length);
  assert.equal(result.meta.stablePreferences.selectedCount, 10);
  assert.equal(result.meta.stablePreferences.excludedCount, 2);
});
