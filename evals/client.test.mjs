import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { runTaskTurns } from "./lib/client.mjs";

test("auto_approve resolves the pending request through the Desktop approval API", async (t) => {
  let approved = false;
  let resolveBody = null;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
    response.setHeader("content-type", "application/json");

    if (request.url === "/api/sessions" && request.method === "POST") {
      response.end(JSON.stringify({ ok: true, session: { id: "session-h2" } }));
      return;
    }
    if (request.url === "/api/chat" && request.method === "POST") {
      while (!approved) await new Promise((resolve) => setTimeout(resolve, 10));
      response.end(JSON.stringify({ ok: true, response: "installed", conversationId: "session-h2" }));
      return;
    }
    if (request.url === "/api/desktop/host-bash" && body?.action === "list_pending") {
      response.end(JSON.stringify({
        ok: true,
        approvals: approved ? [] : [{ type: "host_bash_approval", requestId: "broker-miniapp-1" }]
      }));
      return;
    }
    if (request.url === "/api/desktop/host-bash" && body?.action === "resolve_approval") {
      resolveBody = body;
      approved = true;
      response.end(JSON.stringify({ ok: true, approval: { status: "approved" } }));
      return;
    }
    if (request.url === "/api/sessions/session-h2" && request.method === "GET") {
      response.end(JSON.stringify({ ok: true, session: { messages: [] } }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ ok: false }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === "object");

  const result = await runTaskTurns(`http://127.0.0.1:${address.port}`, {
    id: "H2",
    autoApprove: true,
    turns: [{ prompt: "install it", files: [], newSession: false }]
  }, { fixtureDir: process.cwd() });

  assert.equal(result.reply, "installed");
  assert.deepEqual(resolveBody, {
    action: "resolve_approval",
    profileId: "personal",
    sessionId: "session-h2",
    requestId: "broker-miniapp-1",
    decision: "approve_once"
  });
});
