import assert from "node:assert/strict";
import test from "node:test";
import type { DesktopManagedSessionItem } from "../api";

(globalThis as any).$derived = (value: unknown) => value;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function managedListPayload(offset: number, ids: string[], total = ids.length): {
  ok: true;
  items: DesktopManagedSessionItem[];
  total: number;
  counts: { active: number; archived: number; trashed: number };
  limit: number;
  offset: number;
} {
  return {
    ok: true,
    items: ids.map((id, index) => ({
      conversationId: id,
      title: `Session ${id}`,
      source: "external",
      channel: "telegram",
      botId: "personal",
      ownerExternalUserId: null,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-02T00:00:00.000Z",
      lastActivityAt: "2026-09-02T00:00:00.000Z",
      userTurnCount: 1 + index,
      assistantTurnCount: 1,
      state: "active",
      version: 10 + index,
      retain: false,
      archivedAt: null,
      trashedAt: null,
      extractionStatus: "unprocessed",
      extractionRevision: null,
      processedThroughId: null,
      savedMemoryIds: [],
      savedDocRefs: [],
      pendingCandidateIds: []
    })),
    total,
    counts: { active: total, archived: 3, trashed: 1 },
    limit: offset === 0 ? 20 : 100,
    offset
  };
}

function pageIds(endpoint: URL, offsetParam: string): string[] {
  const offset = Number(endpoint.searchParams.get(offsetParam) ?? "0");
  const limit = Number(endpoint.searchParams.get("limit") ?? "20");
  const ids: string[] = [];
  for (let i = offset; i < Math.min(offset + limit, 7); i += 1) ids.push(`s-${i}`);
  return ids;
}

async function freshStore() {
  (globalThis as any).$state = <T>(value: T): T => value;
  const module = await import("./sessionManagement.svelte.js");
  Object.assign(module.sessionManagementStore, {
    endpoint: "http://desktop.test",
    view: "active",
    botIds: "",
    source: "all",
    keyword: "",
    inactiveDays: "any",
    fromDate: "",
    toDate: "",
    empty: false,
    short: false,
    extractionFilter: "any",
    processedOnly: false,
    pageOffset: 0,
    items: [],
    total: 0,
    counts: { active: 0, archived: 0, trashed: 0 },
    loading: false,
    loadError: "",
    selected: {},
    selectAll: null,
    lastSelectedIdx: -1,
    selectingAll: false,
    previewId: "",
    previewTitle: "",
    previewMessages: [],
    previewLoading: false,
    previewError: "",
    previewUnavailable: false,
    previewExtraction: null,
    bulkBusy: false,
    bulkError: "",
    bulkCounts: null,
    extractCounts: null,
    extractResults: [],
    bulkFailed: 0,
    lastOperationId: "",
    confirmDelete: false,
    deleteFacts: null,
    extractingIds: {},
    policyEnabled: false,
    policyDays: 30,
    policyBots: {},
    policyPreview: null,
    lastRun: null,
    policyLoading: false,
    policySaving: false,
    policyError: "",
    policyMessage: "",
    listGeneration: 0,
    policyGeneration: 0
  });
  return module;
}

test("loading the managed list projects the current filters into the request and stores counts", async () => {
  const { sessionManagementStore, applySessionFilters } = await freshStore();
  sessionManagementStore.botIds = "personal,work";
  sessionManagementStore.source = "external";
  sessionManagementStore.keyword = "cleanup";
  sessionManagementStore.inactiveDays = "30";
  sessionManagementStore.fromDate = "2026-08-01";
  sessionManagementStore.toDate = "2026-08-31";
  sessionManagementStore.empty = true;
  sessionManagementStore.short = true;
  sessionManagementStore.extractionFilter = "failed";
  sessionManagementStore.processedOnly = true;

  const urls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    urls.push(String(input));
    return jsonResponse(managedListPayload(0, ["s-0", "s-1"], 42));
  }) as typeof fetch;
  try {
    applySessionFilters("http://desktop.test");
    await new Promise<void>((done) => {
      const timer = setInterval(() => { if (!sessionManagementStore.loading) { clearInterval(timer); done(); } }, 1);
    });
    const url = new URL(urls[0]);
    assert.equal(url.pathname, "/api/sessions/managed");
    assert.equal(url.searchParams.get("state"), "active");
    assert.equal(url.searchParams.get("botIds"), "personal,work");
    assert.equal(url.searchParams.get("sources"), "external");
    assert.equal(url.searchParams.get("keyword"), "cleanup");
    assert.equal(url.searchParams.get("inactiveDays"), "30");
    assert.equal(url.searchParams.get("activityFromDate"), "2026-08-01");
    assert.equal(url.searchParams.get("activityToDate"), "2026-08-31");
    assert.equal(url.searchParams.get("lengths"), "empty,short");
    assert.equal(url.searchParams.get("extraction"), "failed");
    assert.equal(url.searchParams.get("processedNotArchived"), "true");
    assert.ok(!url.searchParams.has("userId") && !url.searchParams.has("profileId"));
    assert.equal(sessionManagementStore.total, 42);
    assert.deepEqual(sessionManagementStore.counts, { active: 42, archived: 3, trashed: 1 });
    assert.equal(sessionManagementStore.items[1]?.conversationId, "s-1");
    assert.equal(sessionManagementStore.loadError, "");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("filter changes clear selection and page offset, then reload", async () => {
  const { sessionManagementStore, applySessionFilters } = await freshStore();
  sessionManagementStore.selected = { "s-0": 10 };
  sessionManagementStore.selectAll = { selectionId: "sel-1", count: 9 };
  sessionManagementStore.pageOffset = 40;

  const urls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    urls.push(String(input));
    return jsonResponse(managedListPayload(0, ["s-0"]));
  }) as typeof fetch;
  try {
    applySessionFilters("http://desktop.test");
    await new Promise<void>((done) => {
      const timer = setInterval(() => { if (!sessionManagementStore.loading) { clearInterval(timer); done(); } }, 1);
    });
    assert.deepEqual(sessionManagementStore.selected, {});
    assert.equal(sessionManagementStore.selectAll, null);
    assert.equal(sessionManagementStore.pageOffset, 0);
    assert.equal(new URL(urls[0]).searchParams.get("offset"), "0");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("row, range and page selection update the manual selection and drop the snapshot", async () => {
  const { sessionManagementStore, toggleSessionRow, toggleSessionPage, toggleSessionOne } = await freshStore();
  sessionManagementStore.items = [
    { ...managedListPayload(0, ["s-0"]).items[0], conversationId: "s-0", version: 10 },
    { ...managedListPayload(0, ["s-1"]).items[0], conversationId: "s-1", version: 11 },
    { ...managedListPayload(0, ["s-2"]).items[0], conversationId: "s-2", version: 12 }
  ];
  sessionManagementStore.selectAll = { selectionId: "sel-1", count: 9 };

  toggleSessionRow("s-0", 0, false);
  assert.deepEqual(sessionManagementStore.selected, { "s-0": 10 });
  assert.equal(sessionManagementStore.selectAll, null);
  assert.equal(sessionManagementStore.lastSelectedIdx, 0);

  toggleSessionRow("s-2", 2, true);
  assert.deepEqual(sessionManagementStore.selected, { "s-0": 10, "s-1": 11, "s-2": 12 });

  toggleSessionOne("s-1", 11, false);
  assert.deepEqual(sessionManagementStore.selected, { "s-0": 10, "s-2": 12 });

  toggleSessionPage(false);
  assert.deepEqual(sessionManagementStore.selected, {});

  toggleSessionPage(true);
  assert.deepEqual(sessionManagementStore.selected, { "s-0": 10, "s-1": 11, "s-2": 12 });
});

test("cross-page selection pages through every match and posts a server selection snapshot", async () => {
  const { sessionManagementStore, selectAllMatchingSessions } = await freshStore();
  sessionManagementStore.selected = { "manual": 1 };
  const urls: string[] = [];
  const bodies: unknown[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/sessions/managed") {
      urls.push(String(input));
      return jsonResponse(managedListPayload(Number(url.searchParams.get("offset")), pageIds(url, "offset"), 7));
    }
    bodies.push(JSON.parse(String(init?.body)));
    return jsonResponse({ ok: true, selectionId: "sel-42", count: 7 });
  }) as typeof fetch;
  try {
    await selectAllMatchingSessions("http://desktop.test");
    assert.equal(urls.length, 1);
    assert.equal(new URL(urls[0]).searchParams.get("limit"), "100");
    assert.deepEqual(bodies, [{ targets: ["s-0", "s-1", "s-2", "s-3", "s-4", "s-5", "s-6"] }]);
    assert.deepEqual(sessionManagementStore.selectAll, { selectionId: "sel-42", count: 7 });
    assert.deepEqual(sessionManagementStore.selected, {});
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("delete requires describe-delete confirmation, then executes with an idempotency key", async () => {
  const { sessionManagementStore, requestSessionDelete, runSessionBulk } = await freshStore();
  sessionManagementStore.selectAll = { selectionId: "sel-42", count: 12 };
  const bodies: Array<Record<string, unknown>> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/bulk/describe-delete")) {
      assert.ok(url.endsWith("count=12"));
      return jsonResponse({ ok: true, count: 12, retentionDays: 30, retainsMemoriesAndArtifacts: true, searchRemovedImmediately: true, retainedItemsPath: "/settings/memory" });
    }
    if (url.endsWith("/api/sessions/managed/bulk")) {
      bodies.push(JSON.parse(String(init?.body)));
      return jsonResponse({ ok: true, operationId: "op-1", kind: "delete", counts: { total: 12, succeeded: 11, skipped: 1, failed: 0 }, items: [] });
    }
    return jsonResponse(managedListPayload(0, [], 0));
  }) as typeof fetch;
  try {
    await runSessionBulk("http://desktop.test", "delete");
    assert.equal(bodies.length, 0);

    await requestSessionDelete("http://desktop.test");
    assert.equal(sessionManagementStore.confirmDelete, true);
    assert.deepEqual(sessionManagementStore.deleteFacts, { count: 12, retentionDays: 30 });

    await runSessionBulk("http://desktop.test", "delete");
    assert.equal(bodies.length, 1);
    const deleteBody = bodies[0] as { kind: string; selectionId: string; idempotencyKey: string };
    assert.equal(deleteBody.kind, "delete");
    assert.equal(deleteBody.selectionId, "sel-42");
    assert.ok(deleteBody.idempotencyKey.length > 0);
    assert.equal(sessionManagementStore.confirmDelete, false);
    assert.deepEqual(sessionManagementStore.selectAll, null);
    assert.deepEqual(sessionManagementStore.bulkCounts, { total: 12, succeeded: 11, skipped: 1, failed: 0 });
    assert.equal(sessionManagementStore.lastOperationId, "op-1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("archive sends per-target versions and reports per-item failure counts", async () => {
  const { sessionManagementStore, runSessionBulk } = await freshStore();
  sessionManagementStore.selected = { "s-0": 10, "s-1": 11 };
  const bodies: Array<Record<string, unknown>> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).endsWith("/api/sessions/managed/bulk")) {
      bodies.push(JSON.parse(String(init?.body)));
      return jsonResponse({
        ok: true,
        operationId: "op-2",
        kind: "archive",
        counts: { total: 2, succeeded: 1, skipped: 0, failed: 1 },
        items: [
          { conversationId: "s-0", expectedVersion: 10, status: "succeeded", state: "archived", version: 11 },
          { conversationId: "s-1", expectedVersion: 11, status: "failed", reason: "busy" }
        ]
      });
    }
    return jsonResponse(managedListPayload(0, ["s-0"], 1));
  }) as typeof fetch;
  try {
    await runSessionBulk("http://desktop.test", "archive");
    assert.equal(typeof bodies[0]?.idempotencyKey, "string");
    assert.deepEqual(bodies[0], {
      kind: "archive",
      targets: [{ conversationId: "s-0", expectedVersion: 10 }, { conversationId: "s-1", expectedVersion: 11 }],
      idempotencyKey: bodies[0]?.idempotencyKey
    });
    assert.equal(sessionManagementStore.bulkFailed, 1);
    assert.equal(sessionManagementStore.lastOperationId, "op-2");
    assert.deepEqual(sessionManagementStore.selected, {});
    assert.equal(sessionManagementStore.loading, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("extract-and-archive posts the gated mode and keeps per-item outcomes", async () => {
  const { sessionManagementStore, runSessionExtraction } = await freshStore();
  sessionManagementStore.selected = { "s-0": 10, "s-1": 11 };
  const bodies: Array<Record<string, unknown>> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).endsWith("/api/sessions/managed/extraction")) {
      bodies.push(JSON.parse(String(init?.body)));
      return jsonResponse({
        ok: true,
        mode: "extract-and-archive",
        idempotencyKey: "idem-1",
        counts: { total: 2, archived: 1, failed: 1 },
        items: [
          { conversationId: "s-0", status: "saved", archived: true, messageRevision: "rev-1", processedThroughId: "m-1", failureReasons: [] },
          { conversationId: "s-1", status: "failed", archived: false, archiveReason: "pending review", messageRevision: "rev-2", processedThroughId: null, failureReasons: ["pending candidates"] }
        ]
      });
    }
    return jsonResponse(managedListPayload(0, ["s-0"], 1));
  }) as typeof fetch;
  try {
    await runSessionExtraction("http://desktop.test");
    assert.deepEqual(bodies[0]?.targets, [{ conversationId: "s-0", expectedVersion: 10 }, { conversationId: "s-1", expectedVersion: 11 }]);
    assert.equal(bodies[0]?.mode, "extract-and-archive");
    assert.deepEqual(sessionManagementStore.extractCounts, { total: 2, archived: 1, failed: 1 });
    assert.equal(sessionManagementStore.extractResults[1]?.archiveReason, "pending review");
    assert.deepEqual(sessionManagementStore.extractingIds, {});
    assert.deepEqual(sessionManagementStore.selected, {});
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("preview failure on a purged source renders source-unavailable, and closing clears it", async () => {
  const { sessionManagementStore, openSessionPreview, closeSessionPreview } = await freshStore();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/managed/preview")) return jsonResponse({ ok: false, error: "source-unavailable" }, 404);
    if (url.includes("/extraction/status")) return jsonResponse({ ok: false, error: "source-unavailable" }, 404);
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;
  try {
    await openSessionPreview("http://desktop.test", "gone");
    assert.equal(sessionManagementStore.previewId, "gone");
    assert.equal(sessionManagementStore.previewUnavailable, true);
    assert.deepEqual(sessionManagementStore.previewMessages, []);
    assert.equal(sessionManagementStore.previewExtraction, null);

    closeSessionPreview();
    assert.equal(sessionManagementStore.previewId, "");
    assert.equal(sessionManagementStore.previewUnavailable, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("policy load, preview, save, per-bot apply and remove use the fine-grained settings routes", async () => {
  const {
    sessionManagementStore,
    loadSessionPolicy,
    refreshSessionPolicyPreview,
    saveSessionPolicy,
    applySessionBotOverride,
    removeSessionBotOverride
  } = await freshStore();
  const calls: Array<{ method: string; body: unknown }> = [];
  const overview = {
    ok: true,
    policy: { enabled: true, inactiveDays: 30, bots: { personal: { mode: "inherit" } } },
    previewCount: 4,
    lastRun: { runId: "r1", startedAt: "2026-09-07T00:00:00.000Z", finishedAt: "2026-09-07T00:01:00.000Z", status: "completed", candidateCount: 5, archivedCount: 4, skippedCount: 1, failedCount: 0 }
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
    return jsonResponse(overview);
  }) as typeof fetch;
  try {
    await loadSessionPolicy("http://desktop.test");
    assert.equal(sessionManagementStore.policyEnabled, true);
    assert.equal(sessionManagementStore.policyDays, 30);
    assert.equal(sessionManagementStore.policyPreview, 4);
    assert.equal(sessionManagementStore.lastRun?.archivedCount, 4);

    sessionManagementStore.policyEnabled = false;
    sessionManagementStore.policyDays = 14;
    await refreshSessionPolicyPreview("http://desktop.test");
    assert.equal(sessionManagementStore.policyPreview, 4);

    await saveSessionPolicy("http://desktop.test");
    assert.ok(sessionManagementStore.policyMessage.length > 0);

    await applySessionBotOverride("http://desktop.test", " work ", { mode: "custom", inactiveDays: 90 });
    assert.deepEqual(sessionManagementStore.policyBots, { personal: { mode: "inherit" } });

    await removeSessionBotOverride("http://desktop.test", "personal");

    assert.deepEqual(calls, [
      { method: "GET", body: null },
      { method: "POST", body: { policy: { enabled: false, inactiveDays: 14, bots: { personal: { mode: "inherit" } } } } },
      { method: "PUT", body: { global: { enabled: false, inactiveDays: 14 } } },
      { method: "PUT", body: { botId: "work", bot: { mode: "custom", inactiveDays: 90 } } },
      { method: "DELETE", body: { botId: "personal" } }
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a failed list load keeps the previous rows and surfaces the error", async () => {
  const { sessionManagementStore, loadManagedSessions } = await freshStore();
  sessionManagementStore.items = managedListPayload(0, ["kept"]).items;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => jsonResponse({ ok: false, error: "Invalid state: nope" }, 400)) as typeof fetch;
  try {
    await loadManagedSessions("http://desktop.test");
    assert.equal(sessionManagementStore.loadError, "Invalid state: nope");
    assert.equal(sessionManagementStore.items[0]?.conversationId, "kept");
    assert.equal(sessionManagementStore.loading, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a slower older list request cannot overwrite the newer result", async () => {
  const { sessionManagementStore, loadManagedSessions } = await freshStore();
  const originalFetch = globalThis.fetch;
  let releaseOld: (value: Response) => void = () => {};
  const oldResponse = new Promise<Response>((resolve) => { releaseOld = resolve; });
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    if (calls === 1) return oldResponse;
    return jsonResponse(managedListPayload(0, ["fresh"], 1));
  }) as typeof fetch;
  try {
    const first = loadManagedSessions("http://desktop.test");
    await Promise.resolve();
    const second = loadManagedSessions("http://desktop.test");
    await second;
    releaseOld(jsonResponse(managedListPayload(0, ["stale"], 1)));
    await first;
    assert.equal(sessionManagementStore.items[0]?.conversationId, "fresh");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
