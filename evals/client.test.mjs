import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runTaskTurns } from "./lib/client.mjs";

/**
 * The attachment turn must arrive as a parseable multipart body.
 *
 * `sendTurn` posts through undici's `fetch` (the global one takes no
 * `dispatcher`, which is how a run gets a timeout longer than a task). undici
 * detects a form body by an internal brand it only stamps on its own
 * `FormData`, so building the form with Node's *global* class made it fall
 * through to generic body handling and reach the service as something it
 * answered `400 Invalid request body` to. Every attachment task (B2-B6) then
 * errored in ~0s and the scoreboard read "the Agent cannot ingest documents"
 * while the product path was fine.
 *
 * This asserts what the wire actually carries — a multipart content-type and
 * the file's bytes inside the body — so the same realm mismatch cannot come
 * back through a new upload call site.
 */
test("an attachment turn is sent as a real multipart body the server can parse", async (t) => {
  const fixtureDir = mkdtempSync(path.join(tmpdir(), "eval-client-upload-"));
  writeFileSync(path.join(fixtureDir, "probe.txt"), "MOLIBOT-UPLOAD-PROBE");

  let seenContentType = null;
  let seenBody = null;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/chat" && request.method === "POST") {
      seenContentType = request.headers["content-type"] ?? "";
      seenBody = Buffer.concat(chunks).toString("utf8");
      response.end(JSON.stringify({ ok: true, response: "read it", conversationId: "s-upload" }));
      return;
    }
    if (request.url?.startsWith("/api/sessions/")) {
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
    id: "UPLOAD",
    turns: [{ prompt: "what does it say", files: ["probe.txt"] }]
  }, { fixtureDir });

  assert.equal(result.reply, "read it");
  assert.match(seenContentType ?? "", /^multipart\/form-data; boundary=/);
  // The parts the server reads: the file's own bytes and the form fields.
  assert.match(seenBody ?? "", /MOLIBOT-UPLOAD-PROBE/);
  assert.match(seenBody ?? "", /name="files"; filename="probe\.txt"/);
  assert.match(seenBody ?? "", /name="message"/);
});

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
