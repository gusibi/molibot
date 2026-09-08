import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { SessionStore } from "$lib/server/sessions/store.js";
import { ConversationSearchIndex } from "$lib/server/sessions/conversationSearch.js";
import { SessionLifecycleStore } from "$lib/server/sessions/sessionLifecycleStore.js";
import { SessionLifecycleService } from "$lib/server/sessions/sessionLifecycleService.js";
import { zonedDayStartUtc } from "$lib/server/sessions/sessionQueryService.js";

const OWNER_A = "web:personal:user-a";
const OWNER_B = "web:work:user-a";

interface Fixture {
  root: string;
  sessions: SessionStore;
  lifecycle: SessionLifecycleStore;
  service: SessionLifecycleService;
  search: ConversationSearchIndex;
  now: { value: Date };
  originals: Record<string, string>;
  cleanup(): void;
}

function setup(): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-session-query-"));
  const originals = {
    webWorkspaceDir: storagePaths.webWorkspaceDir,
    sessionsDir: storagePaths.sessionsDir,
    sessionsIndexFile: storagePaths.sessionsIndexFile,
    projectsDir: storagePaths.projectsDir
  };
  storagePaths.webWorkspaceDir = path.join(root, "web");
  storagePaths.sessionsDir = path.join(root, "legacy");
  storagePaths.sessionsIndexFile = path.join(root, "legacy-index.json");
  storagePaths.projectsDir = path.join(root, "projects");

  const now = { value: new Date("2026-09-10T12:00:00.000Z") };
  const clock = () => new Date(now.value);
  const sessions = new SessionStore();
  const search = new ConversationSearchIndex(":memory:");
  sessions.setConversationSearchIndex(search, "web");
  const lifecycle = new SessionLifecycleStore(path.join(root, "sessions.db"), { clock });
  const service = new SessionLifecycleService({ sessions, lifecycle, clock, search: { index: search, botId: "web" } });
  sessions.setSessionActivitySink(service);
  let closed = false;
  return {
    root,
    sessions,
    lifecycle,
    service,
    search,
    now,
    originals,
    cleanup() {
      if (closed) return;
      closed = true;
      try { search.close(); } catch { /* already closed */ }
      try { lifecycle.close(); } catch { /* already closed */ }
      Object.assign(storagePaths, originals);
      rmSync(root, { recursive: true, force: true });
    }
  };
}

function createWithMessages(
  fx: Fixture,
  owner: string,
  messages: Array<{ role: "user" | "assistant"; content: string; retention?: "standard" | "not_searchable" }>
): string {
  const conversation = fx.sessions.createWebConversation(owner);
  for (const message of messages) {
    fx.sessions.appendMessage(
      conversation.id,
      message.role,
      message.content,
      message.retention ? { retention: message.retention } : undefined
    );
  }
  return conversation.id;
}

test("default active view sorts by activity desc with stable id tie-break, counts cover all states", (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const first = createWithMessages(fx, OWNER_A, [{ role: "user", content: "first" }]);
  const second = createWithMessages(fx, OWNER_A, [{ role: "user", content: "second" }]);
  const archived = createWithMessages(fx, OWNER_A, [{ role: "user", content: "archived one" }]);
  const trashed = createWithMessages(fx, OWNER_A, [{ role: "user", content: "trashed one" }]);
  assert.equal(fx.service.archive({ conversationId: archived }).status, "succeeded");
  assert.equal(fx.service.trash({ conversationId: trashed }).status, "succeeded");

  const result = fx.service.queryManaged({ requesterExternalUserId: OWNER_A });
  assert.deepEqual(result.counts, { active: 2, archived: 1, trashed: 1 });
  assert.equal(result.total, 2);
  // Newest activity first; both have distinct timestamps via sequential appends.
  const ids = result.items.map((item) => item.conversationId);
  assert.ok(ids.includes(first) && ids.includes(second));
  assert.ok(ids[0] !== ids[1]);
  // Stable tie-break: force equal activity and compare id order.
  const rowA = fx.lifecycle.get(first)!;
  const rowB = fx.lifecycle.get(second)!;
  const pinned = "2026-09-10T12:00:00.000Z";
  fx.lifecycle.updateWithVersion(first, rowA.version, { lastActivityAt: pinned });
  fx.lifecycle.updateWithVersion(second, rowB.version, { lastActivityAt: pinned });
  const tied = fx.service.queryManaged({ requesterExternalUserId: OWNER_A });
  assert.deepEqual(
    tied.items.map((item) => item.conversationId),
    [first, second].sort()
  );
});

test("cross-owner isolation: other owner sees nothing, omitted scope sees all", (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  createWithMessages(fx, OWNER_A, [{ role: "user", content: "owner a session" }]);
  assert.equal(fx.service.queryManaged({ requesterExternalUserId: OWNER_B }).total, 0);
  assert.equal(fx.service.queryManaged({ requesterExternalUserId: OWNER_A }).total, 1);
  assert.equal(fx.service.queryManaged({}).total, 1);
});

test("multi-BOT and local/project source filters combine", (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const localA = createWithMessages(fx, OWNER_A, [{ role: "user", content: "local a" }]);
  const localB = createWithMessages(fx, OWNER_B, [{ role: "user", content: "local b" }]);
  const project = fx.sessions.createProjectConversation("wiki", OWNER_A);
  fx.sessions.appendMessage(project.id, "user", "project work");

  const bots = fx.service.queryManaged({ botIds: ["personal"] });
  assert.deepEqual(bots.items.map((item) => item.conversationId).sort(), [localA, project.id].sort());

  const localOnly = fx.service.queryManaged({ sources: ["local"] });
  assert.deepEqual(localOnly.items.map((item) => item.conversationId).sort(), [localA, localB].sort());
  assert.ok(localOnly.items.every((item) => item.source === "local"));

  const projectOnly = fx.service.queryManaged({ sources: ["project"] });
  assert.deepEqual(projectOnly.items.map((item) => item.conversationId), [project.id]);
  assert.equal(projectOnly.items[0]?.projectId, "wiki");

  const scoped = fx.service.queryManaged({ sources: ["project"], projectIds: ["other"] });
  assert.equal(scoped.total, 0);
});

test("keyword uses title plus authorized searchable projection, never restricted content", (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const titled = fx.sessions.createWebConversation(OWNER_A);
  fx.sessions.renameConversation(titled.id, "web", OWNER_A, "Gardening plans");
  const searchable = createWithMessages(fx, OWNER_A, [{ role: "user", content: "unique searchable syntax zxqjkl" }]);
  const restricted = createWithMessages(fx, OWNER_A, [
    { role: "user", content: "restricted hidden token qwerzxcv", retention: "not_searchable" }
  ]);
  // Titles are display metadata derived from the first message; neutralize it
  // so the keyword assertions below only exercise the content projection.
  fx.sessions.renameConversation(restricted, "web", OWNER_A, "Household notes");
  const archived = createWithMessages(fx, OWNER_A, [{ role: "user", content: "archived recoverable token mnbvcx" }]);
  fx.sessions.renameConversation(archived, "web", OWNER_A, "Old project notes");
  assert.equal(fx.service.archive({ conversationId: archived }).status, "succeeded");
  const trashed = createWithMessages(fx, OWNER_A, [{ role: "user", content: "trashed gone token poiuyt" }]);
  fx.sessions.renameConversation(trashed, "web", OWNER_A, "Discarded drafts");
  assert.equal(fx.service.trash({ conversationId: trashed }).status, "succeeded");

  assert.deepEqual(
    fx.service.queryManaged({ keyword: "gardening" }).items.map((item) => item.conversationId),
    [titled.id]
  );
  assert.deepEqual(
    fx.service.queryManaged({ keyword: "zxqjkl" }).items.map((item) => item.conversationId),
    [searchable]
  );
  // Restricted turns are not indexed: keyword finds nothing.
  assert.equal(fx.service.queryManaged({ keyword: "qwerzxcv" }).total, 0);
  assert.ok(!fx.service.queryManaged({ keyword: "restricted" }).items.some((item) => item.conversationId === restricted));
  // Archived stays searchable; trashed projection is removed immediately.
  assert.deepEqual(
    fx.service.queryManaged({ keyword: "mnbvcx", state: "archived" }).items.map((item) => item.conversationId),
    [archived]
  );
  assert.equal(fx.service.queryManaged({ keyword: "poiuyt", state: "trashed" }).total, 0);
});

test("inactive presets filter by elapsed days without activity", (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const oldId = fx.sessions.createWebConversation(OWNER_A).id;
  const freshId = fx.sessions.createWebConversation(OWNER_A).id;
  const oldRow = fx.lifecycle.ensureRow(oldId);
  fx.lifecycle.updateWithVersion(oldId, oldRow.version, { lastActivityAt: "2026-07-01T00:00:00.000Z" });
  const freshRow = fx.lifecycle.ensureRow(freshId);
  fx.lifecycle.updateWithVersion(freshId, freshRow.version, { lastActivityAt: "2026-09-09T00:00:00.000Z" });

  assert.deepEqual(
    fx.service.queryManaged({ inactiveDays: 30 }).items.map((item) => item.conversationId),
    [oldId]
  );
  assert.equal(fx.service.queryManaged({ inactiveDays: 90 }).total, 0);
  assert.equal(fx.service.queryManaged({ inactiveDays: 7 }).total, 1);
});

test("custom date range interprets days in the user timezone with unambiguous boundaries", (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  // 2026-09-02 00:00 Asia/Shanghai == 2026-09-01T16:00:00Z.
  assert.equal(zonedDayStartUtc("2026-09-02", "Asia/Shanghai"), "2026-09-01T16:00:00.000Z");

  const justBefore = fx.sessions.createWebConversation(OWNER_A).id;
  const justAfter = fx.sessions.createWebConversation(OWNER_A).id;
  const rowBefore = fx.lifecycle.ensureRow(justBefore);
  fx.lifecycle.updateWithVersion(justBefore, rowBefore.version, { lastActivityAt: "2026-09-01T15:59:59.000Z" });
  const rowAfter = fx.lifecycle.ensureRow(justAfter);
  fx.lifecycle.updateWithVersion(justAfter, rowAfter.version, { lastActivityAt: "2026-09-01T16:00:00.000Z" });

  const result = fx.service.queryManaged({
    activityFromDate: "2026-09-02",
    activityToDate: "2026-09-02",
    timeZone: "Asia/Shanghai"
  });
  assert.deepEqual(result.items.map((item) => item.conversationId), [justAfter]);
  assert.throws(() => fx.service.queryManaged({ activityFromDate: "not-a-date" }), /YYYY-MM-DD/);
  assert.throws(() => fx.service.queryManaged({ activityFromDate: "2026-09-03", activityToDate: "2026-09-01" }), /after/);
});

test("empty is no user and no assistant messages; short is one or two user turns", (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const emptyId = fx.sessions.createWebConversation(OWNER_A).id;
  const oneTurn = createWithMessages(fx, OWNER_A, [
    { role: "user", content: "q1" },
    { role: "assistant", content: "a1" }
  ]);
  const twoTurns = createWithMessages(fx, OWNER_A, [
    { role: "user", content: "q1" },
    { role: "assistant", content: "a1" },
    { role: "user", content: "q2" },
    { role: "assistant", content: "a2" }
  ]);
  const long = createWithMessages(fx, OWNER_A, [
    { role: "user", content: "q1" },
    { role: "user", content: "q2" },
    { role: "user", content: "q3" }
  ]);

  assert.deepEqual(
    fx.service.queryManaged({ lengths: ["empty"] }).items.map((item) => item.conversationId),
    [emptyId]
  );
  assert.deepEqual(
    fx.service.queryManaged({ lengths: ["short"] }).items.map((item) => item.conversationId).sort(),
    [oneTurn, twoTurns].sort()
  );
  assert.deepEqual(
    fx.service.queryManaged({ lengths: ["empty", "short"] }).total,
    3
  );
  assert.ok(fx.service.queryManaged({ lengths: ["normal"] }).items.some((item) => item.conversationId === long));
});

test("server-side pagination slices a stable order and reports totals", (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const ids: string[] = [];
  for (let index = 0; index < 5; index += 1) {
    ids.push(createWithMessages(fx, OWNER_A, [{ role: "user", content: `paged ${index} token` }]));
  }
  const full = fx.service.queryManaged({ limit: 100 });
  assert.equal(full.total, 5);
  const pageOne = fx.service.queryManaged({ limit: 2, offset: 0 });
  const pageTwo = fx.service.queryManaged({ limit: 2, offset: 2 });
  const pageThree = fx.service.queryManaged({ limit: 2, offset: 4 });
  assert.equal(pageOne.items.length, 2);
  assert.equal(pageTwo.items.length, 2);
  assert.equal(pageThree.items.length, 1);
  assert.deepEqual(
    [...pageOne.items, ...pageTwo.items, ...pageThree.items].map((item) => item.conversationId),
    full.items.map((item) => item.conversationId)
  );
  assert.deepEqual(pageOne.counts, { active: 5, archived: 0, trashed: 0 });
});

test("lifecycle state survives a store restart and still filters daily active", (t) => {
  const fx = setup();
  const visible = createWithMessages(fx, OWNER_A, [{ role: "user", content: "stay active" }]);
  const hidden = createWithMessages(fx, OWNER_A, [{ role: "user", content: "go archive" }]);
  assert.equal(fx.service.archive({ conversationId: hidden }).status, "succeeded");
  const dbFile = path.join(fx.root, "sessions.db");
  fx.lifecycle.close();
  fx.search.close();

  const reopened = new SessionLifecycleStore(dbFile);
  t.after(() => {
    reopened.close();
    fx.cleanup();
  });
  const service = new SessionLifecycleService({
    sessions: fx.sessions,
    lifecycle: reopened,
    search: { index: fx.search, botId: "web" }
  });
  const active = service.queryManaged({});
  assert.deepEqual(active.items.map((item) => item.conversationId), [visible]);
  assert.deepEqual(active.counts, { active: 1, archived: 1, trashed: 0 });
});

test("list items expose display metadata only, never transcript content", (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const id = createWithMessages(fx, OWNER_A, [
    { role: "user", content: "secret body text" },
    { role: "assistant", content: "assistant reply text" }
  ]);
  fx.sessions.renameConversation(id, "web", OWNER_A, "Neutral display title");
  const item = fx.service.queryManaged({}).items.find((entry) => entry.conversationId === id)!;
  assert.ok(item);
  assert.equal(item.userTurnCount, 1);
  assert.equal(item.assistantTurnCount, 1);
  assert.equal(item.state, "active");
  assert.equal(item.retain, false);
  const serialized = JSON.stringify(item);
  assert.ok(!serialized.includes("secret body text"));
  assert.ok(!serialized.includes("assistant reply text"));
  assert.ok(!("content" in item) && !("preview" in item) && !("messages" in item));
});
