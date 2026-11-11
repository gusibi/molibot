import test from "node:test";
import assert from "node:assert/strict";
import { parseStreamRequest, streamRetryPolicy } from "./request.js";

test("only an explicit Desktop request selects the App surface; existing JSON requests remain unchanged", async () => {
  for (const clientSurface of [undefined, "desktop", "web", "feishu", true]) {
    const parsed = await parseStreamRequest(new Request("http://localhost/api/stream", { method: "POST", body: JSON.stringify({ message: "hello", clientSurface }) }));
    assert.equal(parsed.clientSurface, clientSurface === "desktop" ? "desktop" : undefined);
    assert.equal(streamRetryPolicy(parsed, false, false), clientSurface === "desktop" ? "app" : undefined);
    assert.equal(streamRetryPolicy(parsed, true, false), undefined);
    assert.equal(streamRetryPolicy(parsed, false, true), undefined);
  }
});

test("Desktop attachment requests preserve the surface marker", async () => {
  const body = new FormData(); body.set("clientSurface", "desktop"); body.set("message", "hello");
  body.append("files", new File(["test"], "test.txt"));
  const parsed = await parseStreamRequest(new Request("http://localhost/api/stream", { method: "POST", body }));
  assert.equal(parsed.clientSurface, "desktop");
  assert.equal(parsed.files.length, 1);
});
