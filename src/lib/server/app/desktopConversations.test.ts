import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { SessionStore } from "$lib/server/sessions/store.js";
import {
  buildBotNameResolver,
  buildExternalItems,
  buildWebItems,
  classifyWebPurpose,
  clampLimit,
  decodeCursor,
  encodeCursor,
  parseWebProfileId,
  queryConversations,
  queryGroups,
  sortItems,
  type BotNameResolver
} from "./desktopConversations.js";
import type {
  DesktopConversationChannel,
  DesktopConversationItem
} from "$lib/shared/desktop.js";
import type { ExternalSessionEntry } from "./desktopExternalSessions.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";

function webItem(id: string, updatedAt: string, opts: Partial<DesktopConversationItem> = {}): DesktopConversationItem {
  return {
    sessionId: id,
    title: opts.title ?? `Session ${id}`,
    updatedAt,
    botId: opts.botId ?? "bot-a",
    botName: opts.botName ?? "Bot A",
    botDeleted: opts.botDeleted ?? false,
    channel: "web",
    purpose: "conversation",
    readOnly: false,
    latestMessagePreview: opts.latestMessagePreview
  };
}

const fakeResolver: BotNameResolver = {
  webName: (profileId) => (profileId === "deleted"
    ? { name: "deleted", deleted: true }
    : { name: `Bot-${profileId}`, deleted: false }),
  externalName: (_channel, botId, fallback) => (botId === "ext-deleted"
    ? { name: fallback ?? botId, deleted: true }
    : { name: `Ext-${botId}`, deleted: false })
};

test("clampLimit caps to [1,100] with a fallback", () => {
  assert.equal(clampLimit(undefined), 10);
  assert.equal(clampLimit(0), 10);
  assert.equal(clampLimit(-5), 10);
  assert.equal(clampLimit(5), 5);
  assert.equal(clampLimit(100), 100);
  assert.equal(clampLimit(999), 100);
});

test("parseWebProfileId recovers the profile id from a web externalUserId", () => {
  assert.equal(parseWebProfileId("web:personal:web-anonymous"), "personal");
  assert.equal(parseWebProfileId("web:default:web-anonymous"), "default");
  assert.equal(parseWebProfileId("chat:123:default"), "");
  assert.equal(parseWebProfileId(""), "");
});

test("encodeCursor / decodeCursor round-trip and reject malformed input", () => {
  const item = webItem("s-1", "2026-07-01T00:00:00Z");
  const cursor = encodeCursor(item);
  const decoded = decodeCursor(cursor);
  assert.deepEqual(decoded, { updatedAt: "2026-07-01T00:00:00Z", sessionId: "s-1" });
  assert.equal(decodeCursor("not-valid-base64!!"), null);
  assert.equal(decodeCursor(Buffer.from("no-separator", "utf8").toString("base64url")), null);
});

test("sortItems is newest-first, tie-broken by sessionId desc", () => {
  const items = [
    webItem("b", "2026-07-01T00:00:00Z"),
    webItem("a", "2026-07-01T00:00:00Z"),
    webItem("c", "2026-07-02T00:00:00Z")
  ];
  const sorted = sortItems(items);
  assert.deepEqual(sorted.map((it) => it.sessionId), ["c", "b", "a"]);
});

test("queryConversations paginates with a stable cursor (no dup / no omit on insert)", () => {
  // 12 items, t1 (oldest) .. t12 (newest). Zero-padded ids keep string sort honest.
  const items: DesktopConversationItem[] = [];
  for (let i = 1; i <= 12; i += 1) {
    const stamp = `2026-07-${String(i).padStart(2, "0")}T00:00:00Z`;
    items.push(webItem(`s-${String(i).padStart(2, "0")}`, stamp));
  }

  const page1 = queryConversations(items, { limit: 10 });
  assert.equal(page1.items.length, 10);
  assert.equal(page1.hasMore, true);
  assert.equal(page1.items[0].sessionId, "s-12");
  assert.equal(page1.items[9].sessionId, "s-03");
  assert.ok(page1.nextCursor);

  // A brand-new session lands while the user is on page 1. It must NOT appear
  // on page 2 (it will show up on a fresh page 1 next refresh), and the older
  // sessions must still paginate through without omission.
  const withNew = [webItem("s-13", "2026-07-31T00:00:00Z"), ...items];
  const page2 = queryConversations(withNew, { limit: 10, cursor: page1.nextCursor });
  assert.equal(page2.items.length, 2);
  assert.equal(page2.hasMore, false);
  assert.equal(page2.nextCursor, null);
  assert.deepEqual(
    page2.items.map((it) => it.sessionId),
    ["s-02", "s-01"]
  );
});

test("queryConversations filters by botId", () => {
  const items = [
    webItem("s-1", "2026-07-01T00:00:00Z", { botId: "bot-a" }),
    webItem("s-2", "2026-07-02T00:00:00Z", { botId: "bot-b" }),
    webItem("s-3", "2026-07-03T00:00:00Z", { botId: "bot-a" })
  ];
  const result = queryConversations(items, { limit: 10, botId: "bot-a" });
  assert.deepEqual(result.items.map((it) => it.sessionId), ["s-3", "s-1"]);
});

test("queryConversations matches query across title, bot name and preview", () => {
  const items = [
    webItem("s-1", "2026-07-01T00:00:00Z", { title: "Deploy notes", botName: "Bot A", latestMessagePreview: "ship it" }),
    webItem("s-2", "2026-07-02T00:00:00Z", { title: "Chat", botName: "Bot Bee", latestMessagePreview: "unrelated" }),
    webItem("s-3", "2026-07-03T00:00:00Z", { title: "Other", botName: "Bot A", latestMessagePreview: "mention deploy" })
  ];
  const byTitle = queryConversations(items, { limit: 10, query: "deploy" });
  assert.deepEqual(byTitle.items.map((it) => it.sessionId), ["s-3", "s-1"]);
  const byBot = queryConversations(items, { limit: 10, query: "bee" });
  assert.deepEqual(byBot.items.map((it) => it.sessionId), ["s-2"]);
  const byPreview = queryConversations(items, { limit: 10, query: "ship" });
  assert.deepEqual(byPreview.items.map((it) => it.sessionId), ["s-1"]);
});

test("queryGroups groups by bot, pages each group, and orders groups by recency", () => {
  const items = [
    webItem("a1", "2026-07-01T00:00:00Z", { botId: "bot-a", botName: "Bot A" }),
    webItem("a2", "2026-07-03T00:00:00Z", { botId: "bot-a", botName: "Bot A" }),
    webItem("b1", "2026-07-02T00:00:00Z", { botId: "bot-b", botName: "Bot B" })
  ];
  // 11 sessions for bot-a so the group paginates.
  for (let i = 3; i <= 11; i += 1) {
    items.push(webItem(`a${i}`, `2026-07-0${i}T00:00:00Z`, { botId: "bot-a", botName: "Bot A" }));
  }

  const { groups } = queryGroups(items, { groupLimit: 10 });
  assert.equal(groups.length, 2);
  // bot-a's most recent (a2 @ 07-03) is newer than bot-b's (b1 @ 07-02).
  assert.equal(groups[0].botId, "bot-a");
  assert.equal(groups[1].botId, "bot-b");
  assert.equal(groups[0].total, 11);
  assert.equal(groups[0].items.length, 10);
  assert.equal(groups[0].hasMore, true);
  assert.ok(groups[0].nextCursor);
  assert.equal(groups[1].hasMore, false);
  assert.equal(groups[1].nextCursor, null);
});

test("buildWebItems maps entries, marks deleted profiles, and keeps web read/write", () => {
  const entries = [
    {
      conversation: { id: "s-1", title: "Hello", updatedAt: "2026-07-01T00:00:00Z" },
      externalUserId: "web:personal:web-anonymous",
      lastMessageText: "world"
    },
    {
      conversation: { id: "s-2", title: "Old", updatedAt: "2026-07-02T00:00:00Z", projectId: "p-1" },
      externalUserId: "web:deleted:web-anonymous",
      lastMessageText: ""
    }
  ];
  const items = buildWebItems(entries, fakeResolver);
  assert.equal(items[0].botId, "personal");
  assert.equal(items[0].botName, "Bot-personal");
  assert.equal(items[0].botDeleted, false);
  assert.equal(items[0].readOnly, false);
  assert.equal(items[0].purpose, "conversation");
  assert.equal(items[0].latestMessagePreview, "world");
  // Deleted profile + project-tagged conversation.
  assert.equal(items[1].botDeleted, true);
  assert.equal(items[1].purpose, "project");
  assert.equal(items[1].latestMessagePreview, undefined);
});

test("buildWebItems classifies fresh automation sessions so the sidebar can filter them", () => {
  const items = buildWebItems([
    {
      conversation: { id: "task-20260709-abcd", title: "Daily report", updatedAt: "2026-07-09T00:00:00Z" },
      externalUserId: "web:personal:web-anonymous",
      lastMessageText: "automation output"
    },
    {
      conversation: { id: "s-automation-origin", title: "Explicit automation", updatedAt: "2026-07-09T00:01:00Z", origin: "automation" },
      externalUserId: "web:personal:web-anonymous",
      lastMessageText: "automation output"
    },
    {
      conversation: { id: "s-normal", title: "Normal chat", updatedAt: "2026-07-09T00:02:00Z" },
      externalUserId: "web:personal:web-anonymous",
      lastMessageText: "hello"
    }
  ], fakeResolver);

  assert.equal(items[0].purpose, "automation");
  assert.equal(items[1].purpose, "automation");
  assert.equal(items[2].purpose, "conversation");
  assert.deepEqual(items.filter((item) => item.purpose === "conversation").map((item) => item.sessionId), ["s-normal"]);
});

test("classifyWebPurpose keeps project above automation fallbacks", () => {
  assert.equal(classifyWebPurpose({ id: "task-project", projectId: "p-1", origin: "automation" }), "project");
  assert.equal(classifyWebPurpose({ id: "task-legacy" }), "automation");
  assert.equal(classifyWebPurpose({ id: "s-origin", origin: "automation" }), "automation");
  assert.equal(classifyWebPurpose({ id: "s-normal" }), "conversation");
});

test("historical approval and Event Sessions never enter ordinary Chat", () => {
  const items = buildWebItems([
    {
      conversation: { id: "s-approval", title: "/hosttools approve-session x", updatedAt: "2026-07-09T00:00:00Z", origin: "internal:approval" },
      externalUserId: "web:personal:web-anonymous",
      lastMessageText: "approved"
    },
    {
      conversation: { id: "s-event", title: "[EVENT:event-123", updatedAt: "2026-07-09T00:01:00Z", origin: "internal:event" },
      externalUserId: "web:personal:web-anonymous",
      lastMessageText: "reminder"
    },
    {
      conversation: { id: "s-chat", title: "Normal chat", updatedAt: "2026-07-09T00:02:00Z" },
      externalUserId: "web:personal:web-anonymous",
      lastMessageText: "hello"
    }
  ], fakeResolver);

  assert.deepEqual(items.filter((item) => item.purpose === "conversation").map((item) => item.sessionId), ["s-chat"]);
});

test("buildExternalItems marks external sessions read-only and recovers bot id", () => {
  const entries: ExternalSessionEntry[] = [
    {
      conversation: { id: "ext-1", channel: "telegram", externalUserId: "bot:tg-bot:chat:123:default", title: "TG chat", createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z" },
      channel: "telegram",
      externalUserId: "bot:tg-bot:chat:123:default",
      preview: "hi"
    },
    {
      conversation: { id: "ext-2", channel: "telegram", externalUserId: "bot:ext-deleted:chat:456:default", title: "Old bot", createdAt: "2026-07-02T00:00:00Z", updatedAt: "2026-07-02T00:00:00Z" },
      channel: "telegram",
      externalUserId: "bot:ext-deleted:chat:456:default",
      preview: ""
    }
  ];
  const items = buildExternalItems(entries, fakeResolver);
  assert.equal(items[0].channel, "telegram");
  assert.equal(items[0].botId, "tg-bot");
  assert.equal(items[0].botName, "Ext-tg-bot");
  assert.equal(items[0].botDeleted, false);
  assert.equal(items[0].readOnly, true);
  assert.equal(items[0].purpose, "conversation");
  assert.equal(items[1].botDeleted, true);
  assert.equal(items[1].botName, "ext-deleted");
});

test("buildBotNameResolver resolves web/external names and detects deleted bots", () => {
  const settings = {
    agents: [],
    channels: {
      web: {
        instances: [
          { id: "personal", name: "Personal", enabled: true, agentId: "", credentials: {}, allowedChatIds: [] },
          { id: "work", name: "Work", enabled: true, agentId: "", credentials: {}, allowedChatIds: [] }
        ]
      },
      telegram: {
        instances: [
          { id: "tg-bot", name: "TG Bot", enabled: true, agentId: "", credentials: {}, allowedChatIds: [] }
        ]
      }
    }
  } as unknown as RuntimeSettings;

  const resolver = buildBotNameResolver(settings);
  assert.deepEqual(resolver.webName("personal"), { name: "Personal", deleted: false });
  assert.deepEqual(resolver.webName("ghost"), { name: "ghost", deleted: true });
  assert.deepEqual(resolver.externalName("telegram", "tg-bot"), { name: "TG Bot", deleted: false });
  assert.deepEqual(resolver.externalName("telegram", "ghost", "Ghost Saved"), { name: "Ghost Saved", deleted: true });
  // Legacy unattributable external record → unknown bucket, not "deleted".
  assert.deepEqual(resolver.externalName("telegram", ""), { name: "", deleted: false });
});

test("SessionStore.listAllWebConversations aggregates across profiles with a preview", () => {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-desktop-convs-"));
  const original = {
    webWorkspaceDir: storagePaths.webWorkspaceDir,
    sessionsDir: storagePaths.sessionsDir,
    sessionsIndexFile: storagePaths.sessionsIndexFile
  };
  try {
    storagePaths.webWorkspaceDir = path.join(root, "web");
    storagePaths.sessionsDir = path.join(root, "legacy");
    storagePaths.sessionsIndexFile = path.join(root, "legacy-index.json");

    const store = new SessionStore();
    const a = store.createWebConversation("web:personal:web-anonymous");
    store.appendMessage(a.id, "user", "hello from personal");
    const b = store.createWebConversation("web:work:web-anonymous");
    store.appendMessage(b.id, "user", "hello from work");

    const all = store.listAllWebConversations();
    assert.equal(all.length, 2);
    const byProfile = new Map(all.map((entry) => [parseWebProfileId(entry.externalUserId), entry]));
    assert.equal(byProfile.get("personal")?.conversation.id, a.id);
    assert.equal(byProfile.get("work")?.conversation.id, b.id);
    assert.equal(byProfile.get("personal")?.lastMessageText, "hello from personal");

    // Run→profile reverse lookup (plan §11.3).
    assert.equal(store.getWebConversationOwner(a.id), "web:personal:web-anonymous");
    assert.equal(store.getWebConversationOwner("does-not-exist"), null);
  } finally {
    storagePaths.webWorkspaceDir = original.webWorkspaceDir;
    storagePaths.sessionsDir = original.sessionsDir;
    storagePaths.sessionsIndexFile = original.sessionsIndexFile;
    rmSync(root, { recursive: true, force: true });
  }
});
