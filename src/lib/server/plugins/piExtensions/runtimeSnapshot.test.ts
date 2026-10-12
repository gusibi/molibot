import assert from "node:assert/strict";
import test from "node:test";
import { buildPiExtensionRuntimeSnapshot } from "$lib/server/plugins/piExtensions/runtimeSnapshot.js";

test("the snapshot serializes real run state and drops model headers", () => {
  const snapshot = buildPiExtensionRuntimeSnapshot({
    cwd: "/workspace",
    systemPrompt: "system prompt",
    sessionId: "s-1",
    model: { provider: "anthropic", id: "claude", api: "messages", headers: { authorization: "secret" } },
    thinkingLevel: "high",
    scopedModels: [{ model: { provider: "openai", id: "gpt", headers: { authorization: "secret" } }, thinkingLevel: "low" }],
    isIdle: false,
    pendingMessages: 2,
    contextUsage: { tokens: 500, contextWindow: 1000 }
  });

  assert.equal(snapshot.cwd, "/workspace");
  assert.equal(snapshot.systemPrompt, "system prompt");
  assert.equal(snapshot.sessionId, "s-1");
  assert.deepEqual(snapshot.model, { provider: "anthropic", id: "claude", api: "messages" });
  assert.equal(snapshot.thinkingLevel, "high");
  assert.deepEqual(snapshot.scopedModels, [{ model: { provider: "openai", id: "gpt" }, thinkingLevel: "low" }]);
  assert.equal(snapshot.isIdle, false);
  assert.equal(snapshot.hasPendingMessages, true);
  assert.deepEqual(snapshot.contextUsage, { tokens: 500, contextWindow: 1000, percent: 50 });
  // Credentials never travel to the worker.
  assert.equal(JSON.stringify(snapshot).includes("secret"), false);
});

test("the snapshot omits unknown fields and defaults empty scoping", () => {
  const snapshot = buildPiExtensionRuntimeSnapshot({ cwd: "/w", isIdle: true });
  assert.equal(snapshot.cwd, "/w");
  assert.equal(snapshot.systemPrompt, "");
  assert.equal("model" in snapshot, false);
  assert.equal("thinkingLevel" in snapshot, false);
  assert.deepEqual(snapshot.scopedModels, []);
  assert.equal(snapshot.isIdle, true);
  assert.equal(snapshot.hasPendingMessages, false);
  assert.equal("contextUsage" in snapshot, false);
});

test("the snapshot carries the session view and defaults its cwd", () => {
  const withSession = buildPiExtensionRuntimeSnapshot({
    cwd: "/w",
    isIdle: false,
    session: { id: "s", cwd: "", entries: [{ id: "1", kind: "message", messages: [] }] }
  });
  assert.equal(withSession.session.id, "s");
  assert.equal(withSession.session.cwd, "/w");
  assert.equal(withSession.session.entries.length, 1);

  const empty = buildPiExtensionRuntimeSnapshot({ cwd: "/w", isIdle: false });
  assert.deepEqual(empty.session, { cwd: "/w", entries: [] });
});

test("context usage reports a null percent when tokens are unknown", () => {
  const snapshot = buildPiExtensionRuntimeSnapshot({ cwd: "/w", isIdle: false, contextUsage: { tokens: null, contextWindow: 1000 } });
  assert.deepEqual(snapshot.contextUsage, { tokens: null, contextWindow: 1000, percent: null });
});
