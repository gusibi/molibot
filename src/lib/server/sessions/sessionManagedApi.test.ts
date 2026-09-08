import assert from "node:assert/strict";
import test from "node:test";

// RED: adapter module does not exist yet.
import {
  parseManagedQuery,
  projectBulkResult,
  projectExtractionResult,
  projectManagedItem,
  validateBulkExecute,
  validateExtractionExecute,
  validateSelectionCreate
} from "$lib/server/sessions/sessionManagedApi.js";

test("parseManagedQuery: defaults to active view with sane pagination", () => {
  const parsed = parseManagedQuery(new URLSearchParams(""));
  assert.equal(parsed.state, "active");
  assert.equal(parsed.limit, 20);
  assert.equal(parsed.offset, 0);
});

test("parseManagedQuery: rejects unknown state and bad pagination", () => {
  assert.throws(() => parseManagedQuery(new URLSearchParams("state=bogus")), /Invalid state/);
  assert.throws(() => parseManagedQuery(new URLSearchParams("limit=500")), /Invalid limit/);
  assert.throws(
    () => parseManagedQuery(new URLSearchParams("activityFromDate=2026-13-99")),
    /Invalid date/
  );
  assert.throws(
    () => parseManagedQuery(new URLSearchParams("activityFromDate=2026-09-05&activityToDate=2026-09-01")),
    /must not be after/
  );
});

test("parseManagedQuery: accepts full filter set incl. empty/short lengths and inactivity preset", () => {
  const parsed = parseManagedQuery(
    new URLSearchParams(
      "state=archived&botIds=personal,work&sources=local,project&keyword=hello&inactiveDays=30&lengths=empty,short&limit=10&offset=20"
    )
  );
  assert.equal(parsed.state, "archived");
  assert.deepEqual(parsed.botIds, ["personal", "work"]);
  assert.deepEqual(parsed.sources, ["local", "project"]);
  assert.equal(parsed.keyword, "hello");
  assert.equal(parsed.inactiveDays, 30);
  assert.deepEqual(parsed.lengths, ["empty", "short"]);
  assert.equal(parsed.limit, 10);
  assert.equal(parsed.offset, 20);
});

test("validateBulkExecute: requires exactly one of targets/selectionId plus kind and idempotency key", () => {
  assert.throws(
    () => validateBulkExecute({ kind: "archive", idempotencyKey: "k1" }),
    /targets or selectionId/
  );
  assert.throws(
    () =>
      validateBulkExecute({
        kind: "archive",
        targets: ["a"],
        selectionId: "s",
        idempotencyKey: "k1"
      }),
    /either targets or selectionId, not both/
  );
  assert.throws(() => validateBulkExecute({ kind: "nuke", targets: ["a"], idempotencyKey: "k1" }), /Unknown bulk operation/);
  assert.throws(() => validateBulkExecute({ kind: "delete", targets: ["a"], idempotencyKey: " " }), /idempotencyKey/);
  const ok = validateBulkExecute({ kind: "delete", targets: [{ conversationId: "a", expectedVersion: 3 }], idempotencyKey: "k1" });
  assert.equal(ok.kind, "delete");
});

test("validateSelectionCreate: rejects empty target lists", () => {
  assert.throws(() => validateSelectionCreate({ targets: [] }), /at least one target/);
  const ok = validateSelectionCreate({ targets: ["a", "a", " b "] });
  assert.deepEqual(ok.targetIds, ["a", "b"]);
});

test("projectManagedItem: exposes display metadata only, never transcript content", () => {
  const projected = projectManagedItem({
    conversationId: "c1",
    title: "Hello",
    source: "local",
    channel: "web",
    botId: "personal",
    ownerExternalUserId: "web:personal:x",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    lastActivityAt: "2026-01-02T00:00:00.000Z",
    userTurnCount: 1,
    assistantTurnCount: 1,
    state: "active",
    version: 2,
    retain: false,
    archivedAt: null,
    trashedAt: null,
    messages: [{ role: "user", content: "secret transcript body" }]
  } as unknown as Record<string, unknown>);
  assert.equal((projected as Record<string, unknown>).conversationId, "c1");
  assert.ok(!("messages" in (projected as Record<string, unknown>)));
  assert.ok(!("content" in (projected as Record<string, unknown>)));
  assert.equal((projected as Record<string, unknown>).userTurnCount, 1);
});

test("projectBulkResult: per-item outcomes carry status and reason, no internals", () => {
  const projected = projectBulkResult({
    operationId: "op1",
    kind: "archive",
    counts: { total: 2, succeeded: 1, skipped: 1, failed: 0 },
    items: [
      { conversationId: "a", expectedVersion: 1, status: "succeeded", reason: null, detail: null, state: "archived", version: 2 },
      { conversationId: "b", expectedVersion: 1, status: "skipped", reason: "busy", detail: null, state: null, version: null }
    ]
  } as unknown as Parameters<typeof projectBulkResult>[0]);
  assert.equal(projected.operationId, "op1");
  assert.equal(projected.items.length, 2);
  assert.equal(projected.items[1].reason, "busy");
});

test("parseManagedQuery: accepts extraction states and processed-not-archived", () => {
  const parsed = parseManagedQuery(
    new URLSearchParams("extraction=saved,failed&processedNotArchived=true")
  );
  assert.deepEqual(parsed.extractionStates, ["saved", "failed"]);
  assert.equal(parsed.processedNotArchived, true);
  const off = parseManagedQuery(new URLSearchParams("processedNotArchived=0"));
  assert.equal(off.processedNotArchived, false);
  assert.throws(() => parseManagedQuery(new URLSearchParams("extraction=bogus")), /Invalid extraction/);
  assert.throws(() => parseManagedQuery(new URLSearchParams("processedNotArchived=maybe")), /Invalid processedNotArchived/);
});

test("projectManagedItem: carries extraction status, source range and retained references", () => {
  const projected = projectManagedItem({
    conversationId: "c1",
    title: "Hello",
    source: "local",
    channel: "web",
    botId: "personal",
    ownerExternalUserId: "web:personal:x",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    lastActivityAt: "2026-01-02T00:00:00.000Z",
    userTurnCount: 1,
    assistantTurnCount: 1,
    state: "active",
    version: 2,
    retain: false,
    archivedAt: null,
    trashedAt: null,
    extractionStatus: "saved",
    extractionRevision: "3:m9:2026-01-02T00:00:00.000Z",
    processedThroughId: "m9",
    savedMemoryIds: ["mem-1"],
    savedDocRefs: [{ docId: "doc-1", title: "Notes" }],
    pendingCandidateIds: [],
    messages: [{ role: "user", content: "secret transcript body" }]
  } as unknown as Parameters<typeof projectManagedItem>[0]);
  assert.equal(projected.extractionStatus, "saved");
  assert.equal(projected.processedThroughId, "m9");
  assert.deepEqual(projected.savedMemoryIds, ["mem-1"]);
  assert.ok(!("messages" in (projected as unknown as Record<string, unknown>)));
});

test("validateExtractionExecute: mode plus exactly one of targets/selectionId plus idempotency key", () => {
  assert.throws(
    () => validateExtractionExecute({ idempotencyKey: "k1" }),
    /mode/
  );
  assert.throws(
    () => validateExtractionExecute({ mode: "summarize", targets: ["a"], idempotencyKey: "k1" }),
    /Unknown extraction mode/
  );
  assert.throws(
    () => validateExtractionExecute({ mode: "extract", idempotencyKey: "k1" }),
    /targets or selectionId/
  );
  assert.throws(
    () =>
      validateExtractionExecute({
        mode: "extract-and-archive",
        targets: ["a"],
        selectionId: "s",
        idempotencyKey: "k1"
      }),
    /either targets or selectionId, not both/
  );
  assert.throws(() => validateExtractionExecute({ mode: "extract", targets: ["a"], idempotencyKey: " " }), /idempotencyKey/);
  const ok = validateExtractionExecute({
    mode: "extract-and-archive",
    targets: [{ conversationId: "a", expectedVersion: 3 }],
    idempotencyKey: "k1"
  });
  assert.equal(ok.mode, "extract-and-archive");
  assert.equal(ok.targets?.length, 1);
});

test("projectExtractionResult: per-item extraction outcomes with archive gate state", () => {
  const projected = projectExtractionResult({
    mode: "extract-and-archive",
    idempotencyKey: "k1",
    counts: { total: 2, archived: 1, failed: 1 },
    items: [
      {
        conversationId: "a",
        status: "saved",
        archived: true,
        messageRevision: "1:m1:2026-01-01T00:00:00.000Z",
        processedThroughId: "m1",
        failureReasons: []
      },
      {
        conversationId: "b",
        status: "pending-review",
        archived: false,
        archiveReason: "pending-review",
        messageRevision: "1:m2:2026-01-01T00:00:00.000Z",
        processedThroughId: "m2",
        failureReasons: []
      }
    ]
  });
  assert.equal(projected.items.length, 2);
  assert.equal(projected.items[0].archived, true);
  assert.equal(projected.items[1].archiveReason, "pending-review");
});
