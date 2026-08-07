import assert from "node:assert/strict";
import test from "node:test";
import type { MiniAppHost } from "$lib/server/miniapps/host.js";
import type { MiniAppCatalogEntry } from "$lib/server/miniapps/types.js";
import { _handleMiniAppBadgeClearRequest } from "./+server.js";

function catalogEntry(overrides: Partial<MiniAppCatalogEntry> = {}): MiniAppCatalogEntry {
  return {
    id: "notes",
    name: "Notes",
    version: "1.0.0",
    status: "active",
    enabled: true,
    builtin: false,
    hasUi: true,
    toolNames: ["add"],
    messageActions: [],
    aiCapabilities: [],
    badge: { kind: "count", count: 3 },
    iconDataUri: "",
    source: { kind: "directory", label: "local" },
    updateAvailable: false,
    availableVersion: "",
    ...overrides
  };
}

function hostWithBadge(cleared: string[]): MiniAppHost {
  let badge: MiniAppCatalogEntry["badge"] = { kind: "count", count: 3 };
  return {
    clearBadge: (appId: string) => {
      cleared.push(appId);
      badge = null;
    },
    listCatalog: () => [catalogEntry({ badge })],
    listBuiltinCatalog: () => []
  } as unknown as MiniAppHost;
}

function badgeRequest(body: unknown): Request {
  return new Request("http://localhost/api/desktop/miniapps/badge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

test("clearing a badge answers with the refreshed catalog, not just ok", async () => {
  // The sidebar applies one authoritative snapshot rather than guessing its own
  // request succeeded and drifting from the host when it did not.
  const cleared: string[] = [];
  const response = await _handleMiniAppBadgeClearRequest(badgeRequest({ appId: "notes" }), {
    host: hostWithBadge(cleared)
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].badge, null);
  assert.deepEqual(body.builtin, []);
  assert.deepEqual(cleared, ["notes"]);
});

test("an unknown app id is a no-op success rather than an error", async () => {
  // The owner cannot act on "that badge was already gone", so reporting it as a
  // failure would be noise.
  const cleared: string[] = [];
  const response = await _handleMiniAppBadgeClearRequest(badgeRequest({ appId: "ghost" }), {
    host: hostWithBadge(cleared)
  });
  assert.equal(response.status, 200);
  assert.deepEqual(cleared, ["ghost"]);
});

test("a missing or non-string appId is refused before the host is touched", async () => {
  const cleared: string[] = [];
  const host = hostWithBadge(cleared);
  for (const body of [{}, { appId: "" }, { appId: 42 }, { appId: {} }, "not json"]) {
    const response = await _handleMiniAppBadgeClearRequest(badgeRequest(body), { host });
    assert.equal(response.status, 400, `expected ${JSON.stringify(body)} to be refused`);
  }
  assert.deepEqual(cleared, []);
});

test("the route cannot set a badge, only clear one", async () => {
  // Two writers for one value is how the sidebar and the host disagree; the
  // app's server code is the only writer.
  const host = hostWithBadge([]);
  const response = await _handleMiniAppBadgeClearRequest(
    badgeRequest({ appId: "notes", badge: { kind: "count", count: 99 } }),
    { host }
  );
  assert.equal((await response.json()).items[0].badge, null);
});
