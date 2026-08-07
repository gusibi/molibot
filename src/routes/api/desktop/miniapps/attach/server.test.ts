import assert from "node:assert/strict";
import test from "node:test";
import type { MiniAppHost } from "$lib/server/miniapps/host.js";
import { MiniAppError } from "$lib/server/miniapps/types.js";
import { _handleMiniAppAttachRequest, _MAX_BRIDGE_ATTACH_BYTES } from "./+server.js";

function attachRequest(body: unknown): Request {
  return new Request("http://localhost/api/desktop/miniapps/attach", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

test("the route returns file bytes for a path inside the App's data directory", async () => {
  let asked: { appId: string; path: string; maxBytes: number } | null = null;
  const host = {
    readDataFile: (appId: string, filePath: string, maxBytes: number) => {
      asked = { appId, path: filePath, maxBytes };
      return { bytes: Buffer.from("PNGDATA", "utf8"), name: "chart.png" };
    }
  } as unknown as MiniAppHost;

  const response = await _handleMiniAppAttachRequest(
    attachRequest({ appId: "charts", path: "exports/chart.png" }),
    { host }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    name: "chart.png",
    base64: Buffer.from("PNGDATA", "utf8").toString("base64")
  });
  // The host — not the route — owns resolution, and it receives the app id the
  // panel is bound to plus the ceiling.
  assert.deepEqual(asked, { appId: "charts", path: "exports/chart.png", maxBytes: _MAX_BRIDGE_ATTACH_BYTES });
});

test("the response carries only a basename and bytes, never a host path", async () => {
  // The host returns a basename; the route must not widen that back out into
  // anything the WebView could learn a directory from.
  const host = {
    readDataFile: () => ({ bytes: Buffer.from("x"), name: "chart.png" })
  } as unknown as MiniAppHost;

  const response = await _handleMiniAppAttachRequest(
    attachRequest({ appId: "charts", path: "exports/chart.png" }),
    { host }
  );
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ["base64", "name", "ok"]);
  assert.equal(body.name.includes("/"), false);
  assert.equal(body.name, "chart.png");
});

test("a missing or non-string field is refused before the host is touched", async () => {
  let called = false;
  const host = {
    readDataFile: () => {
      called = true;
      return { bytes: Buffer.from(""), name: "x" };
    }
  } as unknown as MiniAppHost;

  // `String({})` is the truthy "[object Object]" that turned into a real side
  // effect in pitfall #26d; the route must reject rather than coerce.
  for (const body of [
    {},
    { appId: "charts" },
    { path: "exports/chart.png" },
    { appId: {}, path: "exports/chart.png" },
    { appId: "charts", path: 42 },
    { appId: "", path: "exports/chart.png" }
  ]) {
    const response = await _handleMiniAppAttachRequest(attachRequest(body), { host });
    assert.equal(response.status, 400, `expected ${JSON.stringify(body)} to be refused`);
  }
  assert.equal(called, false);
});

test("a non-JSON body is refused", async () => {
  const host = { readDataFile: () => ({ bytes: Buffer.from(""), name: "x" }) } as unknown as MiniAppHost;
  const response = await _handleMiniAppAttachRequest(attachRequest("not json"), { host });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "invalid_input");
});

test("host refusals map to their own status rather than a generic failure", async () => {
  const cases: Array<[MiniAppError["code"], number]> = [
    ["not_found", 404],
    ["disabled", 403],
    ["forbidden", 403],
    ["invalid_input", 400],
    ["load_failed", 503]
  ];
  for (const [code, status] of cases) {
    const host = {
      readDataFile: () => {
        throw new MiniAppError("refused", code);
      }
    } as unknown as MiniAppHost;
    const response = await _handleMiniAppAttachRequest(
      attachRequest({ appId: "charts", path: "exports/chart.png" }),
      { host }
    );
    assert.equal(response.status, status, `expected ${code} to map to ${status}`);
    assert.deepEqual(await response.json(), { ok: false, error: "refused", code });
  }
});

test("an unexpected throw does not leak its message to the WebView", async () => {
  const host = {
    readDataFile: () => {
      throw new Error("ENOENT: /Users/someone/.molibot/miniapps/data/charts/x");
    }
  } as unknown as MiniAppHost;

  const response = await _handleMiniAppAttachRequest(
    attachRequest({ appId: "charts", path: "exports/chart.png" }),
    { host }
  );
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.error, "Mini App attachment failed.");
  assert.equal(JSON.stringify(body).includes("/Users/"), false);
});

test("the size ceiling is the route's, not the caller's", async () => {
  // A client cannot ask for a larger read by supplying its own limit.
  let maxBytes = 0;
  const host = {
    readDataFile: (_appId: string, _path: string, limit: number) => {
      maxBytes = limit;
      return { bytes: Buffer.from("x"), name: "x" };
    }
  } as unknown as MiniAppHost;

  await _handleMiniAppAttachRequest(
    attachRequest({ appId: "charts", path: "exports/chart.png", maxBytes: 999_999_999 }),
    { host }
  );
  assert.equal(maxBytes, _MAX_BRIDGE_ATTACH_BYTES);
});
