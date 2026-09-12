import assert from "node:assert/strict";
import test from "node:test";
import { GET as getSessionPath } from "./+server.js";
import { POST as revealSession } from "../reveal/+server.js";

test("path endpoint requires sessionId", async () => {
  const url = new URL("http://localhost/api/desktop/conversations/path");
  const response = await getSessionPath({ url } as any);
  assert.equal(response.status, 400);
  const data = await response.json();
  assert.equal(data.ok, false);
  assert.equal(data.error, "sessionId is required");
});

test("reveal endpoint requires sessionId", async () => {
  const request = new Request("http://localhost/api/desktop/conversations/reveal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  const response = await revealSession({ request } as any);
  assert.equal(response.status, 400);
  const data = await response.json();
  assert.equal(data.ok, false);
  assert.equal(data.error, "sessionId is required");
});
