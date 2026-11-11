import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PiRecoveryStore } from "$lib/server/agent/core/piRecoveryStore.js";
import { piRecoveryCandidates } from "./piRecovery.js";

test("a reopened recovery store preserves the App strategy while old admissions keep the default", () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-app-policy-recovery-"));
  const store = new PiRecoveryStore(directory);
  const record = { runId: "app", workspaceDir: directory, chatId: "chat", sessionId: "session", channel: "web", context: { retryPolicy: "app" as const }, actor: "actor", workspaceId: "personal", models: [], deferred: false };
  store.save(record); store.save({ ...record, runId: "existing", context: {} }); store.close();
  const reopened = new PiRecoveryStore(directory);
  try {
    assert.equal(reopened.read("app")?.context.retryPolicy, "app");
    assert.equal(reopened.read("existing")?.context.retryPolicy, undefined);
  } finally { reopened.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("startup preserves parked review ownership across another restart without admitting ordinary approvals", () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-pi-review-candidates-"));
  const store = new PiRecoveryStore(directory);
  try {
    const states = new Map([["active", "running"], ["review", "recovery_review"], ["approval", "waiting_for_approval"], ["done", "completed"]]);
    for (const runId of states.keys()) store.save({ runId, workspaceDir: directory, chatId: "chat", sessionId: runId,
      channel: "web", context: {}, actor: "actor", workspaceId: "personal", models: [], deferred: false });
    assert.deepEqual(piRecoveryCandidates(directory, id => states.get(id)).map(record => record.runId).sort(), ["active", "review"]);
    assert.ok(store.read("review"));
    assert.ok(store.read("approval"));
    assert.equal(store.read("done"), undefined);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
