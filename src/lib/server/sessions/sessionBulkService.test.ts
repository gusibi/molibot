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
import { SessionBulkStore } from "$lib/server/sessions/sessionBulkStore.js";
import { SessionBulkService } from "$lib/server/sessions/sessionBulkService.js";

const OWNER = "web:personal:web-anonymous";
const OTHER = "web:other:web-anonymous";

interface Fixture {
  root: string;
  dbFile: string;
  sessions: SessionStore;
  lifecycle: SessionLifecycleStore;
  service: SessionLifecycleService;
  bulk: SessionBulkStore;
  bulkService: SessionBulkService;
  search: ConversationSearchIndex;
  busy: Set<string>;
  now: { value: Date };
  originals: Record<string, string>;
  reopenBulkService(): SessionBulkService;
  cleanup(): void;
}

function setup(): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-session-bulk-"));
  const originals = {
    webWorkspaceDir: storagePaths.webWorkspaceDir,
    sessionsDir: storagePaths.sessionsDir,
    sessionsIndexFile: storagePaths.sessionsIndexFile
  };
  storagePaths.webWorkspaceDir = path.join(root, "web");
  storagePaths.sessionsDir = path.join(root, "legacy");
  storagePaths.sessionsIndexFile = path.join(root, "legacy-index.json");

  const now = { value: new Date("2026-09-01T10:00:00.000Z") };
  const clock = () => new Date(now.value);
  const dbFile = path.join(root, "sessions.db");
  const sessions = new SessionStore();
  const search = new ConversationSearchIndex(":memory:");
  sessions.setConversationSearchIndex(search, "web");
  const lifecycle = new SessionLifecycleStore(dbFile, { clock });
  const busy = new Set<string>();
  const service = new SessionLifecycleService({ sessions, lifecycle, clock, isBusy: (id) => busy.has(id) });
  sessions.setSessionActivitySink(service);
  const bulk = new SessionBulkStore(dbFile, { clock });
  const bulkService = new SessionBulkService({ lifecycle: service, lifecycleRows: lifecycle, bulk });

  let closed = false;
  const fx: Fixture = {
    root,
    dbFile,
    sessions,
    lifecycle,
    service,
    bulk,
    bulkService,
    search,
    busy,
    now,
    originals,
    reopenBulkService() {
      // Simulates reconnect: a fresh service over the same durable store.
      const reopenedBulk = new SessionBulkStore(dbFile, { clock });
      const reopenedLifecycle = new SessionLifecycleStore(dbFile, { clock });
      const reopenedService = new SessionLifecycleService({
        sessions,
        lifecycle: reopenedLifecycle,
        clock,
        isBusy: (id) => busy.has(id)
      });
      const svc = new SessionBulkService({ lifecycle: reopenedService, lifecycleRows: reopenedLifecycle, bulk: reopenedBulk });
      (svc as unknown as { __stores: unknown }).__stores = { reopenedBulk, reopenedLifecycle };
      return svc;
    },
    cleanup() {
      if (closed) return;
      closed = true;
      try { (bulkService as unknown as { __stores?: { reopenedBulk?: { close(): void }; reopenedLifecycle?: { close(): void } } }).__stores?.reopenedBulk?.close(); } catch { /* noop */ }
      try { (bulkService as unknown as { __stores?: { reopenedBulk?: { close(): void }; reopenedLifecycle?: { close(): void } } }).__stores?.reopenedLifecycle?.close(); } catch { /* noop */ }
      try { search.close(); } catch { /* already closed */ }
      try { bulk.close(); } catch { /* already closed */ }
      try { lifecycle.close(); } catch { /* already closed */ }
      Object.assign(storagePaths, originals);
      rmSync(root, { recursive: true, force: true });
    }
  };
  return fx;
}

function makeConversation(fx: Fixture) {
  const conversation = fx.sessions.createWebConversation(OWNER);
  fx.sessions.appendMessage(conversation.id, "user", `bulk message ${conversation.id}`);
  return conversation;
}

test("bulk archive with explicit targets returns operation id, counts and per-item outcomes", (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const a = makeConversation(fx);
  const b = makeConversation(fx);

  const result = fx.bulkService.execute({
    kind: "archive",
    requesterExternalUserId: OWNER,
    targets: [a.id, b.id],
    idempotencyKey: "op-archive-1"
  });

  assert.ok(result.operationId);
  assert.equal(result.kind, "archive");
  assert.deepEqual(result.counts, { total: 2, succeeded: 2, skipped: 0, failed: 0 });
  assert.equal(result.items.length, 2);
  for (const item of result.items) {
    assert.equal(item.status, "succeeded");
    assert.equal(item.state, "archived");
  }
  assert.equal(fx.service.query({ requesterExternalUserId: OWNER }).length, 0);
  assert.equal(fx.service.query({ requesterExternalUserId: OWNER, state: "archived" }).length, 2);
});

test("selection snapshot excludes later arrivals; execution rechecks ownership", (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const a = makeConversation(fx);
  const b = makeConversation(fx);

  const selection = fx.bulkService.createSelection({ requesterExternalUserId: OWNER, targets: [a.id, b.id] });
  assert.equal(selection.count, 2);

  // A later arrival is not silently absorbed into the snapshot.
  const late = makeConversation(fx);

  const result = fx.bulkService.execute({
    kind: "archive",
    requesterExternalUserId: OWNER,
    selectionId: selection.selectionId,
    idempotencyKey: "op-selection-1"
  });
  assert.deepEqual(result.counts, { total: 2, succeeded: 2, skipped: 0, failed: 0 });
  assert.deepEqual(fx.service.query({ requesterExternalUserId: OWNER }).map((item) => item.conversation.id), [late.id]);

  // Ownership is rechecked at execution: another owner's replay over the same
  // selection cannot archive these sessions.
  const crossOwner = fx.bulkService.execute({
    kind: "archive",
    requesterExternalUserId: OTHER,
    selectionId: selection.selectionId,
    idempotencyKey: "op-selection-cross-owner"
  });
  assert.equal(crossOwner.counts.skipped, 2);
  for (const item of crossOwner.items) {
    assert.equal(item.status, "skipped");
    assert.equal(item.reason, "unauthorized");
  }
});

test("stale versions skip instead of acting on preview assumptions", (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const a = makeConversation(fx);
  const row = fx.lifecycle.ensureRow(a.id);

  const result = fx.bulkService.execute({
    kind: "archive",
    requesterExternalUserId: OWNER,
    targets: [{ conversationId: a.id, expectedVersion: row.version + 5 }],
    idempotencyKey: "op-stale-1"
  });
  assert.deepEqual(result.counts, { total: 1, succeeded: 0, skipped: 1, failed: 0 });
  assert.equal(result.items[0]?.status, "skipped");
  assert.equal(result.items[0]?.reason, "stale_version");
  assert.equal(fx.service.query({ requesterExternalUserId: OWNER }).length, 1);
});

test("busy and protected targets skip with actionable reasons; manual archive still allowed", (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const busySession = makeConversation(fx);
  const protectedSession = makeConversation(fx);
  fx.busy.add(busySession.id);
  assert.equal(
    fx.service.setRetain({ conversationId: protectedSession.id, retain: true, requesterExternalUserId: OWNER }).status,
    "succeeded"
  );

  const deleted = fx.bulkService.execute({
    kind: "delete",
    requesterExternalUserId: OWNER,
    targets: [busySession.id, protectedSession.id],
    idempotencyKey: "op-guards-delete"
  });
  assert.equal(deleted.counts.skipped, 2);
  const byId = new Map(deleted.items.map((item) => [item.conversationId, item]));
  assert.equal(byId.get(busySession.id)?.reason, "busy");
  assert.equal(byId.get(protectedSession.id)?.reason, "protected");

  // Long-term retention blocks deletion but allows explicit manual archive.
  const archived = fx.bulkService.execute({
    kind: "archive",
    requesterExternalUserId: OWNER,
    targets: [protectedSession.id],
    idempotencyKey: "op-guards-archive"
  });
  assert.deepEqual(archived.counts, { total: 1, succeeded: 1, skipped: 0, failed: 0 });
});

test("partial failure retries only failed items; completed actions stay idempotent", (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const a = makeConversation(fx);
  const b = makeConversation(fx);
  const c = makeConversation(fx);

  const failing = new Set([b.id]);
  const original = fx.sessions.removeConversationSearchProjection.bind(fx.sessions);
  fx.sessions.removeConversationSearchProjection = ((conversation: Parameters<typeof original>[0]) => {
    if (failing.has(conversation.id)) throw new Error("search projection unavailable");
    return original(conversation);
  }) as typeof original;

  const first = fx.bulkService.execute({
    kind: "delete",
    requesterExternalUserId: OWNER,
    targets: [a.id, b.id, c.id],
    idempotencyKey: "op-partial-1"
  });
  assert.deepEqual(first.counts, { total: 3, succeeded: 2, skipped: 0, failed: 1 });
  const failedItem = first.items.find((item) => item.conversationId === b.id);
  assert.equal(failedItem?.status, "failed");

  const versionsBefore = new Map(first.items.map((item) => [item.conversationId, fx.lifecycle.get(item.conversationId)?.version]));

  // The transient failure is gone; retry converges the failed item only.
  failing.clear();
  const retried = fx.bulkService.retryFailed({ operationId: first.operationId });
  assert.deepEqual(retried.counts, { total: 3, succeeded: 3, skipped: 0, failed: 0 });
  assert.equal(retried.operationId, first.operationId);
  for (const item of retried.items) {
    if (item.conversationId === b.id) continue;
    assert.equal(fx.lifecycle.get(item.conversationId)?.version, versionsBefore.get(item.conversationId));
  }
  assert.equal(fx.service.query({ requesterExternalUserId: OWNER, state: "trashed" }).length, 3);
});

test("idempotent replay returns the stored result without re-executing", (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const a = makeConversation(fx);

  const first = fx.bulkService.execute({
    kind: "archive",
    requesterExternalUserId: OWNER,
    targets: [a.id],
    idempotencyKey: "op-replay-1"
  });
  const versionAfterFirst = fx.lifecycle.get(a.id)?.version;

  const replayed = fx.bulkService.execute({
    kind: "archive",
    requesterExternalUserId: OWNER,
    targets: [a.id],
    idempotencyKey: "op-replay-1"
  });
  assert.equal(replayed.operationId, first.operationId);
  assert.deepEqual(replayed.counts, first.counts);
  assert.deepEqual(replayed.items, first.items);
  assert.equal(fx.lifecycle.get(a.id)?.version, versionAfterFirst);
});

test("large-operation progress stays readable after reconnect", (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const ids = [makeConversation(fx).id, makeConversation(fx).id, makeConversation(fx).id];

  const first = fx.bulkService.execute({
    kind: "archive",
    requesterExternalUserId: OWNER,
    targets: ids,
    idempotencyKey: "op-durable-1"
  });
  assert.equal(first.counts.succeeded, 3);

  const reopened = fx.reopenBulkService();
  const reread = reopened.getOperation(first.operationId);
  assert.ok(reread);
  assert.equal(reread?.operationId, first.operationId);
  assert.deepEqual(reread?.counts, { total: 3, succeeded: 3, skipped: 0, failed: 0 });
  assert.equal(reread?.items.length, 3);
});

test("bulk restore returns archived and trashed sessions to their views", (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const archived = makeConversation(fx);
  const trashed = makeConversation(fx);
  assert.equal(fx.service.archive({ conversationId: archived.id, requesterExternalUserId: OWNER }).status, "succeeded");
  assert.equal(fx.service.trash({ conversationId: trashed.id, requesterExternalUserId: OWNER }).status, "succeeded");

  const result = fx.bulkService.execute({
    kind: "restore",
    requesterExternalUserId: OWNER,
    targets: [archived.id, trashed.id],
    idempotencyKey: "op-restore-1"
  });
  assert.deepEqual(result.counts, { total: 2, succeeded: 2, skipped: 0, failed: 0 });
  assert.equal(fx.service.query({ requesterExternalUserId: OWNER }).length, 2);
});

test("delete preview states exact count, recovery period and data scope", (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const preview = fx.bulkService.describeDelete(7);
  assert.equal(preview.count, 7);
  assert.equal(preview.retentionDays, 30);
  assert.equal(preview.retainsMemoriesAndArtifacts, true);
  assert.equal(preview.searchRemovedImmediately, true);
});

test("bulk requests validate operation, targets and idempotency key", (t) => {
  const fx = setup();
  t.after(() => fx.cleanup());
  const a = makeConversation(fx);
  const selection = fx.bulkService.createSelection({ requesterExternalUserId: OWNER, targets: [a.id] });

  assert.throws(() => fx.bulkService.execute({ kind: "archive", targets: [], idempotencyKey: "k" }), /at least one target/);
  assert.throws(
    () => fx.bulkService.execute({ kind: "archive", targets: [a.id], selectionId: selection.selectionId, idempotencyKey: "k" }),
    /either targets or selectionId/
  );
  assert.throws(
    () => fx.bulkService.execute({ kind: "archive", targets: [a.id], idempotencyKey: "   " }),
    /idempotencyKey/
  );
  assert.throws(
    () => fx.bulkService.execute({ kind: "archive", selectionId: "missing", idempotencyKey: "k" }),
    /Unknown selection/
  );
  assert.throws(() => fx.bulkService.retryFailed({ operationId: "missing" }), /Unknown bulk operation/);
  assert.throws(() => fx.bulkService.createSelection({ targets: [] }), /at least one target/);
  assert.equal(fx.bulkService.getOperation("missing"), null);
});
