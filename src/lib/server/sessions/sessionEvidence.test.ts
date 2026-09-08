import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { SessionStore } from "$lib/server/sessions/store.js";
import { resolveSessionEvidence } from "$lib/server/sessions/sessionEvidence.js";

const OWNER = "web:personal:web-anonymous";

function setup() {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-session-evidence-"));
  const originals = {
    webWorkspaceDir: storagePaths.webWorkspaceDir,
    sessionsDir: storagePaths.sessionsDir,
    sessionsIndexFile: storagePaths.sessionsIndexFile
  };
  storagePaths.webWorkspaceDir = path.join(root, "web");
  storagePaths.sessionsDir = path.join(root, "legacy");
  storagePaths.sessionsIndexFile = path.join(root, "legacy-index.json");
  return {
    sessions: new SessionStore(),
    teardown() {
      Object.assign(storagePaths, originals);
      rmSync(root, { recursive: true, force: true });
    }
  };
}

test("live source resolves to an available snippet", (t) => {
  const fx = setup();
  t.after(() => fx.teardown());
  const conversation = fx.sessions.createWebConversation(OWNER);
  fx.sessions.appendMessage(conversation.id, "user", "evidence content here");
  const [first] = fx.sessions.listMessageMetadata(conversation.id);

  const evidence = resolveSessionEvidence(fx.sessions, conversation.id, first?.id);
  assert.equal(evidence.status, "available");
  if (evidence.status !== "available") return;
  assert.equal(evidence.conversationMessageId, first?.id);
  assert.match(evidence.snippet ?? "", /evidence content/);
});

test("purged source renders source-unavailable instead of crashing", (t) => {
  const fx = setup();
  t.after(() => fx.teardown());
  const conversation = fx.sessions.createWebConversation(OWNER);
  fx.sessions.appendMessage(conversation.id, "user", "doomed evidence");
  const [first] = fx.sessions.listMessageMetadata(conversation.id);
  assert.ok(first?.id);
  fx.sessions.deleteConversation(conversation.id, "web", OWNER);

  assert.deepEqual(resolveSessionEvidence(fx.sessions, conversation.id, first?.id), {
    status: "source-unavailable",
    conversationId: conversation.id,
    conversationMessageId: first?.id
  });
  assert.deepEqual(resolveSessionEvidence(fx.sessions, conversation.id), {
    status: "source-unavailable",
    conversationId: conversation.id
  });
});

test("unknown message and broken stores never throw", (t) => {
  const fx = setup();
  t.after(() => fx.teardown());
  const conversation = fx.sessions.createWebConversation(OWNER);
  fx.sessions.appendMessage(conversation.id, "user", "hello");

  const missing = resolveSessionEvidence(fx.sessions, conversation.id, "no-such-message");
  assert.equal(missing.status, "source-unavailable");

  const broken = resolveSessionEvidence(
    { listMessageMetadata: () => { throw new Error("store gone"); } },
    conversation.id,
    "m1"
  );
  assert.equal(broken.status, "source-unavailable");
});
