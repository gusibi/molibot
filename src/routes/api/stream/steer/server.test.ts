import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Runtime paths are resolved at module load, so point the whole runtime at a
// throwaway data dir before anything imports it (never the user's real store).
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "molibot-steer-route-"));

const load = async () => (await import("./+server.js")).POST as unknown as (
  event: { request: Request }
) => Promise<Response>;

async function call(body: unknown): Promise<{ status: number; payload: unknown }> {
  const post = await load();
  const response = await post({
    request: new Request("http://localhost/api/stream/steer", { method: "POST", body: JSON.stringify(body) })
  });
  return { status: response.status, payload: await response.json() };
}

test("steer requires a conversation and a message", async () => {
  assert.deepEqual(await call({ conversationId: "", text: "hi" }), {
    status: 400,
    payload: { ok: false, error: "conversationId is required" }
  });
  assert.deepEqual(await call({ conversationId: "abc", text: "   " }), {
    status: 400,
    payload: { ok: false, error: "text is required" }
  });
});

// `delivered: false` is what lets the client keep the message queued instead of
// losing it when the turn ended between the click and the request.
test("steering a session with no running turn reports it as undelivered", async () => {
  assert.deepEqual(await call({ profileId: "personal", conversationId: "no-such-session", text: "hurry up" }), {
    status: 200,
    payload: { ok: true, delivered: false }
  });
});
